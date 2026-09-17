-- Migration: Add optional minimum transfer/request quantity to inventory_items and validate in transfer RPCs
-- Created: 2026-09-18

-- 1. Add optional min_transfer_qty column to inventory_items (nullable, defaults to NULL)
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS min_transfer_qty NUMERIC CHECK (min_transfer_qty >= 0);

-- 2. Update fn_create_inventory_item to accept optional p_min_transfer_qty
CREATE OR REPLACE FUNCTION public.fn_create_inventory_item(
    p_sku TEXT,
    p_item_name TEXT,
    p_category TEXT,
    p_base_unit TEXT,
    p_purchase_unit TEXT,
    p_conversion_factor NUMERIC,
    p_reorder_level NUMERIC,
    p_cost_per_base_unit NUMERIC,
    p_initial_quantity NUMERIC,
    p_branch_id UUID,
    p_created_by UUID,
    p_selling_price NUMERIC DEFAULT NULL,
    p_available_branches UUID[] DEFAULT NULL,
    p_foodpanda_price NUMERIC DEFAULT NULL,
    p_grab_price NUMERIC DEFAULT NULL,
    p_min_transfer_qty NUMERIC DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_item_id UUID;
    v_my_role TEXT;
BEGIN
    -- Security check
    SELECT COALESCE(
        (SELECT role_name FROM public.profiles WHERE id = p_created_by),
        'none'
    ) INTO v_my_role;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins or inventory managers can create catalog items.';
    END IF;

    -- Insert into inventory_items
    INSERT INTO public.inventory_items (
        sku, item_name, category, base_unit, purchase_unit,
        conversion_factor, reorder_level, cost_per_base_unit, status, selling_price, available_branches, foodpanda_price, grab_price, min_transfer_qty
    )
    VALUES (
        p_sku, p_item_name, p_category, p_base_unit, p_purchase_unit,
        p_conversion_factor, p_reorder_level, p_cost_per_base_unit, 'active', p_selling_price, p_available_branches, p_foodpanda_price, p_grab_price, p_min_transfer_qty
    )
    RETURNING id INTO v_item_id;

    -- Initial balance
    IF p_initial_quantity > 0 AND p_branch_id IS NOT NULL THEN
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
        VALUES (p_branch_id, v_item_id, p_initial_quantity, now())
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + p_initial_quantity, updated_at = now();

        INSERT INTO public.inventory_movements (
            branch_id, item_id, quantity, movement_type, created_by
        )
        VALUES (
            p_branch_id, v_item_id, p_initial_quantity, 'stock_in', p_created_by
        );
        
        INSERT INTO public.audit_logs (user_id, action, module, new_value)
        VALUES (
            p_created_by,
            'CREATE_WITH_STOCK',
            'inventory',
            json_build_object('item_id', v_item_id, 'sku', p_sku, 'name', p_item_name, 'initial_qty', p_initial_quantity, 'branch_id', p_branch_id)
        );
    ELSE
        INSERT INTO public.audit_logs (user_id, action, module, new_value)
        VALUES (
            p_created_by,
            'CREATE',
            'inventory',
            json_build_object('item_id', v_item_id, 'sku', p_sku, 'name', p_item_name)
        );
    END IF;

    RETURN v_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Update fn_request_transfer to validate minimum transfer/request quantity if configured
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
    -- Loop and validate optional min transfer qty & stock at source
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

        -- Stock availability check at source
        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = p_source_branch_id AND item_id = r_item.item_id;

        IF v_bal < r_item.qty THEN
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


-- 4. Update fn_send_transfer to validate optional minimum transfer/request quantity
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

GRANT EXECUTE ON FUNCTION public.fn_send_transfer(UUID, UUID, JSONB) TO authenticated;
