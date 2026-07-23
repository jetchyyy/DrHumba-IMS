-- ============================================================
-- MIGRATION: Add available_branches list to inventory_items and menu_items
-- ============================================================

-- 1. Alter tables to add available_branches column
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS available_branches UUID[] DEFAULT NULL;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS available_branches UUID[] DEFAULT NULL;

-- 2. Update trigger function fn_sync_inventory_to_menu_items to propagate available_branches during POS catalog sync
CREATE OR REPLACE FUNCTION public.fn_sync_inventory_to_menu_items()
RETURNS TRIGGER AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Determine tenant_id
    IF TG_OP = 'DELETE' THEN
        v_tenant_id := OLD.tenant_id;
    ELSE
        v_tenant_id := NEW.tenant_id;
    END IF;

    -- Handle Delete operation
    IF TG_OP = 'DELETE' THEN
        DELETE FROM public.menu_items WHERE inventory_item_id = OLD.id;
        RETURN OLD;
    END IF;

    -- Only sync if selling_price is set and greater than 0
    IF NEW.selling_price IS NOT NULL AND NEW.selling_price > 0 AND NEW.status = 'active' THEN
        INSERT INTO public.menu_items (
            name, sku, category, price, cost_price, type, inventory_item_id, status, tenant_id, available_branches
        )
        VALUES (
            NEW.item_name, NEW.sku, NEW.category, NEW.selling_price, NEW.cost_per_base_unit, 'retail', NEW.id, NEW.status, v_tenant_id, NEW.available_branches
        )
        ON CONFLICT (inventory_item_id) DO UPDATE SET
            name = EXCLUDED.name,
            sku = EXCLUDED.sku,
            category = EXCLUDED.category,
            price = EXCLUDED.price,
            cost_price = EXCLUDED.cost_price,
            status = EXCLUDED.status,
            available_branches = EXCLUDED.available_branches;
    ELSE
        -- If selling_price is null, 0, or item is inactive, remove from POS listing
        DELETE FROM public.menu_items WHERE inventory_item_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Redefine fn_create_inventory_item to accept p_available_branches parameter
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
    p_available_branches UUID[] DEFAULT NULL
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
        conversion_factor, reorder_level, cost_per_base_unit, status, selling_price, available_branches
    )
    VALUES (
        p_sku, p_item_name, p_category, p_base_unit, p_purchase_unit,
        p_conversion_factor, p_reorder_level, p_cost_per_base_unit, 'active', p_selling_price, p_available_branches
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
