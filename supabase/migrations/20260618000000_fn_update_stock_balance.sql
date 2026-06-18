-- Migration: Add Stock Balance Edit function
-- Created: 2026-06-18

CREATE OR REPLACE FUNCTION public.fn_update_stock_balance(
    p_branch_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_created_by UUID
)
RETURNS VOID AS $$
DECLARE
    v_my_role TEXT;
    v_current_qty NUMERIC;
    v_diff NUMERIC;
BEGIN
    -- Security / Role validation check
    SELECT COALESCE(
        (SELECT role_name FROM public.profiles WHERE id = p_created_by),
        'none'
    ) INTO v_my_role;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins or inventory managers can update stock balances.';
    END IF;

    -- Validate quantity
    IF p_quantity < 0 THEN
        RAISE EXCEPTION 'Stock balance quantity cannot be negative.';
    END IF;

    -- Get current balance (default to 0 if not found)
    SELECT COALESCE(
        (SELECT quantity FROM public.inventory_balances WHERE branch_id = p_branch_id AND item_id = p_item_id),
        0
    ) INTO v_current_qty;

    v_diff := p_quantity - v_current_qty;

    IF v_diff = 0 THEN
        RETURN;
    END IF;

    -- Update balance
    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
    VALUES (p_branch_id, p_item_id, p_quantity, now())
    ON CONFLICT (branch_id, item_id)
    DO UPDATE SET quantity = p_quantity, updated_at = now();

    -- Record movement (adjustment)
    INSERT INTO public.inventory_movements (
        branch_id, item_id, quantity, movement_type, created_by
    )
    VALUES (
        p_branch_id, p_item_id, v_diff, 'adjustment', p_created_by
    );

    -- Log audit
    INSERT INTO public.audit_logs (user_id, action, module, old_value, new_value)
    VALUES (
        p_created_by,
        'UPDATE_STOCK_BALANCE',
        'inventory',
        json_build_object('branch_id', p_branch_id, 'item_id', p_item_id, 'quantity', v_current_qty)::jsonb,
        json_build_object('branch_id', p_branch_id, 'item_id', p_item_id, 'quantity', p_quantity)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public and grant to authenticated users
REVOKE ALL ON FUNCTION public.fn_update_stock_balance FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_update_stock_balance TO authenticated;
