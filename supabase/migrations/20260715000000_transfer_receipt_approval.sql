-- Migration: Transfer Receipt Discrepancy Approval Workflow
-- Created: 2026-07-15

-- 1. Modify transfer_requests table check constraint
ALTER TABLE public.transfer_requests DROP CONSTRAINT IF EXISTS transfer_requests_status_check;
ALTER TABLE public.transfer_requests ADD CONSTRAINT transfer_requests_status_check CHECK (status IN ('requested', 'approved', 'rejected', 'pending_receipt_approval', 'completed'));

-- 2. Add tracking and approval columns to transfer_requests
ALTER TABLE public.transfer_requests ADD COLUMN IF NOT EXISTS receipt_requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.transfer_requests ADD COLUMN IF NOT EXISTS receipt_approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.transfer_requests ADD COLUMN IF NOT EXISTS receipt_remarks TEXT;

-- 3. Add received quantity and reason tracking to transfer_items
ALTER TABLE public.transfer_items ADD COLUMN IF NOT EXISTS received_quantity_base_unit NUMERIC CHECK (received_quantity_base_unit >= 0);
ALTER TABLE public.transfer_items ADD COLUMN IF NOT EXISTS missing_reason TEXT;


-- 4. Redefine fn_receive_transfer to support the immediate happy path (perfect match)
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
    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();

    -- Strict rule: The person confirming must NOT be the sender/approver
    IF auth.uid() = v_approved_by THEN
        RAISE EXCEPTION 'Unauthorized: The sender/approver of this transfer request cannot confirm receipt of items.';
    END IF;

    -- Strict rule: The person confirming must NOT belong to the source branch/warehouse
    IF v_my_branch = v_source THEN
        RAISE EXCEPTION 'Unauthorized: Source branch/warehouse staff are not allowed to confirm receipt of items.';
    END IF;

    -- Check permissions: receiver must belong to the target branch, or be super admin / inventory manager
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        v_my_role != 'inventory_manager' AND 
        v_my_branch != v_target
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You are not authorized to confirm receipt for this branch.';
    END IF;

    -- Loop transfer items to add stock to target and log transfer_in
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.transfer_items WHERE transfer_id = p_transfer_id
    ) LOOP
        -- Add to Target
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
        VALUES (v_target, r_item.item_id, r_item.quantity_base_unit, now())
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.quantity_base_unit, updated_at = now();

        -- Record movement: transfer_in on target
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_target, r_item.item_id, r_item.quantity_base_unit, 'transfer_in', p_transfer_id, 'transfer', auth.uid());
    END LOOP;

    -- Populate received_quantity_base_unit in transfer_items since they all arrived perfectly
    UPDATE public.transfer_items
    SET received_quantity_base_unit = quantity_base_unit,
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

    -- Create Stock Receipt Items
    FOR r_item IN (
        SELECT ti.item_id, ti.quantity_base_unit, i.conversion_factor, i.cost_per_base_unit 
        FROM public.transfer_items ti
        JOIN public.inventory_items i ON i.id = ti.item_id
        WHERE ti.transfer_id = p_transfer_id
    ) LOOP
        INSERT INTO public.stock_receipt_items (
            receipt_id,
            item_id,
            quantity_purchased,
            cost_per_purchase_unit
        )
        VALUES (
            v_receipt_id,
            r_item.item_id,
            r_item.quantity_base_unit / r_item.conversion_factor,
            r_item.cost_per_base_unit * r_item.conversion_factor
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
        json_build_object('transfer_id', p_transfer_id, 'received_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 5. Create fn_submit_transfer_receipt to handle discrepancy submittals
CREATE OR REPLACE FUNCTION public.fn_submit_transfer_receipt(
    p_transfer_id UUID,
    p_items JSONB -- Array of { "item_id": "...", "received_quantity_base_unit": X, "missing_reason": "..." }
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
    v_tenant_id UUID;
    v_has_discrepancy BOOLEAN := FALSE;
    v_item_name TEXT;
    v_dispatched_qty NUMERIC;
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
    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();

    -- Strict rule: The person confirming must NOT be the sender/approver
    IF auth.uid() = v_approved_by THEN
        RAISE EXCEPTION 'Unauthorized: The sender/approver of this transfer request cannot confirm receipt of items.';
    END IF;

    -- Strict rule: The person confirming must NOT belong to the source branch/warehouse
    IF v_my_branch = v_source THEN
        RAISE EXCEPTION 'Unauthorized: Source branch/warehouse staff are not allowed to confirm receipt of items.';
    END IF;

    -- Check permissions: receiver must belong to the target branch, or be super admin / inventory manager
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        v_my_role != 'inventory_manager' AND 
        v_my_branch != v_target
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You are not authorized to confirm receipt for this branch.';
    END IF;

    -- Loop and update transfer_items with target inputs
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID AS item_id,
               (value->>'received_quantity_base_unit')::NUMERIC AS received_qty,
               (value->>'missing_reason')::TEXT AS reason
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch original quantity
        SELECT quantity_base_unit INTO v_dispatched_qty
        FROM public.transfer_items
        WHERE transfer_id = p_transfer_id AND item_id = r_item.item_id;

        IF v_dispatched_qty IS NULL THEN
            RAISE EXCEPTION 'Item not found in transfer.';
        END IF;

        IF r_item.received_qty < v_dispatched_qty THEN
            v_has_discrepancy := TRUE;
            IF r_item.reason IS NULL OR trim(r_item.reason) = '' THEN
                SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = r_item.item_id;
                RAISE EXCEPTION 'A reason is required for the missing item: %', v_item_name;
            END IF;
        END IF;

        UPDATE public.transfer_items
        SET received_quantity_base_unit = r_item.received_qty,
            missing_reason = CASE WHEN r_item.received_qty < quantity_base_unit THEN r_item.reason ELSE NULL END
        WHERE transfer_id = p_transfer_id AND item_id = r_item.item_id;
    END LOOP;

    -- Update transfer status
    UPDATE public.transfer_requests
    SET status = 'pending_receipt_approval',
        receipt_requested_by = auth.uid(),
        updated_at = now()
    WHERE id = p_transfer_id;

    -- Create notification warning about missing items
    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        v_source,
        'system',
        'DISCREPANCY ALERT: Delivery receipt submitted for transfer ' || COALESCE((SELECT control_number FROM public.transfer_requests WHERE id = p_transfer_id), p_transfer_id::text) || ' contains missing items and is awaiting admin approval.',
        v_tenant_id
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_RECEIPT_SUBMIT',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'submitted_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Create fn_approve_transfer_receipt to handle admin approval of discrepancy receipts
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

    -- Check permissions: caller must be super admin / inventory manager
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        v_my_role != 'inventory_manager'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only Super Admins and Inventory Managers are allowed to approve transfer discrepancies.';
    END IF;

    -- Loop transfer items to add stock to target and log transfer_in (using received_quantity_base_unit)
    FOR r_item IN (
        SELECT item_id, COALESCE(received_quantity_base_unit, 0) AS received_qty FROM public.transfer_items WHERE transfer_id = p_transfer_id
    ) LOOP
        -- Add only what actually arrived to target branch inventory
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
        VALUES (v_target, r_item.item_id, r_item.received_qty, now())
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.received_qty, updated_at = now();

        -- Record movement: transfer_in on target
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_target, r_item.item_id, r_item.received_qty, 'transfer_in', p_transfer_id, 'transfer', auth.uid());
    END LOOP;

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
        COALESCE(v_receipt_requested_by, auth.uid()),
        v_target,
        'completed',
        v_tenant_id
    )
    RETURNING id INTO v_receipt_id;

    -- Create Stock Receipt Items using actual received qty
    FOR r_item IN (
        SELECT ti.item_id, COALESCE(ti.received_quantity_base_unit, 0) AS received_qty, i.conversion_factor, i.cost_per_base_unit 
        FROM public.transfer_items ti
        JOIN public.inventory_items i ON i.id = ti.item_id
        WHERE ti.transfer_id = p_transfer_id
    ) LOOP
        INSERT INTO public.stock_receipt_items (
            receipt_id,
            item_id,
            quantity_purchased,
            cost_per_purchase_unit
        )
        VALUES (
            v_receipt_id,
            r_item.item_id,
            r_item.received_qty / r_item.conversion_factor,
            r_item.cost_per_base_unit * r_item.conversion_factor
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


-- 7. Create fn_reject_transfer_receipt to handle admin rejection of discrepancy receipts
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

    -- Check permissions: caller must be super admin / inventory manager
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
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


-- 8. GRANT execution rights
GRANT EXECUTE ON FUNCTION public.fn_receive_transfer(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_submit_transfer_receipt(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_approve_transfer_receipt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reject_transfer_receipt(UUID, TEXT) TO authenticated;
