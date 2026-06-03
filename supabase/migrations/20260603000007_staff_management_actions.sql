-- Migration: Staff management action helpers (Edit, Delete, Suspend)

-- 1. Add status column to profiles if it doesn't exist
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'));

-- 2. Create RPC function to safely delete staff (both auth and public profiles)
CREATE OR REPLACE FUNCTION public.fn_delete_staff(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_my_role TEXT;
BEGIN
    -- Authorization check
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR v_my_role != 'super_admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only super admins can delete staff accounts.';
    END IF;

    -- Avoid self deletion
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot delete your own administrator account.';
    END IF;

    -- Delete from auth.users (cascades to public.profiles)
    DELETE FROM auth.users WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create RPC function to toggle staff suspension status
CREATE OR REPLACE FUNCTION public.fn_update_staff_status(p_user_id UUID, p_status TEXT)
RETURNS VOID AS $$
DECLARE
    v_my_role TEXT;
BEGIN
    -- Authorization check
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR v_my_role != 'super_admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only super admins can toggle staff status.';
    END IF;

    -- Avoid self suspension
    IF p_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot suspend your own administrator account.';
    END IF;

    IF p_status NOT IN ('active', 'suspended') THEN
        RAISE EXCEPTION 'Invalid status. Must be active or suspended.';
    END IF;

    UPDATE public.profiles
    SET status = p_status, updated_at = now()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create RPC function to edit existing staff accounts (role, branch, custom allowed tabs)
CREATE OR REPLACE FUNCTION public.fn_edit_staff(
    p_user_id UUID,
    p_role TEXT,
    p_branch_id UUID,
    p_allowed_tabs TEXT[]
)
RETURNS VOID AS $$
DECLARE
    v_my_role TEXT;
BEGIN
    -- Authorization check
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR v_my_role != 'super_admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only super admins can edit staff accounts.';
    END IF;

    -- 1. Update public.profiles
    UPDATE public.profiles
    SET role_name = p_role,
        branch_id = p_branch_id,
        allowed_tabs = p_allowed_tabs,
        updated_at = now()
    WHERE id = p_user_id;

    -- 2. Update auth.users raw metadata
    UPDATE auth.users
    SET raw_user_meta_data = json_build_object(
        'role_name', p_role,
        'branch_id', p_branch_id,
        'allowed_tabs', p_allowed_tabs
    )::jsonb
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
