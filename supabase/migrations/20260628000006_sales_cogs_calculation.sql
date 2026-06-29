-- ============================================================
-- MIGRATION: Add cost_price to sale_items and update analytics + process_sale
-- ============================================================

-- 1. Add cost_price column to sale_items table
ALTER TABLE public.sale_items 
    ADD COLUMN IF NOT EXISTS cost_price NUMERIC NOT NULL DEFAULT 0;

-- 2. Update fn_process_sale to calculate and record cost_price at sale time
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id      UUID,
    p_items          JSONB,   -- [{ "menu_item_id": "...", "quantity": N }]
    p_payment_method TEXT    DEFAULT 'cash',
    p_amount_tendered NUMERIC DEFAULT NULL,
    p_sale_category   TEXT    DEFAULT 'Dine in',
    p_reference_number TEXT   DEFAULT ''
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
BEGIN
    -- Validate payment_method
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- 1. Create Sale Record
    INSERT INTO public.sales (branch_id, cashier_id, total_amount, status, payment_method, sale_category, reference_number)
    VALUES (p_branch_id, auth.uid(), 0, 'completed', p_payment_method, p_sale_category, p_reference_number)
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
        v_total_amount  := v_total_amount + v_subtotal;

        -- ── Calculate cost price at time of sale ──
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
            SELECT COALESCE(cost_price, 0)
            INTO v_cost_price
            FROM public.menu_items
            WHERE id = r_item.menu_item_id;
        END IF;

        -- Insert sale line item with cost_price
        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, COALESCE(v_cost_price, 0));

        -- 3. Stock deductions based on item type
        IF v_type = 'restaurant' THEN
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
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid());

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;
            
        ELSIF v_type = 'retail' THEN
            IF v_inventory_item_id IS NULL THEN
                RAISE EXCEPTION 'Retail product % has no linked inventory item.', v_menu_name;
            END IF;

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
                    COALESCE(v_item_name, 'Retail Item'), v_qty_needed, COALESCE(v_current_qty, 0);
            END IF;

            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
            VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid());

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
        END IF;
    END LOOP;

    -- 4. Calculate change
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
            'sale_id',        v_sale_id,
            'branch_id',      p_branch_id,
            'total_amount',   v_total_amount,
            'payment_method', p_payment_method,
            'amount_tendered',p_amount_tendered,
            'change_given',   v_change
        )::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update get_branch_analytics to calculate COGS directly from sale_items
CREATE OR REPLACE FUNCTION public.get_branch_analytics(
    p_branch_id   UUID,
    p_start_date  TIMESTAMPTZ,
    p_end_date    TIMESTAMPTZ
)
RETURNS JSONB AS $$
DECLARE
    v_revenue       NUMERIC := 0;
    v_orders        INT     := 0;
    v_food_cost     NUMERIC := 0;
    v_waste_cost    NUMERIC := 0;
    v_top_products  JSONB;
    v_waste_summary JSONB;
    v_tenant_id     UUID;
BEGIN
    v_tenant_id := public.get_my_tenant_id();

    -- Authorization check
    IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = p_branch_id
          AND (tenant_id = v_tenant_id OR public.is_platform_admin())
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Branch does not belong to your organization.';
    END IF;

    -- Revenue & Orders
    SELECT COALESCE(SUM(total_amount), 0), COUNT(*)::INT
    INTO v_revenue, v_orders
    FROM public.sales
    WHERE branch_id = p_branch_id
      AND status = 'completed'
      AND created_at BETWEEN p_start_date AND p_end_date
      AND tenant_id = v_tenant_id;

    -- Food Cost / COGS (calculated directly from sale_items.cost_price)
    SELECT COALESCE(SUM(si.cost_price * si.quantity), 0)
    INTO v_food_cost
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.branch_id = p_branch_id
      AND s.status = 'completed'
      AND s.created_at BETWEEN p_start_date AND p_end_date
      AND s.tenant_id = v_tenant_id;

    -- Waste Cost
    SELECT COALESCE(SUM(ABS(im.quantity) * i.cost_per_base_unit), 0)
    INTO v_waste_cost
    FROM public.inventory_movements im
    JOIN public.inventory_items i ON i.id = im.item_id
    WHERE im.branch_id = p_branch_id
      AND im.movement_type = 'adjustment'
      AND im.quantity < 0
      AND im.created_at BETWEEN p_start_date AND p_end_date
      AND im.tenant_id = v_tenant_id;

    -- Top Selling Products
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    INTO v_top_products
    FROM (
        SELECT mi.name,
               SUM(si.quantity)::INT AS quantity_sold,
               SUM(si.subtotal)      AS revenue
        FROM public.sale_items si
        JOIN public.sales s      ON s.id  = si.sale_id
        JOIN public.menu_items mi ON mi.id = si.menu_item_id
        WHERE s.branch_id = p_branch_id
          AND s.status = 'completed'
          AND s.created_at BETWEEN p_start_date AND p_end_date
          AND s.tenant_id = v_tenant_id
        GROUP BY mi.name
        ORDER BY quantity_sold DESC
        LIMIT 10
    ) t;

    -- Waste Summary by Reason
    SELECT COALESCE(jsonb_agg(w), '[]'::jsonb)
    INTO v_waste_summary
    FROM (
        SELECT sa.reason,
               SUM(ABS(sai.quantity_base_unit) * ii.cost_per_base_unit) AS cost,
               COUNT(DISTINCT sa.id)::INT AS events
        FROM public.stock_adjustments sa
        JOIN public.stock_adjustment_items sai ON sai.adjustment_id = sa.id
        JOIN public.inventory_items ii          ON ii.id             = sai.item_id
        WHERE sa.branch_id = p_branch_id
          AND sa.status = 'approved'
          AND sa.created_at BETWEEN p_start_date AND p_end_date
          AND sa.tenant_id = v_tenant_id
        GROUP BY sa.reason
    ) w;

    RETURN json_build_object(
        'branchId',       p_branch_id,
        'revenue',        v_revenue,
        'orders',         v_orders,
        'foodCost',       v_food_cost,
        'wasteCost',      v_waste_cost,
        'profitEstimate', (v_revenue - v_food_cost - v_waste_cost),
        'topProducts',    v_top_products,
        'wasteSummary',   v_waste_summary
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
