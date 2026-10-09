-- Migration: Transfer Approval Item Modifications & Requested Qty Transparency
-- Created: 2026-10-09
-- Description: Adds original_quantity_base_unit to transfer_items to allow dispatchers/approvers to modify dispatched quantities or remove items, while maintaining full transparency of what was originally requested vs approved.

-- 1. Add original_quantity_base_unit column to transfer_items
ALTER TABLE public.transfer_items 
    ADD COLUMN IF NOT EXISTS original_quantity_base_unit NUMERIC;

-- Backfill original_quantity_base_unit for existing rows
UPDATE public.transfer_items 
SET original_quantity_base_unit = quantity_base_unit 
WHERE original_quantity_base_unit IS NULL;

-- 2. Update fn_request_transfer to record original_quantity_base_unit
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

    -- Insert transfer items with packaging metadata and original requested quantity
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
        json_build_object('transfer_id', v_transfer_id, 'items_count', jsonb_array_length(p_items))::jsonb
    );

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
