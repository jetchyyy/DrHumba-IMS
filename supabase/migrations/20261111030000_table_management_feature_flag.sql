-- ============================================================
-- MIGRATION: Table Management Feature Flag for Tenant Plans
-- ============================================================

-- 1. Ensure Dr. Humba (primary tenant) has table_management enabled by default
UPDATE public.tenants
SET features = jsonb_set(
    COALESCE(features, '{}'::jsonb),
    '{table_management}',
    'true'::jsonb,
    true
)
WHERE id = '00000000-0000-0000-0000-000000000000';

-- 2. Update subscription_plans features
UPDATE public.subscription_plans
SET features = jsonb_set(
    COALESCE(features, '{}'::jsonb),
    '{table_management}',
    'true'::jsonb,
    true
)
WHERE id = 'enterprise';

UPDATE public.subscription_plans
SET features = jsonb_set(
    COALESCE(features, '{}'::jsonb),
    '{table_management}',
    'false'::jsonb,
    true
)
WHERE id IN ('starter', 'professional');

