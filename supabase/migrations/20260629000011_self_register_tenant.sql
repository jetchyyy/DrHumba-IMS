-- Create self-registration function that bypasses platform admin check
CREATE OR REPLACE FUNCTION public.fn_self_register_tenant(
    p_business_name TEXT,
    p_subdomain TEXT,
    p_admin_email TEXT,
    p_admin_password TEXT,
    p_plan_type TEXT,
    p_billing_cycle TEXT,
    p_is_restaurant BOOLEAN,
    p_is_retail BOOLEAN,
    p_is_service BOOLEAN
)
RETURNS UUID AS $$
DECLARE
    v_tenant_id UUID;
    v_admin_id UUID;
    v_branch_id UUID;
    v_max_branches INT;
    v_max_users INT;
BEGIN
    -- Subdomain validation
    IF EXISTS (SELECT 1 FROM public.tenants WHERE LOWER(subdomain) = LOWER(p_subdomain)) THEN
        RAISE EXCEPTION 'Subdomain is already registered.';
    END IF;

    -- Quotas based on plans
    IF p_plan_type = 'free' THEN
        v_max_branches := 1;
        v_max_users := 2;
    ELSIF p_plan_type = 'starter' THEN
        v_max_branches := 1;
        v_max_users := 3;
    ELSIF p_plan_type = 'professional' THEN
        v_max_branches := 3;
        v_max_users := 10;
    ELSE
        v_max_branches := 10;
        v_max_users := 30;
    END IF;

    -- Create active tenant
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
        p_business_name, 
        LOWER(p_subdomain), 
        p_plan_type, 
        p_billing_cycle, 
        'active', 
        v_max_branches, 
        v_max_users,
        COALESCE(p_is_restaurant, true),
        COALESCE(p_is_retail, false),
        COALESCE(p_is_service, false)
    )
    RETURNING id INTO v_tenant_id;

    -- Auto-provision Main Branch
    INSERT INTO public.branches (
        tenant_id,
        name,
        is_warehouse,
        location
    )
    VALUES (
        v_tenant_id,
        p_business_name || ' - Main Branch',
        false,
        'Default Branch Location'
    )
    RETURNING id INTO v_branch_id;

    -- Provision admin user
    v_admin_id := public.internal_provision_tenant_admin(p_admin_email, p_admin_password, v_tenant_id);

    -- Link default branch to profile
    UPDATE public.profiles
    SET branch_id = v_branch_id
    WHERE id = v_admin_id;

    -- Insert record into tenant_applications as approved for historical logging
    INSERT INTO public.tenant_applications (
        business_name,
        subdomain,
        admin_email,
        admin_password_hash,
        plan_type,
        billing_cycle,
        payment_reference,
        payment_receipt_url,
        status,
        is_restaurant,
        is_retail,
        is_service
    )
    VALUES (
        p_business_name,
        LOWER(p_subdomain),
        p_admin_email,
        'SELF_REGISTERED', -- Hide password hash in application log
        p_plan_type,
        p_billing_cycle,
        'SELF_REGISTER',
        'SELF_REGISTER',
        'approved',
        p_is_restaurant,
        p_is_retail,
        p_is_service
    );

    RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_self_register_tenant(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) TO anon, authenticated;
