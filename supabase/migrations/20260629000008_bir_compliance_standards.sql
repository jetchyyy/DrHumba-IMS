-- ============================================================
-- MIGRATION: BIR Compliance Standards Enforcement
-- ============================================================

-- 1. Protect cumulative grand totals from manual deletes/resets
CREATE OR REPLACE FUNCTION public.fn_prevent_reset_grand_total()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'BIR Compliance Error: Deleting records from terminal_counters is strictly prohibited.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.grand_cumulative_sales < OLD.grand_cumulative_sales THEN
            RAISE EXCEPTION 'BIR Compliance Error: Decreasing or resetting the accumulative grand total is strictly prohibited.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_prevent_reset_grand_total ON public.terminal_counters;
CREATE TRIGGER tg_prevent_reset_grand_total
    BEFORE UPDATE OR DELETE ON public.terminal_counters
    FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_reset_grand_total();

-- Completely lock terminal_counters writes from RLS
DROP POLICY IF EXISTS "Write terminal counters" ON public.terminal_counters;
CREATE POLICY "Write terminal counters" ON public.terminal_counters FOR ALL TO authenticated
    USING (false); -- Nobody can manually bypass the system triggers


-- 2. Automatically log item price & cost changes to the audit trail
CREATE OR REPLACE FUNCTION public.fn_audit_price_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME = 'menu_items' THEN
        IF OLD.price != NEW.price OR OLD.cost_price != NEW.cost_price THEN
            PERFORM public.fn_log_audit(
                auth.uid(),
                'PRICE_CHANGE',
                'Menu Items',
                json_build_object('sku', OLD.sku, 'name', OLD.name, 'old_price', OLD.price, 'old_cost', OLD.cost_price)::jsonb,
                json_build_object('sku', NEW.sku, 'name', NEW.name, 'new_price', NEW.price, 'new_cost', NEW.cost_price)::jsonb
            );
        END IF;
    ELSIF TG_TABLE_NAME = 'inventory_items' THEN
        IF OLD.cost_per_base_unit != NEW.cost_per_base_unit OR COALESCE(OLD.selling_price, 0) != COALESCE(NEW.selling_price, 0) THEN
            PERFORM public.fn_log_audit(
                auth.uid(),
                'PRICE_CHANGE',
                'Inventory Catalog',
                json_build_object('sku', OLD.sku, 'name', OLD.item_name, 'old_cost', OLD.cost_per_base_unit, 'old_selling_price', OLD.selling_price)::jsonb,
                json_build_object('sku', NEW.sku, 'name', NEW.item_name, 'new_cost', NEW.cost_per_base_unit, 'new_selling_price', NEW.selling_price)::jsonb
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tg_audit_menu_item_price_change ON public.menu_items;
CREATE TRIGGER tg_audit_menu_item_price_change
    AFTER UPDATE ON public.menu_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_price_changes();

DROP TRIGGER IF EXISTS tg_audit_inventory_item_price_change ON public.inventory_items;
CREATE TRIGGER tg_audit_inventory_item_price_change
    AFTER UPDATE ON public.inventory_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_price_changes();
