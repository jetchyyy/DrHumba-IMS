-- ============================================================
-- MIGRATION: Allow Staff with 'expenses' Permission to Read & Write Expenses
-- File: 20261112012000_allow_staff_with_expenses_permission_rls.sql
-- ============================================================

-- 1. Ensure get_my_allowed_tabs() helper exists and is up to date
CREATE OR REPLACE FUNCTION public.get_my_allowed_tabs()
RETURNS TEXT[] AS $$
    SELECT allowed_tabs FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_my_allowed_tabs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_allowed_tabs() TO service_role;

-- 2. Update "Read expenses" RLS policy to allow users with 'expenses' in allowed_tabs
DROP POLICY IF EXISTS "Read expenses" ON public.expenses;
CREATE POLICY "Read expenses" ON public.expenses FOR SELECT TO authenticated
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR
            public.get_my_branch_id() = branch_id OR
            'expenses' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]))
        )
    );

-- 3. Update "Write expenses" RLS policy to allow staff with 'expenses' permission
DROP POLICY IF EXISTS "Write expenses" ON public.expenses;
CREATE POLICY "Write expenses" ON public.expenses FOR ALL TO authenticated
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() = 'super_admin' OR
            (public.get_my_role() = 'branch_manager' AND (public.get_my_branch_id() IS NULL OR public.get_my_branch_id() = branch_id)) OR
            (
                'expenses' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) AND
                (public.get_my_branch_id() IS NULL OR public.get_my_branch_id() = branch_id)
            )
        )
    )
    WITH CHECK (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() = 'super_admin' OR
            (public.get_my_role() = 'branch_manager' AND (public.get_my_branch_id() IS NULL OR public.get_my_branch_id() = branch_id)) OR
            (
                'expenses' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) AND
                (public.get_my_branch_id() IS NULL OR public.get_my_branch_id() = branch_id)
            )
        ) AND EXISTS (
            SELECT 1 FROM public.branches b
            WHERE b.id = branch_id AND b.tenant_id = public.get_my_tenant_id()
        )
    );

