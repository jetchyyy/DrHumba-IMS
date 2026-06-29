-- ============================================================
-- MIGRATION: Multi-Business Type POS Support (Restaurant, Retail, Service)
-- ============================================================

-- 1. Add business type toggles to tenants
ALTER TABLE public.tenants 
    ADD COLUMN IF NOT EXISTS is_restaurant BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS is_retail BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_service BOOLEAN DEFAULT false;

-- 2. Add business type toggles to tenant onboarding applications
ALTER TABLE public.tenant_applications 
    ADD COLUMN IF NOT EXISTS is_restaurant BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS is_retail BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_service BOOLEAN DEFAULT false;

-- 3. Add type and inventory item reference to menu items
ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'restaurant' CHECK (type IN ('restaurant', 'retail', 'service')),
    ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL;

-- 4. Set existing records default state (restaurant-only)
UPDATE public.tenants 
SET is_restaurant = true, is_retail = false, is_service = false 
WHERE is_restaurant IS NULL;

UPDATE public.tenant_applications 
SET is_restaurant = true, is_retail = false, is_service = false 
WHERE is_restaurant IS NULL;

UPDATE public.menu_items 
SET type = 'restaurant' 
WHERE type IS NULL;


-- 5. Update fn_process_sale to handle retail and service items dynamically
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id      UUID,
    p_items          JSONB,   -- [{ "menu_item_id": "...", "quantity": N }]
    p_payment_method TEXT    DEFAULT 'cash',
    p_amount_tendered NUMERIC DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_sale_id            UUID;
    r_item               RECORD;
    r_ing                RECORD;
    v_total_amount       NUMERIC := 0;
    v_qty_needed         NUMERIC;
    v_current_qty        NUMERIC;
    v_item_name          TEXT;
    v_menu_name          TEXT;
    v_price              NUMERIC;
    v_subtotal           NUMERIC;
    v_change             NUMERIC;
    -- Extension variables
    v_type               TEXT;
    v_inventory_item_id  UUID;
BEGIN
    -- Validate payment_method
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- 1. Create Sale Record (total calculated below)
    INSERT INTO public.sales (branch_id, cashier_id, total_amount, status, payment_method)
    VALUES (p_branch_id, auth.uid(), 0, 'completed', p_payment_method)
    RETURNING id INTO v_sale_id;

    -- 2. Loop menu items — price calculation + stock deduction
    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch price, name, type, and linked inventory item
        SELECT price, name, type, inventory_item_id INTO v_price, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_total_amount  := v_total_amount + v_subtotal;

        -- Insert sale line item
        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal);

        -- 3. Stock deductions based on item type
        IF v_type = 'restaurant' THEN
            -- Restaurant model: Deduct ingredients according to recipes
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes           r  ON r.id  = ri.recipe_id
                JOIN public.inventory_items   i  ON i.id  = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                SELECT COALESCE(quantity, 0) INTO v_current_qty
                FROM public.inventory_balances
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                    RAISE EXCEPTION 'Insufficient stock for ingredient %: required %, current %',
                        r_ing.item_name, v_qty_needed, COALESCE(v_current_qty, 0);
                END IF;

                -- Deduct balance
                UPDATE public.inventory_balances
                SET quantity = quantity - v_qty_needed, updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                -- Movement ledger
                INSERT INTO public.inventory_movements
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid());

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;
            
        ELSIF v_type = 'retail' THEN
            -- Retail model: Deduct inventory item directly (1-to-1)
            IF v_inventory_item_id IS NULL THEN
                RAISE EXCEPTION 'Retail product % has no linked inventory item.', v_menu_name;
            END IF;

            v_qty_needed := r_item.qty;

            SELECT COALESCE(quantity, 0), i.item_name INTO v_current_qty, v_item_name
            FROM public.inventory_balances ib
            JOIN public.inventory_items i ON i.id = ib.item_id
            WHERE ib.branch_id = p_branch_id AND ib.item_id = v_inventory_item_id;

            -- Fetch item name if balance entry doesn't exist yet
            IF v_item_name IS NULL THEN
                SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = v_inventory_item_id;
            END IF;

            IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                RAISE EXCEPTION 'Insufficient stock for product %: required %, current %',
                    COALESCE(v_item_name, 'Retail Item'), v_qty_needed, COALESCE(v_current_qty, 0);
            END IF;

            -- Deduct balance
            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            -- Movement ledger
            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
            VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid());

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
        END IF;
        -- Note: 'service' items bypass stock deduction completely
    END LOOP;

    -- 4. Calculate change (cash only; card/digital = exact)
    IF p_payment_method = 'cash' AND p_amount_tendered IS NOT NULL THEN
        IF p_amount_tendered < v_total_amount THEN
            RAISE EXCEPTION 'Insufficient tender: total is %, tendered is %', v_total_amount, p_amount_tendered;
        END IF;
        v_change := p_amount_tendered - v_total_amount;
    ELSE
        v_change := 0;
    END IF;

    -- 5. Finalize sale with totals + payment info
    UPDATE public.sales
    SET total_amount    = v_total_amount,
        amount_tendered = p_amount_tendered,
        change_given    = v_change
    WHERE id = v_sale_id;

    -- 6. Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'POS_SALE',
        'Sales',
        NULL,
        json_build_object(
            'sale_id',        v_sale_id,
            'branch_id',      p_branch_id,
            'total_amount',   v_total_amount,
            'payment_method', p_payment_method,
            'amount_tendered',p_amount_tendered,
            'change_given',   v_change
        )::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 6. Update fn_void_sale to reverse retail stock deductions
CREATE OR REPLACE FUNCTION public.fn_void_sale(
    p_sale_id    UUID,
    p_void_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_my_role            TEXT;
    v_status             TEXT;
    v_branch_id          UUID;
    r_item               RECORD;
    r_ing                RECORD;
    v_qty_return         NUMERIC;
BEGIN
    -- Authorization
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role NOT IN ('super_admin', 'branch_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only super_admin or branch_manager can void a sale.';
    END IF;

    -- Fetch sale
    SELECT status, branch_id INTO v_status, v_branch_id
    FROM public.sales WHERE id = p_sale_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    IF v_status = 'refunded' THEN
        RAISE EXCEPTION 'Sale % has already been voided/refunded.', p_sale_id;
    END IF;

    -- Reverse stock deductions based on item type
    FOR r_item IN (
        SELECT si.menu_item_id, si.quantity, m.type, m.inventory_item_id
        FROM public.sale_items si
        JOIN public.menu_items m ON m.id = si.menu_item_id
        WHERE si.sale_id = p_sale_id
    ) LOOP
        IF r_item.type = 'restaurant' THEN
            -- Restore ingredients list
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes           r  ON r.id = ri.recipe_id
                JOIN public.inventory_items   i  ON i.id = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_return := r_ing.quantity_base_unit * r_item.quantity;

                -- Add stock back
                INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
                VALUES (v_branch_id, r_ing.item_id, v_qty_return, now())
                ON CONFLICT (branch_id, item_id)
                DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                -- Reverse movement ledger
                INSERT INTO public.inventory_movements
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
                VALUES
                    (v_branch_id, r_ing.item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid());
            END LOOP;
            
        ELSIF r_item.type = 'retail' THEN
            -- Restore retail item directly
            IF r_item.inventory_item_id IS NULL THEN
                RAISE EXCEPTION 'Retail product has no linked inventory item.';
            END IF;

            v_qty_return := r_item.quantity;

            -- Add stock back
            INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
            VALUES (v_branch_id, r_item.inventory_item_id, v_qty_return, now())
            ON CONFLICT (branch_id, item_id)
            DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

            -- Reverse movement ledger
            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, reference_id, reference_type, created_by)
            VALUES
                (v_branch_id, r_item.inventory_item_id, v_qty_return, p_sale_id, 'void_refund', auth.uid());
        END IF;
        -- Note: 'service' items bypass reversals
    END LOOP;

    -- Mark sale as refunded
    UPDATE public.sales
    SET status      = 'refunded',
        voided_by   = auth.uid(),
        voided_at   = now(),
        void_reason = p_void_reason
    WHERE id = p_sale_id;

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'VOID_SALE',
        'Sales',
        json_build_object('sale_id', p_sale_id, 'old_status', v_status)::jsonb,
        json_build_object('sale_id', p_sale_id, 'new_status', 'refunded', 'void_reason', p_void_reason)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 7. Update fn_approve_tenant_application to copy business type configuration flags
CREATE OR REPLACE FUNCTION public.fn_approve_tenant_application(
    p_app_id UUID
)
RETURNS UUID AS $$
DECLARE
    r_app RECORD;
    v_tenant_id UUID;
    v_admin_id UUID;
    v_max_branches INT;
    v_max_users INT;
BEGIN
    -- Authorization check
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only platform superadmins can approve applications.';
    END IF;

    -- Fetch and lock application record
    SELECT * INTO r_app FROM public.tenant_applications WHERE id = p_app_id FOR UPDATE;
    IF r_app IS NULL THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;
    IF r_app.status != 'pending' THEN
        RAISE EXCEPTION 'Application has already been processed.';
    END IF;

    -- Determine quotas based on plans
    IF r_app.plan_type = 'starter' THEN
        v_max_branches := 1;
        v_max_users := 3;
    ELSIF r_app.plan_type = 'professional' THEN
        v_max_branches := 3;
        v_max_users := 10;
    ELSE
        v_max_branches := 10;
        v_max_users := 30;
    END IF;

    -- Create active tenant with business model types
    INSERT INTO public.tenants (
        name, 
        subdomain, 
        plan_type, 
        billing_cycle, 
        status, 
        max_branches, 
        max_users,
        is_restaurant,
        is_retail,
        is_service
    )
    VALUES (
        r_app.business_name, 
        LOWER(r_app.subdomain), 
        r_app.plan_type, 
        r_app.billing_cycle, 
        'active', 
        v_max_branches, 
        v_max_users,
        COALESCE(r_app.is_restaurant, true),
        COALESCE(r_app.is_retail, false),
        COALESCE(r_app.is_service, false)
    )
    RETURNING id INTO v_tenant_id;

    -- Provision admin user
    v_admin_id := public.internal_provision_tenant_admin(r_app.admin_email, r_app.admin_password_hash, v_tenant_id);

    -- Mark application as approved
    UPDATE public.tenant_applications
    SET status = 'approved', updated_at = now()
    WHERE id = p_app_id;

    RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
