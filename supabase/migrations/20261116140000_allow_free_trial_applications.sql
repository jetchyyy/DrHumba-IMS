-- Let the Free Trial plan go through /apply and approval.
--
-- The `free` plan exists in subscription_plans (20260629000010) and the /apply
-- form submits it with payment_reference = 'FREE', but:
--   1. tenant_applications only allowed starter/professional/enterprise and a
--      payment_reference of 5+ characters, so free applications were rejected;
--   2. tenants had the same plan check, so approving one would fail;
--   3. fn_approve_tenant_application had no `free` branch and would have given
--      a free tenant Enterprise quotas (10 branches, 30 users).
--
-- Paid plans behave exactly as before. Existing tenants and applications are not
-- modified: the new checks are strictly wider than the old ones.

-- 1. Allow `free` on applications and tenants.
ALTER TABLE public.tenant_applications DROP CONSTRAINT IF EXISTS tenant_applications_plan_type_check;
ALTER TABLE public.tenant_applications ADD CONSTRAINT tenant_applications_plan_type_check
  CHECK (plan_type IN ('free', 'starter', 'professional', 'enterprise'));

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_plan_type_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_plan_type_check
  CHECK (plan_type IN ('free', 'starter', 'professional', 'enterprise'));

-- 2. Paid plans still need a 5+ character reference; free trials send 'FREE'.
ALTER TABLE public.tenant_applications DROP CONSTRAINT IF EXISTS tenant_applications_payment_reference_check;
ALTER TABLE public.tenant_applications ADD CONSTRAINT tenant_applications_payment_reference_check
  CHECK (
    (plan_type = 'free' AND payment_reference = 'FREE')
    OR (plan_type <> 'free' AND length(payment_reference) >= 5)
  );

-- 3. Approval: free trials get the Free plan's quotas and modules from
--    subscription_plans (fallback 1 branch / 2 users). Paid plans unchanged.
--    Body otherwise identical to 20260629000001_tenant_stamp_and_branch_onboarding_fix.sql.
CREATE OR REPLACE FUNCTION public.fn_approve_tenant_application(
    p_app_id UUID
)
RETURNS UUID AS $$
DECLARE
    r_app RECORD;
    v_tenant_id UUID;
    v_admin_id UUID;
    v_branch_id UUID;
    v_max_branches INT;
    v_max_users INT;
    v_free_features JSONB;
BEGIN
    -- Authorization check
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only platform superadmins can approve applications.';
    END IF;

    -- Fetch and lock application record
    SELECT * INTO r_app FROM public.tenant_applications WHERE id = p_app_id FOR UPDATE;
    IF r_app IS NULL THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;
    IF r_app.status != 'pending' THEN
        RAISE EXCEPTION 'Application has already been processed.';
    END IF;

    -- Determine quotas based on plans
    IF r_app.plan_type = 'free' THEN
        SELECT COALESCE(sp.max_branches, 1), COALESCE(sp.max_users, 2), sp.features
          INTO v_max_branches, v_max_users, v_free_features
          FROM public.subscription_plans sp WHERE sp.id = 'free';
        v_max_branches := COALESCE(v_max_branches, 1);
        v_max_users := COALESCE(v_max_users, 2);
    ELSIF r_app.plan_type = 'starter' THEN
        v_max_branches := 1;
        v_max_users := 3;
    ELSIF r_app.plan_type = 'professional' THEN
        v_max_branches := 3;
        v_max_users := 10;
    ELSE
        v_max_branches := 10;
        v_max_users := 30;
    END IF;

    -- Create active tenant with business model types
    INSERT INTO public.tenants (
        name,
        subdomain,
        plan_type,
        billing_cycle,
        status,
        max_branches,
        max_users,
        is_restaurant,
        is_retail,
        is_service
    )
    VALUES (
        r_app.business_name,
        LOWER(r_app.subdomain),
        r_app.plan_type,
        r_app.billing_cycle,
        'active',
        v_max_branches,
        v_max_users,
        COALESCE(r_app.is_restaurant, true),
        COALESCE(r_app.is_retail, false),
        COALESCE(r_app.is_service, false)
    )
    RETURNING id INTO v_tenant_id;

    -- Free trials: restrict modules to the Free plan's feature set
    IF v_free_features IS NOT NULL AND v_free_features <> '{}'::jsonb THEN
        UPDATE public.tenants
        SET features = features || v_free_features
        WHERE id = v_tenant_id;
    END IF;

    -- Auto-provision a default Main Branch for the new tenant
    INSERT INTO public.branches (
        tenant_id,
        name,
        is_warehouse,
        location
    )
    VALUES (
        v_tenant_id,
        r_app.business_name || ' - Main Branch',
        false,
        'Default Branch Location'
    )
    RETURNING id INTO v_branch_id;

    -- Provision admin user
    v_admin_id := public.internal_provision_tenant_admin(r_app.admin_email, r_app.admin_password_hash, v_tenant_id);

    -- Link the default branch to the newly created admin user profile
    UPDATE public.profiles
    SET branch_id = v_branch_id
    WHERE id = v_admin_id;

    -- Mark application as approved
    UPDATE public.tenant_applications
    SET status = 'approved', updated_at = now()
    WHERE id = p_app_id;

    RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
