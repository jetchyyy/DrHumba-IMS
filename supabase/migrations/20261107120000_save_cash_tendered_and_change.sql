-- ==============================================================================
-- MIGRATION: Save Cash Tendered & Change + Safe Inventory-Menu Price Sync & Recovery
-- Description:
-- 1. Updates fn_process_sale and fn_process_offline_sale (built directly from
--    20261106000001_service_charge_dine_in_only.sql) to:
--    a) Persist amount_tendered and change_given on public.sales.
--    b) Safely merge menu_item_id & inventory_item_id overrides in item_branch_prices
--       without letting null fields clobber positive prices.
--    c) Fallback to linked inventory_items.selling_price (> 0.01) if a retail-linked
--       menu_items.price is 0.
-- 2. Hardens fn_sync_inventory_to_menu_items (SECURITY DEFINER) so portioning and
--    stock-in cost updates on inventory_items with NULL/0 selling_price NEVER delete
--    or overwrite manually linked POS menu items, and preserves custom menu names/SKUs.
-- 3. Heals zero-priced restaurant/retail menu items strictly for Dr. Humba
--    (tenant_id = '00000000-0000-0000-0000-000000000000') using linked catalog
--    selling_price, audit_logs PRICE_CHANGE history, or recent standard sale_items,
--    guaranteeing zero data changes on any other tenant.
-- ==============================================================================

-- 1. Drop existing function signatures cleanly
DROP FUNCTION IF EXISTS public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT, NUMERIC, TEXT);

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

        -- 1. Fetch sub-store price overrides if sub_store_id is present (prioritizing menu_item_id over inventory_item_id)
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

    IF p_queue_number IS NOT NULL AND p_queue_number <> '' THEN
        v_initial_status := 'preparing';
    ELSE
        v_initial_status := NULL;
    END IF;

    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method,
        sale_category, control_number, created_at, reference_number, queue_number, queue_status, queue_updated_at, tenant_id,
        notes
    )
    VALUES (
        p_branch_id, p_sub_store_id, p_cashier_id, 0, 'completed', p_payment_method,
        p_sale_category, p_control_number, p_created_at, p_reference_number, p_queue_number, v_initial_status, p_created_at, v_tenant_id,
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

GRANT EXECUTE ON FUNCTION public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT, NUMERIC, TEXT) TO authenticated;


-- 4. Harden fn_sync_inventory_to_menu_items so portioning/cost updates never delete or wipe linked POS menu items
CREATE OR REPLACE FUNCTION public.fn_sync_inventory_to_menu_items()
RETURNS TRIGGER AS $$
DECLARE
    v_tenant_id        UUID;
    v_existing_menu_id UUID;
    v_safe_sku         TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_tenant_id := OLD.tenant_id;
        IF EXISTS (
            SELECT 1
            FROM public.sale_items si
            JOIN public.menu_items mi ON mi.id = si.menu_item_id
            WHERE mi.inventory_item_id = OLD.id
        ) THEN
            UPDATE public.menu_items
            SET inventory_item_id = NULL,
                status            = 'inactive',
                is_available      = false
            WHERE inventory_item_id = OLD.id;
        ELSE
            DELETE FROM public.menu_items WHERE inventory_item_id = OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    v_tenant_id := NEW.tenant_id;

    SELECT id INTO v_existing_menu_id
    FROM public.menu_items
    WHERE inventory_item_id = NEW.id
    LIMIT 1;

    IF NEW.selling_price IS NOT NULL AND NEW.selling_price > 0 AND NEW.status = 'active' THEN
        IF v_existing_menu_id IS NOT NULL THEN
            UPDATE public.menu_items
            SET name = CASE
                    WHEN TG_OP = 'UPDATE' AND OLD.item_name IS DISTINCT FROM NEW.item_name THEN NEW.item_name
                    ELSE public.menu_items.name
                END,
                sku = CASE
                    WHEN TG_OP = 'UPDATE'
                         AND OLD.sku IS DISTINCT FROM NEW.sku
                         AND NOT EXISTS (
                             SELECT 1 FROM public.menu_items m2
                             WHERE m2.tenant_id = v_tenant_id
                               AND m2.sku = NEW.sku
                               AND m2.id <> v_existing_menu_id
                         )
                    THEN NEW.sku
                    ELSE public.menu_items.sku
                END,
                category = CASE
                    WHEN TG_OP = 'UPDATE' AND OLD.category IS DISTINCT FROM NEW.category THEN NEW.category
                    ELSE public.menu_items.category
                END,
                price = CASE
                    WHEN NEW.selling_price > 0.01 THEN NEW.selling_price
                    WHEN TG_OP = 'UPDATE' AND OLD.selling_price IS DISTINCT FROM NEW.selling_price THEN NEW.selling_price
                    WHEN public.menu_items.price > 0.01 THEN public.menu_items.price
                    ELSE NEW.selling_price
                END,
                cost_price = NEW.cost_per_base_unit,
                status = NEW.status,
                available_branches = CASE
                    WHEN TG_OP = 'UPDATE' AND OLD.available_branches IS NOT DISTINCT FROM NEW.available_branches THEN public.menu_items.available_branches
                    ELSE NEW.available_branches
                END,
                foodpanda_price = CASE
                    WHEN TG_OP = 'UPDATE' AND OLD.foodpanda_price IS NOT DISTINCT FROM NEW.foodpanda_price THEN public.menu_items.foodpanda_price
                    ELSE NEW.foodpanda_price
                END,
                grab_price = CASE
                    WHEN TG_OP = 'UPDATE' AND OLD.grab_price IS NOT DISTINCT FROM NEW.grab_price THEN public.menu_items.grab_price
                    ELSE NEW.grab_price
                END
            WHERE id = v_existing_menu_id;
        ELSE
            v_safe_sku := NEW.sku;
            IF EXISTS (
                SELECT 1 FROM public.menu_items
                WHERE tenant_id = v_tenant_id
                  AND sku = v_safe_sku
                  AND (type <> 'retail' OR inventory_item_id IS NOT NULL)
            ) THEN
                v_safe_sku := NEW.sku || '-POS';
            END IF;

            INSERT INTO public.menu_items (
                name, sku, category, price, cost_price, type, inventory_item_id, status, tenant_id, available_branches, foodpanda_price, grab_price
            )
            VALUES (
                NEW.item_name, v_safe_sku, NEW.category, NEW.selling_price, NEW.cost_per_base_unit, 'retail', NEW.id, NEW.status, v_tenant_id, NEW.available_branches, NEW.foodpanda_price, NEW.grab_price
            )
            ON CONFLICT (tenant_id, sku) DO UPDATE SET
                inventory_item_id  = COALESCE(public.menu_items.inventory_item_id, EXCLUDED.inventory_item_id),
                price              = CASE WHEN public.menu_items.price > 0.01 AND EXCLUDED.price <= 0.01 THEN public.menu_items.price ELSE EXCLUDED.price END,
                cost_price         = EXCLUDED.cost_price,
                status             = EXCLUDED.status,
                available_branches = COALESCE(EXCLUDED.available_branches, public.menu_items.available_branches),
                foodpanda_price    = COALESCE(EXCLUDED.foodpanda_price, public.menu_items.foodpanda_price),
                grab_price         = COALESCE(EXCLUDED.grab_price, public.menu_items.grab_price);
        END IF;
    ELSE
        -- Item is either inactive OR has NULL/0 selling_price on inventory_items
        IF v_existing_menu_id IS NOT NULL THEN
            IF NEW.status <> 'active' THEN
                UPDATE public.menu_items
                SET status       = 'inactive',
                    is_available = false,
                    cost_price   = NEW.cost_per_base_unit
                WHERE id = v_existing_menu_id;
            ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.selling_price, 0) <= 0 THEN
                -- Item never had Direct POS selling_price set on inventory_items (e.g., portioned item
                -- linked manually from Recipes.tsx while fn_approve_portioning updates cost_per_base_unit):
                -- ONLY sync cost_price; NEVER delete or alter price!
                UPDATE public.menu_items
                SET cost_price = NEW.cost_per_base_unit
                WHERE id = v_existing_menu_id;
            ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.selling_price, 0) > 0 THEN
                -- User explicitly turned OFF Direct POS selling in Inventory.tsx
                IF EXISTS (SELECT 1 FROM public.sale_items WHERE menu_item_id = v_existing_menu_id) THEN
                    UPDATE public.menu_items
                    SET status       = 'inactive',
                        is_available = false
                    WHERE id = v_existing_menu_id;
                ELSE
                    DELETE FROM public.menu_items WHERE id = v_existing_menu_id;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_sync_inventory_delete_to_menu_items()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.sale_items si
        JOIN public.menu_items mi ON mi.id = si.menu_item_id
        WHERE mi.inventory_item_id = OLD.id
    ) THEN
        UPDATE public.menu_items
        SET inventory_item_id = NULL,
            status            = 'inactive',
            is_available      = false
        WHERE inventory_item_id = OLD.id;
    ELSE
        DELETE FROM public.menu_items WHERE inventory_item_id = OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 5. Strictly Scoped Data Healing for Dr. Humba ONLY ('00000000-0000-0000-0000-000000000000')
-- Restores zero-priced restaurant/retail menu items in Dr. Humba from:
--   (a) linked inventory_items.selling_price (> 0.01),
--   (b) most recent audit_logs PRICE_CHANGE old_price (> 0.01), or
--   (c) most recent completed standard (non-delivery) sale_items.unit_price (> 0.01).
-- Zero rows of any other tenant are queried or modified.
DO $$
DECLARE
    v_dr_humba_tenant CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
    r_zero_item       RECORD;
    v_recovered_price NUMERIC;
BEGIN
    FOR r_zero_item IN (
        SELECT mi.id, mi.name, mi.sku, mi.type, mi.inventory_item_id
        FROM public.menu_items mi
        WHERE mi.tenant_id = v_dr_humba_tenant
          AND COALESCE(mi.type, 'restaurant') IN ('restaurant', 'retail')
          AND COALESCE(mi.price, 0) <= 0
    ) LOOP
        v_recovered_price := NULL;

        -- Source A: Linked inventory item's selling_price (> 0.01 sentinel)
        IF r_zero_item.inventory_item_id IS NOT NULL THEN
            SELECT ii.selling_price
            INTO v_recovered_price
            FROM public.inventory_items ii
            WHERE ii.id = r_zero_item.inventory_item_id
              AND ii.tenant_id = v_dr_humba_tenant
              AND ii.selling_price IS NOT NULL
              AND ii.selling_price > 0.01
            LIMIT 1;
        END IF;

        -- Source B: Most recent Menu Items PRICE_CHANGE audit trail entry (> 0.01)
        IF v_recovered_price IS NULL OR v_recovered_price <= 0.01 THEN
            SELECT (al.old_value->>'old_price')::NUMERIC
            INTO v_recovered_price
            FROM public.audit_logs al
            WHERE al.tenant_id = v_dr_humba_tenant
              AND al.action = 'PRICE_CHANGE'
              AND al.module = 'Menu Items'
              AND (
                  al.old_value->>'sku' = r_zero_item.sku
                  OR al.new_value->>'sku' = r_zero_item.sku
                  OR al.old_value->>'name' = r_zero_item.name
              )
              AND (al.old_value->>'old_price') ~ '^[0-9]+(\.[0-9]+)?$'
              AND (al.old_value->>'old_price')::NUMERIC > 0.01
            ORDER BY al.timestamp DESC
            LIMIT 1;
        END IF;

        -- Source C: Most recent completed standard (non-Foodpanda/Grab) sale unit_price (> 0.01)
        IF v_recovered_price IS NULL OR v_recovered_price <= 0.01 THEN
            SELECT si.unit_price
            INTO v_recovered_price
            FROM public.sale_items si
            JOIN public.sales s ON s.id = si.sale_id
            WHERE si.menu_item_id = r_zero_item.id
              AND si.tenant_id = v_dr_humba_tenant
              AND s.tenant_id = v_dr_humba_tenant
              AND s.status = 'completed'
              AND NOT (
                  LOWER(COALESCE(s.sale_category, '')) LIKE '%foodpanda%'
                  OR LOWER(COALESCE(s.sale_category, '')) LIKE '%food panda%'
                  OR LOWER(COALESCE(s.sale_category, '')) LIKE '%grab%'
              )
              AND si.unit_price > 0.01
            ORDER BY s.created_at DESC
            LIMIT 1;
        END IF;

        -- Apply recovery strictly to this Dr. Humba menu item (and sync linked retail selling_price if needed)
        IF v_recovered_price IS NOT NULL AND v_recovered_price > 0.01 THEN
            UPDATE public.menu_items
            SET price = v_recovered_price
            WHERE id = r_zero_item.id
              AND tenant_id = v_dr_humba_tenant;

            IF r_zero_item.type = 'retail' AND r_zero_item.inventory_item_id IS NOT NULL THEN
                UPDATE public.inventory_items
                SET selling_price = v_recovered_price
                WHERE id = r_zero_item.inventory_item_id
                  AND tenant_id = v_dr_humba_tenant
                  AND (selling_price IS NULL OR selling_price <= 0);
            END IF;
        END IF;
    END LOOP;
END;
$$;
