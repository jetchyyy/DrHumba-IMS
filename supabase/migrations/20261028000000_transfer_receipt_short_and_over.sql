-- ============================================================
-- MIGRATION: Transfer receipt discrepancies — short AND over
-- The receiving branch declares the arrived qty (less or more than dispatched)
-- with a reason. An admin approves (optionally editing the qty) or rejects.
-- On approval the final qty is what leaves the source and lands in the target:
--   * short: the undelivered difference is returned to the source branch
--   * over:  the extra is deducted from the source branch (blocked if the source
--            does not have enough stock)
-- Rejection is unchanged: the transfer goes back to in-transit for a recount.
-- ============================================================

-- 1. Receiving branch submits arrived quantities (short or over)
CREATE OR REPLACE FUNCTION public.fn_submit_transfer_receipt(
    p_transfer_id UUID,
    p_items JSONB
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
    v_tenant_id UUID;
    v_item_name TEXT;
    v_dispatched_qty NUMERIC;
    v_short_count INT := 0;
    v_over_count INT := 0;
    v_control TEXT;
BEGIN
    SELECT source_branch_id, target_branch_id, status, requested_by, approved_by, tenant_id,
           COALESCE(control_number, id::text)
    INTO v_source, v_target, v_status, v_requested_by, v_approved_by, v_tenant_id, v_control
    FROM public.transfer_requests
    WHERE id = p_transfer_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;

    IF v_status != 'approved' THEN
        RAISE EXCEPTION 'Transfer is not in approved/in-transit status.';
    END IF;

    SELECT role_name, branch_id, allowed_tabs
    INTO v_my_role, v_my_branch, v_my_allowed_tabs
    FROM public.profiles
    WHERE id = auth.uid();

    -- The person confirming must NOT be the sender/approver (super_admin and platform_admin exempt)
    IF v_my_role != 'super_admin' AND NOT public.is_platform_admin() AND auth.uid() = v_approved_by THEN
        RAISE EXCEPTION 'Unauthorized: The sender/approver of this transfer request cannot confirm receipt of items.';
    END IF;

    -- The person confirming must NOT belong to the source branch (super_admin and platform_admin exempt)
    IF v_my_role != 'super_admin' AND NOT public.is_platform_admin() AND v_my_branch = v_source THEN
        RAISE EXCEPTION 'Unauthorized: Source branch/warehouse staff are not allowed to confirm receipt of items.';
    END IF;

    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND
        NOT public.is_platform_admin() AND
        v_my_role != 'inventory_manager' AND
        v_my_branch != v_target AND
        NOT ('transfers' = ANY(COALESCE(v_my_allowed_tabs, ARRAY[]::TEXT[])))
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You are not authorized to confirm receipt for this branch.';
    END IF;

    FOR r_item IN (
        SELECT (value->>'item_id')::UUID AS item_id,
               (value->>'received_quantity_base_unit')::NUMERIC AS received_qty,
               (value->>'missing_reason')::TEXT AS reason
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT quantity_base_unit INTO v_dispatched_qty
        FROM public.transfer_items
        WHERE transfer_id = p_transfer_id AND item_id = r_item.item_id;

        IF v_dispatched_qty IS NULL THEN
            RAISE EXCEPTION 'Item not found in transfer.';
        END IF;

        SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = r_item.item_id;

        IF r_item.received_qty IS NULL OR r_item.received_qty < 0 THEN
            RAISE EXCEPTION 'Arrived quantity for % must be zero or more.', v_item_name;
        END IF;

        IF r_item.received_qty != v_dispatched_qty THEN
            IF r_item.reason IS NULL OR trim(r_item.reason) = '' THEN
                RAISE EXCEPTION 'A reason is required for the % quantity of %.',
                    CASE WHEN r_item.received_qty < v_dispatched_qty THEN 'missing' ELSE 'extra' END,
                    v_item_name;
            END IF;

            IF r_item.received_qty < v_dispatched_qty THEN
                v_short_count := v_short_count + 1;
            ELSE
                v_over_count := v_over_count + 1;
            END IF;
        END IF;

        UPDATE public.transfer_items
        SET received_quantity_base_unit = r_item.received_qty,
            missing_reason = CASE WHEN r_item.received_qty != quantity_base_unit THEN trim(r_item.reason) ELSE NULL END
        WHERE transfer_id = p_transfer_id AND item_id = r_item.item_id;
    END LOOP;

    UPDATE public.transfer_requests
    SET status = 'pending_receipt_approval',
        receipt_requested_by = auth.uid(),
        updated_at = now()
    WHERE id = p_transfer_id;

    -- Alert both branches; admins see it through the pending approvals badge
    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    SELECT b, 'system',
        'DISCREPANCY ALERT: Delivery receipt for transfer ' || v_control || ' reports ' ||
        concat_ws(' and ',
            CASE WHEN v_short_count > 0 THEN v_short_count || ' short item(s)' END,
            CASE WHEN v_over_count > 0 THEN v_over_count || ' over item(s)' END) ||
        ' and is awaiting admin approval.',
        v_tenant_id
    FROM unnest(ARRAY[v_source, v_target]) AS b;

    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_RECEIPT_SUBMIT',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'submitted_by', auth.uid(),
                          'short_items', v_short_count, 'over_items', v_over_count)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_submit_transfer_receipt(UUID, JSONB) TO authenticated;


-- 2. Admin approves the receipt, optionally correcting the arrived quantities.
--    p_items: [{ "item_id": "...", "approved_quantity_base_unit": N }] (optional)
DROP FUNCTION IF EXISTS public.fn_approve_transfer_receipt(UUID);

CREATE OR REPLACE FUNCTION public.fn_approve_transfer_receipt(
    p_transfer_id UUID,
    p_items JSONB DEFAULT NULL
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
    v_control TEXT;
    v_bal NUMERIC;
    v_diff NUMERIC;
BEGIN
    SELECT source_branch_id, target_branch_id, status, receipt_requested_by, tenant_id,
           COALESCE(control_number, id::text)
    INTO v_source, v_target, v_status, v_receipt_requested_by, v_tenant_id, v_control
    FROM public.transfer_requests
    WHERE id = p_transfer_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer not found.';
    END IF;

    IF v_status != 'pending_receipt_approval' THEN
        RAISE EXCEPTION 'Transfer receipt is not in pending approval status.';
    END IF;

    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();

    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND
        NOT public.is_platform_admin() AND
        v_my_role != 'inventory_manager'
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only Super Admins and Inventory Managers are allowed to approve transfer discrepancies.';
    END IF;

    -- Admin corrections to the declared arrived quantities
    IF p_items IS NOT NULL THEN
        FOR r_item IN (
            SELECT (value->>'item_id')::UUID AS item_id,
                   (value->>'approved_quantity_base_unit')::NUMERIC AS qty
            FROM jsonb_array_elements(p_items)
        ) LOOP
            IF r_item.qty IS NULL OR r_item.qty < 0 THEN
                RAISE EXCEPTION 'Approved quantity must be zero or more.';
            END IF;

            UPDATE public.transfer_items
            SET received_quantity_base_unit = r_item.qty
            WHERE transfer_id = p_transfer_id
              AND item_id = r_item.item_id
              AND COALESCE(is_rejected, FALSE) = FALSE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Item not found in transfer.';
            END IF;
        END LOOP;
    END IF;

    -- Over items: the source must be able to cover the extra before anything moves
    FOR r_item IN (
        SELECT ti.item_id, i.item_name,
               COALESCE(ti.received_quantity_base_unit, ti.quantity_base_unit) - ti.quantity_base_unit AS extra
        FROM public.transfer_items ti
        JOIN public.inventory_items i ON i.id = ti.item_id
        WHERE ti.transfer_id = p_transfer_id
          AND COALESCE(ti.is_rejected, FALSE) = FALSE
          AND COALESCE(ti.received_quantity_base_unit, ti.quantity_base_unit) > ti.quantity_base_unit
    ) LOOP
        SELECT COALESCE(quantity, 0) INTO v_bal
        FROM public.inventory_balances
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        IF COALESCE(v_bal, 0) < r_item.extra THEN
            RAISE EXCEPTION 'Source branch has insufficient stock to cover the extra % received: extra %, available %',
                r_item.item_name, r_item.extra, COALESCE(v_bal, 0);
        END IF;
    END LOOP;

    FOR r_item IN (
        SELECT item_id,
               quantity_base_unit AS dispatched_qty,
               COALESCE(received_quantity_base_unit, quantity_base_unit) AS final_qty
        FROM public.transfer_items
        WHERE transfer_id = p_transfer_id
          AND COALESCE(is_rejected, FALSE) = FALSE
    ) LOOP
        -- The dispatched qty already left the source; settle the difference so
        -- the source ends up deducted by exactly the final qty
        v_diff := r_item.final_qty - r_item.dispatched_qty;

        IF v_diff != 0 THEN
            UPDATE public.inventory_balances
            SET quantity = quantity - v_diff, updated_at = now()
            WHERE branch_id = v_source AND item_id = r_item.item_id;

            IF NOT FOUND THEN
                INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                VALUES (v_source, r_item.item_id, -v_diff, now(), v_tenant_id);
            END IF;

            INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES (v_source, r_item.item_id, -v_diff,
                    CASE WHEN v_diff > 0 THEN 'transfer_out' ELSE 'transfer_in' END,
                    p_transfer_id, 'transfer', auth.uid(), v_tenant_id);

            PERFORM public.fn_check_low_stock(v_source, r_item.item_id);
        END IF;

        IF r_item.final_qty > 0 THEN
            INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
            VALUES (v_target, r_item.item_id, r_item.final_qty, now(), v_tenant_id)
            ON CONFLICT (branch_id, item_id)
            DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.final_qty, updated_at = now();

            INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
            VALUES (v_target, r_item.item_id, r_item.final_qty, 'transfer_in', p_transfer_id, 'transfer', auth.uid(), v_tenant_id);
        END IF;
    END LOOP;

    -- Record the receipt in the target branch's stock receiving history
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
        v_control,
        CURRENT_DATE,
        COALESCE(v_receipt_requested_by, auth.uid()),
        v_target,
        'completed',
        v_tenant_id
    )
    RETURNING id INTO v_receipt_id;

    INSERT INTO public.stock_receipt_items (
        receipt_id,
        item_id,
        quantity_purchased,
        cost_per_purchase_unit,
        tenant_id
    )
    SELECT v_receipt_id,
           ti.item_id,
           ti.received_quantity_base_unit / i.conversion_factor,
           i.cost_per_base_unit * i.conversion_factor,
           v_tenant_id
    FROM public.transfer_items ti
    JOIN public.inventory_items i ON i.id = ti.item_id
    WHERE ti.transfer_id = p_transfer_id
      AND COALESCE(ti.is_rejected, FALSE) = FALSE
      AND COALESCE(ti.received_quantity_base_unit, 0) > 0;

    UPDATE public.transfer_requests
    SET status = 'completed',
        receipt_approved_by = auth.uid(),
        updated_at = now()
    WHERE id = p_transfer_id;

    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        v_source,
        'system',
        'Transfer ' || v_control || ' receipt discrepancy approved. Your stock was settled to the approved quantities.',
        v_tenant_id
    );

    INSERT INTO public.notifications (branch_id, type, message, tenant_id)
    VALUES (
        v_target,
        'system',
        'Admin approved transfer ' || v_control || ' delivery receipt. Approved quantities added to inventory.',
        v_tenant_id
    );

    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_RECEIPT_APPROVE',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'approved_by', auth.uid(),
                          'admin_overrides', p_items)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_approve_transfer_receipt(UUID, JSONB) TO authenticated;
