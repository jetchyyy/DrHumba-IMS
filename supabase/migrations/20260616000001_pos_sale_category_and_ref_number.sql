-- Migration: Add sale_category and reference_number to sales table & update fn_process_sale
-- Created: 2026-06-16

-- 1. Add fields to public.sales
ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS sale_category TEXT,
    ADD COLUMN IF NOT EXISTS reference_number TEXT;

-- 2. Redefine fn_process_sale to handle sale_category and reference_number
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id        UUID,
    p_items            JSONB,   -- [{ "menu_item_id": "...", "quantity": N }]
    p_payment_method   TEXT    DEFAULT 'cash',
    p_amount_tendered  NUMERIC DEFAULT NULL,
    p_sale_category    TEXT    DEFAULT NULL,
    p_reference_number TEXT    DEFAULT NULL
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
    INSERT INTO public.sales (branch_id, cashier_id, total_amount, status, payment_method, sale_category, reference_number)
    VALUES (p_branch_id, auth.uid(), 0, 'completed', p_payment_method, p_sale_category, p_reference_number)
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
            'sale_id',          v_sale_id,
            'branch_id',        p_branch_id,
            'total_amount',     v_total_amount,
            'payment_method',   p_payment_method,
            'amount_tendered',  p_amount_tendered,
            'change_given',     v_change,
            'sale_category',    p_sale_category,
            'reference_number', p_reference_number
        )::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT) TO authenticated;
