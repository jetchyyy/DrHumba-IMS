-- ============================================================
-- MIGRATION: POS Menu Item Ingredient/Stock Availability Check
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_get_menu_items_availability(
    p_branch_id UUID
)
RETURNS TABLE (
    menu_item_id UUID,
    stock_available BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mi.id AS menu_item_id,
        CASE
            -- 1. If it has a recipe
            WHEN EXISTS (
                SELECT 1 FROM public.recipes r 
                WHERE r.menu_item_id = mi.id
            ) THEN NOT EXISTS (
                -- Check if any recipe ingredient stock is less than required base unit quantity
                SELECT 1 
                FROM public.recipes r
                JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
                LEFT JOIN public.inventory_balances ib ON ib.item_id = ri.item_id AND ib.branch_id = p_branch_id
                WHERE r.menu_item_id = mi.id
                  AND COALESCE(ib.quantity, 0) < ri.quantity_base_unit
            )
            -- 2. If it is retail / mapped directly to an inventory item
            WHEN mi.inventory_item_id IS NOT NULL THEN COALESCE((
                SELECT ib.quantity FROM public.inventory_balances ib 
                WHERE ib.item_id = mi.inventory_item_id AND ib.branch_id = p_branch_id
            ), 0) >= 1
            -- 3. Otherwise (service, etc. not tracked)
            ELSE TRUE
        END AS stock_available
    FROM public.menu_items mi;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_get_menu_items_availability(UUID) TO authenticated;
