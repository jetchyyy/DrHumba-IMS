-- ==============================================================================
-- MIGRATION: Smart Packaging Recipe Deduction with Dine-In Exemption
-- Description:
-- 1. Updates fn_process_sale and fn_process_offline_sale so that recipe ingredients
--    belonging to the 'Packaging' category are:
--    a) Automatically DEDUCTED for Grab, Foodpanda, Take Out, and other delivery orders.
--    b) Automatically SPARED / SKIPPED for Dine-In transactions (plates & utensils used).
--    c) COGS (cost_price) for Dine-In transactions excludes packaging costs, keeping
--       food margins accurate.
-- 2. Updates fn_void_sale_items so that voiding a Dine-In transaction does NOT
--    artificially restock packaging that was never deducted.
-- 3. Updates fn_get_menu_items_availability so that running low on takeout packaging
--    does not mark food items as out of stock for Dine-In customers.
-- ==============================================================================

-- 1. Drop existing function signatures to ensure clean replacement
DROP FUNCTION IF EXISTS public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.fn_get_menu_items_availability(UUID);

-- 2. Redefine public.fn_process_sale
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id         UUID,
    p_items             JSONB,   -- [{ "menu_item_id": "...", "quantity": N, "price": P, "notes": "...", ... }]
    p_payment_method    TEXT    DEFAULT 'cash',
    p_amount_tendered   NUMERIC DEFAULT NULL,
    p_sale_category     TEXT    DEFAULT NULL,
    p_reference_number  TEXT    DEFAULT NULL,
    p_queue_number      TEXT    DEFAULT NULL,
    p_sub_store_id      UUID    DEFAULT NULL,
    p_discount_type     TEXT    DEFAULT NULL,
    p_discount_amount   NUMERIC DEFAULT 0,
    p_discount_metadata JSONB   DEFAULT '[]'::jsonb,
    p_notes             TEXT    DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sale_id           UUID;
    v_tenant_id         UUID := public.get_my_tenant_id();
    r_item              RECORD;
    r_ing               RECORD;
    v_total_amount      NUMERIC := 0;
    v_qty_needed        NUMERIC;
    v_current_qty       NUMERIC;
    v_item_name         TEXT;
    v_menu_name         TEXT;
    v_price             NUMERIC;
    v_foodpanda_price   NUMERIC;
    v_grab_price_num    NUMERIC;
    v_inv_selling_price NUMERIC;
    v_inv_fp_price      NUMERIC;
    v_inv_grab_price    NUMERIC;
    v_bp_price          NUMERIC;
    v_bp_foodpanda      NUMERIC;
    v_bp_grab           NUMERIC;
    v_cost_price        NUMERIC;
    v_subtotal          NUMERIC;
    v_change            NUMERIC := 0;
    v_initial_status    TEXT;
    v_type              TEXT;
    v_inventory_item_id UUID;
    v_has_recipe        BOOLEAN;
    v_item_policy       TEXT := 'strict';
    v_is_dine_in        BOOLEAN;

    -- Item discount calculations
    v_item_discount     NUMERIC;
    v_item_vatable      NUMERIC;
    v_item_vat_amount   NUMERIC;
    v_item_vat_exempt   NUMERIC;
    v_item_is_exempt    BOOLEAN;

    -- Aggregate calculations
    v_sum_discount      NUMERIC;
    v_sum_vatable       NUMERIC;
    v_sum_vat_amount    NUMERIC;
    v_sum_vat_exempt    NUMERIC;
    v_net_total         NUMERIC;

    -- Service charge
    v_sc_rate           NUMERIC := 0;
    v_service_charge    NUMERIC := 0;
BEGIN
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- Identify Dine-In channel (skip packaging deduction if Dine In)
    v_is_dine_in := LOWER(TRIM(COALESCE(p_sale_category, ''))) IN ('dine in', 'dine-in', 'dine');

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
        SELECT (value->>'menu_item_id')::UUID        AS menu_item_id,
               (value->>'quantity')::INT             AS qty,
               (value->>'price')::NUMERIC            AS custom_price,
               (value->>'notes')::TEXT               AS notes,
               (value->>'discount_amount')::NUMERIC  AS item_discount,
               (value->>'is_vat_exempt')::BOOLEAN    AS item_is_exempt,
               (value->>'vatable_sales')::NUMERIC    AS item_vatable,
               (value->>'vat_amount')::NUMERIC       AS item_vat_amount,
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

        -- If linked to an inventory catalog item, check policy and fallback prices
        IF v_inventory_item_id IS NOT NULL THEN
            SELECT
                CASE WHEN v_item_policy IS NULL OR v_item_policy = 'strict'
                     THEN COALESCE(stock_enforcement_mode, v_item_policy)
                     ELSE v_item_policy END,
                selling_price,
                foodpanda_price,
                grab_price
            INTO v_item_policy, v_inv_selling_price, v_inv_fp_price, v_inv_grab_price
            FROM public.inventory_items
            WHERE id = v_inventory_item_id;

            IF COALESCE(v_price, 0) <= 0 AND v_inv_selling_price IS NOT NULL AND v_inv_selling_price > 0.01 THEN
                v_price := v_inv_selling_price;
            END IF;
            IF COALESCE(v_foodpanda_price, 0) <= 0 AND v_inv_fp_price IS NOT NULL AND v_inv_fp_price > 0 THEN
                v_foodpanda_price := v_inv_fp_price;
            END IF;
            IF COALESCE(v_grab_price_num, 0) <= 0 AND v_inv_grab_price IS NOT NULL AND v_inv_grab_price > 0 THEN
                v_grab_price_num := v_inv_grab_price;
            END IF;
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
            SELECT
                COALESCE(
                    MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND price > 0 THEN price END),
                    MAX(CASE WHEN price > 0 THEN price END)
                ),
                COALESCE(
                    MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND foodpanda_price > 0 THEN foodpanda_price END),
                    MAX(CASE WHEN foodpanda_price > 0 THEN foodpanda_price END)
                ),
                COALESCE(
                    MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND grab_price > 0 THEN grab_price END),
                    MAX(CASE WHEN grab_price > 0 THEN grab_price END)
                )
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.item_branch_prices
            WHERE branch_id = p_sub_store_id
              AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id));
        END IF;

        -- 2. Fetch parent branch price overrides to fill in any missing values
        SELECT
            COALESCE(
                v_bp_price,
                MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND price > 0 THEN price END),
                MAX(CASE WHEN price > 0 THEN price END)
            ),
            COALESCE(
                v_bp_foodpanda,
                MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND foodpanda_price > 0 THEN foodpanda_price END),
                MAX(CASE WHEN foodpanda_price > 0 THEN foodpanda_price END)
            ),
            COALESCE(
                v_bp_grab,
                MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND grab_price > 0 THEN grab_price END),
                MAX(CASE WHEN grab_price > 0 THEN grab_price END)
            )
        INTO v_bp_price, v_bp_foodpanda, v_bp_grab
        FROM public.item_branch_prices
        WHERE branch_id = p_branch_id
          AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id));

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

        v_subtotal     := v_price * r_item.qty;
        v_total_amount := v_total_amount + v_subtotal;

        -- Calculate COGS (if Dine In, exclude ingredients where category = 'Packaging')
        IF v_type = 'restaurant' THEN
            SELECT COALESCE(SUM(ri.quantity_base_unit * ii.cost_per_base_unit), 0)
            INTO v_cost_price
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items ii ON ii.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id
              AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(ii.category, ''))) = 'packaging');
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

        -- Check recipe existence (considering dine-in packaging exclusion)
        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items ii ON ii.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id
              AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(ii.category, ''))) = 'packaging')
        ) INTO v_has_recipe;

        IF v_has_recipe THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes r         ON r.id  = ri.recipe_id
                JOIN public.inventory_items i ON i.id  = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
                  AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(i.category, ''))) = 'packaging')
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
            -- Directly mapped retail or standalone packaging item punched directly in POS
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
    IF v_is_dine_in THEN
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

    -- Calculate change given for cash payments
    IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL THEN
        v_change := GREATEST(0, p_amount_tendered - v_net_total);
    ELSE
        v_change := 0;
    END IF;

    UPDATE public.sales
    SET total_amount          = v_net_total,
        amount_tendered       = p_amount_tendered,
        change_given          = v_change,
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


-- 3. Redefine public.fn_process_offline_sale
CREATE OR REPLACE FUNCTION public.fn_process_offline_sale(
    p_branch_id         UUID,
    p_items             JSONB,
    p_payment_method    TEXT,
    p_created_at        TIMESTAMPTZ,
    p_control_number    TEXT,
    p_cashier_id        UUID,
    p_reference_number  TEXT    DEFAULT NULL,
    p_queue_number      TEXT    DEFAULT NULL,
    p_sub_store_id      UUID    DEFAULT NULL,
    p_discount_type     TEXT    DEFAULT NULL,
    p_discount_amount   NUMERIC DEFAULT 0,
    p_discount_metadata JSONB   DEFAULT '[]'::jsonb,
    p_notes             TEXT    DEFAULT NULL,
    p_amount_tendered   NUMERIC DEFAULT NULL,
    p_sale_category     TEXT    DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sale_id           UUID;
    v_tenant_id         UUID := public.get_my_tenant_id();
    r_item              RECORD;
    r_ing               RECORD;
    v_total_amount      NUMERIC := 0;
    v_qty_needed        NUMERIC;
    v_current_qty       NUMERIC;
    v_item_name         TEXT;
    v_menu_name         TEXT;
    v_price             NUMERIC;
    v_foodpanda_price   NUMERIC;
    v_grab_price_num    NUMERIC;
    v_inv_selling_price NUMERIC;
    v_inv_fp_price      NUMERIC;
    v_inv_grab_price    NUMERIC;
    v_bp_price          NUMERIC;
    v_bp_foodpanda      NUMERIC;
    v_bp_grab           NUMERIC;
    v_cost_price        NUMERIC;
    v_subtotal          NUMERIC;
    v_change            NUMERIC := 0;
    v_initial_status    TEXT;
    v_type              TEXT;
    v_inventory_item_id UUID;
    v_has_recipe        BOOLEAN;
    v_item_policy       TEXT := 'strict';
    v_is_dine_in        BOOLEAN;

    -- Item discount calculations
    v_item_discount     NUMERIC;
    v_item_vatable      NUMERIC;
    v_item_vat_amount   NUMERIC;
    v_item_vat_exempt   NUMERIC;
    v_item_is_exempt    BOOLEAN;

    -- Aggregate calculations
    v_sum_discount      NUMERIC;
    v_sum_vatable       NUMERIC;
    v_sum_vat_amount    NUMERIC;
    v_sum_vat_exempt    NUMERIC;
    v_net_total         NUMERIC;

    -- Service charge
    v_sc_rate           NUMERIC := 0;
    v_service_charge    NUMERIC := 0;
BEGIN
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- Identify Dine-In channel (skip packaging deduction if Dine In)
    v_is_dine_in := LOWER(TRIM(COALESCE(p_sale_category, ''))) IN ('dine in', 'dine-in', 'dine');

    IF p_queue_number IS NOT NULL AND p_queue_number <> '' THEN
        v_initial_status := 'preparing';
    ELSE
        v_initial_status := NULL;
    END IF;

    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method,
        created_at, control_number, sale_category, reference_number, queue_number,
        queue_status, queue_updated_at, tenant_id, notes
    )
    VALUES (
        p_branch_id, p_sub_store_id, p_cashier_id, 0, 'completed', p_payment_method,
        p_created_at, p_control_number, p_sale_category, p_reference_number, p_queue_number,
        v_initial_status, p_created_at, v_tenant_id, p_notes
    )
    RETURNING id INTO v_sale_id;

    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID        AS menu_item_id,
               (value->>'quantity')::INT             AS qty,
               (value->>'price')::NUMERIC            AS custom_price,
               (value->>'notes')::TEXT               AS notes,
               (value->>'discount_amount')::NUMERIC  AS item_discount,
               (value->>'is_vat_exempt')::BOOLEAN    AS item_is_exempt,
               (value->>'vatable_sales')::NUMERIC    AS item_vatable,
               (value->>'vat_amount')::NUMERIC       AS item_vat_amount,
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

        -- If linked to an inventory catalog item, check policy and fallback prices
        IF v_inventory_item_id IS NOT NULL THEN
            SELECT
                CASE WHEN v_item_policy IS NULL OR v_item_policy = 'strict'
                     THEN COALESCE(stock_enforcement_mode, v_item_policy)
                     ELSE v_item_policy END,
                selling_price,
                foodpanda_price,
                grab_price
            INTO v_item_policy, v_inv_selling_price, v_inv_fp_price, v_inv_grab_price
            FROM public.inventory_items
            WHERE id = v_inventory_item_id;

            IF COALESCE(v_price, 0) <= 0 AND v_inv_selling_price IS NOT NULL AND v_inv_selling_price > 0.01 THEN
                v_price := v_inv_selling_price;
            END IF;
            IF COALESCE(v_foodpanda_price, 0) <= 0 AND v_inv_fp_price IS NOT NULL AND v_inv_fp_price > 0 THEN
                v_foodpanda_price := v_inv_fp_price;
            END IF;
            IF COALESCE(v_grab_price_num, 0) <= 0 AND v_inv_grab_price IS NOT NULL AND v_inv_grab_price > 0 THEN
                v_grab_price_num := v_inv_grab_price;
            END IF;
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
            SELECT
                COALESCE(
                    MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND price > 0 THEN price END),
                    MAX(CASE WHEN price > 0 THEN price END)
                ),
                COALESCE(
                    MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND foodpanda_price > 0 THEN foodpanda_price END),
                    MAX(CASE WHEN foodpanda_price > 0 THEN foodpanda_price END)
                ),
                COALESCE(
                    MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND grab_price > 0 THEN grab_price END),
                    MAX(CASE WHEN grab_price > 0 THEN grab_price END)
                )
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.item_branch_prices
            WHERE branch_id = p_sub_store_id
              AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id));
        END IF;

        -- 2. Fetch parent branch price overrides to fill in any missing values
        SELECT
            COALESCE(
                v_bp_price,
                MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND price > 0 THEN price END),
                MAX(CASE WHEN price > 0 THEN price END)
            ),
            COALESCE(
                v_bp_foodpanda,
                MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND foodpanda_price > 0 THEN foodpanda_price END),
                MAX(CASE WHEN foodpanda_price > 0 THEN foodpanda_price END)
            ),
            COALESCE(
                v_bp_grab,
                MAX(CASE WHEN menu_item_id = r_item.menu_item_id AND grab_price > 0 THEN grab_price END),
                MAX(CASE WHEN grab_price > 0 THEN grab_price END)
            )
        INTO v_bp_price, v_bp_foodpanda, v_bp_grab
        FROM public.item_branch_prices
        WHERE branch_id = p_branch_id
          AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id));

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

        v_subtotal     := v_price * r_item.qty;
        v_total_amount := v_total_amount + v_subtotal;

        -- Calculate COGS (if Dine In, exclude ingredients where category = 'Packaging')
        IF v_type = 'restaurant' THEN
            SELECT COALESCE(SUM(ri.quantity_base_unit * ii.cost_per_base_unit), 0)
            INTO v_cost_price
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items ii ON ii.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id
              AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(ii.category, ''))) = 'packaging');
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

        -- Check recipe existence (considering dine-in packaging exclusion)
        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items ii ON ii.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id
              AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(ii.category, ''))) = 'packaging')
        ) INTO v_has_recipe;

        IF v_has_recipe THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes r         ON r.id  = ri.recipe_id
                JOIN public.inventory_items i ON i.id  = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
                  AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(i.category, ''))) = 'packaging')
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
            -- Directly mapped retail or standalone packaging item punched directly in POS
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
    IF v_is_dine_in THEN
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

    -- Calculate change given for cash payments
    IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL THEN
        v_change := GREATEST(0, p_amount_tendered - v_net_total);
    ELSE
        v_change := 0;
    END IF;

    UPDATE public.sales
    SET total_amount          = v_net_total,
        amount_tendered       = p_amount_tendered,
        change_given          = v_change,
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


-- 4. Redefine public.fn_void_sale_items
CREATE OR REPLACE FUNCTION public.fn_void_sale_items(
    p_sale_id     UUID,
    p_items       JSONB,
    p_void_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_my_role         TEXT;
    v_status          TEXT;
    v_branch_id       UUID;
    v_tenant_id       UUID;
    v_sale_category   TEXT;
    v_total_amount    NUMERIC;
    v_total_refund    NUMERIC := 0;
    v_remaining_qty   INT;
    r_item            RECORD;
    r_ing             RECORD;
    v_qty_to_void     INT;
    v_qty_return      NUMERIC;
    v_elem            JSONB;
    v_sale_item_id    UUID;
    v_my_allowed_tabs TEXT[];
    v_has_void_perm   BOOLEAN := FALSE;
    v_is_dine_in      BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization Check (Role or Granular 'sales_void' Permission)
    SELECT role_name, allowed_tabs
    INTO v_my_role, v_my_allowed_tabs
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_my_role IN ('super_admin', 'branch_manager', 'inventory_manager') THEN
        v_has_void_perm := TRUE;
    ELSIF v_my_allowed_tabs IS NOT NULL AND 'sales_void' = ANY(v_my_allowed_tabs) THEN
        v_has_void_perm := TRUE;
    END IF;

    IF NOT v_has_void_perm THEN
        RAISE EXCEPTION 'Unauthorized: Only super_admin, branch_manager, or staff authorized with void permissions can void sale items.';
    END IF;

    IF p_void_reason IS NULL OR length(trim(p_void_reason)) < 3 THEN
        RAISE EXCEPTION 'Void reason must be at least 3 characters.';
    END IF;

    -- 2. Fetch Sale
    SELECT status, branch_id, tenant_id, total_amount, sale_category
    INTO v_status, v_branch_id, v_tenant_id, v_total_amount, v_sale_category
    FROM public.sales
    WHERE id = p_sale_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    IF v_status = 'refunded' THEN
        RAISE EXCEPTION 'Sale % has already been fully refunded.', p_sale_id;
    END IF;

    v_is_dine_in := LOWER(TRIM(COALESCE(v_sale_category, ''))) IN ('dine in', 'dine-in', 'dine');

    -- 3. Process Items to Void
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        -- Specific items selected
        FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            v_sale_item_id := (v_elem->>'sale_item_id')::UUID;
            v_qty_to_void  := COALESCE((v_elem->>'quantity_to_void')::INT, 1);

            IF v_qty_to_void <= 0 THEN
                CONTINUE;
            END IF;

            -- Fetch sale item & menu item
            SELECT si.id, si.quantity, si.voided_quantity, si.unit_price, si.subtotal, m.id AS menu_item_id, m.type, m.inventory_item_id
            INTO r_item
            FROM public.sale_items si
            JOIN public.menu_items m ON m.id = si.menu_item_id
            WHERE si.id = v_sale_item_id AND si.sale_id = p_sale_id;

            IF r_item.id IS NULL THEN
                RAISE EXCEPTION 'Sale item % not found in sale %.', v_sale_item_id, p_sale_id;
            END IF;

            IF (r_item.quantity - r_item.voided_quantity) < v_qty_to_void THEN
                RAISE EXCEPTION 'Cannot void % units: only % active units remain for this item.',
                    v_qty_to_void, (r_item.quantity - r_item.voided_quantity);
            END IF;

            -- Update sale_item voided tracking
            UPDATE public.sale_items
            SET voided_quantity = voided_quantity + v_qty_to_void,
                void_reason     = p_void_reason,
                voided_at       = now(),
                voided_by       = auth.uid()
            WHERE id = v_sale_item_id;

            -- Accumulate refund
            v_total_refund := v_total_refund + (r_item.unit_price * v_qty_to_void);

            -- Restock inventory based on item type (skip packaging if Dine In)
            IF r_item.type = 'restaurant' THEN
                FOR r_ing IN (
                    SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                    FROM public.recipe_ingredients ri
                    JOIN public.recipes         r ON r.id = ri.recipe_id
                    JOIN public.inventory_items i ON i.id = ri.item_id
                    WHERE r.menu_item_id = r_item.menu_item_id
                      AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(i.category, ''))) = 'packaging')
                ) LOOP
                    v_qty_return := r_ing.quantity_base_unit * v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_ing.item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_ing.item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END LOOP;

            ELSIF r_item.type = 'retail' THEN
                IF r_item.inventory_item_id IS NOT NULL THEN
                    v_qty_return := v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_item.inventory_item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_item.inventory_item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END IF;
            END IF;
        END LOOP;
    ELSE
        -- Void ALL remaining active items
        FOR r_item IN (
            SELECT si.id, si.quantity, si.voided_quantity, si.unit_price, si.subtotal, m.id AS menu_item_id, m.type, m.inventory_item_id
            FROM public.sale_items si
            JOIN public.menu_items m ON m.id = si.menu_item_id
            WHERE si.sale_id = p_sale_id AND (si.quantity - si.voided_quantity) > 0
        ) LOOP
            v_qty_to_void := r_item.quantity - r_item.voided_quantity;

            UPDATE public.sale_items
            SET voided_quantity = quantity,
                void_reason     = p_void_reason,
                voided_at       = now(),
                voided_by       = auth.uid()
            WHERE id = r_item.id;

            v_total_refund := v_total_refund + (r_item.unit_price * v_qty_to_void);

            IF r_item.type = 'restaurant' THEN
                FOR r_ing IN (
                    SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                    FROM public.recipe_ingredients ri
                    JOIN public.recipes         r ON r.id = ri.recipe_id
                    JOIN public.inventory_items i ON i.id = ri.item_id
                    WHERE r.menu_item_id = r_item.menu_item_id
                      AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(i.category, ''))) = 'packaging')
                ) LOOP
                    v_qty_return := r_ing.quantity_base_unit * v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_ing.item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_ing.item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END LOOP;

            ELSIF r_item.type = 'retail' THEN
                IF r_item.inventory_item_id IS NOT NULL THEN
                    v_qty_return := v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_item.inventory_item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_item.inventory_item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 4. Check if any active items remain
    SELECT COALESCE(SUM(quantity - voided_quantity), 0)
    INTO v_remaining_qty
    FROM public.sale_items
    WHERE sale_id = p_sale_id;

    IF v_remaining_qty <= 0 THEN
        -- 100% of items voided -> full refund
        UPDATE public.sales
        SET status          = 'refunded',
            refunded_amount = total_amount,
            voided_by       = auth.uid(),
            voided_at       = now(),
            void_reason     = p_void_reason
        WHERE id = p_sale_id;
    ELSE
        -- Partial void -> keep completed status, update refunded_amount and reason
        UPDATE public.sales
        SET refunded_amount = COALESCE(refunded_amount, 0) + v_total_refund,
            void_reason     = p_void_reason
        WHERE id = p_sale_id;
    END IF;

    -- 5. Audit Log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'VOID_SALE_ITEMS',
        'Sales',
        json_build_object('sale_id', p_sale_id, 'status', v_status)::jsonb,
        json_build_object(
            'sale_id',         p_sale_id,
            'refund_amount',   v_total_refund,
            'remaining_qty',   v_remaining_qty,
            'void_reason',     p_void_reason
        )::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Redefine public.fn_get_menu_items_availability
-- Excludes packaging from stock availability checks so lack of takeout boxes does not disable dine-in dishes
CREATE OR REPLACE FUNCTION public.fn_get_menu_items_availability(
    p_branch_id UUID
)
RETURNS TABLE (
    menu_item_id UUID,
    stock_available BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mi.id AS menu_item_id,
        CASE
            -- 1. If it has a recipe
            WHEN EXISTS (
                SELECT 1 FROM public.recipes r 
                WHERE r.menu_item_id = mi.id
            ) THEN NOT EXISTS (
                -- Check if any non-packaging recipe ingredient stock is less than required base unit quantity
                SELECT 1 
                FROM public.recipes r
                JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
                JOIN public.inventory_items ii ON ii.id = ri.item_id
                LEFT JOIN public.inventory_balances ib ON ib.item_id = ri.item_id AND ib.branch_id = p_branch_id
                WHERE r.menu_item_id = mi.id
                  AND LOWER(TRIM(COALESCE(ii.category, ''))) != 'packaging'
                  AND COALESCE(ib.quantity, 0) < ri.quantity_base_unit
            )
            -- 2. If it is retail / mapped directly to an inventory item
            WHEN mi.inventory_item_id IS NOT NULL THEN COALESCE((
                SELECT ib.quantity FROM public.inventory_balances ib 
                WHERE ib.item_id = mi.inventory_item_id AND ib.branch_id = p_branch_id
            ), 0) >= 1
            -- 3. Otherwise (service, etc. not tracked)
            ELSE TRUE
        END AS stock_available
    FROM public.menu_items mi;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Grant execute permissions
GRANT EXECUTE ON FUNCTION public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_void_sale_items(UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_menu_items_availability(UUID) TO authenticated;

