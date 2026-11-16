-- Stop storing tenant applicants' admin passwords in plain text.
--
-- The /apply form inserts the applicant's chosen admin password into
-- tenant_applications.admin_password_hash. Despite the column name it was saved
-- as plain text and only bcrypt-hashed later, when a platform admin approved the
-- application and internal_provision_tenant_admin() created the auth user.
--
-- After this migration:
--   1. A BEFORE INSERT/UPDATE trigger bcrypt-hashes the value as soon as it is
--      written, so the plain password never rests in the table.
--   2. internal_provision_tenant_admin() accepts either a plain password (direct
--      callers such as fn_self_register_tenant) or an existing bcrypt hash
--      (approval of a stored application) and writes the hash to auth.users.
--   3. Existing rows are hashed in place. Pending applications can still be
--      approved; the applicant signs in with the password they chose.

CREATE OR REPLACE FUNCTION public.fn_is_bcrypt_hash(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_value ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$';
$$;

CREATE OR REPLACE FUNCTION public.fn_hash_tenant_application_password()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.admin_password_hash IS NOT NULL
     AND NOT public.fn_is_bcrypt_hash(NEW.admin_password_hash) THEN
    NEW.admin_password_hash := extensions.crypt(NEW.admin_password_hash, extensions.gen_salt('bf'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_tenant_application_password ON public.tenant_applications;
CREATE TRIGGER trg_hash_tenant_application_password
  BEFORE INSERT OR UPDATE OF admin_password_hash ON public.tenant_applications
  FOR EACH ROW EXECUTE FUNCTION public.fn_hash_tenant_application_password();

-- Accept a pre-hashed password. Body is otherwise unchanged from 20260628000000_multitenancy.sql.
CREATE OR REPLACE FUNCTION public.internal_provision_tenant_admin(
    p_email TEXT,
    p_password TEXT,
    p_tenant_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_encrypted TEXT;
BEGIN
    v_encrypted := CASE
        WHEN public.fn_is_bcrypt_hash(p_password) THEN p_password
        ELSE extensions.crypt(p_password, extensions.gen_salt('bf'))
    END;

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
        v_encrypted,
        now(),
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        json_build_object('role_name', 'super_admin', 'branch_id', NULL, 'tenant_id', p_tenant_id)::jsonb,
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

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Hash every password already stored in plain text (fires the trigger above).
UPDATE public.tenant_applications
SET admin_password_hash = admin_password_hash
WHERE admin_password_hash IS NOT NULL
  AND NOT public.fn_is_bcrypt_hash(admin_password_hash);
