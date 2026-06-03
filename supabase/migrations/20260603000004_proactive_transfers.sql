-- Migration: Proactive Transfers & Confirmations
-- Created: 2026-06-03

-- 1. Modify fn_approve_transfer to mark requests as 'approved' (In Transit) and only deduct from source
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

    -- Loop transfer items to validate source stock
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.transfer_items WHERE transfer_id = p_transfer_id
    ) LOOP
        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        IF v_bal < r_item.quantity_base_unit THEN
            SELECT item_name INTO v_name FROM public.inventory_items WHERE id = r_item.item_id;
            RAISE EXCEPTION 'Source branch has insufficient stock for item %: required %, available %', v_name, r_item.quantity_base_unit, v_bal;
        END IF;
    END LOOP;

    -- Execute transfer deduction from source
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.transfer_items WHERE transfer_id = p_transfer_id
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


-- 2. New fn_send_transfer for proactive stock shipments from Warehouse to Branches
CREATE OR REPLACE FUNCTION public.fn_send_transfer(
    p_source_branch_id UUID,
    p_target_branch_id UUID,
    p_items JSONB -- Array of { "item_id": "...", "quantity_base_unit": X }
)
RETURNS UUID AS $$
DECLARE
    v_transfer_id UUID;
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
    v_my_role TEXT;
    v_my_branch UUID;
BEGIN
    -- Permission Check: User must be super admin, inventory manager, or a manager/staff of the source branch
    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        v_my_role != 'inventory_manager' AND 
        v_my_branch != p_source_branch_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You are not authorized to send stock from this branch.';
    END IF;

    -- Loop and validate stock at source first
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID AS item_id, (value->>'quantity_base_unit')::NUMERIC AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = p_source_branch_id AND item_id = r_item.item_id;

        IF v_bal < r_item.qty THEN
            SELECT item_name INTO v_name FROM public.inventory_items WHERE id = r_item.item_id;
            RAISE EXCEPTION 'Source branch has insufficient stock for item %: required %, available %', v_name, r_item.qty, v_bal;
        END IF;
    END LOOP;

    -- Create transfer request directly in 'approved' status (meaning In Transit / Dispatched)
    INSERT INTO public.transfer_requests (source_branch_id, target_branch_id, status, requested_by, approved_by, reviewed_by)
    VALUES (p_source_branch_id, p_target_branch_id, 'approved', auth.uid(), auth.uid(), auth.uid())
    RETURNING id INTO v_transfer_id;

    -- Loop items to deduct stock, log movement, and insert into transfer_items
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID AS item_id, (value->>'quantity_base_unit')::NUMERIC AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Insert into transfer_items
        INSERT INTO public.transfer_items (transfer_id, item_id, quantity_base_unit)
        VALUES (v_transfer_id, r_item.item_id, r_item.qty);

        -- Deduct from Source
        UPDATE public.inventory_balances
        SET quantity = quantity - r_item.qty, updated_at = now()
        WHERE branch_id = p_source_branch_id AND item_id = r_item.item_id;

        -- Record movement: transfer_out on source
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (p_source_branch_id, r_item.item_id, -r_item.qty, 'transfer_out', v_transfer_id, 'transfer', auth.uid());

        -- Check low stock alerts
        PERFORM public.fn_check_low_stock(p_source_branch_id, r_item.item_id);
    END LOOP;

    -- Create notification for target branch
    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        p_target_branch_id,
        'system',
        'New stock shipment in transit from ' || (SELECT name FROM public.branches WHERE id = p_source_branch_id)
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_SEND',
        'Transfers',
        NULL,
        json_build_object('transfer_id', v_transfer_id, 'source', p_source_branch_id, 'target', p_target_branch_id)::jsonb
    );

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. New fn_receive_transfer for target branch receiving confirmation
CREATE OR REPLACE FUNCTION public.fn_receive_transfer(
    p_transfer_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_source UUID;
    v_target UUID;
    v_status TEXT;
    r_item RECORD;
    v_my_role TEXT;
    v_my_branch UUID;
BEGIN
    -- Get transfer details
    SELECT source_branch_id, target_branch_id, status INTO v_source, v_target, v_status 
    FROM public.transfer_requests 
    WHERE id = p_transfer_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;

    IF v_status != 'approved' THEN
        RAISE EXCEPTION 'Transfer is not in approved/in-transit status.';
    END IF;

    -- Check permissions: receiver must belong to the target branch, or be super admin / inventory manager
    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();
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
