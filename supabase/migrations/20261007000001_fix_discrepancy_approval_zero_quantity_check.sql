-- Migration: Fix Discrepancy Approval Zero Quantity Check Constraint Violation
-- Created: 2026-10-07
-- Description: In fn_approve_transfer_receipt, items with received_quantity_base_unit = 0 (missing items) were being inserted into stock_receipt_items with quantity_purchased = 0, violating the CHECK (quantity_purchased > 0) constraint. This migration filters out zero-quantity items when creating stock receipt items and updating inventory balances.

CREATE OR REPLACE FUNCTION public.fn_approve_transfer_receipt(
    p_transfer_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_source UUID;
    v_target UUID;
    v_status TEXT;
    v_receipt_requested_by UUID;
    r_item RECORD;
    v_my_role TEXT;
    v_my_branch UUID;
    v_receipt_id UUID;
    v_tenant_id UUID;
BEGIN
    -- Get transfer details
    SELECT source_branch_id, target_branch_id, status, receipt_requested_by, tenant_id
    INTO v_source, v_target, v_status, v_receipt_requested_by, v_tenant_id
    FROM public.transfer_requests 
    WHERE id = p_transfer_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;

    IF v_status != 'pending_receipt_approval' THEN
        RAISE EXCEPTION 'Transfer receipt is not in pending approval status.';
    END IF;

    -- Get user profile details
    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();

    -- Check permissions: caller must be super admin / inventory manager / platform admin
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        NOT public.is_platform_admin() AND
        v_my_role != 'inventory_manager'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only Super Admins and Inventory Managers are allowed to approve transfer discrepancies.';
    END IF;

    -- Loop transfer items to add stock to target and log transfer_in (only if received_quantity_base_unit > 0)
    FOR r_item IN (
        SELECT item_id, COALESCE(received_quantity_base_unit, 0) AS received_qty 
        FROM public.transfer_items 
        WHERE transfer_id = p_transfer_id
    ) LOOP
        IF r_item.received_qty > 0 THEN
            -- Add only what actually arrived to target branch inventory
            INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
            VALUES (v_target, r_item.item_id, r_item.received_qty, now(), v_tenant_id)
            ON CONFLICT (branch_id, item_id)
            DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.received_qty, updated_at = now();

            -- Record movement: transfer_in on target
            INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES (v_target, r_item.item_id, r_item.received_qty, 'transfer_in', p_transfer_id, 'transfer', auth.uid(), v_tenant_id);
        END IF;
    END LOOP;

    -- Create matching Stock Receipt header
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
        COALESCE(v_receipt_requested_by, auth.uid()),
        v_target,
        'completed',
        v_tenant_id
    )
    RETURNING id INTO v_receipt_id;

    -- Create Stock Receipt Items using actual received qty (> 0 only to satisfy check constraint)
    FOR r_item IN (
        SELECT ti.item_id, COALESCE(ti.received_quantity_base_unit, 0) AS received_qty, i.conversion_factor, i.cost_per_base_unit 
        FROM public.transfer_items ti
        JOIN public.inventory_items i ON i.id = ti.item_id
        WHERE ti.transfer_id = p_transfer_id
          AND COALESCE(ti.received_quantity_base_unit, 0) > 0
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
            r_item.received_qty / r_item.conversion_factor,
            r_item.cost_per_base_unit * r_item.conversion_factor,
            v_tenant_id
        );
    END LOOP;

    -- Complete transfer request
    UPDATE public.transfer_requests
    SET status = 'completed', 
        receipt_approved_by = auth.uid(),
        updated_at = now()
    WHERE id = p_transfer_id;

    -- Create notifications
    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        v_source,
        'system',
        'Transfer receipt with discrepancies has been approved and completed by admin.',
        v_tenant_id
    );

    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        v_target,
        'system',
        'Admin approved transfer delivery receipt. Quantities added to inventory.',
        v_tenant_id
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_RECEIPT_APPROVE',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'approved_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Update fn_reject_transfer_receipt with platform_admin support
CREATE OR REPLACE FUNCTION public.fn_reject_transfer_receipt(
    p_transfer_id UUID,
    p_remarks TEXT
)
RETURNS VOID AS $$
DECLARE
    v_source UUID;
    v_target UUID;
    v_status TEXT;
    v_tenant_id UUID;
    v_my_role TEXT;
    v_my_branch UUID;
BEGIN
    -- Get transfer details
    SELECT source_branch_id, target_branch_id, status, tenant_id
    INTO v_source, v_target, v_status, v_tenant_id
    FROM public.transfer_requests 
    WHERE id = p_transfer_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;

    IF v_status != 'pending_receipt_approval' THEN
        RAISE EXCEPTION 'Transfer receipt is not in pending approval status.';
    END IF;

    -- Get user profile details
    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();

    -- Check permissions: caller must be super admin / inventory manager / platform admin
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        NOT public.is_platform_admin() AND
        v_my_role != 'inventory_manager'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only Super Admins and Inventory Managers are allowed to reject transfer receipts.';
    END IF;

    -- Reset status back to approved (In Transit) and clear discrepancy values
    UPDATE public.transfer_requests
    SET status = 'approved',
        receipt_requested_by = NULL,
        receipt_remarks = p_remarks,
        updated_at = now()
    WHERE id = p_transfer_id;

    UPDATE public.transfer_items
    SET received_quantity_base_unit = NULL,
        missing_reason = NULL
    WHERE transfer_id = p_transfer_id;

    -- Notify target branch
    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        v_target,
        'system',
        'Admin rejected delivery receipt. Reason: ' || COALESCE(p_remarks, 'No reason specified') || '. Please re-verify and re-submit.',
        v_tenant_id
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_RECEIPT_REJECT',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'rejected_by', auth.uid(), 'remarks', p_remarks)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.fn_approve_transfer_receipt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reject_transfer_receipt(UUID, TEXT) TO authenticated;
