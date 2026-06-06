-- Migration: Transfer Receiving Strict Permissions
-- Created: 2026-06-06

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
BEGIN
    -- Get transfer details
    SELECT source_branch_id, target_branch_id, status, requested_by, approved_by
    INTO v_source, v_target, v_status, v_requested_by, v_approved_by
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
    IF auth.uid() = v_approved_by OR auth.uid() = v_requested_by THEN
        RAISE EXCEPTION 'Unauthorized: The sender/creator of this transfer request cannot confirm receipt of items.';
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

    -- Create matching Stock Receipt (Stock In / Stock Receiving Transaction)
    INSERT INTO public.stock_receipts (
        supplier,
        invoice_no,
        date_received,
        received_by,
        branch_id,
        status
    )
    VALUES (
        'Transfer from ' || (SELECT name FROM public.branches WHERE id = v_source),
        (SELECT COALESCE(control_number, p_transfer_id::text) FROM public.transfer_requests WHERE id = p_transfer_id),
        CURRENT_DATE,
        auth.uid(),
        v_target,
        'completed'
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
    SET status = 'completed', updated_at = now()
    WHERE id = p_transfer_id;

    -- Create notification for source branch (Warehouse)
    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        v_source,
        'system',
        'Shipment ' || p_transfer_id || ' has been received and confirmed by ' || (SELECT name FROM public.branches WHERE id = v_target)
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
