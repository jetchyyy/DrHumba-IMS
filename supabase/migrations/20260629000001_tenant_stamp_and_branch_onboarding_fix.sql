-- ============================================================
-- MIGRATION: Tenant Stamp Triggers, Data Recovery, & Branch Onboarding
-- ============================================================

-- 1. Create auto-tenant triggers for sales, sale_items, and audit_logs
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_sales ON public.sales;
CREATE TRIGGER tg_auto_stamp_tenant_sales
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_sale_items ON public.sale_items;
CREATE TRIGGER tg_auto_stamp_tenant_sale_items
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_audit_logs ON public.audit_logs;
CREATE TRIGGER tg_auto_stamp_tenant_audit_logs
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();


-- 2. Recover and repair any existing test transactions misattributed to default tenant
-- Recover sales
UPDATE public.sales s
SET tenant_id = p.tenant_id
FROM public.profiles p
WHERE s.cashier_id = p.id
  AND s.tenant_id = '00000000-0000-0000-0000-000000000000'
  AND p.tenant_id != '00000000-0000-0000-0000-000000000000';

-- Recover sale_items
UPDATE public.sale_items si
SET tenant_id = s.tenant_id
FROM public.sales s
WHERE si.sale_id = s.id
  AND si.tenant_id = '00000000-0000-0000-0000-000000000000'
  AND s.tenant_id != '00000000-0000-0000-0000-000000000000';

-- Recover audit_logs
UPDATE public.audit_logs al
SET tenant_id = p.tenant_id
FROM public.profiles p
WHERE al.user_id = p.id
  AND al.tenant_id = '00000000-0000-0000-0000-000000000000'
  AND p.tenant_id != '00000000-0000-0000-0000-000000000000';


-- 3. Redefine fn_approve_tenant_application to auto-provision a default branch
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
    IF r_app.plan_type = 'starter' THEN
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
