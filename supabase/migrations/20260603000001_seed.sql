-- 1. SEED BRANCHES
INSERT INTO public.branches (id, name, is_warehouse, location)
VALUES 
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'Main Warehouse', true, 'Central Hub'),
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'Branch A - Downtown', false, '123 Main St, Downtown'),
    ('c5c52c6f-682b-4d43-9828-095ef7fdecf8', 'Branch B - Uptown', false, '456 Heights Ave, Uptown')
ON CONFLICT (id) DO NOTHING;

-- 2. SEED INVENTORY ITEMS
INSERT INTO public.inventory_items (id, sku, item_name, category, base_unit, purchase_unit, conversion_factor, reorder_level, cost_per_base_unit, status)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'ING-ONION', 'White Onion', 'Vegetables', 'g', 'kg', 1000, 500, 0.005, 'active'),
    ('a2222222-2222-2222-2222-222222222222', 'ING-TOMATO', 'Tomato', 'Vegetables', 'g', 'kg', 1000, 500, 0.006, 'active'),
    ('a3333333-3333-3333-3333-333333333333', 'ING-PATTY', 'Beef Patty', 'Meat', 'pc', 'pack', 10, 20, 1.20, 'active'),
    ('a4444444-4444-4444-4444-444444444444', 'ING-BUN', 'Burger Bun', 'Bakery', 'pc', 'pack', 12, 24, 0.35, 'active'),
    ('a5555555-5555-5555-5555-555555555555', 'ING-OIL', 'Cooking Oil', 'Liquid', 'ml', 'L', 1000, 1000, 0.002, 'active'),
    ('a6666666-6666-6666-6666-666666666666', 'ING-LETTUCE', 'Lettuce', 'Vegetables', 'g', 'kg', 1000, 400, 0.004, 'active'),
    ('a7777777-7777-7777-7777-777777777777', 'ING-CHEESE', 'Cheddar Cheese Slices', 'Dairy', 'pc', 'pack', 50, 50, 0.15, 'active')
ON CONFLICT (id) DO NOTHING;

-- 3. SEED INITIAL WAREHOUSE STOCK (Balances)
INSERT INTO public.inventory_balances (branch_id, item_id, quantity)
VALUES
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'a1111111-1111-1111-1111-111111111111', 100000), -- 100 kg White Onion
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'a2222222-2222-2222-2222-222222222222', 80000),  -- 80 kg Tomato
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'a3333333-3333-3333-3333-333333333333', 500),    -- 500 Beef Patties
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'a4444444-4444-4444-4444-444444444444', 600),    -- 600 Burger Buns
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'a5555555-5555-5555-5555-555555555555', 50000),  -- 50 L Cooking Oil
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'a6666666-6666-6666-6666-666666666666', 60000),  -- 60 kg Lettuce
    ('d2b4d8a1-8d26-4ee1-b27b-fb8f3879a9c8', 'a7777777-7777-7777-7777-777777777777', 1000)   -- 1000 Cheese slices
ON CONFLICT (branch_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity;

-- 4. SEED INITIAL BRANCH A STOCK (Low Stock Sandbox)
INSERT INTO public.inventory_balances (branch_id, item_id, quantity)
VALUES
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'a1111111-1111-1111-1111-111111111111', 400),   -- 400g White Onion (Below 500g reorder!)
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'a2222222-2222-2222-2222-222222222222', 1500),  -- 1.5kg Tomato
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'a3333333-3333-3333-3333-333333333333', 10),    -- 10 Beef Patties (Below 20 reorder!)
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'a4444444-4444-4444-4444-444444444444', 15),    -- 15 Burger Buns (Below 24 reorder!)
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'a5555555-5555-5555-5555-555555555555', 4000),  -- 4 L Cooking Oil
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'a6666666-6666-6666-6666-666666666666', 300),   -- 300g Lettuce (Below 400g reorder!)
    ('b3b3a6ef-468b-4a5f-b52b-7cde970868f0', 'a7777777-7777-7777-7777-777777777777', 80)     -- 80 Cheese Slices
ON CONFLICT (branch_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity;

-- 5. SEED MENU ITEMS
INSERT INTO public.menu_items (id, name, sku, category, price, status, is_available)
VALUES
    ('m1111111-1111-1111-1111-111111111111', 'Classic Beef Burger', 'MEN-BURGER-CLASSIC', 'Burgers', 8.99, 'active', true),
    ('m2222222-2222-2222-2222-222222222222', 'Double Cheeseburger', 'MEN-BURGER-DOUBLE', 'Burgers', 12.49, 'active', true),
    ('m3333333-3333-3333-3333-333333333333', 'Onion Rings', 'MEN-SIDES-ONION', 'Sides', 4.50, 'active', true)
ON CONFLICT (id) DO NOTHING;

-- 6. SEED RECIPES
INSERT INTO public.recipes (id, menu_item_id, instructions, version)
VALUES
    ('r1111111-1111-1111-1111-111111111111', 'm1111111-1111-1111-1111-111111111111', 'Toast the bun. Sear the beef patty for 3 minutes per side. Layer patty, lettuce, tomato slice, and raw onion rings on the bun.', 1),
    ('r2222222-2222-2222-2222-222222222222', 'm2222222-2222-2222-2222-222222222222', 'Toast the bun. Sear two beef patties and melt a slice of cheese on each. Layer cheese-covered patties, pickles, onions, and sauce.', 1),
    ('r3333333-3333-3333-3333-333333333333', 'm3333333-3333-3333-3333-333333333333', 'Slice onions, batter with flour, and deep fry in hot oil until golden brown.', 1)
ON CONFLICT (id) DO NOTHING;

-- 7. SEED RECIPE INGREDIENTS
-- Classic Beef Burger: 5g Onion, 10g Tomato, 15g Lettuce, 1 Patty, 1 Bun
INSERT INTO public.recipe_ingredients (recipe_id, item_id, quantity_base_unit)
VALUES
    ('r1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 5),    -- 5g Onion
    ('r1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222', 10),   -- 10g Tomato
    ('r1111111-1111-1111-1111-111111111111', 'a6666666-6666-6666-6666-666666666666', 15),   -- 15g Lettuce
    ('r1111111-1111-1111-1111-111111111111', 'a3333333-3333-3333-3333-333333333333', 1),    -- 1 pc Beef Patty
    ('r1111111-1111-1111-1111-111111111111', 'a4444444-4444-4444-4444-444444444444', 1)     -- 1 pc Burger Bun
ON CONFLICT (recipe_id, item_id) DO NOTHING;

-- Double Cheeseburger: 2 Patties, 1 Bun, 2 Cheese Slices, 5g Onion, 50ml Cooking Oil (used for grill)
INSERT INTO public.recipe_ingredients (recipe_id, item_id, quantity_base_unit)
VALUES
    ('r2222222-2222-2222-2222-222222222222', 'a3333333-3333-3333-3333-333333333333', 2),    -- 2 pc Beef Patty
    ('r2222222-2222-2222-2222-222222222222', 'a4444444-4444-4444-4444-444444444444', 1),    -- 1 pc Burger Bun
    ('r2222222-2222-2222-2222-222222222222', 'a7777777-7777-7777-7777-777777777777', 2),    -- 2 pc Cheese Slices
    ('r2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 5),    -- 5g Onion
    ('r2222222-2222-2222-2222-222222222222', 'a5555555-5555-5555-5555-555555555555', 10)    -- 10ml Cooking Oil
ON CONFLICT (recipe_id, item_id) DO NOTHING;

-- Onion Rings: 100g Onion, 150ml Cooking oil
INSERT INTO public.recipe_ingredients (recipe_id, item_id, quantity_base_unit)
VALUES
    ('r3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111', 100),  -- 100g Onion
    ('r3333333-3333-3333-3333-333333333333', 'a5555555-5555-5555-5555-555555555555', 150)   -- 150ml Cooking Oil
ON CONFLICT (recipe_id, item_id) DO NOTHING;
