-- ============================================================
-- MIGRATION: Add Expense Tracker and Advanced Analytics RPC
-- ============================================================

-- 1. Create expenses table
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    amount NUMERIC NOT NULL CHECK (amount >= 0),
    description TEXT,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fix relationship constraint if table already exists referencing auth.users
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_created_by_fkey;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_branch ON public.expenses(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses(expense_date);

-- 2. Enable Row-Level Security
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
DROP POLICY IF EXISTS "Read expenses" ON public.expenses;
CREATE POLICY "Read expenses" ON public.expenses FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );

DROP POLICY IF EXISTS "Write expenses" ON public.expenses;
CREATE POLICY "Write expenses" ON public.expenses FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'branch_manager') AND
            (public.get_my_role() = 'super_admin' OR public.get_my_branch_id() = branch_id)
        ) OR public.is_platform_admin()
    );

-- 4. Tenant Auto-Stamping Trigger
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_expenses ON public.expenses;
CREATE TRIGGER tg_auto_stamp_tenant_expenses
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- 5. Redefine get_branch_analytics with OPEX and aggregations for new charts
CREATE OR REPLACE FUNCTION public.get_branch_analytics(
    p_branch_id   UUID,
    p_start_date  TIMESTAMPTZ,
    p_end_date    TIMESTAMPTZ
)
RETURNS JSONB AS $$
DECLARE
    v_revenue           NUMERIC := 0;
    v_orders            INT     := 0;
    v_food_cost         NUMERIC := 0;
    v_waste_cost        NUMERIC := 0;
    v_opex_cost         NUMERIC := 0;
    v_top_products      JSONB;
    v_waste_summary     JSONB;
    v_cash_flow_history JSONB;
    v_sales_by_category JSONB;
    v_sales_by_type     JSONB;
    v_tenant_id         UUID;
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

    -- OPEX (Operating Expenses)
    SELECT COALESCE(SUM(amount), 0)
    INTO v_opex_cost
    FROM public.expenses
    WHERE branch_id = p_branch_id
      AND expense_date BETWEEN p_start_date::date AND p_end_date::date
      AND tenant_id = v_tenant_id;

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

    -- Cash Flow Overview
    SELECT COALESCE(jsonb_agg(row_to_json(cf)), '[]'::jsonb)
    INTO v_cash_flow_history
    FROM (
        WITH dates AS (
            SELECT generate_series(
                p_start_date::date,
                p_end_date::date,
                '1 day'::interval
            )::date AS d
        ),
        daily_revenue AS (
            SELECT created_at::date AS d, SUM(total_amount) AS amount
            FROM public.sales
            WHERE branch_id = p_branch_id
              AND status = 'completed'
              AND created_at BETWEEN p_start_date AND p_end_date
              AND tenant_id = v_tenant_id
            GROUP BY 1
        ),
        daily_cogs AS (
            SELECT s.created_at::date AS d, SUM(si.cost_price * si.quantity) AS amount
            FROM public.sale_items si
            JOIN public.sales s ON s.id = si.sale_id
            WHERE s.branch_id = p_branch_id
              AND s.status = 'completed'
              AND s.created_at BETWEEN p_start_date AND p_end_date
              AND s.tenant_id = v_tenant_id
            GROUP BY 1
        ),
        daily_waste AS (
            SELECT im.created_at::date AS d, SUM(ABS(im.quantity) * i.cost_per_base_unit) AS amount
            FROM public.inventory_movements im
            JOIN public.inventory_items i ON i.id = im.item_id
            WHERE im.branch_id = p_branch_id
              AND im.movement_type = 'adjustment'
              AND im.quantity < 0
              AND im.created_at BETWEEN p_start_date AND p_end_date
              AND im.tenant_id = v_tenant_id
            GROUP BY 1
        ),
        daily_opex AS (
            SELECT expense_date AS d, SUM(amount) AS amount
            FROM public.expenses
            WHERE branch_id = p_branch_id
              AND expense_date BETWEEN p_start_date::date AND p_end_date::date
              AND tenant_id = v_tenant_id
            GROUP BY 1
        )
        SELECT 
            to_char(dates.d, 'YYYY-MM-DD') AS date,
            COALESCE(r.amount, 0) AS revenue,
            COALESCE(c.amount, 0) + COALESCE(w.amount, 0) + COALESCE(o.amount, 0) AS expenses,
            COALESCE(r.amount, 0) - (COALESCE(c.amount, 0) + COALESCE(w.amount, 0) + COALESCE(o.amount, 0)) AS net_cash_flow
        FROM dates
        LEFT JOIN daily_revenue r ON r.d = dates.d
        LEFT JOIN daily_cogs c ON c.d = dates.d
        LEFT JOIN daily_waste w ON w.d = dates.d
        LEFT JOIN daily_opex o ON o.d = dates.d
        ORDER BY dates.d
    ) cf;

    -- Sales by Menu Item Category
    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
    INTO v_sales_by_category
    FROM (
        SELECT mi.category,
               SUM(si.quantity)::INT AS quantity_sold,
               SUM(si.subtotal)      AS revenue
        FROM public.sale_items si
        JOIN public.sales s      ON s.id  = si.sale_id
        JOIN public.menu_items mi ON mi.id = si.menu_item_id
        WHERE s.branch_id = p_branch_id
          AND s.status = 'completed'
          AND s.created_at BETWEEN p_start_date AND p_end_date
          AND s.tenant_id = v_tenant_id
        GROUP BY mi.category
        ORDER BY revenue DESC
    ) c;

    -- Sales by Sale Type (Sale Category)
    SELECT COALESCE(jsonb_agg(st), '[]'::jsonb)
    INTO v_sales_by_type
    FROM (
        SELECT COALESCE(s.sale_category, 'Dine in') AS sale_type,
               COUNT(*)::INT AS order_count,
               SUM(s.total_amount) AS revenue
        FROM public.sales s
        WHERE s.branch_id = p_branch_id
          AND s.status = 'completed'
          AND s.created_at BETWEEN p_start_date AND p_end_date
          AND s.tenant_id = v_tenant_id
        GROUP BY COALESCE(s.sale_category, 'Dine in')
        ORDER BY revenue DESC
    ) st;

    RETURN json_build_object(
        'branchId',          p_branch_id,
        'revenue',           v_revenue,
        'orders',            v_orders,
        'foodCost',          v_food_cost,
        'wasteCost',         v_waste_cost,
        'opexCost',          v_opex_cost,
        'profitEstimate',    (v_revenue - v_food_cost - v_waste_cost), -- legacy compatibility field
        'grossProfit',       (v_revenue - v_food_cost - v_waste_cost),
        'netProfit',         (v_revenue - v_food_cost - v_waste_cost - v_opex_cost),
        'topProducts',       v_top_products,
        'wasteSummary',      v_waste_summary,
        'cashFlowHistory',   v_cash_flow_history,
        'salesByCategory',   v_sales_by_category,
        'salesByType',       v_sales_by_type
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
