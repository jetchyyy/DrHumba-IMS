-- Migration: Fine-grained staff page/feature permissions

-- 1. Add allowed_tabs column to public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allowed_tabs TEXT[] DEFAULT NULL;

-- 2. Update handle_new_user trigger function to populate allowed_tabs on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role_name, branch_id, allowed_tabs)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role_name', 'cashier'),
        (NEW.raw_user_meta_data->>'branch_id')::UUID,
        CASE 
            WHEN NEW.raw_user_meta_data->'allowed_tabs' IS NOT NULL AND NEW.raw_user_meta_data->'allowed_tabs' != 'null'::jsonb THEN
                ARRAY(SELECT jsonb_array_elements_text(NEW.raw_user_meta_data->'allowed_tabs'))
            ELSE
                NULL
        END
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update fn_create_staff to accept allowed_tabs and insert them into user metadata
CREATE OR REPLACE FUNCTION public.fn_create_staff(
    p_email TEXT,
    p_password TEXT,
    p_role TEXT,
    p_branch_id UUID,
    p_allowed_tabs TEXT[]
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

    -- Insert into auth.users (triggers profile creation via handle_new_user)
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
        json_build_object(
            'role_name', p_role, 
            'branch_id', p_branch_id,
            'allowed_tabs', p_allowed_tabs
        )::jsonb,
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
        json_build_object('sub', v_user_id, 'email', p_email)::jsonb,
        'email',
        p_email,
        now(),
        now(),
        now()
    );

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
