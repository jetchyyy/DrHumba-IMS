-- ============================================================
-- MIGRATION: Prevent Double Deductions & Race Conditions on Stock Adjustments
-- File: 20261108214000_prevent_adjustment_double_deductions.sql
-- Date: 2026-11-08
--
-- Summary:
-- 1. Updates `fn_process_adjustment` to lock target adjustment row with FOR UPDATE,
--    preventing concurrent double approvals.
-- 2. Aggregates item quantities by `item_id` (SUM) in `fn_process_adjustment` so duplicate
--    records can never produce duplicate inventory deductions or movement logs.
-- 3. Updates RLS policy on `stock_adjustment_items` to allow creators of pending adjustments
--    to delete/update their own pending adjustment items cleanly during edits.
-- 4. Deduplicates any existing duplicate adjustment items and adds a UNIQUE constraint
--    on `(adjustment_id, item_id)` to prevent duplicate item entries at the database level.
-- ============================================================

-- 1. Deduplicate any existing duplicate rows in stock_adjustment_items
DELETE FROM public.stock_adjustment_items a
USING public.stock_adjustment_items b
WHERE a.ctid < b.ctid
  AND a.adjustment_id = b.adjustment_id
  AND a.item_id = b.item_id;

-- 2. Add composite UNIQUE constraint on (adjustment_id, item_id)
ALTER TABLE public.stock_adjustment_items 
DROP CONSTRAINT IF EXISTS stock_adjustment_items_adj_item_key;

ALTER TABLE public.stock_adjustment_items
ADD CONSTRAINT stock_adjustment_items_adj_item_key UNIQUE (adjustment_id, item_id);

-- 3. Update RLS policy on stock_adjustment_items to allow pending adjustment creator edits
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
                    'action_buttons' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])) OR
                    (a.created_by = auth.uid() AND a.status = 'pending')
                )
            )
        )
    );

-- 4. Update fn_process_adjustment with row locking and item deduplication
CREATE OR REPLACE FUNCTION public.fn_process_adjustment(
    p_adjustment_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_branch UUID;
    v_status TEXT;
    v_reason TEXT;
    v_tenant_id UUID;
    v_my_role TEXT;
    v_allowed_tabs TEXT[];
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
BEGIN
    SELECT role_name, allowed_tabs
    INTO v_my_role, v_allowed_tabs
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_my_role != 'super_admin' AND 'restrict_adjustment_edits' = ANY(COALESCE(v_allowed_tabs, ARRAY[]::TEXT[])) THEN
        RAISE EXCEPTION 'Unauthorized: Adjustments and edits are subject to Admin approval.';
    END IF;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only administrators can approve stock adjustments.';
    END IF;

    -- Lock the row with FOR UPDATE to prevent concurrent race conditions
    SELECT branch_id, status, reason, tenant_id
    INTO v_branch, v_status, v_reason, v_tenant_id
    FROM public.stock_adjustments 
    WHERE id = p_adjustment_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stock adjustment not found.';
    END IF;

    IF v_tenant_id != public.get_my_tenant_id() AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Tenant mismatch.';
    END IF;

    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Stock adjustment already processed.';
    END IF;

    -- Validate stock levels if adjustment is negative (deduction)
    -- Group by item_id with SUM to aggregate quantities and prevent duplicate processing
    FOR r_item IN (
        SELECT item_id, SUM(quantity_base_unit) AS quantity_base_unit 
        FROM public.stock_adjustment_items 
        WHERE adjustment_id = p_adjustment_id
        GROUP BY item_id
    ) LOOP
        IF r_item.quantity_base_unit < 0 THEN
            SELECT COALESCE(quantity, 0) INTO v_bal 
            FROM public.inventory_balances 
            WHERE branch_id = v_branch AND item_id = r_item.item_id;

            IF v_bal < ABS(r_item.quantity_base_unit) THEN
                SELECT item_name INTO v_name FROM public.inventory_items WHERE id = r_item.item_id;
                RAISE EXCEPTION 'Insufficient stock to apply adjustment for %: balance %, required deduction %', v_name, v_bal, ABS(r_item.quantity_base_unit);
            END IF;
        END IF;
    END LOOP;

    -- Apply Adjustments (strictly deduplicated by item_id using GROUP BY)
    FOR r_item IN (
        SELECT item_id, SUM(quantity_base_unit) AS quantity_base_unit 
        FROM public.stock_adjustment_items 
        WHERE adjustment_id = p_adjustment_id
        GROUP BY item_id
    ) LOOP
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
        VALUES (v_branch, r_item.item_id, r_item.quantity_base_unit, now(), v_tenant_id)
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.quantity_base_unit, updated_at = now();

        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
        VALUES (v_branch, r_item.item_id, r_item.quantity_base_unit, 'adjustment', p_adjustment_id, 'adjustment', auth.uid(), v_tenant_id);

        PERFORM public.fn_check_low_stock(v_branch, r_item.item_id);
    END LOOP;

    -- Complete adjustment
    UPDATE public.stock_adjustments
    SET status = 'approved', approved_by = auth.uid()
    WHERE id = p_adjustment_id;

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'ADJUSTMENT_APPROVE',
        'Adjustments',
        NULL,
        json_build_object('adjustment_id', p_adjustment_id, 'approved_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
