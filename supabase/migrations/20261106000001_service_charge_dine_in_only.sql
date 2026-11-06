-- ==============================================================================
-- MIGRATION: Service Charge Applicable Only to Dine In Sales
-- Description: Ensures service charge is calculated and recorded ONLY when
--              sale_category is Dine In. Foodpanda, Grab, Take Out, and other
--              sales strictly have 0% service charge.
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
        p_sale_category, p_reference_number, p_queue_number, v_initial_status,
        CASE WHEN v_initial_status IS NOT NULL THEN NOW() ELSE NULL END,
        v_tenant_id,
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

        v_bp_price := NULL;
        v_bp_foodpanda := NULL;
        v_bp_grab := NULL;

        IF p_sub_store_id IS NOT NULL THEN
            SELECT price, foodpanda_price, grab_price
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.menu_item_branch_prices
            WHERE menu_item_id = r_item.menu_item_id AND branch_id = p_sub_store_id;
        END IF;

        IF v_bp_price IS NULL THEN
            SELECT price, foodpanda_price, grab_price
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.menu_item_branch_prices
            WHERE menu_item_id = r_item.menu_item_id AND branch_id = p_branch_id;
        END IF;

        IF r_item.custom_price IS NOT NULL AND r_item.custom_price > 0 THEN
            v_price := r_item.custom_price;
        ELSIF p_sale_category ILIKE '%foodpanda%' THEN
            v_price := COALESCE(v_bp_foodpanda, v_foodpanda_price, v_bp_price, v_price);
        ELSIF p_sale_category ILIKE '%grab%' THEN
            v_price := COALESCE(v_bp_grab, v_grab_price_num, v_bp_price, v_price);
        ELSE
            v_price := COALESCE(v_bp_price, v_price);
        END IF;

        v_subtotal := v_price * r_item.qty;
        v_total_amount := v_total_amount + v_subtotal;

        SELECT EXISTS (
            SELECT 1 FROM public.recipes WHERE menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

        IF v_type = 'service' OR v_item_policy = 'disabled' THEN
            v_cost_price := 0.00;
        ELSIF v_type = 'retail' OR (NOT v_has_recipe AND v_inventory_item_id IS NOT NULL) THEN
            SELECT cost_price, current_stock, item_name INTO v_cost_price, v_current_qty, v_item_name
            FROM public.inventory_items
            WHERE id = v_inventory_item_id
            FOR UPDATE;

            IF v_cost_price IS NULL THEN
                v_cost_price := 0.00;
            END IF;

            IF v_item_policy = 'strict' AND v_current_qty < r_item.qty THEN
                RAISE EXCEPTION 'Insufficient stock for "%" (available: %, needed: %)',
                    COALESCE(v_item_name, v_menu_name), v_current_qty, r_item.qty;
            END IF;

            UPDATE public.inventory_items
            SET current_stock = current_stock - r_item.qty
            WHERE id = v_inventory_item_id;

            INSERT INTO public.stock_movements (
                inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
            ) VALUES (
                v_inventory_item_id,
                'out',
                r_item.qty,
                CASE 
                    WHEN p_queue_number IS NOT NULL AND p_queue_number <> '' 
                    THEN 'Direct POS Sale (Queue #' || p_queue_number || ')'
                    ELSE 'Direct POS Sale'
                END,
                auth.uid(),
                v_tenant_id
            );
        ELSIF v_has_recipe THEN
            v_cost_price := 0.00;

            FOR r_ing IN (
                SELECT r.inventory_item_id,
                       r.quantity AS recipe_qty,
                       ii.current_stock,
                       ii.cost_price,
                       ii.item_name,
                       COALESCE(ii.stock_enforcement_mode, v_item_policy) AS ing_policy
                FROM public.recipes r
                JOIN public.inventory_items ii ON ii.id = r.inventory_item_id
                WHERE r.menu_item_id = r_item.menu_item_id
                FOR UPDATE OF ii
            ) LOOP
                v_cost_price := v_cost_price + (COALESCE(r_ing.cost_price, 0.00) * r_ing.recipe_qty);
                v_qty_needed := r_ing.recipe_qty * r_item.qty;

                IF r_ing.ing_policy = 'strict' AND r_ing.current_stock < v_qty_needed THEN
                    RAISE EXCEPTION 'Insufficient stock for ingredient "%" in menu item "%" (available: %, needed: %)',
                        r_ing.item_name, v_menu_name, r_ing.current_stock, v_qty_needed;
                END IF;

                UPDATE public.inventory_items
                SET current_stock = current_stock - v_qty_needed
                WHERE id = r_ing.inventory_item_id;

                INSERT INTO public.stock_movements (
                    inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
                ) VALUES (
                    r_ing.inventory_item_id,
                    'out',
                    v_qty_needed,
                    CASE 
                        WHEN p_queue_number IS NOT NULL AND p_queue_number <> '' 
                        THEN 'POS Sale - Recipe Deduction for ' || v_menu_name || ' (Queue #' || p_queue_number || ')'
                        ELSE 'POS Sale - Recipe Deduction for ' || v_menu_name
                    END,
                    auth.uid(),
                    v_tenant_id
                );
            END LOOP;
        ELSE
            v_cost_price := 0.00;
        END IF;

        v_item_discount  := COALESCE(r_item.item_discount, 0);
        v_item_is_exempt := COALESCE(r_item.item_is_exempt, false);
        v_item_vatable   := COALESCE(r_item.item_vatable, 0);
        v_item_vat_amount := COALESCE(r_item.item_vat_amount, 0);
        v_item_vat_exempt := COALESCE(r_item.item_vat_exempt, 0);

        IF v_item_vatable = 0 AND v_item_vat_amount = 0 AND v_item_vat_exempt = 0 THEN
            IF v_item_is_exempt THEN
                v_item_vat_exempt := v_subtotal - v_item_discount;
            ELSE
                v_item_vatable := (v_subtotal - v_item_discount) / 1.12;
                v_item_vat_amount := (v_subtotal - v_item_discount) - v_item_vatable;
            END IF;
        END IF;

        INSERT INTO public.sale_items (
            sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, notes, tenant_id,
            discount_amount, is_vat_exempt, vatable_sales, vat_amount, vat_exempt_sales
        ) VALUES (
            v_sale_id,
            r_item.menu_item_id,
            r_item.qty,
            v_price,
            v_subtotal,
            v_cost_price,
            r_item.notes,
            v_tenant_id,
            v_item_discount,
            v_item_is_exempt,
            v_item_vatable,
            v_item_vat_amount,
            v_item_vat_exempt
        );
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

    -- Calculate service charge ONLY for Dine In sales (never for Foodpanda, Grab, Take Out, etc.)
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


-- 3. Redefine public.fn_process_offline_sale
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

        v_bp_price := NULL;
        v_bp_foodpanda := NULL;
        v_bp_grab := NULL;

        IF p_sub_store_id IS NOT NULL THEN
            SELECT price, foodpanda_price, grab_price
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.menu_item_branch_prices
            WHERE menu_item_id = r_item.menu_item_id AND branch_id = p_sub_store_id;
        END IF;

        IF v_bp_price IS NULL THEN
            SELECT price, foodpanda_price, grab_price
            INTO v_bp_price, v_bp_foodpanda, v_bp_grab
            FROM public.menu_item_branch_prices
            WHERE menu_item_id = r_item.menu_item_id AND branch_id = p_branch_id;
        END IF;

        IF r_item.custom_price IS NOT NULL AND r_item.custom_price > 0 THEN
            v_price := r_item.custom_price;
        ELSE
            v_price := COALESCE(v_bp_price, v_price);
        END IF;

        v_subtotal := v_price * r_item.qty;
        v_total_amount := v_total_amount + v_subtotal;

        SELECT EXISTS (
            SELECT 1 FROM public.recipes WHERE menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

        IF v_type = 'service' OR v_item_policy = 'disabled' THEN
            v_cost_price := 0.00;
        ELSIF v_type = 'retail' OR (NOT v_has_recipe AND v_inventory_item_id IS NOT NULL) THEN
            SELECT cost_price, current_stock, item_name INTO v_cost_price, v_current_qty, v_item_name
            FROM public.inventory_items
            WHERE id = v_inventory_item_id
            FOR UPDATE;

            IF v_cost_price IS NULL THEN
                v_cost_price := 0.00;
            END IF;

            IF v_item_policy = 'strict' AND v_current_qty < r_item.qty THEN
                RAISE EXCEPTION 'Insufficient stock for "%" (available: %, needed: %)',
                    COALESCE(v_item_name, v_menu_name), v_current_qty, r_item.qty;
            END IF;

            UPDATE public.inventory_items
            SET current_stock = current_stock - r_item.qty
            WHERE id = v_inventory_item_id;

            INSERT INTO public.stock_movements (
                inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
            ) VALUES (
                v_inventory_item_id,
                'out',
                r_item.qty,
                CASE 
                    WHEN p_queue_number IS NOT NULL AND p_queue_number <> '' 
                    THEN 'Direct POS Sale (Queue #' || p_queue_number || ')'
                    ELSE 'Direct POS Sale'
                END,
                p_cashier_id,
                v_tenant_id
            );
        ELSIF v_has_recipe THEN
            v_cost_price := 0.00;

            FOR r_ing IN (
                SELECT r.inventory_item_id,
                       r.quantity AS recipe_qty,
                       ii.current_stock,
                       ii.cost_price,
                       ii.item_name,
                       COALESCE(ii.stock_enforcement_mode, v_item_policy) AS ing_policy
                FROM public.recipes r
                JOIN public.inventory_items ii ON ii.id = r.inventory_item_id
                WHERE r.menu_item_id = r_item.menu_item_id
                FOR UPDATE OF ii
            ) LOOP
                v_cost_price := v_cost_price + (COALESCE(r_ing.cost_price, 0.00) * r_ing.recipe_qty);
                v_qty_needed := r_ing.recipe_qty * r_item.qty;

                IF r_ing.ing_policy = 'strict' AND r_ing.current_stock < v_qty_needed THEN
                    RAISE EXCEPTION 'Insufficient stock for ingredient "%" in menu item "%" (available: %, needed: %)',
                        r_ing.item_name, v_menu_name, r_ing.current_stock, v_qty_needed;
                END IF;

                UPDATE public.inventory_items
                SET current_stock = current_stock - v_qty_needed
                WHERE id = r_ing.inventory_item_id;

                INSERT INTO public.stock_movements (
                    inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
                ) VALUES (
                    r_ing.inventory_item_id,
                    'out',
                    v_qty_needed,
                    CASE 
                        WHEN p_queue_number IS NOT NULL AND p_queue_number <> '' 
                        THEN 'POS Sale - Recipe Deduction for ' || v_menu_name || ' (Queue #' || p_queue_number || ')'
                        ELSE 'POS Sale - Recipe Deduction for ' || v_menu_name
                    END,
                    p_cashier_id,
                    v_tenant_id
                );
            END LOOP;
        ELSE
            v_cost_price := 0.00;
        END IF;

        v_item_discount  := COALESCE(r_item.item_discount, 0);
        v_item_is_exempt := COALESCE(r_item.item_is_exempt, false);
        v_item_vatable   := COALESCE(r_item.item_vatable, 0);
        v_item_vat_amount := COALESCE(r_item.item_vat_amount, 0);
        v_item_vat_exempt := COALESCE(r_item.item_vat_exempt, 0);

        IF v_item_vatable = 0 AND v_item_vat_amount = 0 AND v_item_vat_exempt = 0 THEN
            IF v_item_is_exempt THEN
                v_item_vat_exempt := v_subtotal - v_item_discount;
            ELSE
                v_item_vatable := (v_subtotal - v_item_discount) / 1.12;
                v_item_vat_amount := (v_subtotal - v_item_discount) - v_item_vatable;
            END IF;
        END IF;

        INSERT INTO public.sale_items (
            sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, notes, tenant_id,
            discount_amount, is_vat_exempt, vatable_sales, vat_amount, vat_exempt_sales
        ) VALUES (
            v_sale_id,
            r_item.menu_item_id,
            r_item.qty,
            v_price,
            v_subtotal,
            v_cost_price,
            r_item.notes,
            v_tenant_id,
            v_item_discount,
            v_item_is_exempt,
            v_item_vatable,
            v_item_vat_amount,
            v_item_vat_exempt
        );
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

    -- Offline sales default to no service charge
    v_sc_rate := 0.00;
    v_service_charge := 0.00;

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
