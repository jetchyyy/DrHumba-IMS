-- ============================================================
-- MIGRATION: Strict Tenant Isolation in RLS Policies
-- ============================================================

-- 1. Branches
DROP POLICY IF EXISTS "Read branches" ON public.branches;
CREATE POLICY "Read branches" ON public.branches FOR SELECT TO authenticated 
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Admin manage branches" ON public.branches;
CREATE POLICY "Admin manage branches" ON public.branches FOR ALL TO authenticated 
    USING (public.get_my_role() = 'super_admin' AND tenant_id = public.get_my_tenant_id());

-- 2. Inventory Items
DROP POLICY IF EXISTS "Read inventory items" ON public.inventory_items;
CREATE POLICY "Read inventory items" ON public.inventory_items FOR SELECT TO authenticated 
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write inventory items" ON public.inventory_items;
CREATE POLICY "Write inventory items" ON public.inventory_items FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

-- 3. Inventory Balances
DROP POLICY IF EXISTS "Read inventory balances" ON public.inventory_balances;
CREATE POLICY "Read inventory balances" ON public.inventory_balances FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Write inventory balances (admin/manager)" ON public.inventory_balances;
CREATE POLICY "Write inventory balances (admin/manager)" ON public.inventory_balances FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

-- 4. Inventory Movements
DROP POLICY IF EXISTS "Read inventory movements" ON public.inventory_movements;
CREATE POLICY "Read inventory movements" ON public.inventory_movements FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Write inventory movements (internal RPCs)" ON public.inventory_movements;
CREATE POLICY "Write inventory movements (internal RPCs)" ON public.inventory_movements FOR INSERT TO authenticated 
    WITH CHECK (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() = branch_id
        )
    );

-- 5. Menu Items
DROP POLICY IF EXISTS "Read menu items" ON public.menu_items;
CREATE POLICY "Read menu items" ON public.menu_items FOR SELECT TO authenticated 
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write menu items" ON public.menu_items;
CREATE POLICY "Write menu items" ON public.menu_items FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

-- 6. Recipes
DROP POLICY IF EXISTS "Read recipes" ON public.recipes;
CREATE POLICY "Read recipes" ON public.recipes FOR SELECT TO authenticated 
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write recipes" ON public.recipes;
CREATE POLICY "Write recipes" ON public.recipes FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

-- 7. Recipe Ingredients
DROP POLICY IF EXISTS "Read recipe ingredients" ON public.recipe_ingredients;
CREATE POLICY "Read recipe ingredients" ON public.recipe_ingredients FOR SELECT TO authenticated 
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write recipe ingredients" ON public.recipe_ingredients;
CREATE POLICY "Write recipe ingredients" ON public.recipe_ingredients FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

-- 8. Stock Receipts
DROP POLICY IF EXISTS "Read stock receipts" ON public.stock_receipts;
CREATE POLICY "Read stock receipts" ON public.stock_receipts FOR SELECT TO authenticated 
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write stock receipts" ON public.stock_receipts;
CREATE POLICY "Write stock receipts" ON public.stock_receipts FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Read stock receipt items" ON public.stock_receipt_items;
CREATE POLICY "Read stock receipt items" ON public.stock_receipt_items FOR SELECT TO authenticated 
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write stock receipt items" ON public.stock_receipt_items;
CREATE POLICY "Write stock receipt items" ON public.stock_receipt_items FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

-- 9. Transfer Requests
DROP POLICY IF EXISTS "Read transfer requests" ON public.transfer_requests;
CREATE POLICY "Read transfer requests" ON public.transfer_requests FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() IN (source_branch_id, target_branch_id)
        )
    );

DROP POLICY IF EXISTS "Write transfer requests" ON public.transfer_requests;
CREATE POLICY "Write transfer requests" ON public.transfer_requests FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() IN (source_branch_id, target_branch_id)
        )
    );

DROP POLICY IF EXISTS "Read transfer items" ON public.transfer_items;
CREATE POLICY "Read transfer items" ON public.transfer_items FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            EXISTS (
                SELECT 1 FROM public.transfer_requests r 
                WHERE r.id = transfer_id AND (
                    public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
                    public.get_my_branch_id() IN (r.source_branch_id, r.target_branch_id)
                )
            )
        )
    );

DROP POLICY IF EXISTS "Write transfer items" ON public.transfer_items;
CREATE POLICY "Write transfer items" ON public.transfer_items FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            EXISTS (
                SELECT 1 FROM public.transfer_requests r 
                WHERE r.id = transfer_id AND public.get_my_branch_id() IN (r.source_branch_id, r.target_branch_id)
            )
        )
    );

-- 10. Adjustments
DROP POLICY IF EXISTS "Read adjustments" ON public.stock_adjustments;
CREATE POLICY "Read adjustments" ON public.stock_adjustments FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Write adjustments" ON public.stock_adjustments;
CREATE POLICY "Write adjustments" ON public.stock_adjustments FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Read adjustment items" ON public.stock_adjustment_items;
CREATE POLICY "Read adjustment items" ON public.stock_adjustment_items FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            EXISTS (
                SELECT 1 FROM public.stock_adjustments a 
                WHERE a.id = adjustment_id AND (
                    public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
                    public.get_my_branch_id() = a.branch_id
                )
            )
        )
    );

DROP POLICY IF EXISTS "Write adjustment items" ON public.stock_adjustment_items;
CREATE POLICY "Write adjustment items" ON public.stock_adjustment_items FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
            EXISTS (
                SELECT 1 FROM public.stock_adjustments a 
                WHERE a.id = adjustment_id AND public.get_my_branch_id() = a.branch_id
            )
        )
    );

-- 11. Sales & Sale Items
DROP POLICY IF EXISTS "Read sales" ON public.sales;
CREATE POLICY "Read sales" ON public.sales FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Write sales" ON public.sales;
CREATE POLICY "Write sales" ON public.sales FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'branch_manager', 'cashier') AND
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Read sale items" ON public.sale_items;
CREATE POLICY "Read sale items" ON public.sale_items FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            EXISTS (
                SELECT 1 FROM public.sales s 
                WHERE s.id = sale_id AND (
                    public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
                    public.get_my_branch_id() = s.branch_id
                )
            )
        )
    );

DROP POLICY IF EXISTS "Write sale items" ON public.sale_items;
CREATE POLICY "Write sale items" ON public.sale_items FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            EXISTS (
                SELECT 1 FROM public.sales s 
                WHERE s.id = sale_id AND public.get_my_branch_id() = s.branch_id
            )
        )
    );

-- 12. Audit Logs
DROP POLICY IF EXISTS "Read audit logs" ON public.audit_logs;
CREATE POLICY "Read audit logs" ON public.audit_logs FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'auditor')
        )
    );

-- 13. Notifications
DROP POLICY IF EXISTS "Read notifications" ON public.notifications;
CREATE POLICY "Read notifications" ON public.notifications FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Write notifications" ON public.notifications;
CREATE POLICY "Write notifications" ON public.notifications FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
            public.get_my_branch_id() = branch_id
        )
    );

-- 14. Cashier Sessions & Terminal Counters
DROP POLICY IF EXISTS "Read terminal counters" ON public.terminal_counters;
CREATE POLICY "Read terminal counters" ON public.terminal_counters FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write terminal counters" ON public.terminal_counters;
CREATE POLICY "Write terminal counters" ON public.terminal_counters FOR ALL TO authenticated
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Read cashier sessions" ON public.cashier_sessions;
CREATE POLICY "Read cashier sessions" ON public.cashier_sessions FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write cashier sessions" ON public.cashier_sessions;
CREATE POLICY "Write cashier sessions" ON public.cashier_sessions FOR ALL TO authenticated
    USING (tenant_id = public.get_my_tenant_id());
