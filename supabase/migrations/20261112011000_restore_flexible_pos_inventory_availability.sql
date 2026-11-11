-- ============================================================================
-- MIGRATION: Restore Flexible POS Inventory Policy Availability
-- File: 20261112011000_restore_flexible_pos_inventory_availability.sql
-- Date: 2026-11-12
--
-- Description:
-- Fixes regression where migration 20261110130000 accidentally reverted
-- fn_get_menu_items_availability to an older template that lacked
-- stock_enforcement_mode ('flexible' vs 'strict') evaluation and dropped
-- the has_sufficient_stock column.
--
-- This migration merges BOTH:
-- 1. Packaging item exclusion from recipe availability (from 20261110130000).
-- 2. Flexible POS stock policy evaluation (from 20261015160000), allowing
--    flexible dishes (e.g. Crab & Corn Soup, Chicharon Bulaklak) to remain
--    sellable with the "Needs Adjustment" badge rather than "Out of Stock".
-- ============================================================================

-- 1. Idempotently ensure stock_enforcement_mode columns exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'menu_items' 
          AND column_name = 'stock_enforcement_mode'
    ) THEN
        ALTER TABLE public.menu_items 
        ADD COLUMN stock_enforcement_mode TEXT NOT NULL DEFAULT 'strict' 
        CHECK (stock_enforcement_mode IN ('strict', 'flexible'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'inventory_items' 
          AND column_name = 'stock_enforcement_mode'
    ) THEN
        ALTER TABLE public.inventory_items 
        ADD COLUMN stock_enforcement_mode TEXT NOT NULL DEFAULT 'strict' 
        CHECK (stock_enforcement_mode IN ('strict', 'flexible'));
    END IF;
END $$;

-- 2. Explicitly drop the function to avoid "cannot change return type of existing function" error
DROP FUNCTION IF EXISTS public.fn_get_menu_items_availability(UUID);

-- 3. Recreate public.fn_get_menu_items_availability with full flexible policy support and packaging exemption
CREATE OR REPLACE FUNCTION public.fn_get_menu_items_availability(
    p_branch_id UUID
)
RETURNS TABLE (
    menu_item_id UUID,
    stock_available BOOLEAN,
    has_sufficient_stock BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH item_eval AS (
        SELECT 
            mi.id AS m_id,
            COALESCE(
                mi.stock_enforcement_mode,
                (SELECT ii.stock_enforcement_mode FROM public.inventory_items ii WHERE ii.id = mi.inventory_item_id),
                'strict'
            ) AS effective_mode,
            CASE
                -- 1. If it has a recipe
                WHEN EXISTS (
                    SELECT 1 FROM public.recipes r 
                    WHERE r.menu_item_id = mi.id
                ) THEN NOT EXISTS (
                    -- Check if any non-packaging recipe ingredient stock is less than required base unit quantity
                    SELECT 1 
                    FROM public.recipes r
                    JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
                    JOIN public.inventory_items ii ON ii.id = ri.item_id
                    LEFT JOIN public.inventory_balances ib ON ib.item_id = ri.item_id AND ib.branch_id = p_branch_id
                    WHERE r.menu_item_id = mi.id
                      AND LOWER(TRIM(COALESCE(ii.category, ''))) != 'packaging'
                      AND COALESCE(ib.quantity, 0) < ri.quantity_base_unit
                )
                -- 2. If it is retail / mapped directly to an inventory item
                WHEN mi.inventory_item_id IS NOT NULL THEN COALESCE((
                    SELECT ib.quantity FROM public.inventory_balances ib 
                    WHERE ib.item_id = mi.inventory_item_id AND ib.branch_id = p_branch_id
                ), 0) >= 1
                -- 3. Otherwise (service, etc. not tracked)
                ELSE TRUE
            END AS in_stock
        FROM public.menu_items mi
    )
    SELECT 
        m_id AS menu_item_id,
        CASE
            WHEN effective_mode = 'flexible' THEN TRUE
            ELSE in_stock
        END AS stock_available,
        in_stock AS has_sufficient_stock
    FROM item_eval;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Grant execute permissions
GRANT EXECUTE ON FUNCTION public.fn_get_menu_items_availability(UUID) TO authenticated, service_role, anon;

