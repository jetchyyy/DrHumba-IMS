-- ============================================================
-- MIGRATION: Restrict Direct Adjustment & Stock Balance Edits (Require Super Admin Approval)
-- File: 20261106000002_restrict_adjustment_edits_approval.sql
-- Date: 2026-11-06
--
-- Summary:
-- 1. Retroactively applies `'restrict_adjustment_edits'` to `allowed_tabs` (and `auth.users` metadata)
--    for all existing non-super_admin accounts (including `inventory_manager`, `branch_manager`, `cashier`, `auditor`, and custom roles).
-- 2. Updates `fn_update_stock_balance` and `fn_stock_in_item` so accounts with `'restrict_adjustment_edits'`
--    cannot bypass the approval workflow to directly overwrite stock balances.
-- 3. Updates `fn_process_adjustment` to enforce that only `super_admin` (or unrestricted `inventory_manager`)
--    within the same tenant can approve and apply stock adjustments.
-- ============================================================

-- 1. Retroactively populate allowed_tabs with default role tabs + 'restrict_adjustment_edits'
--    for existing non-super_admin profiles.
UPDATE public.profiles
SET allowed_tabs = CASE
    WHEN allowed_tabs IS NULL THEN
        CASE role_name
            WHEN 'inventory_manager' THEN ARRAY[
                'dashboard', 'inventory', 'global-inventory', 'receiving', 'transfers', 'transfers_dispatch',
                'transfers_receive', 'adjustments', 'portioning', 'transactions', 'recipes', 'analytics', 'settings',
                'action_buttons', 'restrict_adjustment_edits'
            ]::TEXT[]
            WHEN 'branch_manager' THEN ARRAY[
                'dashboard', 'pos', 'sales-history', 'z-read-history', 'expenses', 'inventory', 'global-inventory',
                'transfers', 'transfers_receive', 'adjustments', 'recipes', 'analytics', 'settings',
                'sales_void', 'restrict_adjustment_edits'
            ]::TEXT[]
            WHEN 'cashier' THEN ARRAY[
                'dashboard', 'pos', 'sales-history', 'z-read-history', 'inventory', 'global-inventory', 'settings',
                'restrict_adjustment_edits'
            ]::TEXT[]
            WHEN 'auditor' THEN ARRAY[
                'dashboard', 'inventory', 'global-inventory', 'transfers', 'adjustments', 'recipes', 'branches',
                'analytics', 'audit-logs', 'expenses', 'transactions', 'settings', 'restrict_adjustment_edits'
            ]::TEXT[]
            ELSE ARRAY[
                'dashboard', 'pos', 'sales-history', 'inventory', 'global-inventory', 'settings',
                'restrict_adjustment_edits'
            ]::TEXT[]
        END
    WHEN NOT ('restrict_adjustment_edits' = ANY(allowed_tabs)) THEN
        array_append(allowed_tabs, 'restrict_adjustment_edits')
    ELSE
        allowed_tabs
END,
updated_at = now()
WHERE role_name != 'super_admin'
  AND COALESCE(is_platform_admin, false) = false;

-- Sync raw_user_meta_data in auth.users for updated profiles
UPDATE auth.users u
SET raw_user_meta_data = COALESCE(u.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('allowed_tabs', p.allowed_tabs)
FROM public.profiles p
WHERE u.id = p.id
  AND p.role_name != 'super_admin'
  AND COALESCE(p.is_platform_admin, false) = false;

-- 2. Update fn_update_stock_balance to enforce 'restrict_adjustment_edits'
CREATE OR REPLACE FUNCTION public.fn_update_stock_balance(
    p_branch_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_created_by UUID
)
RETURNS VOID AS $$
DECLARE
    v_my_role TEXT;
    v_allowed_tabs TEXT[];
    v_current_qty NUMERIC;
    v_diff NUMERIC;
BEGIN
    SELECT role_name, allowed_tabs
    INTO v_my_role, v_allowed_tabs
    FROM public.profiles
    WHERE id = COALESCE(auth.uid(), p_created_by);

    IF v_my_role != 'super_admin' AND 'restrict_adjustment_edits' = ANY(COALESCE(v_allowed_tabs, ARRAY[]::TEXT[])) THEN
        RAISE EXCEPTION 'Unauthorized: Direct stock balance edits are restricted for your account and are subject to Admin approval.';
    END IF;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') AND NOT ('action_buttons' = ANY(COALESCE(v_allowed_tabs, ARRAY[]::TEXT[]))) THEN
        RAISE EXCEPTION 'Unauthorized: You do not have permission to update stock balances.';
    END IF;

    IF p_quantity < 0 THEN
        RAISE EXCEPTION 'Stock balance quantity cannot be negative.';
    END IF;

    SELECT COALESCE(
        (SELECT quantity FROM public.inventory_balances WHERE branch_id = p_branch_id AND item_id = p_item_id),
        0
    ) INTO v_current_qty;

    v_diff := p_quantity - v_current_qty;

    IF v_diff = 0 THEN
        RETURN;
    END IF;

    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
    VALUES (p_branch_id, p_item_id, p_quantity, now())
    ON CONFLICT (branch_id, item_id)
    DO UPDATE SET quantity = p_quantity, updated_at = now();

    INSERT INTO public.inventory_movements (
        branch_id, item_id, quantity, movement_type, created_by
    )
    VALUES (
        p_branch_id, p_item_id, v_diff, 'adjustment', COALESCE(auth.uid(), p_created_by)
    );

    INSERT INTO public.audit_logs (user_id, action, module, old_value, new_value)
    VALUES (
        COALESCE(auth.uid(), p_created_by),
        'UPDATE_STOCK_BALANCE',
        'inventory',
        json_build_object('branch_id', p_branch_id, 'item_id', p_item_id, 'quantity', v_current_qty)::jsonb,
        json_build_object('branch_id', p_branch_id, 'item_id', p_item_id, 'quantity', p_quantity)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update fn_stock_in_item to enforce 'restrict_adjustment_edits'
CREATE OR REPLACE FUNCTION public.fn_stock_in_item(
    p_branch_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_created_by UUID
)
RETURNS VOID AS $$
DECLARE
    v_my_role TEXT;
    v_allowed_tabs TEXT[];
BEGIN
    SELECT role_name, allowed_tabs
    INTO v_my_role, v_allowed_tabs
    FROM public.profiles
    WHERE id = COALESCE(auth.uid(), p_created_by);

    IF v_my_role != 'super_admin' AND 'restrict_adjustment_edits' = ANY(COALESCE(v_allowed_tabs, ARRAY[]::TEXT[])) THEN
        RAISE EXCEPTION 'Unauthorized: Direct stock additions are restricted for your account and are subject to Admin approval.';
    END IF;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins or inventory managers can stock in items.';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Stock in quantity must be greater than zero.';
    END IF;

    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
    VALUES (p_branch_id, p_item_id, p_quantity, now())
    ON CONFLICT (branch_id, item_id)
    DO UPDATE SET quantity = public.inventory_balances.quantity + p_quantity, updated_at = now();

    INSERT INTO public.inventory_movements (
        branch_id, item_id, quantity, movement_type, created_by
    )
    VALUES (
        p_branch_id, p_item_id, p_quantity, 'stock_in', COALESCE(auth.uid(), p_created_by)
    );

    INSERT INTO public.audit_logs (user_id, action, module, new_value)
    VALUES (
        COALESCE(auth.uid(), p_created_by),
        'STOCK_IN',
        'inventory',
        json_build_object('branch_id', p_branch_id, 'item_id', p_item_id, 'quantity', p_quantity)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update fn_process_adjustment to enforce Admin approval when 'restrict_adjustment_edits' is active
CREATE OR REPLACE FUNCTION public.fn_process_adjustment(
    p_adjustment_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_branch UUID;
    v_status TEXT;
    v_reason TEXT;
    v_tenant_id UUID;
    v_my_role TEXT;
    v_allowed_tabs TEXT[];
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
BEGIN
    SELECT role_name, allowed_tabs
    INTO v_my_role, v_allowed_tabs
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_my_role != 'super_admin' AND 'restrict_adjustment_edits' = ANY(COALESCE(v_allowed_tabs, ARRAY[]::TEXT[])) THEN
        RAISE EXCEPTION 'Unauthorized: Adjustments and edits are subject to Admin approval.';
    END IF;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can approve stock adjustments.';
    END IF;

    SELECT branch_id, status, reason, tenant_id
    INTO v_branch, v_status, v_reason, v_tenant_id
    FROM public.stock_adjustments 
    WHERE id = p_adjustment_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stock adjustment not found.';
    END IF;

    IF v_tenant_id != public.get_my_tenant_id() AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Tenant mismatch.';
    END IF;

    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Stock adjustment already processed.';
    END IF;

    -- Validate stock levels if adjustment is negative (deduction)
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.stock_adjustment_items WHERE adjustment_id = p_adjustment_id
    ) LOOP
        IF r_item.quantity_base_unit < 0 THEN
            SELECT COALESCE(quantity, 0) INTO v_bal 
            FROM public.inventory_balances 
            WHERE branch_id = v_branch AND item_id = r_item.item_id;

            IF v_bal < ABS(r_item.quantity_base_unit) THEN
                SELECT item_name INTO v_name FROM public.inventory_items WHERE id = r_item.item_id;
                RAISE EXCEPTION 'Insufficient stock to apply adjustment for %: balance %, required deduction %', v_name, v_bal, ABS(r_item.quantity_base_unit);
            END IF;
        END IF;
    END LOOP;

    -- Apply Adjustments
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.stock_adjustment_items WHERE adjustment_id = p_adjustment_id
    ) LOOP
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
        VALUES (v_branch, r_item.item_id, r_item.quantity_base_unit, now(), v_tenant_id)
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.quantity_base_unit, updated_at = now();

        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
        VALUES (v_branch, r_item.item_id, r_item.quantity_base_unit, 'adjustment', p_adjustment_id, 'adjustment', auth.uid(), v_tenant_id);

        PERFORM public.fn_check_low_stock(v_branch, r_item.item_id);
    END LOOP;

    -- Complete adjustment
    UPDATE public.stock_adjustments
    SET status = 'approved', approved_by = auth.uid()
    WHERE id = p_adjustment_id;

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'ADJUSTMENT_APPROVE',
        'Adjustments',
        NULL,
        json_build_object('adjustment_id', p_adjustment_id, 'approved_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

