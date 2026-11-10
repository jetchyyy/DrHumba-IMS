-- ============================================================
-- MIGRATION: Strict tenant isolation for expenses
-- ============================================================
-- The expense tracker policies allowed `OR public.is_platform_admin()`, so a
-- platform-admin account could read, edit and delete every tenant's expenses
-- from inside its own tenant's app. Match the branches policy
-- (20260629000004): expenses are visible only within the caller's tenant.

DROP POLICY IF EXISTS "Read expenses" ON public.expenses;
CREATE POLICY "Read expenses" ON public.expenses FOR SELECT TO authenticated
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Write expenses" ON public.expenses;
CREATE POLICY "Write expenses" ON public.expenses FOR ALL TO authenticated
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() = 'super_admin' OR
            (public.get_my_role() = 'branch_manager' AND public.get_my_branch_id() = branch_id)
        )
    )
    WITH CHECK (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() = 'super_admin' OR
            (public.get_my_role() = 'branch_manager' AND public.get_my_branch_id() = branch_id)
        ) AND EXISTS (
            SELECT 1 FROM public.branches b
            WHERE b.id = branch_id AND b.tenant_id = public.get_my_tenant_id()
        )
    );
