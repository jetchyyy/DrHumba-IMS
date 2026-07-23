-- ============================================================
-- MIGRATION: Add Branch-Level Dynamic Pricing Table & Updates
-- ============================================================

-- 1. Create item_branch_prices table
CREATE TABLE IF NOT EXISTS public.item_branch_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    menu_item_id UUID REFERENCES public.menu_items(id) ON DELETE CASCADE,
    price NUMERIC CHECK (price >= 0),
    foodpanda_price NUMERIC CHECK (foodpanda_price >= 0),
    grab_price NUMERIC CHECK (grab_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_branch_inventory UNIQUE (tenant_id, branch_id, inventory_item_id),
    CONSTRAINT uq_tenant_branch_menu UNIQUE (tenant_id, branch_id, menu_item_id)
);

-- 2. Enable RLS and create tenant isolation policies
ALTER TABLE public.item_branch_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read item_branch_prices" ON public.item_branch_prices;
CREATE POLICY "Read item_branch_prices" ON public.item_branch_prices
    FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "Write item_branch_prices" ON public.item_branch_prices;
CREATE POLICY "Write item_branch_prices" ON public.item_branch_prices
    FOR ALL TO authenticated
    USING (
        (public.get_my_role() IN ('super_admin', 'inventory_manager', 'branch_manager') AND tenant_id = public.get_my_tenant_id()) 
        OR public.is_platform_admin()
    );

-- 3. Auto-tenant stamp trigger
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_item_branch_prices ON public.item_branch_prices;
CREATE TRIGGER tg_auto_stamp_tenant_item_branch_prices
  BEFORE INSERT ON public.item_branch_prices
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- 4. Update fn_process_sale to support branch dynamic pricing
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
               (value->>'price')::NUMERIC      AS custom_price
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch base catalog prices
        SELECT price, foodpanda_price, grab_price, name, type, inventory_item_id
        INTO v_price, v_foodpanda_price, v_grab_price, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        -- Fetch branch price overrides if present
        SELECT price, foodpanda_price, grab_price
        INTO v_bp_price, v_bp_foodpanda, v_bp_grab
        FROM public.item_branch_prices
        WHERE branch_id = p_branch_id
          AND (menu_item_id = r_item.menu_item_id OR (v_inventory_item_id IS NOT NULL AND inventory_item_id = v_inventory_item_id))
        LIMIT 1;

        IF v_bp_price IS NOT NULL AND v_bp_price > 0 THEN v_price := v_bp_price; END IF;
        IF v_bp_foodpanda IS NOT NULL AND v_bp_foodpanda > 0 THEN v_foodpanda_price := v_bp_foodpanda; END IF;
        IF v_bp_grab IS NOT NULL AND v_bp_grab > 0 THEN v_grab_price := v_bp_grab; END IF;

        -- Resolve effective unit price
        IF r_item.custom_price IS NOT NULL AND r_item.custom_price > 0 THEN
            v_price := r_item.custom_price;
        ELSIF (LOWER(COALESCE(p_sale_category, '')) LIKE '%foodpanda%' OR LOWER(COALESCE(p_sale_category, '')) LIKE '%food panda%') AND v_foodpanda_price IS NOT NULL AND v_foodpanda_price > 0 THEN
            v_price := v_foodpanda_price;
        ELSIF LOWER(COALESCE(p_sale_category, '')) LIKE '%grab%' AND v_grab_price IS NOT NULL AND v_grab_price > 0 THEN
            v_price := v_grab_price;
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

        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price, tenant_id)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, v_cost_price, v_tenant_id);

        SELECT EXISTS (
            SELECT 1 FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) INTO v_has_recipe;

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

                UPDATE public.inventory_balances
                SET quantity = quantity - v_qty_needed, updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

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
                RAISE EXCEPTION 'Insufficient stock for product %: required %, current %',
                    COALESCE(v_item_name, 'Direct POS Item'), v_qty_needed, COALESCE(v_current_qty, 0);
            END IF;

            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid(), v_tenant_id);

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
        END IF;
    END LOOP;

    IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL THEN
        IF p_amount_tendered < v_total_amount THEN
            RAISE EXCEPTION 'Insufficient tender: total is %, tendered is %', v_total_amount, p_amount_tendered;
        END IF;
        v_change := p_amount_tendered - v_total_amount;
    ELSE
        v_change := 0;
    END IF;

    UPDATE public.sales
    SET total_amount    = v_total_amount,
        amount_tendered = p_amount_tendered,
        change_given    = v_change
    WHERE id = v_sale_id;

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
