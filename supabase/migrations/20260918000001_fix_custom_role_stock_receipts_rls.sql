-- Migration: Fix Custom Role Stock Receipts RLS and Granular Staff Action Permissions
-- Created: 2026-09-18

-- 1. Ensure get_my_allowed_tabs() helper exists
CREATE OR REPLACE FUNCTION public.get_my_allowed_tabs()
RETURNS TEXT[] AS $$
    SELECT allowed_tabs FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.get_my_allowed_tabs() TO authenticated;

-- 2. Update Stock Receipts RLS Policies
DROP POLICY IF EXISTS "Write stock receipts" ON public.stock_receipts;
CREATE POLICY "Write stock receipts" ON public.stock_receipts FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() = branch_id OR
            'receiving' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
            'action_buttons' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]))
        )
    );

DROP POLICY IF EXISTS "Write stock receipt items" ON public.stock_receipt_items;
CREATE POLICY "Write stock receipt items" ON public.stock_receipt_items FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            EXISTS (
                SELECT 1 FROM public.stock_receipts r
                WHERE r.id = receipt_id AND (
                    public.get_my_role() IN ('super_admin', 'inventory_manager') OR
                    public.get_my_branch_id() = r.branch_id OR
                    'receiving' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
                    'action_buttons' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]))
                )
            )
        )
    );

-- 3. Update Inventory Items & Balances RLS for custom roles
DROP POLICY IF EXISTS "Write inventory items" ON public.inventory_items;
CREATE POLICY "Write inventory items" ON public.inventory_items FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            'inventory' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
            'action_buttons' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]))
        )
    );

DROP POLICY IF EXISTS "Write inventory balances (admin/manager)" ON public.inventory_balances;
CREATE POLICY "Write inventory balances (admin/manager)" ON public.inventory_balances FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() = branch_id OR
            'inventory' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
            'global-inventory' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
            'action_buttons' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]))
        )
    );

-- 4. Update Stock Adjustments RLS for custom roles
DROP POLICY IF EXISTS "Write adjustments" ON public.stock_adjustments;
CREATE POLICY "Write adjustments" ON public.stock_adjustments FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
            public.get_my_branch_id() = branch_id OR
            'adjustments' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
            'action_buttons' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]))
        )
    );

DROP POLICY IF EXISTS "Write adjustment items" ON public.stock_adjustment_items;
CREATE POLICY "Write adjustment items" ON public.stock_adjustment_items FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
            EXISTS (
                SELECT 1 FROM public.stock_adjustments a 
                WHERE a.id = adjustment_id AND (
                    public.get_my_role() IN ('super_admin', 'inventory_manager') OR
                    public.get_my_branch_id() = a.branch_id OR
                    'adjustments' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
                    'action_buttons' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]))
                )
            )
        )
    );

-- 5. Update fn_receive_stock to be SECURITY DEFINER with tenant isolation & permission checks
CREATE OR REPLACE FUNCTION public.fn_receive_stock(
    p_receipt_id UUID
)
RETURNS VOID AS $$
DECLARE
    r_item RECORD;
    v_branch_id UUID;
    v_status TEXT;
    v_conv NUMERIC;
    v_item_cost NUMERIC;
    v_tenant_id UUID;
    v_my_role TEXT;
    v_my_branch UUID;
    v_my_allowed_tabs TEXT[];
BEGIN
    -- Read receipt details
    SELECT branch_id, status, tenant_id INTO v_branch_id, v_status, v_tenant_id 
    FROM public.stock_receipts 
    WHERE id = p_receipt_id;
    
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stock receipt not found.';
    END IF;

    -- Tenant isolation check
    IF v_tenant_id != public.get_my_tenant_id() THEN
        RAISE EXCEPTION 'Unauthorized: Tenant mismatch.';
    END IF;
    
    IF v_status = 'completed' THEN
        RAISE EXCEPTION 'Stock receipt already processed.';
    END IF;

    -- Get profile details
    SELECT role_name, branch_id, allowed_tabs 
    INTO v_my_role, v_my_branch, v_my_allowed_tabs 
    FROM public.profiles 
    WHERE id = auth.uid();

    -- Check permissions: super_admin, inventory_manager, staff belonging to receipt branch, or having 'receiving' in allowed_tabs
    IF v_my_role IS NULL OR (
        v_my_role NOT IN ('super_admin', 'inventory_manager') AND
        v_my_branch != v_branch_id AND
        NOT ('receiving' = ANY(COALESCE(v_my_allowed_tabs, ARRAY[]::TEXT[]))) AND
        NOT ('action_buttons' = ANY(COALESCE(v_my_allowed_tabs, ARRAY[]::TEXT[])))
    ) THEN
        RAISE EXCEPTION 'Unauthorized: You do not have permission to receive stock for this branch.';
    END IF;

    -- Process each item
    FOR r_item IN (
        SELECT ri.item_id, ri.quantity_purchased, ri.cost_per_purchase_unit, i.conversion_factor 
        FROM public.stock_receipt_items ri
        JOIN public.inventory_items i ON i.id = ri.item_id
        WHERE ri.receipt_id = p_receipt_id
    ) LOOP
        v_conv := r_item.quantity_purchased * r_item.conversion_factor;
        v_item_cost := r_item.cost_per_purchase_unit / r_item.conversion_factor;

        -- Update Inventory Balance with tenant_id
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
        VALUES (v_branch_id, r_item.item_id, v_conv, now(), v_tenant_id)
        ON CONFLICT (branch_id, item_id) 
        DO UPDATE SET quantity = public.inventory_balances.quantity + v_conv, updated_at = now();

        -- Update cost per base unit in catalog
        UPDATE public.inventory_items
        SET cost_per_base_unit = v_item_cost, updated_at = now()
        WHERE id = r_item.item_id;

        -- Write movement ledger with tenant_id
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
        VALUES (v_branch_id, r_item.item_id, v_conv, 'stock_in', p_receipt_id, 'stock_receipt', auth.uid(), v_tenant_id);

        -- Alert trigger check
        PERFORM public.fn_check_low_stock(v_branch_id, r_item.item_id);
    END LOOP;

    -- Complete receipt
    UPDATE public.stock_receipts
    SET status = 'completed', received_by = auth.uid()
    WHERE id = p_receipt_id;

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'RECEIVE_STOCK',
        'Stock Receiving',
        NULL,
        json_build_object('receipt_id', p_receipt_id, 'branch_id', v_branch_id)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_receive_stock(UUID) TO authenticated;
