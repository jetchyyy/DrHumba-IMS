-- Migration: Make existing inventory items available to all branches (available_branches = NULL)
-- Created: 2026-10-07

-- 1. Update existing inventory_items to have available_branches = NULL so they are accessible across all branches
UPDATE public.inventory_items
SET available_branches = NULL
WHERE available_branches IS NOT NULL;

-- 2. Update existing retail menu_items linked to inventory_items to also reflect available_branches = NULL
UPDATE public.menu_items
SET available_branches = NULL
WHERE inventory_item_id IS NOT NULL;
