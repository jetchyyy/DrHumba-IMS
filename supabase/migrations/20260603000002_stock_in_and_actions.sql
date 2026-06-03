-- Migration: Stock In and Inventory Actions Functions
-- Created: 2026-06-03

-- 1. Function to create inventory item and optionally record initial stock
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
    p_created_by UUID
)
RETURNS UUID AS $$
DECLARE
    v_item_id UUID;
    v_my_role TEXT;
BEGIN
    -- Security / Role validation check
    SELECT COALESCE(
        (SELECT role_name FROM public.profiles WHERE id = p_created_by),
        'none'
    ) INTO v_my_role;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins or inventory managers can create catalog items.';
    END IF;

    -- 1. Insert into inventory_items
    INSERT INTO public.inventory_items (
        sku, item_name, category, base_unit, purchase_unit,
        conversion_factor, reorder_level, cost_per_base_unit, status
    )
    VALUES (
        p_sku, p_item_name, p_category, p_base_unit, p_purchase_unit,
        p_conversion_factor, p_reorder_level, p_cost_per_base_unit, 'active'
    )
    RETURNING id INTO v_item_id;

    -- 2. If initial quantity is greater than 0, record balance and movement
    IF p_initial_quantity > 0 AND p_branch_id IS NOT NULL THEN
        -- Insert/Update balance
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
        VALUES (p_branch_id, v_item_id, p_initial_quantity, now())
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + p_initial_quantity, updated_at = now();

        -- Insert movement
        INSERT INTO public.inventory_movements (
            branch_id, item_id, quantity, movement_type, created_by
        )
        VALUES (
            p_branch_id, v_item_id, p_initial_quantity, 'stock_in', p_created_by
        );
        
        -- Log audit
        INSERT INTO public.audit_logs (user_id, action, module, new_value)
        VALUES (
            p_created_by,
            'CREATE_WITH_STOCK',
            'inventory',
            json_build_object('item_id', v_item_id, 'sku', p_sku, 'name', p_item_name, 'initial_qty', p_initial_quantity, 'branch_id', p_branch_id)
        );
    ELSE
        -- Log audit without stock
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

-- 2. Function to stock in existing inventory item
CREATE OR REPLACE FUNCTION public.fn_stock_in_item(
    p_branch_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_created_by UUID
)
RETURNS VOID AS $$
DECLARE
    v_my_role TEXT;
BEGIN
    -- Security / Role validation check
    SELECT COALESCE(
        (SELECT role_name FROM public.profiles WHERE id = p_created_by),
        'none'
    ) INTO v_my_role;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only admins or inventory managers can stock in items.';
    END IF;

    -- 1. Validate quantity
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Stock in quantity must be greater than zero.';
    END IF;

    -- 2. Insert/Update balance
    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
    VALUES (p_branch_id, p_item_id, p_quantity, now())
    ON CONFLICT (branch_id, item_id)
    DO UPDATE SET quantity = public.inventory_balances.quantity + p_quantity, updated_at = now();

    -- 3. Insert movement
    INSERT INTO public.inventory_movements (
        branch_id, item_id, quantity, movement_type, created_by
    )
    VALUES (
        p_branch_id, p_item_id, p_quantity, 'stock_in', p_created_by
    );

    -- 4. Log audit
    INSERT INTO public.audit_logs (user_id, action, module, new_value)
    VALUES (
        p_created_by,
        'STOCK_IN',
        'inventory',
        json_build_object('branch_id', p_branch_id, 'item_id', p_item_id, 'quantity', p_quantity)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grants
REVOKE ALL ON FUNCTION public.fn_create_inventory_item FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_inventory_item TO authenticated;

REVOKE ALL ON FUNCTION public.fn_stock_in_item FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_stock_in_item TO authenticated;
