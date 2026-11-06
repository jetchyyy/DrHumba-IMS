-- ==============================================================================
-- MIGRATION: Service Charge Applicable Only to Dine In Sales
-- Description: Ensures service charge is calculated and recorded ONLY when
--              sale_category is Dine In. Foodpanda, Grab, Take Out, and other
--              sales strictly have 0% service charge.
-- ==============================================================================

-- 1. Redefine public.fn_process_sale
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id        UUID,
    p_items            JSONB,
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
    v_item_price       NUMERIC;
    v_initial_status   TEXT;
    v_stock_policy     TEXT;
    v_item_is_service  BOOLEAN;
    v_item_is_direct   BOOLEAN;
    v_parent_branch_id UUID;
    v_inv_branch_id    UUID;

    -- BIR & discount items
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

    SELECT pos_inventory_policy INTO v_stock_policy
    FROM public.tenants
    WHERE id = v_tenant_id;

    v_stock_policy := COALESCE(v_stock_policy, 'strict');

    SELECT parent_id INTO v_parent_branch_id
    FROM public.branches
    WHERE id = p_branch_id;

    v_inv_branch_id := COALESCE(v_parent_branch_id, p_branch_id);

    FOR r_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        menu_item_id UUID, 
        quantity NUMERIC, 
        price NUMERIC, 
        notes TEXT,
        discount_amount NUMERIC,
        vatable_sales NUMERIC,
        vat_amount NUMERIC,
        vat_exempt_sales NUMERIC,
        is_vat_exempt BOOLEAN
    )
    LOOP
        SELECT is_service, is_direct_sale
        INTO v_item_is_service, v_item_is_direct
        FROM public.menu_items
        WHERE id = r_item.menu_item_id AND tenant_id = v_tenant_id;

        IF r_item.price IS NOT NULL AND r_item.price >= 0 THEN
            v_item_price := r_item.price;
        ELSE
            SELECT COALESCE(
                (SELECT price FROM public.menu_item_branch_prices 
                 WHERE menu_item_id = r_item.menu_item_id AND branch_id = COALESCE(p_sub_store_id, p_branch_id)),
                (SELECT price FROM public.menu_item_branch_prices 
                 WHERE menu_item_id = r_item.menu_item_id AND branch_id = p_branch_id),
                mi.price
            ) INTO v_item_price
            FROM public.menu_items mi
            WHERE mi.id = r_item.menu_item_id AND mi.tenant_id = v_tenant_id;
        END IF;

        IF v_item_price IS NULL THEN
            SELECT name INTO v_menu_name FROM public.menu_items WHERE id = r_item.menu_item_id;
            RAISE EXCEPTION 'Menu item % not found', COALESCE(v_menu_name, r_item.menu_item_id::text);
        END IF;

        v_item_discount   := COALESCE(r_item.discount_amount, 0);
        v_item_is_exempt   := COALESCE(r_item.is_vat_exempt, false);
        v_item_vatable     := COALESCE(r_item.vatable_sales, 0);
        v_item_vat_amount  := COALESCE(r_item.vat_amount, 0);
        v_item_vat_exempt  := COALESCE(r_item.vat_exempt_sales, 0);

        IF v_item_vatable = 0 AND v_item_vat_amount = 0 AND v_item_vat_exempt = 0 THEN
            IF v_item_is_exempt THEN
                v_item_vat_exempt := (v_item_price * r_item.quantity) - v_item_discount;
            ELSE
                v_item_vatable := ((v_item_price * r_item.quantity) - v_item_discount) / 1.12;
                v_item_vat_amount := ((v_item_price * r_item.quantity) - v_item_discount) - v_item_vatable;
            END IF;
        END IF;

        INSERT INTO public.sale_items (
            sale_id, menu_item_id, quantity, unit_price, subtotal, tenant_id, notes,
            discount_amount, vatable_sales, vat_amount, vat_exempt_sales, is_vat_exempt
        )
        VALUES (
            v_sale_id, r_item.menu_item_id, r_item.quantity, v_item_price, 
            (v_item_price * r_item.quantity) - v_item_discount,
            v_tenant_id, r_item.notes,
            v_item_discount, v_item_vatable, v_item_vat_amount, v_item_vat_exempt, v_item_is_exempt
        );

        v_total_amount := v_total_amount + (v_item_price * r_item.quantity);

        IF NOT COALESCE(v_item_is_service, false) THEN
            IF COALESCE(v_item_is_direct, false) THEN
                v_qty_needed := r_item.quantity;
                SELECT current_stock, item_name INTO v_current_qty, v_item_name
                FROM public.inventory_items
                WHERE menu_item_id = r_item.menu_item_id AND branch_id = v_inv_branch_id AND tenant_id = v_tenant_id
                FOR UPDATE;

                IF v_current_qty IS NULL THEN
                    INSERT INTO public.inventory_items (
                        tenant_id, branch_id, menu_item_id, item_name, category, 
                        current_stock, min_stock_level, unit
                    )
                    SELECT 
                        v_tenant_id, v_inv_branch_id, mi.id, mi.name, mi.category, 
                        0, 0, 'piece'
                    FROM public.menu_items mi
                    WHERE mi.id = r_item.menu_item_id
                    RETURNING current_stock, item_name INTO v_current_qty, v_item_name;
                END IF;

                IF v_current_qty < v_qty_needed THEN
                    IF v_stock_policy = 'strict' THEN
                        SELECT name INTO v_menu_name FROM public.menu_items WHERE id = r_item.menu_item_id;
                        RAISE EXCEPTION 'Insufficient stock for direct item "%" (Needs %, Has %)', 
                            COALESCE(v_menu_name, v_item_name), v_qty_needed, v_current_qty;
                    END IF;
                END IF;

                UPDATE public.inventory_items
                SET current_stock = current_stock - v_qty_needed
                WHERE menu_item_id = r_item.menu_item_id AND branch_id = v_inv_branch_id AND tenant_id = v_tenant_id;

                INSERT INTO public.stock_movements (
                    inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
                )
                SELECT 
                    id, 'out', v_qty_needed, 
                    'Direct POS Sale - Item deduction' || CASE WHEN p_queue_number IS NOT NULL AND p_queue_number <> '' THEN ' (Queue #' || p_queue_number || ')' ELSE '' END, 
                    auth.uid(), v_tenant_id
                FROM public.inventory_items
                WHERE menu_item_id = r_item.menu_item_id AND branch_id = v_inv_branch_id AND tenant_id = v_tenant_id;
            ELSE
                FOR r_ing IN
                    SELECT r.inventory_item_id, r.quantity as recipe_qty, ii.current_stock, ii.item_name
                    FROM public.recipes r
                    JOIN public.inventory_items ii ON ii.id = r.inventory_item_id
                    WHERE r.menu_item_id = r_item.menu_item_id
                      AND ii.branch_id = v_inv_branch_id
                      AND r.tenant_id = v_tenant_id
                    FOR UPDATE OF ii
                LOOP
                    v_qty_needed := r_item.quantity * r_ing.recipe_qty;

                    IF r_ing.current_stock < v_qty_needed THEN
                        IF v_stock_policy = 'strict' THEN
                            SELECT name INTO v_menu_name FROM public.menu_items WHERE id = r_item.menu_item_id;
                            RAISE EXCEPTION 'Insufficient stock for recipe ingredient "%" (Used in %, Needs %, Has %)', 
                                r_ing.item_name, COALESCE(v_menu_name, 'Dish'), v_qty_needed, r_ing.current_stock;
                        END IF;
                    END IF;

                    UPDATE public.inventory_items
                    SET current_stock = current_stock - v_qty_needed
                    WHERE id = r_ing.inventory_item_id AND tenant_id = v_tenant_id;

                    INSERT INTO public.stock_movements (
                        inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
                    )
                    VALUES (
                        r_ing.inventory_item_id, 'out', v_qty_needed, 
                        'POS Sale - Recipe deduction' || CASE WHEN p_queue_number IS NOT NULL AND p_queue_number <> '' THEN ' (Queue #' || p_queue_number || ')' ELSE '' END, 
                        auth.uid(), v_tenant_id
                    );
                END LOOP;
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


-- 2. Redefine public.fn_process_offline_sale
CREATE OR REPLACE FUNCTION public.fn_process_offline_sale(
    p_branch_id        UUID,
    p_items            JSONB,
    p_payment_method   TEXT,
    p_created_at       TIMESTAMPTZ,
    p_cashier_email    TEXT,
    p_cashier_id       UUID    DEFAULT NULL,
    p_sale_category    TEXT    DEFAULT NULL,
    p_reference_number TEXT    DEFAULT NULL,
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
    v_item_price       NUMERIC;
    v_stock_policy     TEXT;
    v_item_is_service  BOOLEAN;
    v_item_is_direct   BOOLEAN;
    v_parent_branch_id UUID;
    v_inv_branch_id    UUID;

    -- BIR & discount items
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

    INSERT INTO public.sales (
        branch_id, sub_store_id, cashier_id, total_amount, status, payment_method, 
        created_at, reference_number, sale_category, tenant_id, notes
    )
    VALUES (
        p_branch_id, p_sub_store_id, COALESCE(p_cashier_id, auth.uid()), 0, 'completed', p_payment_method, 
        p_created_at, p_reference_number, p_sale_category, v_tenant_id, p_notes
    )
    RETURNING id INTO v_sale_id;

    SELECT pos_inventory_policy INTO v_stock_policy
    FROM public.tenants
    WHERE id = v_tenant_id;

    v_stock_policy := COALESCE(v_stock_policy, 'strict');

    SELECT parent_id INTO v_parent_branch_id
    FROM public.branches
    WHERE id = p_branch_id;

    v_inv_branch_id := COALESCE(v_parent_branch_id, p_branch_id);

    FOR r_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        menu_item_id UUID, 
        quantity NUMERIC, 
        price NUMERIC, 
        notes TEXT,
        discount_amount NUMERIC,
        vatable_sales NUMERIC,
        vat_amount NUMERIC,
        vat_exempt_sales NUMERIC,
        is_vat_exempt BOOLEAN
    )
    LOOP
        SELECT is_service, is_direct_sale
        INTO v_item_is_service, v_item_is_direct
        FROM public.menu_items
        WHERE id = r_item.menu_item_id AND tenant_id = v_tenant_id;

        IF r_item.price IS NOT NULL AND r_item.price >= 0 THEN
            v_item_price := r_item.price;
        ELSE
            SELECT COALESCE(
                (SELECT price FROM public.menu_item_branch_prices 
                 WHERE menu_item_id = r_item.menu_item_id AND branch_id = COALESCE(p_sub_store_id, p_branch_id)),
                (SELECT price FROM public.menu_item_branch_prices 
                 WHERE menu_item_id = r_item.menu_item_id AND branch_id = p_branch_id),
                mi.price
            ) INTO v_item_price
            FROM public.menu_items mi
            WHERE mi.id = r_item.menu_item_id AND mi.tenant_id = v_tenant_id;
        END IF;

        IF v_item_price IS NULL THEN
            SELECT name INTO v_menu_name FROM public.menu_items WHERE id = r_item.menu_item_id;
            RAISE EXCEPTION 'Menu item % not found', COALESCE(v_menu_name, r_item.menu_item_id::text);
        END IF;

        v_item_discount   := COALESCE(r_item.discount_amount, 0);
        v_item_is_exempt   := COALESCE(r_item.is_vat_exempt, false);
        v_item_vatable     := COALESCE(r_item.vatable_sales, 0);
        v_item_vat_amount  := COALESCE(r_item.vat_amount, 0);
        v_item_vat_exempt  := COALESCE(r_item.vat_exempt_sales, 0);

        IF v_item_vatable = 0 AND v_item_vat_amount = 0 AND v_item_vat_exempt = 0 THEN
            IF v_item_is_exempt THEN
                v_item_vat_exempt := (v_item_price * r_item.quantity) - v_item_discount;
            ELSE
                v_item_vatable := ((v_item_price * r_item.quantity) - v_item_discount) / 1.12;
                v_item_vat_amount := ((v_item_price * r_item.quantity) - v_item_discount) - v_item_vatable;
            END IF;
        END IF;

        INSERT INTO public.sale_items (
            sale_id, menu_item_id, quantity, unit_price, subtotal, tenant_id, notes,
            discount_amount, vatable_sales, vat_amount, vat_exempt_sales, is_vat_exempt
        )
        VALUES (
            v_sale_id, r_item.menu_item_id, r_item.quantity, v_item_price, 
            (v_item_price * r_item.quantity) - v_item_discount,
            v_tenant_id, r_item.notes,
            v_item_discount, v_item_vatable, v_item_vat_amount, v_item_vat_exempt, v_item_is_exempt
        );

        v_total_amount := v_total_amount + (v_item_price * r_item.quantity);

        IF NOT COALESCE(v_item_is_service, false) THEN
            IF COALESCE(v_item_is_direct, false) THEN
                v_qty_needed := r_item.quantity;
                SELECT current_stock, item_name INTO v_current_qty, v_item_name
                FROM public.inventory_items
                WHERE menu_item_id = r_item.menu_item_id AND branch_id = v_inv_branch_id AND tenant_id = v_tenant_id
                FOR UPDATE;

                IF v_current_qty IS NULL THEN
                    INSERT INTO public.inventory_items (
                        tenant_id, branch_id, menu_item_id, item_name, category, 
                        current_stock, min_stock_level, unit
                    )
                    SELECT 
                        v_tenant_id, v_inv_branch_id, mi.id, mi.name, mi.category, 
                        0, 0, 'piece'
                    FROM public.menu_items mi
                    WHERE mi.id = r_item.menu_item_id
                    RETURNING current_stock, item_name INTO v_current_qty, v_item_name;
                END IF;

                IF v_current_qty < v_qty_needed THEN
                    IF v_stock_policy = 'strict' THEN
                        SELECT name INTO v_menu_name FROM public.menu_items WHERE id = r_item.menu_item_id;
                        RAISE EXCEPTION 'Insufficient stock for direct item "%" (Needs %, Has %)', 
                            COALESCE(v_menu_name, v_item_name), v_qty_needed, v_current_qty;
                    END IF;
                END IF;

                UPDATE public.inventory_items
                SET current_stock = current_stock - v_qty_needed
                WHERE menu_item_id = r_item.menu_item_id AND branch_id = v_inv_branch_id AND tenant_id = v_tenant_id;

                INSERT INTO public.stock_movements (
                    inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
                )
                SELECT 
                    id, 'out', v_qty_needed, 
                    'Direct Offline POS Sale - Item deduction', 
                    COALESCE(p_cashier_id, auth.uid()), v_tenant_id
                FROM public.inventory_items
                WHERE menu_item_id = r_item.menu_item_id AND branch_id = v_inv_branch_id AND tenant_id = v_tenant_id;
            ELSE
                FOR r_ing IN
                    SELECT r.inventory_item_id, r.quantity as recipe_qty, ii.current_stock, ii.item_name
                    FROM public.recipes r
                    JOIN public.inventory_items ii ON ii.id = r.inventory_item_id
                    WHERE r.menu_item_id = r_item.menu_item_id
                      AND ii.branch_id = v_inv_branch_id
                      AND r.tenant_id = v_tenant_id
                    FOR UPDATE OF ii
                LOOP
                    v_qty_needed := r_item.quantity * r_ing.recipe_qty;

                    IF r_ing.current_stock < v_qty_needed THEN
                        IF v_stock_policy = 'strict' THEN
                            SELECT name INTO v_menu_name FROM public.menu_items WHERE id = r_item.menu_item_id;
                            RAISE EXCEPTION 'Insufficient stock for recipe ingredient "%" (Used in %, Needs %, Has %)', 
                                r_ing.item_name, COALESCE(v_menu_name, 'Dish'), v_qty_needed, r_ing.current_stock;
                        END IF;
                    END IF;

                    UPDATE public.inventory_items
                    SET current_stock = current_stock - v_qty_needed
                    WHERE id = r_ing.inventory_item_id AND tenant_id = v_tenant_id;

                    INSERT INTO public.stock_movements (
                        inventory_item_id, movement_type, quantity, notes, created_by, tenant_id
                    )
                    VALUES (
                        r_ing.inventory_item_id, 'out', v_qty_needed, 
                        'Offline POS Sale - Recipe deduction', 
                        COALESCE(p_cashier_id, auth.uid()), v_tenant_id
                    );
                END LOOP;
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

GRANT EXECUTE ON FUNCTION public.fn_process_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_process_offline_sale(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, UUID, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;

