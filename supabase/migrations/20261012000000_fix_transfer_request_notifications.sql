-- Route transfer request approval notifications to the branch supplying stock.
-- In a request, source_branch_id is the approver/dispatcher and target_branch_id
-- is the requesting/receiving branch.

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
BEGIN
    -- Preserve the existing optional minimum transfer quantity validation.
    FOR r_item IN (
        SELECT
            (value->>'item_id')::UUID AS item_id,
            (value->>'quantity_base_unit')::NUMERIC AS qty,
            COALESCE(value->>'packaging_unit', 'pc')::TEXT AS pkg_unit,
            (value->>'package_count')::NUMERIC AS pkg_count,
            (value->>'pieces_per_pack')::NUMERIC AS pcs_per_pkg
        FROM jsonb_array_elements(p_items)
    ) LOOP
        SELECT item_name, base_unit, min_transfer_qty
        INTO v_name, v_unit, v_min_transfer_qty
        FROM public.inventory_items
        WHERE id = r_item.item_id;

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
