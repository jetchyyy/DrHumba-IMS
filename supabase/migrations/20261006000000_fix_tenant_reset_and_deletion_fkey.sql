-- ============================================================
-- MIGRATION: Fix Tenant Data Deletion & Reset Reverse-Dependency Order
-- & Update Portioning Requests Foreign Key Constraints
-- ============================================================

-- 1. Update portioning_requests foreign keys to CASCADE on parent deletes
ALTER TABLE public.portioning_requests DROP CONSTRAINT IF EXISTS portioning_requests_source_item_id_fkey;
ALTER TABLE public.portioning_requests ADD CONSTRAINT portioning_requests_source_item_id_fkey 
    FOREIGN KEY (source_item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;

ALTER TABLE public.portioning_requests DROP CONSTRAINT IF EXISTS portioning_requests_target_item_id_fkey;
ALTER TABLE public.portioning_requests ADD CONSTRAINT portioning_requests_target_item_id_fkey 
    FOREIGN KEY (target_item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;

ALTER TABLE public.portioning_requests DROP CONSTRAINT IF EXISTS portioning_requests_branch_id_fkey;
ALTER TABLE public.portioning_requests ADD CONSTRAINT portioning_requests_branch_id_fkey 
    FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;


-- 2. Update fn_reset_tenant_data with portioning_requests, item_branch_prices, kitchen_receipts, and terminals
CREATE OR REPLACE FUNCTION public.fn_reset_tenant_data(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Ensure the calling user is a platform admin
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Only platform administrators can perform this action';
    END IF;

    -- Delete data in correct reverse-dependency order, preserving only accounts and branches:
    
    -- 1. Kitchen receipts (depends on sales)
    DELETE FROM public.kitchen_receipts WHERE tenant_id = p_tenant_id;
    
    -- 2. Sale items (depends on sales, menu_items, inventory_items)
    DELETE FROM public.sale_items WHERE tenant_id = p_tenant_id;
    
    -- 3. Sales (depends on cashier_sessions, branches)
    DELETE FROM public.sales WHERE tenant_id = p_tenant_id;
    
    -- 4. Cashier sessions (depends on terminals, branches)
    DELETE FROM public.cashier_sessions WHERE tenant_id = p_tenant_id;
    
    -- 5. Terminal counters (Superadmin bypass will allow this)
    DELETE FROM public.terminal_counters WHERE tenant_id = p_tenant_id;

    -- 6. Terminals (preserves branches, resets terminal device registrations)
    DELETE FROM public.terminals WHERE tenant_id = p_tenant_id;
    
    -- 7. Recipe ingredients (depends on recipes, inventory_items)
    DELETE FROM public.recipe_ingredients WHERE tenant_id = p_tenant_id;
    
    -- 8. Recipes (depends on menu_items)
    DELETE FROM public.recipes WHERE tenant_id = p_tenant_id;

    -- 9. Portioning requests (depends on inventory_items, branches)
    DELETE FROM public.portioning_requests WHERE tenant_id = p_tenant_id;

    -- 10. Dynamic branch pricing (depends on inventory_items, menu_items, branches)
    DELETE FROM public.item_branch_prices WHERE tenant_id = p_tenant_id;
    
    -- 11. Stock adjustment items (depends on stock_adjustments, inventory_items)
    DELETE FROM public.stock_adjustment_items WHERE tenant_id = p_tenant_id;
    
    -- 12. Stock adjustments (depends on branches)
    DELETE FROM public.stock_adjustments WHERE tenant_id = p_tenant_id;
    
    -- 13. Stock receipt items (depends on stock_receipts, inventory_items)
    DELETE FROM public.stock_receipt_items WHERE tenant_id = p_tenant_id;
    
    -- 14. Stock receipts (depends on branches)
    DELETE FROM public.stock_receipts WHERE tenant_id = p_tenant_id;
    
    -- 15. Transfer items (depends on transfer_requests, inventory_items)
    DELETE FROM public.transfer_items WHERE tenant_id = p_tenant_id;
    
    -- 16. Transfer requests / transfers (depends on branches)
    DELETE FROM public.transfer_requests WHERE tenant_id = p_tenant_id;
    
    -- 17. Inventory movements (depends on inventory_items, branches)
    DELETE FROM public.inventory_movements WHERE tenant_id = p_tenant_id;
    
    -- 18. Inventory balances (depends on inventory_items, branches)
    DELETE FROM public.inventory_balances WHERE tenant_id = p_tenant_id;
    
    -- 19. Inventory items (now safe to delete)
    DELETE FROM public.inventory_items WHERE tenant_id = p_tenant_id;
    
    -- 20. Menu items (now safe to delete)
    DELETE FROM public.menu_items WHERE tenant_id = p_tenant_id;
    
    -- 21. Expenses (depends on branches)
    DELETE FROM public.expenses WHERE tenant_id = p_tenant_id;
    
    -- 22. Notifications (depends on branches)
    DELETE FROM public.notifications WHERE tenant_id = p_tenant_id;
    
    -- 23. Control number sequences
    DELETE FROM public.control_number_sequences WHERE tenant_id = p_tenant_id;
    
    -- 24. System settings
    DELETE FROM public.system_settings WHERE tenant_id = p_tenant_id;
    
    -- 25. Audit logs
    DELETE FROM public.audit_logs WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Update fn_delete_tenant_data with complete reverse-dependency order
CREATE OR REPLACE FUNCTION public.fn_delete_tenant_data(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Ensure the calling user is a platform admin
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Only platform administrators can perform this action';
    END IF;

    -- Avoid deleting the default tenant (Dr. Humba) or the system tenant
    IF p_tenant_id = '00000000-0000-0000-0000-000000000000' THEN
        RAISE EXCEPTION 'Cannot delete the main system tenant';
    END IF;

    -- Delete in reverse dependency order:
    
    -- 1. Kitchen receipts
    DELETE FROM public.kitchen_receipts WHERE tenant_id = p_tenant_id;

    -- 2. Sale items
    DELETE FROM public.sale_items WHERE tenant_id = p_tenant_id;
    
    -- 3. Sales
    DELETE FROM public.sales WHERE tenant_id = p_tenant_id;
    
    -- 4. Cashier sessions
    DELETE FROM public.cashier_sessions WHERE tenant_id = p_tenant_id;
    
    -- 5. Terminal counters (Superadmin bypass will allow this)
    DELETE FROM public.terminal_counters WHERE tenant_id = p_tenant_id;

    -- 6. Terminals
    DELETE FROM public.terminals WHERE tenant_id = p_tenant_id;
    
    -- 7. Recipe ingredients
    DELETE FROM public.recipe_ingredients WHERE tenant_id = p_tenant_id;
    
    -- 8. Recipes
    DELETE FROM public.recipes WHERE tenant_id = p_tenant_id;

    -- 9. Portioning requests
    DELETE FROM public.portioning_requests WHERE tenant_id = p_tenant_id;

    -- 10. Dynamic branch pricing
    DELETE FROM public.item_branch_prices WHERE tenant_id = p_tenant_id;
    
    -- 11. Stock adjustment items
    DELETE FROM public.stock_adjustment_items WHERE tenant_id = p_tenant_id;
    
    -- 12. Stock adjustments
    DELETE FROM public.stock_adjustments WHERE tenant_id = p_tenant_id;
    
    -- 13. Stock receipt items
    DELETE FROM public.stock_receipt_items WHERE tenant_id = p_tenant_id;
    
    -- 14. Stock receipts
    DELETE FROM public.stock_receipts WHERE tenant_id = p_tenant_id;
    
    -- 15. Transfer items
    DELETE FROM public.transfer_items WHERE tenant_id = p_tenant_id;
    
    -- 16. Transfer requests / transfers
    DELETE FROM public.transfer_requests WHERE tenant_id = p_tenant_id;
    
    -- 17. Inventory movements
    DELETE FROM public.inventory_movements WHERE tenant_id = p_tenant_id;
    
    -- 18. Inventory balances
    DELETE FROM public.inventory_balances WHERE tenant_id = p_tenant_id;
    
    -- 19. Inventory items
    DELETE FROM public.inventory_items WHERE tenant_id = p_tenant_id;
    
    -- 20. Menu items
    DELETE FROM public.menu_items WHERE tenant_id = p_tenant_id;
    
    -- 21. Expenses
    DELETE FROM public.expenses WHERE tenant_id = p_tenant_id;
    
    -- 22. Notifications
    DELETE FROM public.notifications WHERE tenant_id = p_tenant_id;
    
    -- 23. Control number sequences
    DELETE FROM public.control_number_sequences WHERE tenant_id = p_tenant_id;
    
    -- 24. System settings
    DELETE FROM public.system_settings WHERE tenant_id = p_tenant_id;
    
    -- 25. Audit logs
    DELETE FROM public.audit_logs WHERE tenant_id = p_tenant_id;
    
    -- 26. Profiles (Staff/Users)
    DELETE FROM public.profiles WHERE tenant_id = p_tenant_id;
    
    -- 27. Branches (sub-stores with parent_id first, then parent branches)
    DELETE FROM public.branches WHERE tenant_id = p_tenant_id AND parent_id IS NOT NULL;
    DELETE FROM public.branches WHERE tenant_id = p_tenant_id;
    
    -- 28. Finally, the tenant itself
    DELETE FROM public.tenants WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
