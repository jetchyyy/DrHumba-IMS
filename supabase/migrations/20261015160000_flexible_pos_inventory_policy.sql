-- ============================================================
-- MIGRATION: Per-Item Flexible POS Inventory Policy & Reconciliation
-- ============================================================

-- 1. Add stock_enforcement_mode to public.menu_items
ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS stock_enforcement_mode TEXT NOT NULL DEFAULT 'strict' 
CHECK (stock_enforcement_mode IN ('strict', 'flexible'));

-- 2. Add stock_enforcement_mode to public.inventory_items (for retail items)
ALTER TABLE public.inventory_items 
ADD COLUMN IF NOT EXISTS stock_enforcement_mode TEXT NOT NULL DEFAULT 'strict' 
CHECK (stock_enforcement_mode IN ('strict', 'flexible'));

-- 3. (Optional backwards compatibility) Keep column on branches as fallback/default
ALTER TABLE public.branches 
ADD COLUMN IF NOT EXISTS stock_enforcement_mode TEXT NOT NULL DEFAULT 'strict' 
CHECK (stock_enforcement_mode IN ('strict', 'flexible'));

-- 4. Expand public.stock_adjustments reason check constraint
ALTER TABLE public.stock_adjustments 
DROP CONSTRAINT IF EXISTS stock_adjustments_reason_check;

ALTER TABLE public.stock_adjustments 
ADD CONSTRAINT stock_adjustments_reason_check 
CHECK (reason IN ('damage', 'spoilage', 'expired', 'lost', 'manual_correction', 'recipe_substitution'));

-- 5. Drop and recreate fn_get_menu_items_availability to check the MENU ITEM's own policy
DROP FUNCTION IF EXISTS public.fn_get_menu_items_availability(UUID);

CREATE OR REPLACE FUNCTION public.fn_get_menu_items_availability(
    p_branch_id UUID
)
RETURNS TABLE (
    menu_item_id UUID,
    stock_available BOOLEAN,
    has_sufficient_stock BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH item_eval AS (
        SELECT 
            mi.id AS m_id,
            COALESCE(
                mi.stock_enforcement_mode,
                (SELECT ii.stock_enforcement_mode FROM public.inventory_items ii WHERE ii.id = mi.inventory_item_id),
                'strict'
            ) AS effective_mode,
            CASE
                -- 1. If it has a recipe
                WHEN EXISTS (
                    SELECT 1 FROM public.recipes r 
                    WHERE r.menu_item_id = mi.id
                ) THEN NOT EXISTS (
                    -- Check if any recipe ingredient stock is less than required base unit quantity
                    SELECT 1 
                    FROM public.recipes r
                    JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
                    LEFT JOIN public.inventory_balances ib ON ib.item_id = ri.item_id AND ib.branch_id = p_branch_id
                    WHERE r.menu_item_id = mi.id
                      AND COALESCE(ib.quantity, 0) < ri.quantity_base_unit
                )
                -- 2. If it is retail / mapped directly to an inventory item
                WHEN mi.inventory_item_id IS NOT NULL THEN COALESCE((
                    SELECT ib.quantity FROM public.inventory_balances ib 
                    WHERE ib.item_id = mi.inventory_item_id AND ib.branch_id = p_branch_id
                ), 0) >= 1
                -- 3. Otherwise (service, etc. not tracked)
                ELSE TRUE
            END AS in_stock
        FROM public.menu_items mi
    )
    SELECT 
        m_id AS menu_item_id,
        CASE
            WHEN effective_mode = 'flexible' THEN TRUE
            ELSE in_stock
        END AS stock_available,
        in_stock AS has_sufficient_stock
    FROM item_eval;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_get_menu_items_availability(UUID) TO authenticated;

-- 6. Update fn_process_sale to evaluate per-item stock_enforcement_mode
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id        UUID,
    p_items            JSONB,
    p_payment_method   TEXT,
    p_sale_category    TEXT    DEFAULT 'standard',
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

    -- Apply branch service charge
    SELECT COALESCE(service_charge_rate, 0) INTO v_sc_rate
    FROM public.branches
    WHERE id = p_branch_id;

    IF v_sc_rate > 0 THEN
        v_service_charge := ROUND((v_total_amount * (v_sc_rate / 100.0)), 2);
    ELSE
        v_service_charge := 0;
    END IF;

    v_net_total := (v_total_amount - v_sum_discount) + v_service_charge;

    UPDATE public.sales
    SET total_amount      = v_net_total,
        discount_type     = p_discount_type,
        discount_amount   = v_sum_discount,
        vatable_sales     = v_sum_vatable,
        vat_amount        = v_sum_vat_amount,
        vat_exempt_sales  = v_sum_vat_exempt,
        service_charge    = v_service_charge,
        discount_metadata = p_discount_metadata
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Update fn_process_offline_sale to evaluate per-item stock_enforcement_mode
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
        sale_category, reference_number, queue_number, queue_status, queue_updated_at,
        created_at, control_number, tenant_id
    )
    VALUES (
        p_branch_id, p_sub_store_id, p_cashier_id, 0, 'completed', p_payment_method, 
        'standard', p_reference_number, p_queue_number, v_initial_status, now(),
        p_created_at, p_control_number, v_tenant_id
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

        -- 1. Fetch sub-store price overrides
        IF p_sub_store_id IS NOT NULL THEN
            SELECT price, foodpanda_price, grab_price
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.item_branch_prices
            WHERE branch_id = p_sub_store_id
              AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id))
            LIMIT 1;
        END IF;

        -- 2. Fetch parent branch price overrides
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

    -- Apply branch service charge
    SELECT COALESCE(service_charge_rate, 0) INTO v_sc_rate
    FROM public.branches
    WHERE id = p_branch_id;

    IF v_sc_rate > 0 THEN
        v_service_charge := ROUND((v_total_amount * (v_sc_rate / 100.0)), 2);
    ELSE
        v_service_charge := 0;
    END IF;

    v_net_total := (v_total_amount - v_sum_discount) + v_service_charge;

    UPDATE public.sales
    SET total_amount      = v_net_total,
        discount_type     = p_discount_type,
        discount_amount   = v_sum_discount,
        vatable_sales     = v_sum_vatable,
        vat_amount        = v_sum_vat_amount,
        vat_exempt_sales  = v_sum_vat_exempt,
        service_charge    = v_service_charge,
        discount_metadata = p_discount_metadata
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
