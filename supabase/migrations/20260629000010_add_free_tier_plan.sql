-- Insert Free Trial subscription plan
INSERT INTO public.subscription_plans (id, name, monthly_price, yearly_price, max_branches, max_users, features)
VALUES 
('free', 'Free Trial', 0, 0, 1, 2, '{"pos": true, "sales_history": true, "inventory": true, "global_inventory": false, "receiving": true, "transfers": false, "adjustments": false, "transactions": false, "recipes": false, "branches": false, "analytics": false, "audit_logs": false, "users": false, "settings": false}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    monthly_price = EXCLUDED.monthly_price,
    yearly_price = EXCLUDED.yearly_price,
    max_branches = EXCLUDED.max_branches,
    max_users = EXCLUDED.max_users,
    features = EXCLUDED.features;
