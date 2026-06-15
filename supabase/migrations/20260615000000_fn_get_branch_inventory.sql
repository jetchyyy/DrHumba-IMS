-- Migration: fn_get_branch_inventory and fn_request_transfer stock check
-- Created: 2026-06-15

-- 1. Helper function to fetch branch inventory balances bypass RLS
CREATE OR REPLACE FUNCTION public.fn_get_branch_inventory(
    p_branch_id UUID
)
RETURNS TABLE (
    item_id UUID,
    quantity NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT ib.item_id, COALESCE(ib.quantity, 0) AS quantity
    FROM public.inventory_balances ib
    WHERE ib.branch_id = p_branch_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_get_branch_inventory(UUID) TO authenticated;

-- 2. Redefine fn_request_transfer to include validation of source branch inventory balances
CREATE OR REPLACE FUNCTION public.fn_request_transfer(
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
BEGIN
    -- Loop and validate stock at source first to ensure requests cannot exceed current inventory
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

    -- Create transfer request
    INSERT INTO public.transfer_requests (source_branch_id, target_branch_id, status, requested_by)
    VALUES (p_source_branch_id, p_target_branch_id, 'requested', auth.uid())
    RETURNING id INTO v_transfer_id;

    -- Insert transfer items
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID AS item_id, (value->>'quantity_base_unit')::NUMERIC AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        INSERT INTO public.transfer_items (transfer_id, item_id, quantity_base_unit)
        VALUES (v_transfer_id, r_item.item_id, r_item.qty);
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
