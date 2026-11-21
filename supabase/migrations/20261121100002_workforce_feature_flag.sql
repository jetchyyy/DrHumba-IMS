-- ============================================================
-- MIGRATION: staff_scheduling feature key on subscription plans
--
-- ADDITIVE ONLY. Adds the key as FALSE to plans that do not have it yet,
-- so it shows up in the Super Admin plan editor. It never changes a value
-- that is already set and never turns the feature on for any tenant.
-- Tenants see Workforce only when tenants.features.staff_scheduling = true.
-- ============================================================

UPDATE public.subscription_plans
SET features = jsonb_set(COALESCE(features, '{}'::jsonb), '{staff_scheduling}', 'false'::jsonb, true)
WHERE NOT (COALESCE(features, '{}'::jsonb) ? 'staff_scheduling');
