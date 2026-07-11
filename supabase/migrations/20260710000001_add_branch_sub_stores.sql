-- Migration: Add sub-stores support under branches and POS sale attribution
-- Date: 2026-07-10

-- 1. Alter public.branches to support hierarchy (parent-child relationship)
ALTER TABLE public.branches 
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.branches(id) ON DELETE CASCADE;

-- 2. Alter public.sales to support attributing sales to a specific sub-store/brand
ALTER TABLE public.sales
ADD COLUMN IF NOT EXISTS sub_store_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- 3. Update the branch limit trigger to only count physical parent branches (parent_id IS NULL)
CREATE OR REPLACE FUNCTION public.check_branch_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_limit INT;
    v_count INT;
BEGIN
    -- If it's a sub-store (parent_id is not null), it doesn't count towards the physical branch limit
    IF NEW.parent_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT max_branches INTO v_limit FROM public.tenants WHERE id = NEW.tenant_id;
    SELECT COUNT(*) INTO v_count FROM public.branches WHERE tenant_id = NEW.tenant_id AND parent_id IS NULL;
    
    IF v_count >= v_limit THEN
        RAISE EXCEPTION 'Branch limit reached for this tenant plan (max: %).', v_limit;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Redefine fn_process_sale to support optional sub_store_id
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id        UUID,
    p_items            JSONB,   -- [{ "menu_item_id": "...", "quantity": N }]
    p_payment_method   TEXT    DEFAULT 'cash',
    p_amount_tendered  NUMERIC DEFAULT NULL,
    p_sale_category    TEXT    DEFAULT NULL,
    p_reference_number TEXT    DEFAULT NULL,
    p_queue_number     TEXT    DEFAULT NULL,
    p_sub_store_id     UUID    DEFAULT NULL
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
    v_initial_status TEXT;
BEGIN
    -- Validate payment_method
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- Set initial queue status if queue number is present
    IF p_queue_number IS NOT NULL AND p_queue_number <> '' THEN
        v_initial_status := 'preparing';
    ELSE
        v_initial_status := NULL;
    END IF;

    -- 1. Create Sale Record (total calculated below)
    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method, 
        sale_category, reference_number, queue_number, queue_status, queue_updated_at
    )
    VALUES (
        p_branch_id, p_sub_store_id, auth.uid(), 0, 'completed', p_payment_method, 
        p_sale_category, p_reference_number, p_queue_number, v_initial_status, now()
    )
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

        -- 3. Ingredient deductions (always scopes to the parent branch_id)
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
            'sub_store_id',     p_sub_store_id,
            'total_amount',     v_total_amount,
            'payment_method',   p_payment_method,
            'amount_tendered',  p_amount_tendered,
            'change_given',     v_change,
            'sale_category',    p_sale_category,
            'reference_number', p_reference_number,
            'queue_number',     p_queue_number
        )::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- 5. Redefine fn_process_offline_sale to support optional sub_store_id
CREATE OR REPLACE FUNCTION public.fn_process_offline_sale(
    p_branch_id       UUID,
    p_items           JSONB,   -- [{ "menu_item_id": "...", "quantity": N }]
    p_payment_method  TEXT,
    p_amount_tendered NUMERIC,
    p_sale_category   TEXT,
    p_reference_number TEXT,
    p_control_number  TEXT,
    p_created_at      TIMESTAMPTZ,
    p_cashier_id      UUID,
    p_queue_number    TEXT DEFAULT NULL,
    p_sub_store_id    UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sale_id            UUID;
    r_item               RECORD;
    r_ing                RECORD;
    v_total_amount       NUMERIC := 0;
    v_qty_needed         NUMERIC;
    v_current_qty        NUMERIC;
    v_item_name          TEXT;
    v_menu_name          TEXT;
    v_price              NUMERIC;
    v_subtotal           NUMERIC;
    v_change             NUMERIC;
    v_type               TEXT;
    v_inventory_item_id  UUID;
    v_cost_price         NUMERIC := 0;
    v_tenant_id          UUID;
    v_initial_status     TEXT;
    v_calc_total         NUMERIC := 0;
BEGIN
    -- Resolve context tenant
    v_tenant_id := public.get_my_tenant_id();

    -- Validate payment_method
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- Validate control number uniqueness strictly within this tenant's scope to prevent duplicate syncs
    IF EXISTS (
        SELECT 1 FROM public.sales 
        WHERE control_number = p_control_number 
          AND tenant_id = v_tenant_id
    ) THEN
        SELECT id INTO v_sale_id FROM public.sales 
        WHERE control_number = p_control_number 
          AND tenant_id = v_tenant_id;
        RETURN v_sale_id; -- Return existing ID if already synced
    END IF;

    -- Set initial queue status
    IF p_queue_number IS NOT NULL AND p_queue_number <> '' THEN
        v_initial_status := 'preparing';
    ELSE
        v_initial_status := NULL;
    END IF;

    -- 1. Create Sale Record (tenant_id auto-stamped by trigger)
    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method, 
        sale_category, reference_number, control_number, created_at,
        queue_number, queue_status, queue_updated_at
    )
    VALUES (
        p_branch_id, p_sub_store_id, p_cashier_id, 0, 'completed', p_payment_method, 
        p_sale_category, p_reference_number, p_control_number, p_created_at,
        p_queue_number, v_initial_status, p_created_at
    )
    RETURNING id INTO v_sale_id;

    -- 2. Loop menu items
    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch item properties
        SELECT price, name, type, inventory_item_id INTO v_price, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_calc_total    := v_calc_total + v_subtotal;

        -- Calculate cost price at time of sale
        IF v_type = 'restaurant' THEN
            SELECT COALESCE(SUM(ri.quantity_base_unit * ii.cost_per_base_unit), 0)
            INTO v_cost_price
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items ii ON ii.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id;
        ELSIF v_type = 'retail' AND v_inventory_item_id IS NOT NULL THEN
            SELECT COALESCE(cost_per_base_unit, 0)
            INTO v_cost_price
            FROM public.inventory_items
            WHERE id = v_inventory_item_id;
        ELSE
            v_cost_price := 0;
        END IF;

        -- Insert sale line item
        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, tenant_id)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id);

        -- 3. Ingredient deductions if type is restaurant
        IF v_type = 'restaurant' THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes           r  ON r.id = ri.recipe_id
                JOIN public.inventory_items   i  ON i.id = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                -- Deduct balance directly (allow negative/overdraw for offline to sync, then alert)
                UPDATE public.inventory_balances
                SET quantity = quantity - v_qty_needed, updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                -- Movement ledger
                INSERT INTO public.inventory_movements
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', p_cashier_id, v_tenant_id);

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;
        ELSIF v_type = 'retail' AND v_inventory_item_id IS NOT NULL THEN
            -- Direct retail catalog deduction
            UPDATE public.inventory_balances
            SET quantity = quantity - r_item.qty, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES
                (p_branch_id, v_inventory_item_id, -r_item.qty, 'sale_deduction', v_sale_id, 'sale', p_cashier_id, v_tenant_id);

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
        END IF;
    END LOOP;

    -- 4. Calculate change
    IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL THEN
        v_change := p_amount_tendered - v_calc_total;
    ELSE
        v_change := 0;
    END IF;

    -- 5. Finalize sale with totals + payment info
    UPDATE public.sales
    SET total_amount    = v_calc_total,
        amount_tendered = p_amount_tendered,
        change_given    = v_change
    WHERE id = v_sale_id;

    -- 6. Audit log
    PERFORM public.fn_log_audit(
        p_cashier_id,
        'POS_SALE_OFFLINE',
        'Sales',
        NULL,
        json_build_object(
            'sale_id',          v_sale_id,
            'branch_id',        p_branch_id,
            'sub_store_id',     p_sub_store_id,
            'total_amount',     v_calc_total,
            'payment_method',   p_payment_method,
            'amount_tendered',  p_amount_tendered,
            'change_given',     v_change,
            'sale_category',    p_sale_category,
            'reference_number', p_reference_number,
            'control_number',   p_control_number,
            'queue_number',     p_queue_number
        )::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_process_offline_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, UUID) TO authenticated;
