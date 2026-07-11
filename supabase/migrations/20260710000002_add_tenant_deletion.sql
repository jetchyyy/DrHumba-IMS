-- ============================================================
-- MIGRATION: Tenant Data Deletion & Reset RPCs with Compliance Bypass
-- ============================================================

-- Redefine cumulative grand total protection trigger function to allow ODC Superadmin bypass
CREATE OR REPLACE FUNCTION public.fn_prevent_reset_grand_total()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF NOT public.is_platform_admin() THEN
            RAISE EXCEPTION 'BIR Compliance Error: Deleting records from terminal_counters is strictly prohibited.';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.grand_cumulative_sales < OLD.grand_cumulative_sales THEN
            IF NOT public.is_platform_admin() THEN
                RAISE EXCEPTION 'BIR Compliance Error: Decreasing or resetting the accumulative grand total is strictly prohibited.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


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
    -- 1. Recipe ingredients
    DELETE FROM public.recipe_ingredients WHERE tenant_id = p_tenant_id;
    
    -- 2. Recipes
    DELETE FROM public.recipes WHERE tenant_id = p_tenant_id;
    
    -- 3. Sale items
    DELETE FROM public.sale_items WHERE tenant_id = p_tenant_id;
    
    -- 4. Sales
    DELETE FROM public.sales WHERE tenant_id = p_tenant_id;
    
    -- 5. Cashier sessions
    DELETE FROM public.cashier_sessions WHERE tenant_id = p_tenant_id;
    
    -- 6. Terminal counters (Superadmin bypass will allow this)
    DELETE FROM public.terminal_counters WHERE tenant_id = p_tenant_id;
    
    -- 7. Stock adjustment items
    DELETE FROM public.stock_adjustment_items WHERE tenant_id = p_tenant_id;
    
    -- 8. Stock adjustments
    DELETE FROM public.stock_adjustments WHERE tenant_id = p_tenant_id;
    
    -- 9. Stock receipt items
    DELETE FROM public.stock_receipt_items WHERE tenant_id = p_tenant_id;
    
    -- 10. Stock receipts
    DELETE FROM public.stock_receipts WHERE tenant_id = p_tenant_id;
    
    -- 11. Transfer items
    DELETE FROM public.transfer_items WHERE tenant_id = p_tenant_id;
    
    -- 12. Transfer requests / transfers
    DELETE FROM public.transfer_requests WHERE tenant_id = p_tenant_id;
    
    -- 13. Inventory movements
    DELETE FROM public.inventory_movements WHERE tenant_id = p_tenant_id;
    
    -- 14. Inventory balances
    DELETE FROM public.inventory_balances WHERE tenant_id = p_tenant_id;
    
    -- 15. Inventory items
    DELETE FROM public.inventory_items WHERE tenant_id = p_tenant_id;
    
    -- 16. Menu items
    DELETE FROM public.menu_items WHERE tenant_id = p_tenant_id;
    
    -- 17. Expenses
    DELETE FROM public.expenses WHERE tenant_id = p_tenant_id;
    
    -- 18. Notifications
    DELETE FROM public.notifications WHERE tenant_id = p_tenant_id;
    
    -- 19. Control number sequences
    DELETE FROM public.control_number_sequences WHERE tenant_id = p_tenant_id;
    
    -- 20. System settings
    DELETE FROM public.system_settings WHERE tenant_id = p_tenant_id;
    
    -- 21. Audit logs
    DELETE FROM public.audit_logs WHERE tenant_id = p_tenant_id;
    
    -- 22. Profiles (Staff/Users)
    DELETE FROM public.profiles WHERE tenant_id = p_tenant_id;
    
    -- 23. Branches (including sub-stores)
    DELETE FROM public.branches WHERE tenant_id = p_tenant_id;
    
    -- 24. Finally, the tenant itself
    DELETE FROM public.tenants WHERE id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION public.fn_reset_tenant_data(p_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Ensure the calling user is a platform admin
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Only platform administrators can perform this action';
    END IF;

    -- Delete data in correct reverse-dependency order, preserving only accounts and branches:
    -- 1. Recipe ingredients
    DELETE FROM public.recipe_ingredients WHERE tenant_id = p_tenant_id;
    
    -- 2. Recipes
    DELETE FROM public.recipes WHERE tenant_id = p_tenant_id;
    
    -- 3. Sale items
    DELETE FROM public.sale_items WHERE tenant_id = p_tenant_id;
    
    -- 4. Sales
    DELETE FROM public.sales WHERE tenant_id = p_tenant_id;
    
    -- 5. Cashier sessions
    DELETE FROM public.cashier_sessions WHERE tenant_id = p_tenant_id;
    
    -- 6. Terminal counters (Superadmin bypass will allow this)
    DELETE FROM public.terminal_counters WHERE tenant_id = p_tenant_id;
    
    -- 7. Stock adjustment items
    DELETE FROM public.stock_adjustment_items WHERE tenant_id = p_tenant_id;
    
    -- 8. Stock adjustments
    DELETE FROM public.stock_adjustments WHERE tenant_id = p_tenant_id;
    
    -- 9. Stock receipt items
    DELETE FROM public.stock_receipt_items WHERE tenant_id = p_tenant_id;
    
    -- 10. Stock receipts
    DELETE FROM public.stock_receipts WHERE tenant_id = p_tenant_id;
    
    -- 11. Transfer items
    DELETE FROM public.transfer_items WHERE tenant_id = p_tenant_id;
    
    -- 12. Transfer requests / transfers
    DELETE FROM public.transfer_requests WHERE tenant_id = p_tenant_id;
    
    -- 13. Inventory movements
    DELETE FROM public.inventory_movements WHERE tenant_id = p_tenant_id;
    
    -- 14. Inventory balances
    DELETE FROM public.inventory_balances WHERE tenant_id = p_tenant_id;
    
    -- 15. Inventory items
    DELETE FROM public.inventory_items WHERE tenant_id = p_tenant_id;
    
    -- 16. Menu items
    DELETE FROM public.menu_items WHERE tenant_id = p_tenant_id;
    
    -- 17. Expenses
    DELETE FROM public.expenses WHERE tenant_id = p_tenant_id;
    
    -- 18. Notifications
    DELETE FROM public.notifications WHERE tenant_id = p_tenant_id;
    
    -- 19. Control number sequences
    DELETE FROM public.control_number_sequences WHERE tenant_id = p_tenant_id;
    
    -- 20. System settings
    DELETE FROM public.system_settings WHERE tenant_id = p_tenant_id;
    
    -- 21. Audit logs
    DELETE FROM public.audit_logs WHERE tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
