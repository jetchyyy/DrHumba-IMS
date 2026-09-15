-- ============================================================
-- MIGRATION: Add Sub-Store Dynamic Price Resolution
-- ============================================================

-- 1. Update public.fn_process_sale to evaluate sub-store dynamic price overrides
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id        UUID,
    p_items            JSONB,   -- [{ "menu_item_id": "...", "quantity": N, "price": P, "discount_amount": DA, "is_vat_exempt": VE, "vatable_sales": VS, "vat_amount": VA, "vat_exempt_sales": VES }]
    p_payment_method   TEXT    DEFAULT 'cash',
    p_amount_tendered  NUMERIC DEFAULT NULL,
    p_sale_category    TEXT    DEFAULT NULL,
    p_reference_number TEXT    DEFAULT NULL,
    p_queue_number     TEXT    DEFAULT NULL,
    p_sub_store_id     UUID    DEFAULT NULL,
    p_discount_type     TEXT    DEFAULT NULL,
    p_discount_amount   NUMERIC DEFAULT 0,
    p_discount_metadata JSONB   DEFAULT '[]'::jsonb
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
    v_grab_price_num   NUMERIC;
    v_bp_price         NUMERIC;
    v_bp_foodpanda     NUMERIC;
    v_bp_grab          NUMERIC;
    v_cost_price       NUMERIC;
    v_subtotal         NUMERIC;
    v_change           NUMERIC;
    v_initial_status   TEXT;
    v_type             TEXT;
    v_inventory_item_id UUID;
    v_has_recipe       BOOLEAN;
    
    -- Item discount calculations
    v_item_discount    NUMERIC;
    v_item_vatable     NUMERIC;
    v_item_vat_amount  NUMERIC;
    v_item_vat_exempt  NUMERIC;
    v_item_is_exempt   BOOLEAN;

    -- Aggregate calculations
    v_sum_discount     NUMERIC;
    v_sum_vatable      NUMERIC;
    v_sum_vat_amount   NUMERIC;
    v_sum_vat_exempt   NUMERIC;
    v_net_total        NUMERIC;
BEGIN
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    IF p_queue_number IS NOT NULL AND p_queue_number <> '' THEN
        v_initial_status := 'preparing';
    ELSE
        v_initial_status := NULL;
    END IF;

    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method, 
        sale_category, reference_number, queue_number, queue_status, queue_updated_at, tenant_id
    )
    VALUES (
        p_branch_id, p_sub_store_id, auth.uid(), 0, 'completed', p_payment_method, 
        p_sale_category, p_reference_number, p_queue_number, v_initial_status, now(), v_tenant_id
    )
    RETURNING id INTO v_sale_id;

    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty,
               (value->>'price')::NUMERIC      AS custom_price,
               (value->>'discount_amount')::NUMERIC AS item_discount,
               (value->>'is_vat_exempt')::BOOLEAN   AS item_is_exempt,
               (value->>'vatable_sales')::NUMERIC   AS item_vatable,
               (value->>'vat_amount')::NUMERIC      AS item_vat_amount,
               (value->>'vat_exempt_sales')::NUMERIC AS item_vat_exempt
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch base catalog prices
        SELECT price, foodpanda_price, grab_price, name, type, inventory_item_id
        INTO v_price, v_foodpanda_price, v_grab_price_num, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        -- Reset override variables
        v_bp_price := NULL;
        v_bp_foodpanda := NULL;
        v_bp_grab := NULL;

        -- 1. Fetch sub-store price overrides if sub_store_id is present
        IF p_sub_store_id IS NOT NULL THEN
            SELECT price, foodpanda_price, grab_price
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.item_branch_prices
            WHERE branch_id = p_sub_store_id
              AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id))
            LIMIT 1;
        END IF;

        -- 2. Fetch parent branch price overrides to fill in any missing values
        SELECT 
            COALESCE(v_bp_price, price),
            COALESCE(v_bp_foodpanda, foodpanda_price),
            COALESCE(v_bp_grab, grab_price)
        INTO v_bp_price, v_bp_foodpanda, v_bp_grab
        FROM public.item_branch_prices
        WHERE branch_id = p_branch_id
          AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id))
        LIMIT 1;

        IF v_bp_price IS NOT NULL AND v_bp_price > 0 THEN v_price := v_bp_price; END IF;
        IF v_bp_foodpanda IS NOT NULL AND v_bp_foodpanda > 0 THEN v_foodpanda_price := v_bp_foodpanda; END IF;
        IF v_bp_grab IS NOT NULL AND v_bp_grab > 0 THEN v_grab_price_num := v_bp_grab; END IF;

        -- Resolve effective unit price
        IF r_item.custom_price IS NOT NULL AND r_item.custom_price > 0 THEN
            v_price := r_item.custom_price;
        ELSIF (LOWER(COALESCE(p_sale_category, '')) LIKE '%foodpanda%' OR LOWER(COALESCE(p_sale_category, '')) LIKE '%food panda%') AND v_foodpanda_price IS NOT NULL AND v_foodpanda_price > 0 THEN
            v_price := v_foodpanda_price;
        ELSIF LOWER(COALESCE(p_sale_category, '')) LIKE '%grab%' AND v_grab_price_num IS NOT NULL AND v_grab_price_num > 0 THEN
            v_price := v_grab_price_num;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_total_amount  := v_total_amount + v_subtotal;

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

        v_item_discount   := COALESCE(r_item.item_discount, 0);
        v_item_is_exempt  := COALESCE(r_item.item_is_exempt, FALSE);
        v_item_vatable    := COALESCE(r_item.item_vatable, CASE WHEN NOT v_item_is_exempt THEN ((v_subtotal - v_item_discount) / 1.12) ELSE 0 END);
        v_item_vat_amount := COALESCE(r_item.item_vat_amount, CASE WHEN NOT v_item_is_exempt THEN (v_item_vatable * 0.12) ELSE 0 END);
        v_item_vat_exempt := COALESCE(r_item.item_vat_exempt, CASE WHEN v_item_is_exempt THEN ((v_subtotal - v_item_discount) / 1.12) ELSE 0 END);

        INSERT INTO public.sale_items (
            sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, tenant_id,
            discount_amount, vatable_sales, vat_amount, vat_exempt_sales, is_vat_exempt
        )
        VALUES (
            v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id,
            v_item_discount, v_item_vatable, v_item_vat_amount, v_item_vat_exempt, v_item_is_exempt
        );

        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

        IF v_has_recipe THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit
                FROM public.recipe_ingredients ri
                JOIN public.recipes r ON r.id = ri.recipe_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                SELECT quantity INTO v_current_qty
                FROM public.branch_inventory
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                IF v_current_qty IS NULL THEN
                    SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = r_ing.item_id;
                    RAISE EXCEPTION 'Stock record not found for "%" in this branch.', v_item_name;
                END IF;

                IF v_current_qty < v_qty_needed THEN
                    SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = r_ing.item_id;
                    RAISE EXCEPTION 'Insufficient stock for "%". Required: %, Available: %',
                        v_item_name, v_qty_needed, v_current_qty;
                END IF;

                UPDATE public.branch_inventory
                SET quantity   = quantity - v_qty_needed,
                    updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;
            END LOOP;
        ELSIF v_inventory_item_id IS NOT NULL THEN
            v_qty_needed := r_item.qty;

            SELECT quantity INTO v_current_qty
            FROM public.branch_inventory
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            IF v_current_qty IS NOT NULL THEN
                IF v_current_qty < v_qty_needed THEN
                    SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = v_inventory_item_id;
                    RAISE EXCEPTION 'Insufficient stock for "%". Required: %, Available: %',
                        v_item_name, v_qty_needed, v_current_qty;
                END IF;

                UPDATE public.branch_inventory
                SET quantity   = quantity - v_qty_needed,
                    updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;
            END IF;
        END IF;

    END LOOP;

    SELECT 
        COALESCE(SUM(discount_amount), 0),
        COALESCE(SUM(vatable_sales), 0),
        COALESCE(SUM(vat_amount), 0),
        COALESCE(SUM(vat_exempt_sales), 0)
    INTO 
        v_sum_discount,
        v_sum_vatable,
        v_sum_vat_amount,
        v_sum_vat_exempt
    FROM public.sale_items
    WHERE sale_id = v_sale_id;

    v_net_total := (v_sum_vatable + v_sum_vat_amount + v_sum_vat_exempt);

    IF p_discount_amount > 0 AND v_sum_discount = 0 THEN
        v_sum_discount := p_discount_amount;
        IF v_net_total > p_discount_amount THEN
            v_net_total := v_net_total - p_discount_amount;
        END IF;
    END IF;

    UPDATE public.sales
    SET total_amount       = v_net_total,
        discount_amount    = v_sum_discount,
        vatable_sales      = v_sum_vatable,
        vat_amount         = v_sum_vat_amount,
        vat_exempt_sales   = v_sum_vat_exempt,
        discount_type      = p_discount_type,
        discount_metadata  = p_discount_metadata
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Update public.fn_process_offline_sale to evaluate sub-store dynamic price overrides
CREATE OR REPLACE FUNCTION public.fn_process_offline_sale(
    p_branch_id        UUID,
    p_items            JSONB,
    p_payment_method   TEXT,
    p_created_at       TIMESTAMPTZ,
    p_control_number   TEXT,
    p_cashier_id       UUID,
    p_reference_number TEXT    DEFAULT NULL,
    p_queue_number     TEXT    DEFAULT NULL,
    p_sub_store_id     UUID    DEFAULT NULL,
    p_discount_type     TEXT    DEFAULT NULL,
    p_discount_amount   NUMERIC DEFAULT 0,
    p_discount_metadata JSONB   DEFAULT '[]'::jsonb
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
    v_grab_price_num   NUMERIC;
    v_bp_price         NUMERIC;
    v_bp_foodpanda     NUMERIC;
    v_bp_grab          NUMERIC;
    v_cost_price       NUMERIC;
    v_subtotal         NUMERIC;
    v_initial_status   TEXT;
    v_type             TEXT;
    v_inventory_item_id UUID;
    v_has_recipe       BOOLEAN;

    -- Item discount calculations
    v_item_discount    NUMERIC;
    v_item_vatable     NUMERIC;
    v_item_vat_amount  NUMERIC;
    v_item_vat_exempt  NUMERIC;
    v_item_is_exempt   BOOLEAN;

    -- Aggregate calculations
    v_sum_discount     NUMERIC;
    v_sum_vatable      NUMERIC;
    v_sum_vat_amount   NUMERIC;
    v_sum_vat_exempt   NUMERIC;
    v_net_total        NUMERIC;
BEGIN
    IF p_control_number IS NOT NULL AND p_control_number <> '' THEN
        SELECT id INTO v_sale_id 
        FROM public.sales 
        WHERE control_number = p_control_number 
          AND tenant_id = v_tenant_id;
        IF v_sale_id IS NOT NULL THEN
            RETURN v_sale_id;
        END IF;
    END IF;

    IF p_queue_number IS NOT NULL AND p_queue_number <> '' THEN
        v_initial_status := 'preparing';
    ELSE
        v_initial_status := NULL;
    END IF;

    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method, 
        sale_category, reference_number, control_number, created_at,
        queue_number, queue_status, queue_updated_at, tenant_id
    )
    VALUES (
        p_branch_id, p_sub_store_id, p_cashier_id, 0, 'completed', p_payment_method, 
        NULL, p_reference_number, p_control_number, p_created_at,
        p_queue_number, v_initial_status, p_created_at, v_tenant_id
    )
    RETURNING id INTO v_sale_id;

    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty,
               (value->>'price')::NUMERIC      AS custom_price,
               (value->>'discount_amount')::NUMERIC AS item_discount,
               (value->>'is_vat_exempt')::BOOLEAN   AS item_is_exempt,
               (value->>'vatable_sales')::NUMERIC   AS item_vatable,
               (value->>'vat_amount')::NUMERIC      AS item_vat_amount,
               (value->>'vat_exempt_sales')::NUMERIC AS item_vat_exempt
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT price, foodpanda_price, grab_price, name, type, inventory_item_id
        INTO v_price, v_foodpanda_price, v_grab_price_num, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        -- Reset override variables
        v_bp_price := NULL;
        v_bp_foodpanda := NULL;
        v_bp_grab := NULL;

        -- 1. Fetch sub-store price overrides if sub_store_id is present
        IF p_sub_store_id IS NOT NULL THEN
            SELECT price, foodpanda_price, grab_price
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.item_branch_prices
            WHERE branch_id = p_sub_store_id
              AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id))
            LIMIT 1;
        END IF;

        -- 2. Fetch parent branch price overrides to fill in any missing values
        SELECT 
            COALESCE(v_bp_price, price),
            COALESCE(v_bp_foodpanda, foodpanda_price),
            COALESCE(v_bp_grab, grab_price)
        INTO v_bp_price, v_bp_foodpanda, v_bp_grab
        FROM public.item_branch_prices
        WHERE branch_id = p_branch_id
          AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id))
        LIMIT 1;

        IF v_bp_price IS NOT NULL AND v_bp_price > 0 THEN v_price := v_bp_price; END IF;
        IF v_bp_foodpanda IS NOT NULL AND v_bp_foodpanda > 0 THEN v_foodpanda_price := v_bp_foodpanda; END IF;
        IF v_bp_grab IS NOT NULL AND v_bp_grab > 0 THEN v_grab_price_num := v_bp_grab; END IF;

        IF r_item.custom_price IS NOT NULL AND r_item.custom_price > 0 THEN
            v_price := r_item.custom_price;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_total_amount  := v_total_amount + v_subtotal;

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

        v_item_discount   := COALESCE(r_item.item_discount, 0);
        v_item_is_exempt  := COALESCE(r_item.item_is_exempt, FALSE);
        v_item_vatable    := COALESCE(r_item.item_vatable, CASE WHEN NOT v_item_is_exempt THEN ((v_subtotal - v_item_discount) / 1.12) ELSE 0 END);
        v_item_vat_amount := COALESCE(r_item.item_vat_amount, CASE WHEN NOT v_item_is_exempt THEN (v_item_vatable * 0.12) ELSE 0 END);
        v_item_vat_exempt := COALESCE(r_item.item_vat_exempt, CASE WHEN v_item_is_exempt THEN ((v_subtotal - v_item_discount) / 1.12) ELSE 0 END);

        INSERT INTO public.sale_items (
            sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, tenant_id,
            discount_amount, vatable_sales, vat_amount, vat_exempt_sales, is_vat_exempt
        )
        VALUES (
            v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id,
            v_item_discount, v_item_vatable, v_item_vat_amount, v_item_vat_exempt, v_item_is_exempt
        );

        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

        IF v_has_recipe THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit
                FROM public.recipe_ingredients ri
                JOIN public.recipes r ON r.id = ri.recipe_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                SELECT quantity INTO v_current_qty
                FROM public.branch_inventory
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                IF v_current_qty IS NOT NULL THEN
                    UPDATE public.branch_inventory
                    SET quantity   = GREATEST(0, quantity - v_qty_needed),
                        updated_at = now()
                    WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;
                END IF;
            END LOOP;
        ELSIF v_inventory_item_id IS NOT NULL THEN
            v_qty_needed := r_item.qty;

            SELECT quantity INTO v_current_qty
            FROM public.branch_inventory
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            IF v_current_qty IS NOT NULL THEN
                UPDATE public.branch_inventory
                SET quantity   = GREATEST(0, quantity - v_qty_needed),
                    updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;
            END IF;
        END IF;

    END LOOP;

    SELECT 
        COALESCE(SUM(discount_amount), 0),
        COALESCE(SUM(vatable_sales), 0),
        COALESCE(SUM(vat_amount), 0),
        COALESCE(SUM(vat_exempt_sales), 0)
    INTO 
        v_sum_discount,
        v_sum_vatable,
        v_sum_vat_amount,
        v_sum_vat_exempt
    FROM public.sale_items
    WHERE sale_id = v_sale_id;

    v_net_total := (v_sum_vatable + v_sum_vat_amount + v_sum_vat_exempt);

    IF p_discount_amount > 0 AND v_sum_discount = 0 THEN
        v_sum_discount := p_discount_amount;
        IF v_net_total > p_discount_amount THEN
            v_net_total := v_net_total - p_discount_amount;
        END IF;
    END IF;

    UPDATE public.sales
    SET total_amount       = v_net_total,
        discount_amount    = v_sum_discount,
        vatable_sales      = v_sum_vatable,
        vat_amount         = v_sum_vat_amount,
        vat_exempt_sales   = v_sum_vat_exempt,
        discount_type      = p_discount_type,
        discount_metadata  = p_discount_metadata
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
