-- ============================================================
-- MIGRATION: Secure Dashboard and Analytics RPC Functions
-- Ensures all SECURITY DEFINER functions filter by tenant_id
-- ============================================================


-- 1. Secure get_inventory_alerts
CREATE OR REPLACE FUNCTION public.get_inventory_alerts()
RETURNS TABLE (
    branch_id UUID,
    branch_name TEXT,
    item_id UUID,
    item_name TEXT,
    sku TEXT,
    current_quantity NUMERIC,
    reorder_level NUMERIC,
    base_unit TEXT
) AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    v_tenant_id := public.get_my_tenant_id();

    RETURN QUERY
    SELECT 
        b.id AS branch_id,
        b.name AS branch_name,
        i.id AS item_id,
        i.item_name,
        i.sku,
        COALESCE(ib.quantity, 0) AS current_quantity,
        i.reorder_level,
        i.base_unit
    FROM public.inventory_items i
    CROSS JOIN public.branches b
    LEFT JOIN public.inventory_balances ib ON ib.item_id = i.id AND ib.branch_id = b.id
    WHERE COALESCE(ib.quantity, 0) < i.reorder_level
      AND i.status = 'active'
      AND i.tenant_id = v_tenant_id
      AND b.tenant_id = v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- 2. Secure get_overall_dashboard_stats
CREATE OR REPLACE FUNCTION public.get_overall_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
    v_total_inventory_val NUMERIC := 0;
    v_total_sales         NUMERIC := 0;
    v_total_branches      INT     := 0;
    v_low_stock_count     INT     := 0;
    v_pending_transfers   INT     := 0;
    v_today_revenue       NUMERIC := 0;
    v_tenant_id           UUID;
BEGIN
    v_tenant_id := public.get_my_tenant_id();

    -- Total inventory value (tenant specific)
    SELECT COALESCE(SUM(ib.quantity * i.cost_per_base_unit), 0)
    INTO v_total_inventory_val
    FROM public.inventory_balances ib
    JOIN public.inventory_items i ON i.id = ib.item_id
    WHERE ib.tenant_id = v_tenant_id;

    -- Total completed sales amount
    SELECT COALESCE(SUM(total_amount), 0)
    INTO v_total_sales
    FROM public.sales
    WHERE status = 'completed'
      AND tenant_id = v_tenant_id;

    -- Total branches
    SELECT COUNT(*)
    INTO v_total_branches
    FROM public.branches
    WHERE tenant_id = v_tenant_id;

    -- Low stock count (calls the secured get_inventory_alerts above)
    SELECT COUNT(*)::INT
    INTO v_low_stock_count
    FROM public.get_inventory_alerts();

    -- Pending transfers
    SELECT COUNT(*)::INT
    INTO v_pending_transfers
    FROM public.transfer_requests
    WHERE status = 'requested'
      AND tenant_id = v_tenant_id;

    -- Today's revenue
    SELECT COALESCE(SUM(total_amount), 0)
    INTO v_today_revenue
    FROM public.sales
    WHERE status = 'completed'
      AND created_at >= CURRENT_DATE
      AND tenant_id = v_tenant_id;

    RETURN json_build_object(
        'totalInventoryValue',  v_total_inventory_val,
        'totalSales',           v_total_sales,
        'totalBranches',        v_total_branches,
        'lowStockCount',        v_low_stock_count,
        'pendingTransfersCount',v_pending_transfers,
        'todayRevenue',         v_today_revenue
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- 3. Secure get_branch_analytics
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

    -- Authorization: branch must belong to caller's tenant
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

    -- Food Cost
    SELECT COALESCE(SUM(ABS(im.quantity) * i.cost_per_base_unit), 0)
    INTO v_food_cost
    FROM public.inventory_movements im
    JOIN public.inventory_items i ON i.id = im.item_id
    WHERE im.branch_id = p_branch_id
      AND im.movement_type = 'sale_deduction'
      AND im.created_at BETWEEN p_start_date AND p_end_date
      AND im.tenant_id = v_tenant_id;

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
        'revenue',      v_revenue,
        'orders',       v_orders,
        'foodCost',     v_food_cost,
        'wasteCost',    v_waste_cost,
        'topProducts',  v_top_products,
        'wasteSummary', v_waste_summary
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- 4. Secure fn_get_branch_inventory
CREATE OR REPLACE FUNCTION public.fn_get_branch_inventory(
    p_branch_id UUID
)
RETURNS TABLE (
    item_id  UUID,
    quantity NUMERIC
) AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    v_tenant_id := public.get_my_tenant_id();

    IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = p_branch_id
          AND (tenant_id = v_tenant_id OR public.is_platform_admin())
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Branch does not belong to your organization.';
    END IF;

    RETURN QUERY
    SELECT ib.item_id, COALESCE(ib.quantity, 0) AS quantity
    FROM public.inventory_balances ib
    WHERE ib.branch_id  = p_branch_id
      AND ib.tenant_id  = v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Secure fn_request_transfer
CREATE OR REPLACE FUNCTION public.fn_request_transfer(
    p_source_branch_id UUID,
    p_target_branch_id UUID,
    p_items            JSONB
)
RETURNS UUID AS $$
DECLARE
    v_transfer_id UUID;
    r_item        RECORD;
    v_bal         NUMERIC;
    v_name        TEXT;
    v_tenant_id   UUID;
BEGIN
    v_tenant_id := public.get_my_tenant_id();

    -- Both branches must belong to the caller's tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = p_source_branch_id
          AND (tenant_id = v_tenant_id OR public.is_platform_admin())
    ) OR NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = p_target_branch_id
          AND (tenant_id = v_tenant_id OR public.is_platform_admin())
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Source or target branch does not belong to your organization.';
    END IF;

    -- Validate stock at source branch
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID         AS item_id,
               (value->>'quantity_base_unit')::NUMERIC AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT COALESCE(quantity, 0) INTO v_bal
        FROM public.inventory_balances
        WHERE branch_id = p_source_branch_id
          AND item_id   = r_item.item_id
          AND tenant_id = v_tenant_id;

        IF v_bal < r_item.qty THEN
            SELECT item_name INTO v_name
            FROM public.inventory_items
            WHERE id = r_item.item_id AND tenant_id = v_tenant_id;

            RAISE EXCEPTION 'Insufficient stock for %: need %, have %', v_name, r_item.qty, v_bal;
        END IF;
    END LOOP;

    -- Create transfer request
    INSERT INTO public.transfer_requests
        (source_branch_id, target_branch_id, status, requested_by, tenant_id)
    VALUES
        (p_source_branch_id, p_target_branch_id, 'requested', auth.uid(), v_tenant_id)
    RETURNING id INTO v_transfer_id;

    -- Insert transfer items
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID         AS item_id,
               (value->>'quantity_base_unit')::NUMERIC AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        INSERT INTO public.transfer_items (transfer_id, item_id, quantity_base_unit, tenant_id)
        VALUES (v_transfer_id, r_item.item_id, r_item.qty, v_tenant_id);
    END LOOP;

    -- Notify target branch
    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        p_target_branch_id,
        'transfer_pending',
        'New transfer request from ' || (
            SELECT name FROM public.branches
            WHERE id = p_source_branch_id AND tenant_id = v_tenant_id
        ),
        v_tenant_id
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_REQUEST',
        'Transfers',
        NULL,
        json_build_object(
            'transfer_id', v_transfer_id,
            'source',      p_source_branch_id,
            'target',      p_target_branch_id
        )::jsonb
    );

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
