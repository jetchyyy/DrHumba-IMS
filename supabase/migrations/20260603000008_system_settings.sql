-- Migration: Add System Settings Table for Document Templates
CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policy Rules
CREATE POLICY "Read system settings" ON public.system_settings 
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Manage system settings (admin/manager)" ON public.system_settings 
    FOR ALL TO authenticated USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));
