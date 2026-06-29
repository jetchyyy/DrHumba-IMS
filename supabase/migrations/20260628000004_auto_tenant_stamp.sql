-- ============================================================
-- MIGRATION: Auto-stamp tenant_id on INSERT for all tenant-scoped tables
-- Prevents RLS violations when client-side code omits tenant_id
-- ============================================================

-- Generic helper: auto-set tenant_id before insert if not already set
CREATE OR REPLACE FUNCTION public.fn_auto_stamp_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.get_my_tenant_id();
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Cannot determine tenant_id for new row in table %. Ensure the user has a valid tenant association.', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Apply to all tenant-scoped tables ────────────────────────────────────────

-- branches
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_branches ON public.branches;
CREATE TRIGGER tg_auto_stamp_tenant_branches
  BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- inventory_items
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_items ON public.inventory_items;
CREATE TRIGGER tg_auto_stamp_tenant_items
  BEFORE INSERT ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- menu_items
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_menu ON public.menu_items;
CREATE TRIGGER tg_auto_stamp_tenant_menu
  BEFORE INSERT ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- recipes
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_recipes ON public.recipes;
CREATE TRIGGER tg_auto_stamp_tenant_recipes
  BEFORE INSERT ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- recipe_ingredients
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_recipe_ingredients ON public.recipe_ingredients;
CREATE TRIGGER tg_auto_stamp_tenant_recipe_ingredients
  BEFORE INSERT ON public.recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- inventory_balances
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_inv_balances ON public.inventory_balances;
CREATE TRIGGER tg_auto_stamp_tenant_inv_balances
  BEFORE INSERT ON public.inventory_balances
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- inventory_movements
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_inv_movements ON public.inventory_movements;
CREATE TRIGGER tg_auto_stamp_tenant_inv_movements
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- stock_receipts
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_receipts ON public.stock_receipts;
CREATE TRIGGER tg_auto_stamp_tenant_receipts
  BEFORE INSERT ON public.stock_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- stock_receipt_items
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_receipt_items ON public.stock_receipt_items;
CREATE TRIGGER tg_auto_stamp_tenant_receipt_items
  BEFORE INSERT ON public.stock_receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- stock_adjustments
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_adjustments ON public.stock_adjustments;
CREATE TRIGGER tg_auto_stamp_tenant_adjustments
  BEFORE INSERT ON public.stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- stock_adjustment_items
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_adj_items ON public.stock_adjustment_items;
CREATE TRIGGER tg_auto_stamp_tenant_adj_items
  BEFORE INSERT ON public.stock_adjustment_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- transfer_requests
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_transfers ON public.transfer_requests;
CREATE TRIGGER tg_auto_stamp_tenant_transfers
  BEFORE INSERT ON public.transfer_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- transfer_items
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_transfer_items ON public.transfer_items;
CREATE TRIGGER tg_auto_stamp_tenant_transfer_items
  BEFORE INSERT ON public.transfer_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- notifications
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_notifications ON public.notifications;
CREATE TRIGGER tg_auto_stamp_tenant_notifications
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();
