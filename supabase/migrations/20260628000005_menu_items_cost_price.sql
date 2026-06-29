-- ============================================================
-- MIGRATION: Add cost_price to menu_items table
-- ============================================================

ALTER TABLE public.menu_items 
    ADD COLUMN IF NOT EXISTS cost_price NUMERIC NOT NULL DEFAULT 0 CHECK (cost_price >= 0);

-- Trigger 1: Auto-update cost_price on menu_items changes
CREATE OR REPLACE FUNCTION public.fn_sync_retail_item_cost_price()
RETURNS TRIGGER AS $$
DECLARE
    v_cost NUMERIC;
BEGIN
    IF NEW.type = 'retail' AND NEW.inventory_item_id IS NOT NULL THEN
        SELECT COALESCE(cost_per_base_unit, 0) INTO v_cost
        FROM public.inventory_items
        WHERE id = NEW.inventory_item_id;
        
        NEW.cost_price := COALESCE(v_cost, 0);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_sync_retail_item_cost_price ON public.menu_items;
CREATE TRIGGER tg_sync_retail_item_cost_price
    BEFORE INSERT OR UPDATE OF inventory_item_id ON public.menu_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_retail_item_cost_price();

-- Trigger 2: Auto-update cost_price on inventory_items cost updates
CREATE OR REPLACE FUNCTION public.fn_sync_retail_item_cost_price_on_inventory_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.cost_per_base_unit IS DISTINCT FROM NEW.cost_per_base_unit THEN
        UPDATE public.menu_items
        SET cost_price = NEW.cost_per_base_unit
        WHERE type = 'retail' AND inventory_item_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_sync_retail_item_cost_price_on_inventory_update ON public.inventory_items;
CREATE TRIGGER tg_sync_retail_item_cost_price_on_inventory_update
    AFTER UPDATE OF cost_per_base_unit ON public.inventory_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_sync_retail_item_cost_price_on_inventory_update();
