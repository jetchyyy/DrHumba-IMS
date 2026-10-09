-- Migration: Add Packaging Breakdown & Transparency to Portioning Requests
-- Created: 2026-10-09
-- Description: Adds packaging unit metadata (package count and pieces per pack) to portioning_requests for 100% operational transparency.

-- 1. Add packaging breakdown columns to portioning_requests
ALTER TABLE public.portioning_requests 
    ADD COLUMN IF NOT EXISTS packaging_unit TEXT DEFAULT 'pc',
    ADD COLUMN IF NOT EXISTS package_count NUMERIC,
    ADD COLUMN IF NOT EXISTS pieces_per_pack NUMERIC;

-- 2. Update fn_approve_portioning_request to include packaging metadata in audit log
CREATE OR REPLACE FUNCTION public.fn_approve_portioning_request(
    p_request_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_status TEXT;
    v_branch_id UUID;
    v_source_item_id UUID;
    v_source_qty NUMERIC;
    v_target_item_id UUID;
    v_target_qty NUMERIC;
    v_pkg_unit TEXT;
    v_pkg_count NUMERIC;
    v_pcs_per_pkg NUMERIC;
    v_tenant_id UUID;
    v_source_balance NUMERIC;
    v_source_cost NUMERIC;
    v_unit_cost NUMERIC;
    v_my_role TEXT;
    v_source_name TEXT;
    v_target_name TEXT;
BEGIN
    -- Check role permissions
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR v_my_role NOT IN ('super_admin', 'inventory_manager', 'branch_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only Managers and Admins can approve portioning requests.';
    END IF;

    -- Fetch request details
    SELECT status, branch_id, source_item_id, source_quantity, target_item_id, target_quantity, 
           COALESCE(packaging_unit, 'pc'), package_count, pieces_per_pack, tenant_id
    INTO v_status, v_branch_id, v_source_item_id, v_source_qty, v_target_item_id, v_target_qty,
         v_pkg_unit, v_pkg_count, v_pcs_per_pkg, v_tenant_id
    FROM public.portioning_requests
    WHERE id = p_request_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Portioning request not found.';
    END IF;

    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Portioning request has already been processed.';
    END IF;

    -- Check source item stock balance
    SELECT COALESCE(quantity, 0) INTO v_source_balance
    FROM public.inventory_balances
    WHERE branch_id = v_branch_id AND item_id = v_source_item_id;

    IF v_source_balance < v_source_qty THEN
        RAISE EXCEPTION 'Insufficient inventory balance for source raw item. Available: %, Requested: %', v_source_balance, v_source_qty;
    END IF;

    -- Fetch source item cost per unit & names
    SELECT item_name, cost_per_base_unit INTO v_source_name, v_source_cost
    FROM public.inventory_items WHERE id = v_source_item_id;

    SELECT item_name INTO v_target_name
    FROM public.inventory_items WHERE id = v_target_item_id;

    -- Calculate unit cost for target portioned item (Total cost of source consumed / target pcs)
    IF v_target_qty > 0 AND v_source_cost IS NOT NULL AND v_source_cost > 0 THEN
        v_unit_cost := (v_source_qty * v_source_cost) / v_target_qty;
        UPDATE public.inventory_items
        SET cost_per_base_unit = v_unit_cost,
            updated_at = now()
        WHERE id = v_target_item_id;
    END IF;

    -- 1. Deduct source item stock
    UPDATE public.inventory_balances
    SET quantity = quantity - v_source_qty,
        updated_at = now()
    WHERE branch_id = v_branch_id AND item_id = v_source_item_id;

    -- 2. Add target item stock
    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
    VALUES (v_branch_id, v_target_item_id, v_target_qty, now())
    ON CONFLICT (branch_id, item_id)
    DO UPDATE SET quantity = public.inventory_balances.quantity + v_target_qty, updated_at = now();

    -- 3. Log stock movements
    -- Source deduction movement
    INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
    VALUES (v_branch_id, v_source_item_id, -v_source_qty, 'portioning_out', p_request_id, 'portioning', auth.uid(), v_tenant_id);

    -- Target yield movement
    INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
    VALUES (v_branch_id, v_target_item_id, v_target_qty, 'portioning_in', p_request_id, 'portioning', auth.uid(), v_tenant_id);

    -- 4. Mark request approved
    UPDATE public.portioning_requests
    SET status = 'approved',
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    -- 5. Audit log entry
    INSERT INTO public.audit_logs (user_id, action, module, new_value, tenant_id)
    VALUES (
        auth.uid(),
        'APPROVE_PORTIONING_REQUEST',
        'portioning',
        jsonb_build_object(
            'request_id', p_request_id,
            'source_item', v_source_name,
            'source_qty', v_source_qty,
            'target_item', v_target_name,
            'target_qty', v_target_qty,
            'packaging_unit', v_pkg_unit,
            'package_count', v_pkg_count,
            'pieces_per_pack', v_pcs_per_pkg,
            'unit_cost', v_unit_cost
        ),
        v_tenant_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
