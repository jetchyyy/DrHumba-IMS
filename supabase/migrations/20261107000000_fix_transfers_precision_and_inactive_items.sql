-- Migration: Fix floating point precision in inventory balances and enforce active status / branch availability in transfers
-- Description:
-- 1. Cleans existing inventory balances with floating-point residue (e.g. 2e-14) and adds a trigger to automatically snap |quantity| < 0.0001 to 0 and round to 4 decimals.
-- 2. Updates fn_request_transfer to reject inactive items and items not available for the target branch.
-- 3. Updates fn_send_transfer to reject inactive items and items not available for the target branch.
-- 4. Updates fn_approve_transfer to reject approving inactive items unless excluded.

-- 1. Inventory Balances Floating-point Cleanup Trigger
CREATE OR REPLACE FUNCTION public.tg_fn_clean_inventory_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF ABS(NEW.quantity) < 0.0001 THEN
        NEW.quantity := 0;
    ELSE
        NEW.quantity := ROUND(NEW.quantity, 4);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_clean_inventory_balance ON public.inventory_balances;
CREATE TRIGGER tg_clean_inventory_balance
    BEFORE INSERT OR UPDATE ON public.inventory_balances
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_fn_clean_inventory_balance();

-- Clean existing residue in inventory_balances
UPDATE public.inventory_balances
SET quantity = 0
WHERE ABS(quantity) < 0.0001 AND quantity != 0;

UPDATE public.inventory_balances
SET quantity = ROUND(quantity, 4)
WHERE ABS(quantity) >= 0.0001 AND quantity != ROUND(quantity, 4);

-- 2. fn_request_transfer with strict active status & branch availability validation
CREATE OR REPLACE FUNCTION public.fn_request_transfer(
    p_source_branch_id UUID,
    p_target_branch_id UUID,
    p_items JSONB
)
RETURNS UUID AS $$
DECLARE
    v_transfer_id UUID;
    r_item RECORD;
    v_name TEXT;
    v_min_transfer_qty NUMERIC;
    v_unit TEXT;
    v_status TEXT;
    v_avail_branches UUID[];
BEGIN
    -- Validate every item before creating the request
    FOR r_item IN (
        SELECT
            (value->>'item_id')::UUID AS item_id,
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT item_name, base_unit, min_transfer_qty, status, available_branches
        INTO v_name, v_unit, v_min_transfer_qty, v_status, v_avail_branches
        FROM public.inventory_items
        WHERE id = r_item.item_id;

        IF v_name IS NULL THEN
            RAISE EXCEPTION 'Item not found in inventory.';
        END IF;

        IF v_status != 'active' THEN
            RAISE EXCEPTION 'Cannot request "%": this item is inactive or discontinued.', v_name;
        END IF;

        IF v_avail_branches IS NOT NULL AND array_length(v_avail_branches, 1) > 0 THEN
            IF NOT (p_target_branch_id = ANY(v_avail_branches)) THEN
                RAISE EXCEPTION 'Cannot request "%": this item is not assigned to the destination branch.', v_name;
            END IF;
        END IF;

        IF v_min_transfer_qty IS NOT NULL
           AND v_min_transfer_qty > 0
           AND r_item.qty < v_min_transfer_qty THEN
            RAISE EXCEPTION 'Item % requires a minimum transfer/request quantity of % %',
                v_name, v_min_transfer_qty, v_unit;
        END IF;
    END LOOP;

    INSERT INTO public.transfer_requests (
        source_branch_id,
        target_branch_id,
        status,
        requested_by
    )
    VALUES (
        p_source_branch_id,
        p_target_branch_id,
        'requested',
        auth.uid()
    )
    RETURNING id INTO v_transfer_id;

    FOR r_item IN (
        SELECT
            (value->>'item_id')::UUID AS item_id,
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        INSERT INTO public.transfer_items (
            transfer_id,
            item_id,
            quantity_base_unit,
            original_quantity_base_unit,
            packaging_unit,
            package_count,
            pieces_per_pack
        )
        VALUES (
            v_transfer_id,
            r_item.item_id,
            r_item.qty,
            r_item.qty,
            r_item.pkg_unit,
            r_item.pkg_count,
            r_item.pcs_per_pkg
        );
    END LOOP;

    -- Notify the source branch because it must approve and dispatch the request.
    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        p_source_branch_id,
        'transfer_pending',
        'New transfer request from ' || COALESCE(
            (SELECT name FROM public.branches WHERE id = p_target_branch_id),
            'another branch'
        ) || ' pending your approval'
    );

    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_REQUEST',
        'Transfers',
        NULL,
        json_build_object(
            'transfer_id', v_transfer_id,
            'items_count', jsonb_array_length(p_items)
        )::jsonb
    );

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_request_transfer(UUID, UUID, JSONB) TO authenticated;

-- 3. fn_send_transfer with strict active status & branch availability validation
CREATE OR REPLACE FUNCTION public.fn_send_transfer(
    p_source_branch_id UUID,
    p_target_branch_id UUID,
    p_items JSONB
)
RETURNS UUID AS $$
DECLARE
    v_transfer_id UUID;
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
    v_min_transfer_qty NUMERIC;
    v_unit TEXT;
    v_status TEXT;
    v_avail_branches UUID[];
    v_my_role TEXT;
    v_my_branch UUID;
BEGIN
    SELECT role_name, branch_id INTO v_my_role, v_my_branch FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR (
        v_my_role != 'super_admin' AND 
        v_my_role != 'inventory_manager' AND 
        v_my_branch != p_source_branch_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You are not authorized to send stock from this branch.';
    END IF;

    FOR r_item IN (
        SELECT 
            (value->>'item_id')::UUID AS item_id, 
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT item_name, base_unit, min_transfer_qty, status, available_branches
        INTO v_name, v_unit, v_min_transfer_qty, v_status, v_avail_branches
        FROM public.inventory_items
        WHERE id = r_item.item_id;

        IF v_name IS NULL THEN
            RAISE EXCEPTION 'Item not found in inventory.';
        END IF;

        IF v_status != 'active' THEN
            RAISE EXCEPTION 'Cannot dispatch "%": this item is inactive or discontinued.', v_name;
        END IF;

        IF v_avail_branches IS NOT NULL AND array_length(v_avail_branches, 1) > 0 THEN
            IF NOT (p_target_branch_id = ANY(v_avail_branches)) THEN
                RAISE EXCEPTION 'Cannot dispatch "%": this item is not assigned to destination branch.', v_name;
            END IF;
        END IF;

        IF v_min_transfer_qty IS NOT NULL AND v_min_transfer_qty > 0 AND r_item.qty < v_min_transfer_qty THEN
            RAISE EXCEPTION 'Item % requires a minimum transfer/request quantity of % %', v_name, v_min_transfer_qty, v_unit;
        END IF;

        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = p_source_branch_id AND item_id = r_item.item_id;

        IF v_bal < r_item.qty THEN
            RAISE EXCEPTION 'Source branch has insufficient stock for item %: required %, available %', v_name, r_item.qty, v_bal;
        END IF;
    END LOOP;

    INSERT INTO public.transfer_requests (source_branch_id, target_branch_id, status, requested_by, approved_by, reviewed_by)
    VALUES (p_source_branch_id, p_target_branch_id, 'approved', auth.uid(), auth.uid(), auth.uid())
    RETURNING id INTO v_transfer_id;

    FOR r_item IN (
        SELECT 
            (value->>'item_id')::UUID AS item_id, 
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        INSERT INTO public.transfer_items (
            transfer_id, 
            item_id, 
            quantity_base_unit, 
            packaging_unit, 
            package_count, 
            pieces_per_pack
        )
        VALUES (
            v_transfer_id, 
            r_item.item_id, 
            r_item.qty, 
            r_item.pkg_unit, 
            r_item.pkg_count, 
            r_item.pcs_per_pkg
        );

        UPDATE public.inventory_balances
        SET quantity = quantity - r_item.qty, updated_at = now()
        WHERE branch_id = p_source_branch_id AND item_id = r_item.item_id;

        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (p_source_branch_id, r_item.item_id, -r_item.qty, 'transfer_out', v_transfer_id, 'transfer', auth.uid());

        PERFORM public.fn_check_low_stock(p_source_branch_id, r_item.item_id);
    END LOOP;

    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        p_target_branch_id,
        'transfer_pending',
        'Stock dispatched to your branch from ' || (SELECT name FROM public.branches WHERE id = p_source_branch_id)
    );

    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_DISPATCH',
        'Transfers',
        NULL,
        json_build_object('transfer_id', v_transfer_id, 'source', p_source_branch_id, 'target', p_target_branch_id)::jsonb
    );

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_send_transfer(UUID, UUID, JSONB) TO authenticated;

-- 4. fn_approve_transfer with inactive item check
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
    v_item_status TEXT;
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

    -- Validate active status and stock availability for all active items
    FOR r_item IN (
        SELECT item_id, quantity_base_unit 
        FROM public.transfer_items 
        WHERE transfer_id = p_transfer_id
          AND COALESCE(is_rejected, FALSE) = FALSE
          AND COALESCE(quantity_base_unit, 0) > 0
    ) LOOP
        SELECT item_name, status INTO v_name, v_item_status 
        FROM public.inventory_items WHERE id = r_item.item_id;

        IF v_item_status != 'active' THEN
            RAISE EXCEPTION 'Cannot approve transfer: item "%" is inactive. Please exclude or reject this item before approving.', v_name;
        END IF;

        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        IF v_bal < r_item.quantity_base_unit THEN
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
        UPDATE public.inventory_balances
        SET quantity = quantity - r_item.quantity_base_unit, updated_at = now()
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_source, r_item.item_id, -r_item.quantity_base_unit, 'transfer_out', p_transfer_id, 'transfer', auth.uid());

        PERFORM public.fn_check_low_stock(v_source, r_item.item_id);
    END LOOP;

    UPDATE public.transfer_requests
    SET status = 'approved', approved_by = auth.uid(), reviewed_by = auth.uid(), updated_at = now()
    WHERE id = p_transfer_id;

    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        v_target,
        'system',
        'Stock shipment for transfer request ' || p_transfer_id || ' is in transit.'
    );

    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_APPROVE',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'approved_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_approve_transfer(UUID) TO authenticated;

