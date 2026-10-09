-- Migration: Add Packaging Units & Pack Breakdown to Transfers
-- Created: 2026-10-09
-- Description: Allows transfers to record packaging breakdown (e.g. 10 packs x 5 pcs) while preserving base pcs accounting for recipes and inventory balances.

-- 1. Add packaging breakdown columns to transfer_items
ALTER TABLE public.transfer_items 
    ADD COLUMN IF NOT EXISTS packaging_unit TEXT DEFAULT 'pc',
    ADD COLUMN IF NOT EXISTS package_count NUMERIC,
    ADD COLUMN IF NOT EXISTS pieces_per_pack NUMERIC;

-- 2. Update fn_request_transfer to record packaging metadata
CREATE OR REPLACE FUNCTION public.fn_request_transfer(
    p_source_branch_id UUID,
    p_target_branch_id UUID,
    p_items JSONB -- Array of { "item_id": "...", "quantity_base_unit": X, "packaging_unit": "...", "package_count": Y, "pieces_per_pack": Z }
)
RETURNS UUID AS $$
DECLARE
    v_transfer_id UUID;
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
    v_min_transfer_qty NUMERIC;
    v_unit TEXT;
BEGIN
    -- Loop and validate optional min transfer qty
    FOR r_item IN (
        SELECT 
            (value->>'item_id')::UUID AS item_id, 
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch item details
        SELECT item_name, base_unit, min_transfer_qty
        INTO v_name, v_unit, v_min_transfer_qty
        FROM public.inventory_items
        WHERE id = r_item.item_id;

        -- Minimum quantity check (only if min_transfer_qty is set and > 0)
        IF v_min_transfer_qty IS NOT NULL AND v_min_transfer_qty > 0 AND r_item.qty < v_min_transfer_qty THEN
            RAISE EXCEPTION 'Item % requires a minimum transfer/request quantity of % %', v_name, v_min_transfer_qty, v_unit;
        END IF;
    END LOOP;

    -- Create transfer request
    INSERT INTO public.transfer_requests (source_branch_id, target_branch_id, status, requested_by)
    VALUES (p_source_branch_id, p_target_branch_id, 'requested', auth.uid())
    RETURNING id INTO v_transfer_id;

    -- Insert transfer items with packaging metadata
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
    END LOOP;

    -- Create notification for target branch
    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        p_target_branch_id,
        'transfer_pending',
        'New transfer request pending approval from ' || (SELECT name FROM public.branches WHERE id = p_source_branch_id)
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_REQUEST',
        'Transfers',
        NULL,
        json_build_object('transfer_id', v_transfer_id, 'source', p_source_branch_id, 'target', p_target_branch_id)::jsonb
    );

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_request_transfer(UUID, UUID, JSONB) TO authenticated;


-- 3. Update fn_send_transfer (proactive transfer) to record packaging metadata
CREATE OR REPLACE FUNCTION public.fn_send_transfer(
    p_source_branch_id UUID,
    p_target_branch_id UUID,
    p_items JSONB -- Array of { "item_id": "...", "quantity_base_unit": X, "packaging_unit": "...", "package_count": Y, "pieces_per_pack": Z }
)
RETURNS UUID AS $$
DECLARE
    v_transfer_id UUID;
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
    v_min_transfer_qty NUMERIC;
    v_unit TEXT;
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

    -- Loop and validate optional min transfer qty & stock at source
    FOR r_item IN (
        SELECT 
            (value->>'item_id')::UUID AS item_id, 
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch item details
        SELECT item_name, base_unit, min_transfer_qty
        INTO v_name, v_unit, v_min_transfer_qty
        FROM public.inventory_items
        WHERE id = r_item.item_id;

        -- Minimum quantity check (only if min_transfer_qty is set and > 0)
        IF v_min_transfer_qty IS NOT NULL AND v_min_transfer_qty > 0 AND r_item.qty < v_min_transfer_qty THEN
            RAISE EXCEPTION 'Item % requires a minimum transfer/request quantity of % %', v_name, v_min_transfer_qty, v_unit;
        END IF;

        -- Stock availability check
        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = p_source_branch_id AND item_id = r_item.item_id;

        IF v_bal < r_item.qty THEN
            RAISE EXCEPTION 'Source branch has insufficient stock for item %: required %, available %', v_name, r_item.qty, v_bal;
        END IF;
    END LOOP;

    -- Create transfer request directly in 'approved' status (meaning In Transit / Dispatched)
    INSERT INTO public.transfer_requests (source_branch_id, target_branch_id, status, requested_by, approved_by, reviewed_by)
    VALUES (p_source_branch_id, p_target_branch_id, 'approved', auth.uid(), auth.uid(), auth.uid())
    RETURNING id INTO v_transfer_id;

    -- Loop items to deduct stock, log movement, and insert into transfer_items
    FOR r_item IN (
        SELECT 
            (value->>'item_id')::UUID AS item_id, 
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Insert into transfer_items
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
        'transfer_pending',
        'Stock dispatched to your branch from ' || (SELECT name FROM public.branches WHERE id = p_source_branch_id)
    );

    -- Audit log
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
