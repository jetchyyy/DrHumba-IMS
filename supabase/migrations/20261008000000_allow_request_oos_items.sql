-- Migration: Allow requesting Out-Of-Stock (OOS) items
-- Description: Removes the stock availability validation from fn_request_transfer so branches can request items even if the warehouse is currently out of stock.

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
    v_min_transfer_qty NUMERIC;
    v_unit TEXT;
BEGIN
    -- Loop and validate optional min transfer qty
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID AS item_id, (value->>'quantity_base_unit')::NUMERIC AS qty
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

        -- We purposely do NOT block the request if the source has insufficient stock
        -- so branches can submit requests for out of stock items.
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
