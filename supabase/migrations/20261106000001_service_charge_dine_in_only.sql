-- ==============================================================================
-- MIGRATION: Service Charge Applicable Only to Dine In Sales & Delivery Drawer Balancing
-- Description: 1. Ensures service charge is calculated and recorded ONLY when
--                 sale_category is Dine In. Foodpanda, Grab, Take Out, and other
--                 sales strictly have 0% service charge.
--              2. Excludes Grab and Foodpanda online delivery platform orders from
--                 physical cash drawer counts in X-Read / Z-Read (fn_get_session_summary).
-- ==============================================================================

-- 1. Drop existing functions to allow clean definition updates without 42P13 errors
DROP FUNCTION IF EXISTS public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT);

-- 2. Redefine public.fn_process_sale
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id        UUID,
    p_items            JSONB,   -- [{ "menu_item_id": "...", "quantity": N, "price": P, "notes": "...", ... }]
    p_payment_method   TEXT    DEFAULT 'cash',
    p_amount_tendered  NUMERIC DEFAULT NULL,
    p_sale_category    TEXT    DEFAULT NULL,
    p_reference_number TEXT    DEFAULT NULL,
    p_queue_number     TEXT    DEFAULT NULL,
    p_sub_store_id     UUID    DEFAULT NULL,
    p_discount_type     TEXT    DEFAULT NULL,
    p_discount_amount   NUMERIC DEFAULT 0,
    p_discount_metadata JSONB   DEFAULT '[]'::jsonb,
    p_notes             TEXT    DEFAULT NULL
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
    v_item_policy      TEXT := 'strict';
    
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

    -- Service charge
    v_sc_rate          NUMERIC := 0;
    v_service_charge   NUMERIC := 0;
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
        sale_category, reference_number, queue_number, queue_status, queue_updated_at, tenant_id,
        notes
    )
    VALUES (
        p_branch_id, p_sub_store_id, auth.uid(), 0, 'completed', p_payment_method, 
        p_sale_category, p_reference_number, p_queue_number, v_initial_status, now(), v_tenant_id,
        p_notes
    )
    RETURNING id INTO v_sale_id;

    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty,
               (value->>'price')::NUMERIC      AS custom_price,
               (value->>'notes')::TEXT         AS notes,
               (value->>'discount_amount')::NUMERIC AS item_discount,
               (value->>'is_vat_exempt')::BOOLEAN   AS item_is_exempt,
               (value->>'vatable_sales')::NUMERIC   AS item_vatable,
               (value->>'vat_amount')::NUMERIC      AS item_vat_amount,
               (value->>'vat_exempt_sales')::NUMERIC AS item_vat_exempt
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch base catalog prices & stock policy
        SELECT price, foodpanda_price, grab_price, name, type, inventory_item_id, COALESCE(stock_enforcement_mode, 'strict')
        INTO v_price, v_foodpanda_price, v_grab_price_num, v_menu_name, v_type, v_inventory_item_id, v_item_policy
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        -- If it's a direct retail item and menu item policy wasn't explicitly set, fallback to inventory item's policy
        IF v_inventory_item_id IS NOT NULL AND (v_item_policy IS NULL OR v_item_policy = 'strict') THEN
            SELECT COALESCE(stock_enforcement_mode, v_item_policy) INTO v_item_policy
            FROM public.inventory_items
            WHERE id = v_inventory_item_id;
        END IF;

        IF v_item_policy IS NULL THEN
            v_item_policy := 'strict';
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
            discount_amount, vatable_sales, vat_amount, vat_exempt_sales, is_vat_exempt,
            notes
        )
        VALUES (
            v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id,
            v_item_discount, v_item_vatable, v_item_vat_amount, v_item_vat_exempt, v_item_is_exempt,
            r_item.notes
        );

        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

        IF v_has_recipe THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes r         ON r.id  = ri.recipe_id
                JOIN public.inventory_items i ON i.id  = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                SELECT COALESCE(quantity, 0) INTO v_current_qty
                FROM public.inventory_balances
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                    IF v_item_policy = 'strict' THEN
                        RAISE EXCEPTION 'Insufficient stock for ingredient "%": required %, current %',
                            r_ing.item_name, v_qty_needed, COALESCE(v_current_qty, 0);
                    END IF;
                END IF;

                INSERT INTO public.inventory_balances (branch_id, item_id, quantity, tenant_id, updated_at)
                VALUES (p_branch_id, r_ing.item_id, -v_qty_needed, v_tenant_id, now())
                ON CONFLICT (branch_id, item_id)
                DO UPDATE SET quantity = public.inventory_balances.quantity - v_qty_needed, updated_at = now();

                INSERT INTO public.inventory_movements
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid(), v_tenant_id);

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;
        ELSIF v_inventory_item_id IS NOT NULL THEN
            v_qty_needed := r_item.qty;

            SELECT COALESCE(quantity, 0), i.item_name INTO v_current_qty, v_item_name
            FROM public.inventory_balances ib
            JOIN public.inventory_items i ON i.id = ib.item_id
            WHERE ib.branch_id = p_branch_id AND ib.item_id = v_inventory_item_id;

            IF v_item_name IS NULL THEN
                SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = v_inventory_item_id;
            END IF;

            IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                IF v_item_policy = 'strict' THEN
                    RAISE EXCEPTION 'Insufficient stock for product "%": required %, current %',
                        COALESCE(v_item_name, 'Direct POS Item'), v_qty_needed, COALESCE(v_current_qty, 0);
                END IF;
            END IF;

            INSERT INTO public.inventory_balances (branch_id, item_id, quantity, tenant_id, updated_at)
            VALUES (p_branch_id, v_inventory_item_id, -v_qty_needed, v_tenant_id, now())
            ON CONFLICT (branch_id, item_id)
            DO UPDATE SET quantity = public.inventory_balances.quantity - v_qty_needed, updated_at = now();

            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid(), v_tenant_id);

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
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

    -- Calculate service charge: Branch override (if configured) -> Tenant general default -> 0%
    -- ONLY applicable for Dine In sales (never for Foodpanda, Grab, Take Out, etc.)
    IF LOWER(TRIM(COALESCE(p_sale_category, ''))) IN ('dine in', 'dine-in', 'dine') THEN
        SELECT service_charge_rate
        INTO v_sc_rate
        FROM public.branches
        WHERE id = COALESCE(p_sub_store_id, p_branch_id);

        IF v_sc_rate IS NULL AND p_sub_store_id IS NOT NULL THEN
            SELECT service_charge_rate
            INTO v_sc_rate
            FROM public.branches
            WHERE id = p_branch_id;
        END IF;

        IF v_sc_rate IS NULL THEN
            SELECT COALESCE(default_service_charge_rate, 0.00)
            INTO v_sc_rate
            FROM public.tenants
            WHERE id = v_tenant_id;
        END IF;

        v_sc_rate := COALESCE(v_sc_rate, 0.00);

        IF v_sc_rate > 0 THEN
            v_service_charge := ROUND((v_total_amount * (v_sc_rate / 100.0)), 2);
        ELSE
            v_service_charge := 0;
        END IF;
    ELSE
        v_sc_rate := 0.00;
        v_service_charge := 0.00;
    END IF;

    v_net_total := v_net_total + v_service_charge;

    UPDATE public.sales
    SET total_amount          = v_net_total,
        discount_amount       = v_sum_discount,
        vatable_sales         = v_sum_vatable,
        vat_amount            = v_sum_vat_amount,
        vat_exempt_sales      = v_sum_vat_exempt,
        service_charge_rate   = v_sc_rate,
        service_charge_amount = v_service_charge,
        discount_type         = p_discount_type,
        discount_metadata     = p_discount_metadata
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Update fn_process_offline_sale to handle p_notes and per-item notes
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
    p_discount_metadata JSONB   DEFAULT '[]'::jsonb,
    p_notes             TEXT    DEFAULT NULL
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
    v_item_policy      TEXT := 'strict';
    
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

    -- Service charge
    v_sc_rate          NUMERIC := 0;
    v_service_charge   NUMERIC := 0;
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
        control_number, created_at, reference_number, queue_number, queue_status, queue_updated_at, tenant_id,
        notes
    )
    VALUES (
        p_branch_id, p_sub_store_id, p_cashier_id, 0, 'completed', p_payment_method, 
        p_control_number, p_created_at, p_reference_number, p_queue_number, v_initial_status, p_created_at, v_tenant_id,
        p_notes
    )
    RETURNING id INTO v_sale_id;

    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty,
               (value->>'price')::NUMERIC      AS custom_price,
               (value->>'notes')::TEXT         AS notes,
               (value->>'discount_amount')::NUMERIC AS item_discount,
               (value->>'is_vat_exempt')::BOOLEAN   AS item_is_exempt,
               (value->>'vatable_sales')::NUMERIC   AS item_vatable,
               (value->>'vat_amount')::NUMERIC      AS item_vat_amount,
               (value->>'vat_exempt_sales')::NUMERIC AS item_vat_exempt
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch base catalog prices & stock policy
        SELECT price, foodpanda_price, grab_price, name, type, inventory_item_id, COALESCE(stock_enforcement_mode, 'strict')
        INTO v_price, v_foodpanda_price, v_grab_price_num, v_menu_name, v_type, v_inventory_item_id, v_item_policy
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        IF v_inventory_item_id IS NOT NULL AND (v_item_policy IS NULL OR v_item_policy = 'strict') THEN
            SELECT COALESCE(stock_enforcement_mode, v_item_policy) INTO v_item_policy
            FROM public.inventory_items
            WHERE id = v_inventory_item_id;
        END IF;

        IF v_item_policy IS NULL THEN
            v_item_policy := 'strict';
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
            discount_amount, vatable_sales, vat_amount, vat_exempt_sales, is_vat_exempt,
            notes
        )
        VALUES (
            v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id,
            v_item_discount, v_item_vatable, v_item_vat_amount, v_item_vat_exempt, v_item_is_exempt,
            r_item.notes
        );

        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

        IF v_has_recipe THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes r         ON r.id  = ri.recipe_id
                JOIN public.inventory_items i ON i.id  = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                SELECT COALESCE(quantity, 0) INTO v_current_qty
                FROM public.inventory_balances
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                    IF v_item_policy = 'strict' THEN
                        RAISE EXCEPTION 'Insufficient stock for ingredient "%": required %, current %',
                            r_ing.item_name, v_qty_needed, COALESCE(v_current_qty, 0);
                    END IF;
                END IF;

                INSERT INTO public.inventory_balances (branch_id, item_id, quantity, tenant_id, updated_at)
                VALUES (p_branch_id, r_ing.item_id, -v_qty_needed, v_tenant_id, now())
                ON CONFLICT (branch_id, item_id)
                DO UPDATE SET quantity = public.inventory_balances.quantity - v_qty_needed, updated_at = now();

                INSERT INTO public.inventory_movements
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', p_cashier_id, v_tenant_id);

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;
        ELSIF v_inventory_item_id IS NOT NULL THEN
            v_qty_needed := r_item.qty;

            SELECT COALESCE(quantity, 0), i.item_name INTO v_current_qty, v_item_name
            FROM public.inventory_balances ib
            JOIN public.inventory_items i ON i.id = ib.item_id
            WHERE ib.branch_id = p_branch_id AND ib.item_id = v_inventory_item_id;

            IF v_item_name IS NULL THEN
                SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = v_inventory_item_id;
            END IF;

            IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                IF v_item_policy = 'strict' THEN
                    RAISE EXCEPTION 'Insufficient stock for product "%": required %, current %',
                        COALESCE(v_item_name, 'Direct POS Item'), v_qty_needed, COALESCE(v_current_qty, 0);
                END IF;
            END IF;

            INSERT INTO public.inventory_balances (branch_id, item_id, quantity, tenant_id, updated_at)
            VALUES (p_branch_id, v_inventory_item_id, -v_qty_needed, v_tenant_id, now())
            ON CONFLICT (branch_id, item_id)
            DO UPDATE SET quantity = public.inventory_balances.quantity - v_qty_needed, updated_at = now();

            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', p_cashier_id, v_tenant_id);

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
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

    -- Calculate service charge: Branch override (if configured) -> Tenant general default -> 0%
    -- ONLY applicable for Dine In sales (never for Foodpanda, Grab, Take Out, etc.)
    IF LOWER(TRIM(COALESCE(p_sale_category, ''))) IN ('dine in', 'dine-in', 'dine') THEN
        SELECT service_charge_rate
        INTO v_sc_rate
        FROM public.branches
        WHERE id = COALESCE(p_sub_store_id, p_branch_id);

        IF v_sc_rate IS NULL AND p_sub_store_id IS NOT NULL THEN
            SELECT service_charge_rate
            INTO v_sc_rate
            FROM public.branches
            WHERE id = p_branch_id;
        END IF;

        IF v_sc_rate IS NULL THEN
            SELECT COALESCE(default_service_charge_rate, 0.00)
            INTO v_sc_rate
            FROM public.tenants
            WHERE id = v_tenant_id;
        END IF;

        v_sc_rate := COALESCE(v_sc_rate, 0.00);

        IF v_sc_rate > 0 THEN
            v_service_charge := ROUND((v_total_amount * (v_sc_rate / 100.0)), 2);
        ELSE
            v_service_charge := 0;
        END IF;
    ELSE
        v_sc_rate := 0.00;
        v_service_charge := 0.00;
    END IF;

    v_net_total := v_net_total + v_service_charge;

    UPDATE public.sales
    SET total_amount          = v_net_total,
        discount_amount       = v_sum_discount,
        vatable_sales         = v_sum_vatable,
        vat_amount            = v_sum_vat_amount,
        vat_exempt_sales      = v_sum_vat_exempt,
        service_charge_rate   = v_sc_rate,
        service_charge_amount = v_service_charge,
        discount_type         = p_discount_type,
        discount_metadata     = p_discount_metadata
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;



-- 3. Redefine public.fn_get_session_summary to exclude online delivery platforms (Grab / Foodpanda) from physical cash drawer
CREATE OR REPLACE FUNCTION public.fn_get_session_summary(
    p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
    r_session RECORD;
    v_summary JSONB;
BEGIN
    SELECT * INTO r_session FROM public.cashier_sessions WHERE id = p_session_id;
    IF r_session IS NULL THEN
        RAISE EXCEPTION 'Register session not found.';
    END IF;

    SELECT json_build_object(
        'openedAt',        r_session.opened_at,
        'closedAt',        r_session.closed_at,
        'cashierId',       r_session.cashier_id,
        'openingBalance',  r_session.opening_balance,
        'status',          r_session.status,
        'zCounter',        r_session.z_counter,
        'grandTotalStart', r_session.grand_total_start,
        'grandTotalEnd',   r_session.grand_total_end,
        'grossSales',      COALESCE(SUM(CASE WHEN status = 'completed' THEN vatable_sales + vat_amount + vat_exempt_sales + discount_amount ELSE 0 END), 0),
        'netSales',        COALESCE(SUM(CASE WHEN status = 'completed' THEN vatable_sales + vat_exempt_sales ELSE 0 END), 0),
        'vatAmount',       COALESCE(SUM(CASE WHEN status = 'completed' THEN vat_amount ELSE 0 END), 0),
        'vatExemptSales',  COALESCE(SUM(CASE WHEN status = 'completed' THEN vat_exempt_sales ELSE 0 END), 0),
        'discountAmount',  COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_amount ELSE 0 END), 0),
        'scPwdDiscount',   COALESCE(SUM(CASE WHEN status = 'completed' THEN sc_pwd_discount ELSE 0 END), 0),
        'otherDiscount',   COALESCE(SUM(CASE WHEN status = 'completed' THEN other_discounts ELSE 0 END), 0),
        'transactionCount',COUNT(*)::INT,
        -- Physical cash in drawer ONLY (excludes Foodpanda & Grab which are paid online via app)
        'cashSales',       COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'cash' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'gcashSales',      COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'gcash' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'mayaSales',       COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'maya' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'cardSales',       COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'card' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'otherSales',      COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND (
                                     payment_method = 'other' 
                                     OR LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' 
                                     OR LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' 
                                     OR LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'foodpandaSales',  COALESCE(SUM(CASE WHEN status = 'completed' AND (LOWER(sale_category) LIKE '%foodpanda%' OR LOWER(sale_category) LIKE '%food panda%') THEN total_amount ELSE 0 END), 0),
        'grabSales',       COALESCE(SUM(CASE WHEN status = 'completed' AND LOWER(sale_category) LIKE '%grab%' THEN total_amount ELSE 0 END), 0),
        'dineInSales',     COALESCE(SUM(CASE WHEN status = 'completed' AND (LOWER(sale_category) LIKE '%dine%' OR sale_category IS NULL OR sale_category = '') THEN total_amount ELSE 0 END), 0),
        'takeOutSales',    COALESCE(SUM(CASE WHEN status = 'completed' AND (LOWER(sale_category) LIKE '%take%' OR LOWER(sale_category) LIKE '%pickup%') THEN total_amount ELSE 0 END), 0),
        'otherChannelSales', COALESCE(SUM(CASE WHEN status = 'completed' AND NOT (
                                LOWER(sale_category) LIKE '%foodpanda%' OR 
                                LOWER(sale_category) LIKE '%food panda%' OR 
                                LOWER(sale_category) LIKE '%grab%' OR 
                                LOWER(sale_category) LIKE '%dine%' OR 
                                LOWER(sale_category) LIKE '%take%' OR 
                                LOWER(sale_category) LIKE '%pickup%' OR 
                                sale_category IS NULL OR 
                                sale_category = ''
                            ) THEN total_amount ELSE 0 END), 0),
        'voidCount',       COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0)::INT,
        'voidAmount',      COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_amount ELSE 0 END), 0)
    ) INTO v_summary
    FROM public.sales
    WHERE branch_id = r_session.branch_id
      AND cashier_id = r_session.cashier_id
      AND created_at BETWEEN r_session.opened_at AND COALESCE(r_session.closed_at, now());

    RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_get_session_summary(UUID) TO authenticated;
