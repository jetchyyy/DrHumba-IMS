-- ============================================================
-- MIGRATION: Support Dynamic Platform & Custom Unit Pricing in fn_process_sale & fn_process_offline_sale
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id        UUID,
    p_items            JSONB,   -- [{ "menu_item_id": "...", "quantity": N, "price": P }]
    p_payment_method   TEXT    DEFAULT 'cash',
    p_amount_tendered  NUMERIC DEFAULT NULL,
    p_sale_category    TEXT    DEFAULT NULL,
    p_reference_number TEXT    DEFAULT NULL,
    p_queue_number     TEXT    DEFAULT NULL,
    p_sub_store_id     UUID    DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sale_id          UUID;
    v_tenant_id        UUID := public.get_my_tenant_id();
    r_item             RECORD;
    r_ing              RECORD;
    v_total_amount     NUMERIC := 0;
    v_qty_needed       NUMERIC;
    v_current_qty      NUMERIC;
    v_item_name        TEXT;
    v_menu_name        TEXT;
    v_price            NUMERIC;
    v_foodpanda_price  NUMERIC;
    v_grab_price       NUMERIC;
    v_cost_price       NUMERIC;
    v_subtotal         NUMERIC;
    v_change           NUMERIC;
    v_initial_status   TEXT;
    v_type             TEXT;
    v_inventory_item_id UUID;
    v_has_recipe       BOOLEAN;
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

    -- 1. Create Sale Record
    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method, 
        sale_category, reference_number, queue_number, queue_status, queue_updated_at, tenant_id
    )
    VALUES (
        p_branch_id, p_sub_store_id, auth.uid(), 0, 'completed', p_payment_method, 
        p_sale_category, p_reference_number, p_queue_number, v_initial_status, now(), v_tenant_id
    )
    RETURNING id INTO v_sale_id;

    -- 2. Loop menu items — price resolution + stock deduction
    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty,
               (value->>'price')::NUMERIC      AS custom_price
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch standard price, platform prices, name, type, and linked inventory_item_id
        SELECT price, foodpanda_price, grab_price, name, type, inventory_item_id
        INTO v_price, v_foodpanda_price, v_grab_price, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        -- Resolve effective unit price:
        -- 1. Custom price passed from frontend cart JSON payload (if > 0)
        -- 2. Platform specific price based on p_sale_category (FoodPanda / GrabFood)
        -- 3. Fallback to standard menu item price
        IF r_item.custom_price IS NOT NULL AND r_item.custom_price > 0 THEN
            v_price := r_item.custom_price;
        ELSIF (LOWER(COALESCE(p_sale_category, '')) LIKE '%foodpanda%' OR LOWER(COALESCE(p_sale_category, '')) LIKE '%food panda%') AND v_foodpanda_price IS NOT NULL AND v_foodpanda_price > 0 THEN
            v_price := v_foodpanda_price;
        ELSIF LOWER(COALESCE(p_sale_category, '')) LIKE '%grab%' AND v_grab_price IS NOT NULL AND v_grab_price > 0 THEN
            v_price := v_grab_price;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_total_amount  := v_total_amount + v_subtotal;

        -- Calculate cost price at time of sale
        IF v_type = 'restaurant' THEN
            SELECT COALESCE(SUM(ri.quantity_base_unit * ii.cost_per_base_unit), 0)
            INTO v_cost_price
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items ii ON ii.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id;
        ELSIF v_inventory_item_id IS NOT NULL THEN
            SELECT COALESCE(cost_per_base_unit, 0)
            INTO v_cost_price
            FROM public.inventory_items
            WHERE id = v_inventory_item_id;
        ELSE
            v_cost_price := 0;
        END IF;

        -- Insert sale line item with resolved unit_price and subtotal
        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, tenant_id)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id);

        -- Check if recipe ingredients exist for this item
        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

        -- 3. Stock deductions (Recipe ingredients OR Direct Inventory Item)
        IF v_has_recipe THEN
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
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid(), v_tenant_id);

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;

        ELSIF v_inventory_item_id IS NOT NULL THEN
            -- Direct 1:1 stock deduction for items directly listed on POS
            v_qty_needed := r_item.qty;

            SELECT COALESCE(quantity, 0), i.item_name INTO v_current_qty, v_item_name
            FROM public.inventory_balances ib
            JOIN public.inventory_items i ON i.id = ib.item_id
            WHERE ib.branch_id = p_branch_id AND ib.item_id = v_inventory_item_id;

            IF v_item_name IS NULL THEN
                SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = v_inventory_item_id;
            END IF;

            IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                RAISE EXCEPTION 'Insufficient stock for product %: required %, current %',
                    COALESCE(v_item_name, 'Direct POS Item'), v_qty_needed, COALESCE(v_current_qty, 0);
            END IF;

            -- Deduct balance directly
            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            -- Movement ledger
            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid(), v_tenant_id);

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
        END IF;
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


-- Offline Sync Function
CREATE OR REPLACE FUNCTION public.fn_process_offline_sale(
    p_branch_id        UUID,
    p_items            JSONB,
    p_payment_method   TEXT,
    p_amount_tendered  NUMERIC,
    p_sale_category    TEXT,
    p_reference_number TEXT,
    p_control_number   TEXT,
    p_created_at       TIMESTAMPTZ,
    p_cashier_id       UUID,
    p_queue_number     TEXT    DEFAULT NULL,
    p_sub_store_id     UUID    DEFAULT NULL
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
    v_foodpanda_price    NUMERIC;
    v_grab_price         NUMERIC;
    v_subtotal           NUMERIC;
    v_change             NUMERIC;
    v_type               TEXT;
    v_inventory_item_id  UUID;
    v_cost_price         NUMERIC := 0;
    v_tenant_id          UUID;
    v_initial_status     TEXT;
    v_calc_total         NUMERIC := 0;
BEGIN
    v_tenant_id := public.get_my_tenant_id();

    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.sales 
        WHERE control_number = p_control_number 
          AND tenant_id = v_tenant_id
    ) THEN
        SELECT id INTO v_sale_id FROM public.sales 
        WHERE control_number = p_control_number 
          AND tenant_id = v_tenant_id;
        RETURN v_sale_id;
    END IF;

    IF p_queue_number IS NOT NULL AND p_queue_number <> '' THEN
        v_initial_status := 'preparing';
    ELSE
        v_initial_status := NULL;
    END IF;

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

    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty,
               (value->>'price')::NUMERIC      AS custom_price
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT price, foodpanda_price, grab_price, name, type, inventory_item_id
        INTO v_price, v_foodpanda_price, v_grab_price, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        IF r_item.custom_price IS NOT NULL AND r_item.custom_price > 0 THEN
            v_price := r_item.custom_price;
        ELSIF (LOWER(COALESCE(p_sale_category, '')) LIKE '%foodpanda%' OR LOWER(COALESCE(p_sale_category, '')) LIKE '%food panda%') AND v_foodpanda_price IS NOT NULL AND v_foodpanda_price > 0 THEN
            v_price := v_foodpanda_price;
        ELSIF LOWER(COALESCE(p_sale_category, '')) LIKE '%grab%' AND v_grab_price IS NOT NULL AND v_grab_price > 0 THEN
            v_price := v_grab_price;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_calc_total    := v_calc_total + v_subtotal;

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

        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, tenant_id)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id);

        IF v_type = 'restaurant' THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes           r  ON r.id  = ri.recipe_id
                JOIN public.inventory_items   i  ON i.id  = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                UPDATE public.inventory_balances
                SET quantity = quantity - v_qty_needed, updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                INSERT INTO public.inventory_movements
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, p_cashier_id, v_tenant_id);

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;
        ELSIF v_type = 'retail' AND v_inventory_item_id IS NOT NULL THEN
            v_qty_needed := r_item.qty;

            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, p_cashier_id, v_tenant_id);

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
        END IF;
    END LOOP;

    IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL THEN
        v_change := GREATEST(0, p_amount_tendered - v_calc_total);
    ELSE
        v_change := 0;
    END IF;

    UPDATE public.sales
    SET total_amount    = v_calc_total,
        amount_tendered = p_amount_tendered,
        change_given    = v_change
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_process_offline_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID, TEXT, UUID) TO authenticated;
