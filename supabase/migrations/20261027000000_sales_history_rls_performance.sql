-- ============================================================
-- MIGRATION: Speed up Sales History reads
-- 1. Index sales/sale_items for the ledger's filter + sort patterns
-- 2. Wrap RLS helper calls in (SELECT ...) so Postgres evaluates them
--    once per query instead of once per row
-- Policy semantics are unchanged.
-- ============================================================

-- 1. Indexes
CREATE INDEX IF NOT EXISTS idx_sales_tenant_created_at
    ON public.sales (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_branch_created_at
    ON public.sales (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id
    ON public.sale_items (sale_id);

-- 2. Sales & Sale Items policies
DROP POLICY IF EXISTS "Read sales" ON public.sales;
CREATE POLICY "Read sales" ON public.sales FOR SELECT TO authenticated
    USING (
        tenant_id = (SELECT public.get_my_tenant_id()) AND (
            (SELECT public.get_my_role()) IN ('super_admin', 'inventory_manager', 'auditor') OR
            (SELECT public.get_my_branch_id()) = branch_id
        )
    );

DROP POLICY IF EXISTS "Write sales" ON public.sales;
CREATE POLICY "Write sales" ON public.sales FOR ALL TO authenticated
    USING (
        tenant_id = (SELECT public.get_my_tenant_id()) AND (
            (SELECT public.get_my_role()) IN ('super_admin', 'branch_manager', 'cashier') AND
            (SELECT public.get_my_branch_id()) = branch_id
        )
    );

DROP POLICY IF EXISTS "Read sale items" ON public.sale_items;
CREATE POLICY "Read sale items" ON public.sale_items FOR SELECT TO authenticated
    USING (
        tenant_id = (SELECT public.get_my_tenant_id()) AND (
            EXISTS (
                SELECT 1 FROM public.sales s
                WHERE s.id = sale_id AND (
                    (SELECT public.get_my_role()) IN ('super_admin', 'inventory_manager', 'auditor') OR
                    (SELECT public.get_my_branch_id()) = s.branch_id
                )
            )
        )
    );

DROP POLICY IF EXISTS "Write sale items" ON public.sale_items;
CREATE POLICY "Write sale items" ON public.sale_items FOR ALL TO authenticated
    USING (
        tenant_id = (SELECT public.get_my_tenant_id()) AND (
            EXISTS (
                SELECT 1 FROM public.sales s
                WHERE s.id = sale_id AND (SELECT public.get_my_branch_id()) = s.branch_id
            )
        )
    );
