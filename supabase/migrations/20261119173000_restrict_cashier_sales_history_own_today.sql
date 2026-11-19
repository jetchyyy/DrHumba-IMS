-- ============================================================
-- MIGRATION: Restrict Cashier Sales History to Own & Today Only
-- ============================================================

-- 1. Retroactively enable 'restrict_sales_history_own_today' on existing cashier profiles
UPDATE public.profiles
SET allowed_tabs = CASE
    WHEN allowed_tabs IS NULL THEN ARRAY[
        'dashboard', 'pos', 'sales-history', 'z-read-history', 'inventory', 'global-inventory', 'settings',
        'restrict_adjustment_edits', 'restrict_sales_history_own_today'
    ]::TEXT[]
    WHEN NOT ('restrict_sales_history_own_today' = ANY(allowed_tabs)) THEN
        array_append(allowed_tabs, 'restrict_sales_history_own_today')
    ELSE
        allowed_tabs
END,
updated_at = now()
WHERE role_name = 'cashier'
  AND COALESCE(is_platform_admin, false) = false;

-- 2. Sync raw_user_meta_data in auth.users for updated cashier profiles
UPDATE auth.users u
SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('allowed_tabs', p.allowed_tabs)
FROM public.profiles p
WHERE u.id = p.id
  AND p.role_name = 'cashier'
  AND COALESCE(p.is_platform_admin, false) = false;
