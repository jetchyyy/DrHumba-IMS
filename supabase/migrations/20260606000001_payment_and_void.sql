-- ============================================================
-- MIGRATION: Payment Tender Tracking + Void/Refund RPC
-- ============================================================

-- 1. Add payment fields to the sales table
ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'card', 'gcash', 'maya', 'other')),
    ADD COLUMN IF NOT EXISTS amount_tendered NUMERIC,
    ADD COLUMN IF NOT EXISTS change_given    NUMERIC,
    ADD COLUMN IF NOT EXISTS voided_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS voided_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS void_reason     TEXT;

-- 2. Update fn_process_sale to accept payment details
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id      UUID,
    p_items          JSONB,   -- [{ "menu_item_id": "...", "quantity": N }]
    p_payment_method TEXT    DEFAULT 'cash',
    p_amount_tendered NUMERIC DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sale_id       UUID;
    r_item          RECORD;
    r_ing           RECORD;
    v_total_amount  NUMERIC := 0;
    v_qty_needed    NUMERIC;
    v_current_qty   NUMERIC;
    v_item_name     TEXT;
    v_menu_name     TEXT;
    v_price         NUMERIC;
    v_subtotal      NUMERIC;
    v_change        NUMERIC;
BEGIN
    -- Validate payment_method
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- 1. Create Sale Record (total calculated below)
    INSERT INTO public.sales (branch_id, cashier_id, total_amount, status, payment_method)
    VALUES (p_branch_id, auth.uid(), 0, 'completed', p_payment_method)
    RETURNING id INTO v_sale_id;

    -- 2. Loop menu items — price calculation + ingredient stock deduction
    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch price
        SELECT price, name INTO v_price, v_menu_name
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_total_amount  := v_total_amount + v_subtotal;

        -- Insert sale line item
        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal);

        -- 3. Ingredient deductions
        FOR r_ing IN (
            SELECT ri.item_id, ri.quantity_base_unit, i.item_name
            FROM public.recipe_ingredients ri
            JOIN public.recipes           r  ON r.id  = ri.recipe_id
            JOIN public.inventory_items   i  ON i.id  = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) LOOP
            v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

            SELECT COALESCE(quantity, 0) INTO v_current_qty
            FROM public.inventory_balances
            WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

            IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                RAISE EXCEPTION 'Insufficient stock for ingredient %: required %, current %',
                    r_ing.item_name, v_qty_needed, COALESCE(v_current_qty, 0);
            END IF;

            -- Deduct balance
            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

            -- Movement ledger
            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
            VALUES
                (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid());

            PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
        END LOOP;
    END LOOP;

    -- 4. Calculate change (cash only; card/digital = exact)
    IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL THEN
        IF p_amount_tendered < v_total_amount THEN
            RAISE EXCEPTION 'Insufficient tender: total is %, tendered is %', v_total_amount, p_amount_tendered;
        END IF;
        v_change := p_amount_tendered - v_total_amount;
    ELSE
        v_change := 0;
    END IF;

    -- 5. Finalize sale with totals + payment info
    UPDATE public.sales
    SET total_amount    = v_total_amount,
        amount_tendered = p_amount_tendered,
        change_given    = v_change
    WHERE id = v_sale_id;

    -- 6. Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'POS_SALE',
        'Sales',
        NULL,
        json_build_object(
            'sale_id',        v_sale_id,
            'branch_id',      p_branch_id,
            'total_amount',   v_total_amount,
            'payment_method', p_payment_method,
            'amount_tendered',p_amount_tendered,
            'change_given',   v_change
        )::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Void / Refund RPC (admin + branch_manager only)
CREATE OR REPLACE FUNCTION public.fn_void_sale(
    p_sale_id    UUID,
    p_void_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_my_role    TEXT;
    v_status     TEXT;
    v_branch_id  UUID;
    r_item       RECORD;
    r_ing        RECORD;
    v_qty_return NUMERIC;
BEGIN
    -- Authorization
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role NOT IN ('super_admin', 'branch_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only super_admin or branch_manager can void a sale.';
    END IF;

    -- Fetch sale
    SELECT status, branch_id INTO v_status, v_branch_id
    FROM public.sales WHERE id = p_sale_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    IF v_status = 'refunded' THEN
        RAISE EXCEPTION 'Sale % has already been voided/refunded.', p_sale_id;
    END IF;

    -- Reverse ingredient deductions (re-stock)
    FOR r_item IN (
        SELECT si.menu_item_id, si.quantity
        FROM public.sale_items si
        WHERE si.sale_id = p_sale_id
    ) LOOP
        FOR r_ing IN (
            SELECT ri.item_id, ri.quantity_base_unit, i.item_name
            FROM public.recipe_ingredients ri
            JOIN public.recipes           r  ON r.id = ri.recipe_id
            JOIN public.inventory_items   i  ON i.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) LOOP
            v_qty_return := r_ing.quantity_base_unit * r_item.quantity;

            -- Add stock back
            INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
            VALUES (v_branch_id, r_ing.item_id, v_qty_return, now())
            ON CONFLICT (branch_id, item_id)
            DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

            -- Reverse movement ledger
            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
            VALUES
                (v_branch_id, r_ing.item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid());
        END LOOP;
    END LOOP;

    -- Mark sale as refunded
    UPDATE public.sales
    SET status      = 'refunded',
        voided_by   = auth.uid(),
        voided_at   = now(),
        void_reason = p_void_reason
    WHERE id = p_sale_id;

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'VOID_SALE',
        'Sales',
        json_build_object('sale_id', p_sale_id, 'old_status', v_status)::jsonb,
        json_build_object('sale_id', p_sale_id, 'new_status', 'refunded', 'void_reason', p_void_reason)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update RLS: allow super_admin / branch_manager to UPDATE sales (for void)
DROP POLICY IF EXISTS "Void sales (admin/manager)" ON public.sales;
CREATE POLICY "Void sales (admin/manager)" ON public.sales
    FOR UPDATE TO authenticated
    USING (
        public.get_my_role() IN ('super_admin', 'branch_manager') AND
        (public.get_my_role() = 'super_admin' OR public.get_my_branch_id() = branch_id)
    );
