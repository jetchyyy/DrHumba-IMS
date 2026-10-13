-- Migration: Transfer Unapproved / Rejected Items Tracking
-- Created: 2026-10-13
-- Description: Adds is_rejected column to transfer_items to allow keeping unapproved/deleted items visible in system with strikethrough/unapproved label, without deducting stock or printing them.

-- 1. Add is_rejected column to transfer_items
ALTER TABLE public.transfer_items 
    ADD COLUMN IF NOT EXISTS is_rejected BOOLEAN DEFAULT FALSE;

-- 2. Update fn_approve_transfer to only validate and deduct items that are NOT rejected and have quantity > 0
CREATE OR REPLACE FUNCTION public.fn_approve_transfer(
    p_transfer_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_source UUID;
    v_target UUID;
    v_status TEXT;
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
    v_active_count INT;
BEGIN
    SELECT source_branch_id, target_branch_id, status INTO v_source, v_target, v_status 
    FROM public.transfer_requests 
    WHERE id = p_transfer_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer request not found.';
    END IF;

    IF v_status != 'requested' THEN
        RAISE EXCEPTION 'Transfer request is not in requested status.';
    END IF;

    -- Ensure there is at least one active approved item
    SELECT COUNT(*) INTO v_active_count
    FROM public.transfer_items
    WHERE transfer_id = p_transfer_id
      AND COALESCE(is_rejected, FALSE) = FALSE
      AND COALESCE(quantity_base_unit, 0) > 0;

    IF v_active_count = 0 THEN
        RAISE EXCEPTION 'Cannot approve transfer with no approved items. Please reject the transfer request instead.';
    END IF;

    -- Loop active transfer items to validate source stock
    FOR r_item IN (
        SELECT item_id, quantity_base_unit 
        FROM public.transfer_items 
        WHERE transfer_id = p_transfer_id
          AND COALESCE(is_rejected, FALSE) = FALSE
          AND COALESCE(quantity_base_unit, 0) > 0
    ) LOOP
        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        IF v_bal < r_item.quantity_base_unit THEN
            SELECT item_name INTO v_name FROM public.inventory_items WHERE id = r_item.item_id;
            RAISE EXCEPTION 'Source branch has insufficient stock for item %: required %, available %', v_name, r_item.quantity_base_unit, v_bal;
        END IF;
    END LOOP;

    -- Execute transfer deduction from source for active items only
    FOR r_item IN (
        SELECT item_id, quantity_base_unit 
        FROM public.transfer_items 
        WHERE transfer_id = p_transfer_id
          AND COALESCE(is_rejected, FALSE) = FALSE
          AND COALESCE(quantity_base_unit, 0) > 0
    ) LOOP
        -- Deduct from Source
        UPDATE public.inventory_balances
        SET quantity = quantity - r_item.quantity_base_unit, updated_at = now()
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        -- Record movement: transfer_out on source
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_source, r_item.item_id, -r_item.quantity_base_unit, 'transfer_out', p_transfer_id, 'transfer', auth.uid());

        -- Check low stock alerts
        PERFORM public.fn_check_low_stock(v_source, r_item.item_id);
    END LOOP;

    -- Update request status to 'approved' (meaning dispatched and in transit)
    UPDATE public.transfer_requests
    SET status = 'approved', approved_by = auth.uid(), reviewed_by = auth.uid(), updated_at = now()
    WHERE id = p_transfer_id;

    -- Notification for target branch that stock is incoming
    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        v_target,
        'system',
        'Stock shipment for transfer request ' || p_transfer_id || ' is in transit.'
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_APPROVE',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'approved_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Update fn_receive_transfer to only add active approved items to target and stock receipts
CREATE OR REPLACE FUNCTION public.fn_receive_transfer(
    p_transfer_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_source UUID;
    v_target UUID;
    v_status TEXT;
    v_requested_by UUID;
    v_approved_by UUID;
    r_item RECORD;
    v_my_role TEXT;
    v_my_branch UUID;
    v_my_allowed_tabs TEXT[];
    v_receipt_id UUID;
    v_tenant_id UUID;
BEGIN
    -- Get transfer details
    SELECT source_branch_id, target_branch_id, status, requested_by, approved_by, tenant_id
    INTO v_source, v_target, v_status, v_requested_by, v_approved_by, v_tenant_id
    FROM public.transfer_requests 
    WHERE id = p_transfer_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;

    IF v_status != 'approved' THEN
        RAISE EXCEPTION 'Transfer is not in approved/in-transit status.';
    END IF;

    -- Get user profile details
    SELECT role_name, branch_id, allowed_tabs 
    INTO v_my_role, v_my_branch, v_my_allowed_tabs 
    FROM public.profiles 
    WHERE id = auth.uid();

    -- Strict rule: The person confirming must NOT be the sender/approver who dispatched from source (super_admin and platform_admin exempt)
    IF v_my_role != 'super_admin' AND NOT public.is_platform_admin() AND auth.uid() = v_approved_by THEN
        RAISE EXCEPTION 'Unauthorized: The sender/approver of this transfer request cannot confirm receipt of items.';
    END IF;

    -- Strict rule: The person confirming must NOT belong to the source branch/warehouse (super_admin and platform_admin exempt)
    IF v_my_role != 'super_admin' AND NOT public.is_platform_admin() AND v_my_branch = v_source THEN
        RAISE EXCEPTION 'Unauthorized: Source branch/warehouse staff are not allowed to confirm receipt of items.';
    END IF;

    -- Check permissions: receiver must belong to target branch, or be super admin / inventory manager, or have 'transfers' in allowed_tabs
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        NOT public.is_platform_admin() AND
        v_my_role != 'inventory_manager' AND 
        v_my_branch != v_target AND
        NOT ('transfers' = ANY(COALESCE(v_my_allowed_tabs, ARRAY[]::TEXT[])))
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You are not authorized to confirm receipt for this branch.';
    END IF;

    -- Loop transfer items to add stock to target and log transfer_in (only active items > 0)
    FOR r_item IN (
        SELECT item_id, quantity_base_unit 
        FROM public.transfer_items 
        WHERE transfer_id = p_transfer_id
          AND COALESCE(is_rejected, FALSE) = FALSE
          AND COALESCE(quantity_base_unit, 0) > 0
    ) LOOP
        -- Add to Target
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
        VALUES (v_target, r_item.item_id, r_item.quantity_base_unit, now(), v_tenant_id)
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.quantity_base_unit, updated_at = now();

        -- Record movement: transfer_in on target
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
        VALUES (v_target, r_item.item_id, r_item.quantity_base_unit, 'transfer_in', p_transfer_id, 'transfer', auth.uid(), v_tenant_id);
    END LOOP;

    -- Populate received_quantity_base_unit in transfer_items since active items arrived perfectly
    UPDATE public.transfer_items
    SET received_quantity_base_unit = CASE 
            WHEN COALESCE(is_rejected, FALSE) = TRUE THEN 0 
            ELSE quantity_base_unit 
        END,
        missing_reason = NULL
    WHERE transfer_id = p_transfer_id;

    -- Create matching Stock Receipt
    INSERT INTO public.stock_receipts (
        supplier,
        invoice_no,
        date_received,
        received_by,
        branch_id,
        status,
        tenant_id
    )
    VALUES (
        'Transfer from ' || (SELECT name FROM public.branches WHERE id = v_source),
        (SELECT COALESCE(control_number, p_transfer_id::text) FROM public.transfer_requests WHERE id = p_transfer_id),
        CURRENT_DATE,
        auth.uid(),
        v_target,
        'completed',
        v_tenant_id
    )
    RETURNING id INTO v_receipt_id;

    -- Create Stock Receipt Items (only active items > 0)
    FOR r_item IN (
        SELECT ti.item_id, ti.quantity_base_unit, i.conversion_factor, i.cost_per_base_unit 
        FROM public.transfer_items ti
        JOIN public.inventory_items i ON i.id = ti.item_id
        WHERE ti.transfer_id = p_transfer_id
          AND COALESCE(ti.is_rejected, FALSE) = FALSE
          AND COALESCE(ti.quantity_base_unit, 0) > 0
    ) LOOP
        INSERT INTO public.stock_receipt_items (
            receipt_id,
            item_id,
            quantity_purchased,
            cost_per_purchase_unit,
            tenant_id
        )
        VALUES (
            v_receipt_id,
            r_item.item_id,
            r_item.quantity_base_unit / r_item.conversion_factor,
            r_item.cost_per_base_unit * r_item.conversion_factor,
            v_tenant_id
        );
    END LOOP;

    -- Complete transfer request
    UPDATE public.transfer_requests
    SET status = 'completed', 
        receipt_requested_by = auth.uid(),
        receipt_approved_by = auth.uid(),
        updated_at = now()
    WHERE id = p_transfer_id;

    -- Create notification for source branch (Warehouse)
    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        v_source,
        'system',
        'Shipment ' || COALESCE((SELECT control_number FROM public.transfer_requests WHERE id = p_transfer_id), p_transfer_id::text) || ' has been received and confirmed by ' || (SELECT name FROM public.branches WHERE id = v_target),
        v_tenant_id
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_RECEIVE',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'received_by', auth.uid(), 'tenant_id', v_tenant_id)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_approve_transfer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_transfer(UUID) TO authenticated;
