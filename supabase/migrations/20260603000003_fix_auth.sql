-- Migration Hotfix: Sync identities for manual auth.users & update fn_create_staff
-- Created: 2026-06-03

-- 1. Heal any existing user accounts that have NULL timestamps in auth.users
UPDATE auth.users
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now())
WHERE created_at IS NULL OR updated_at IS NULL;

-- 2. Insert missing identity mappings for any manually created users
-- This will immediately fix the "Database error querying schema" sign-in issue for existing staff accounts
INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
)
SELECT 
    u.id,
    u.id,
    json_build_object('sub', u.id::TEXT, 'email', u.email)::jsonb,
    'email',
    u.id::TEXT,
    now(),
    COALESCE(u.created_at, now()),
    COALESCE(u.updated_at, now())
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id
WHERE i.id IS NULL
ON CONFLICT (provider, provider_id) DO NOTHING;

-- 3. Update fn_create_staff to automatically insert identities for new users and write all required auth.users columns
CREATE OR REPLACE FUNCTION public.fn_create_staff(
    p_email TEXT,
    p_password TEXT,
    p_role TEXT,
    p_branch_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_my_role TEXT;
BEGIN
    -- Authorization check
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR v_my_role != 'super_admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only super admins can create staff accounts.';
    END IF;

    -- Insert into auth.users (triggers profile creation)
    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        aud,
        role,
        is_sso_user,
        phone,
        phone_confirmed_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change
    )
    VALUES (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        p_email,
        extensions.crypt(p_password, extensions.gen_salt('bf')),
        now(),
        now(), -- created_at
        now(), -- updated_at
        '{"provider":"email","providers":["email"]}'::jsonb,
        json_build_object('role_name', p_role, 'branch_id', p_branch_id)::jsonb,
        'authenticated',
        'authenticated',
        false,
        NULL,
        NULL,
        '',
        '',
        '',
        ''
    )
    RETURNING id INTO v_user_id;

    -- Insert into auth.identities to link Email Auth Provider
    INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
    )
    VALUES (
        v_user_id,
        v_user_id,
        json_build_object('sub', v_user_id::TEXT, 'email', p_email)::jsonb,
        'email',
        v_user_id::TEXT,
        now(),
        now(),
        now()
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'CREATE_STAFF',
        'User Management',
        NULL,
        json_build_object('staff_id', v_user_id, 'email', p_email, 'role', p_role, 'branch_id', p_branch_id)::jsonb
    );

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
