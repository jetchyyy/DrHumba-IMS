-- ============================================================
-- MIGRATION: Fix RLS violation in sync triggers by adding SECURITY DEFINER
-- ============================================================

-- 1. Re-create fn_sync_inventory_to_menu_items with SECURITY DEFINER
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
            name, sku, category, price, cost_price, type, inventory_item_id, status, tenant_id
        )
        VALUES (
            NEW.item_name, NEW.sku, NEW.category, NEW.selling_price, NEW.cost_per_base_unit, 'retail', NEW.id, NEW.status, v_tenant_id
        )
        ON CONFLICT (inventory_item_id) DO UPDATE SET
            name = EXCLUDED.name,
            sku = EXCLUDED.sku,
            category = EXCLUDED.category,
            price = EXCLUDED.price,
            cost_price = EXCLUDED.cost_price,
            status = EXCLUDED.status;
    ELSE
        -- If selling_price is null, 0, or item is inactive, remove from POS listing
        DELETE FROM public.menu_items WHERE inventory_item_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Re-create fn_sync_inventory_delete_to_menu_items with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.fn_sync_inventory_delete_to_menu_items()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.menu_items WHERE inventory_item_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
