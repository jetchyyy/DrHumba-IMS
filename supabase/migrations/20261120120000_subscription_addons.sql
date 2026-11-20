-- Add-ons a tenant can buy on top of a paid plan (extra branch, extra staff).
-- Prices are editable by platform admins and shown on the public landing page.
CREATE TABLE IF NOT EXISTS public.subscription_addons (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    monthly_price NUMERIC NOT NULL CHECK (monthly_price >= 0),
    unit_label TEXT NOT NULL DEFAULT 'per month',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscription_addons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public select addons" ON public.subscription_addons;
CREATE POLICY "Allow public select addons" ON public.subscription_addons
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Platform admins manage addons" ON public.subscription_addons;
CREATE POLICY "Platform admins manage addons" ON public.subscription_addons
    FOR ALL TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

INSERT INTO public.subscription_addons (id, name, description, monthly_price, unit_label, sort_order)
VALUES
('extra_branch', 'Extra Branch Location', 'Open another branch on your current plan, with its own stock, sales and reports.', 499, 'per branch / month', 1),
('extra_staff', 'Extra Staff Account', 'Add another cashier, manager or kitchen login with its own role and permissions.', 99, 'per account / month', 2)
ON CONFLICT (id) DO NOTHING;
