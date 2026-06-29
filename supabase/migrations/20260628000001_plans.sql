-- Create subscription plans table
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_price NUMERIC NOT NULL,
    yearly_price NUMERIC NOT NULL,
    max_branches INTEGER NOT NULL,
    max_users INTEGER NOT NULL,
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Policies for subscription plans
CREATE POLICY "Allow public select plans" ON public.subscription_plans
    FOR SELECT TO public, authenticated USING (true);

CREATE POLICY "Platform admins manage plans" ON public.subscription_plans
    FOR ALL TO authenticated USING (public.is_platform_admin());

-- Prepopulate plans
INSERT INTO public.subscription_plans (id, name, monthly_price, yearly_price, max_branches, max_users, features)
VALUES 
('starter', 'Starter Plan', 999, 9990, 1, 3, '{"pos": true, "sales_history": true, "inventory": true, "global_inventory": true, "receiving": true, "transfers": false, "adjustments": false, "transactions": false, "recipes": false, "branches": false, "analytics": false, "audit_logs": false, "users": false, "settings": true}'::jsonb),
('professional', 'Professional Plan', 2499, 24990, 3, 10, '{"pos": true, "sales_history": true, "inventory": true, "global_inventory": true, "receiving": true, "transfers": true, "adjustments": true, "transactions": true, "recipes": true, "branches": true, "analytics": true, "audit_logs": true, "users": true, "settings": true}'::jsonb),
('enterprise', 'Enterprise Plan', 7499, 74990, 10, 30, '{"pos": true, "sales_history": true, "inventory": true, "global_inventory": true, "receiving": true, "transfers": true, "adjustments": true, "transactions": true, "recipes": true, "branches": true, "analytics": true, "audit_logs": true, "users": true, "settings": true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
    monthly_price = EXCLUDED.monthly_price,
    yearly_price = EXCLUDED.yearly_price,
    max_branches = EXCLUDED.max_branches,
    max_users = EXCLUDED.max_users,
    features = EXCLUDED.features;
