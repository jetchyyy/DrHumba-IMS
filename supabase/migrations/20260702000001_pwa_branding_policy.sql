-- ============================================================
-- MIGRATION: Tenant Branding Update Policy
-- ============================================================

-- Allow tenant super_admin to update their own tenant details (like name and logo_url)
DROP POLICY IF EXISTS "Tenant admins manage own tenant" ON public.tenants;
CREATE POLICY "Tenant admins manage own tenant" ON public.tenants 
    FOR UPDATE TO authenticated 
    USING (id = public.get_my_tenant_id() AND public.get_my_role() = 'super_admin');
