-- Optional customer-facing description for menu items (set from the Recipes editor, shown on the POS menu).
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS description TEXT;
