-- Store staff names separately from their login email so request records can identify the requester.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT;

-- Keep profile creation in sync with the staff provisioning metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role_name, branch_id, tenant_id)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
    COALESCE(NEW.raw_user_meta_data->>'role_name', 'cashier'),
    (NEW.raw_user_meta_data->>'branch_id')::UUID,
    COALESCE(
      (NEW.raw_user_meta_data->>'tenant_id')::UUID,
      '00000000-0000-0000-0000-000000000000'
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_create_staff(
  p_full_name TEXT,
  p_email TEXT,
  p_password TEXT,
  p_role TEXT,
  p_branch_id UUID,
  p_allowed_tabs TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_my_role TEXT;
  v_my_tenant_id UUID;
BEGIN
  IF NULLIF(BTRIM(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Staff full name is required.';
  END IF;

  SELECT role_name, tenant_id
  INTO v_my_role, v_my_tenant_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF (v_my_role IS NULL OR v_my_role != 'super_admin') AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can create staff accounts.';
  END IF;

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, aud, role, is_sso_user, phone, phone_confirmed_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  VALUES (
    gen_random_uuid(), '00000000-0000-0000-0000-000000000000', p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'full_name', BTRIM(p_full_name),
      'role_name', p_role,
      'branch_id', p_branch_id,
      'tenant_id', v_my_tenant_id
    ),
    'authenticated', 'authenticated', false, NULL, NULL, '', '', '', ''
  )
  RETURNING id INTO v_user_id;

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  )
  VALUES (
    v_user_id, v_user_id,
    jsonb_build_object('sub', v_user_id::TEXT, 'email', p_email),
    'email', v_user_id::TEXT, now(), now(), now()
  );

  UPDATE public.profiles
  SET allowed_tabs = p_allowed_tabs
  WHERE id = v_user_id;

  PERFORM public.fn_log_audit(
    auth.uid(),
    'CREATE_STAFF',
    'User Management',
    NULL,
    jsonb_build_object('staff_id', v_user_id, 'full_name', BTRIM(p_full_name), 'email', p_email, 'role', p_role, 'branch_id', p_branch_id)
  );

  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_edit_staff(
  p_user_id UUID,
  p_full_name TEXT,
  p_role TEXT,
  p_branch_id UUID,
  p_allowed_tabs TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_role TEXT;
BEGIN
  IF NULLIF(BTRIM(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Staff full name is required.';
  END IF;

  SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
  IF v_my_role IS NULL OR v_my_role != 'super_admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only super admins can edit staff accounts.';
  END IF;

  UPDATE public.profiles
  SET full_name = BTRIM(p_full_name),
      role_name = p_role,
      branch_id = p_branch_id,
      allowed_tabs = p_allowed_tabs,
      updated_at = now()
  WHERE id = p_user_id;

  UPDATE auth.users
  SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'full_name', BTRIM(p_full_name),
    'role_name', p_role,
    'branch_id', p_branch_id,
    'allowed_tabs', p_allowed_tabs
  )
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_staff(TEXT, TEXT, TEXT, TEXT, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_staff(TEXT, TEXT, TEXT, TEXT, UUID, TEXT[]) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_edit_staff(UUID, TEXT, TEXT, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_edit_staff(UUID, TEXT, TEXT, UUID, TEXT[]) TO authenticated;
