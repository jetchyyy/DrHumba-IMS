-- ============================================================
-- MIGRATION: Tenant Isolation in System Settings
-- ============================================================

-- 1. Add tenant_id column referencing tenants table
ALTER TABLE public.system_settings 
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- 2. Backfill existing settings rows with the default tenant ID (Dr. Humba)
UPDATE public.system_settings
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

-- 3. Set NOT NULL and default values
ALTER TABLE public.system_settings 
    ALTER COLUMN tenant_id SET NOT NULL,
    ALTER COLUMN tenant_id SET DEFAULT public.get_my_tenant_id();

-- 4. Rebuild Primary Key to be composite (tenant_id, key)
ALTER TABLE public.system_settings DROP CONSTRAINT IF EXISTS system_settings_pkey;
ALTER TABLE public.system_settings ADD CONSTRAINT system_settings_pkey PRIMARY KEY (tenant_id, key);

-- 5. Revise RLS Policies to isolate by tenant_id
DROP POLICY IF EXISTS "Read system settings" ON public.system_settings;
CREATE POLICY "Read system settings" ON public.system_settings 
    FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Manage system settings (admin/manager)" ON public.system_settings;
CREATE POLICY "Manage system settings (admin/manager)" ON public.system_settings 
    FOR ALL TO authenticated USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() IN ('super_admin', 'inventory_manager'));

-- 6. Attach the auto-stamp tenant_id trigger
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_settings ON public.system_settings;
CREATE TRIGGER tg_auto_stamp_tenant_settings
  BEFORE INSERT ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();
