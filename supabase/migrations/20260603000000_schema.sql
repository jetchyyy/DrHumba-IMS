-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. CORE & USER MANAGEMENT
CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_warehouse BOOLEAN NOT NULL DEFAULT false,
    location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role_name TEXT NOT NULL CHECK (role_name IN ('super_admin', 'inventory_manager', 'branch_manager', 'cashier', 'auditor')),
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. INVENTORY CATALOG & BALANCES
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT UNIQUE NOT NULL,
    item_name TEXT NOT NULL,
    category TEXT NOT NULL,
    base_unit TEXT NOT NULL,
    purchase_unit TEXT NOT NULL,
    conversion_factor NUMERIC NOT NULL CHECK (conversion_factor > 0),
    reorder_level NUMERIC NOT NULL CHECK (reorder_level >= 0),
    cost_per_base_unit NUMERIC NOT NULL CHECK (cost_per_base_unit >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_balances (
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    item_id UUID REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (branch_id, item_id)
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    item_id UUID REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    quantity NUMERIC NOT NULL, -- change in base units (can be positive or negative)
    movement_type TEXT NOT NULL CHECK (movement_type IN ('stock_in', 'stock_out', 'sale_deduction', 'transfer_out', 'transfer_in', 'adjustment')),
    reference_id UUID,
    reference_type TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. RECIPES & MENU ITEMS
CREATE TABLE IF NOT EXISTS public.menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    sku TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    price NUMERIC NOT NULL CHECK (price >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    is_available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_item_id UUID UNIQUE REFERENCES public.menu_items(id) ON DELETE CASCADE,
    instructions TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
    recipe_id UUID REFERENCES public.recipes(id) ON DELETE CASCADE,
    item_id UUID REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    quantity_base_unit NUMERIC NOT NULL CHECK (quantity_base_unit > 0),
    PRIMARY KEY (recipe_id, item_id)
);

-- 5. STOCK RECEIVING
CREATE TABLE IF NOT EXISTS public.stock_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier TEXT NOT NULL,
    invoice_no TEXT,
    date_received DATE NOT NULL DEFAULT CURRENT_DATE,
    received_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID REFERENCES public.stock_receipts(id) ON DELETE CASCADE,
    item_id UUID REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    quantity_purchased NUMERIC NOT NULL CHECK (quantity_purchased > 0),
    cost_per_purchase_unit NUMERIC NOT NULL CHECK (cost_per_purchase_unit >= 0)
);

-- 6. TRANSFERS
CREATE TABLE IF NOT EXISTS public.transfer_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    target_branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'completed')),
    requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID REFERENCES public.transfer_requests(id) ON DELETE CASCADE,
    item_id UUID REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    quantity_base_unit NUMERIC NOT NULL CHECK (quantity_base_unit > 0)
);

-- 7. ADJUSTMENTS
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (reason IN ('damage', 'spoilage', 'expired', 'lost', 'manual_correction')),
    remarks TEXT,
    photo_url TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_adjustment_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_id UUID REFERENCES public.stock_adjustments(id) ON DELETE CASCADE,
    item_id UUID REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    quantity_base_unit NUMERIC NOT NULL -- Negative for deduction, positive for correction
);

-- 8. SALES
CREATE TABLE IF NOT EXISTS public.sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
    cashier_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    total_amount NUMERIC NOT NULL CHECK (total_amount >= 0),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID REFERENCES public.sales(id) ON DELETE CASCADE,
    menu_item_id UUID REFERENCES public.menu_items(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    subtotal NUMERIC NOT NULL CHECK (subtotal >= 0)
);

-- 9. AUDITS & NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    ip_address TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('low_stock', 'transfer_pending', 'adjustment_pending', 'system')),
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Helper security functions to fetch role/branch in policies
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
    SELECT role_name FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.get_my_branch_id()
RETURNS UUID AS $$
    SELECT branch_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RLS POLICY RULES

-- 1. Profiles
CREATE POLICY "Allow public read profile" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow profile update self or admin" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id OR public.get_my_role() = 'super_admin');
CREATE POLICY "Admin full manage profile" ON public.profiles FOR ALL TO authenticated USING (public.get_my_role() = 'super_admin');

-- 2. Branches
CREATE POLICY "Read branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin manage branches" ON public.branches FOR ALL TO authenticated USING (public.get_my_role() = 'super_admin');

-- 3. Inventory Items
CREATE POLICY "Read inventory items" ON public.inventory_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Write inventory items" ON public.inventory_items FOR ALL TO authenticated USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));

-- 4. Inventory Balances
CREATE POLICY "Read inventory balances" ON public.inventory_balances FOR SELECT TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
        public.get_my_branch_id() = branch_id
    );
CREATE POLICY "Write inventory balances (admin/manager)" ON public.inventory_balances FOR ALL TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));

-- 5. Inventory Movements (Ledger is Read Only)
CREATE POLICY "Read inventory movements" ON public.inventory_movements FOR SELECT TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
        public.get_my_branch_id() = branch_id
    );
CREATE POLICY "Write inventory movements (internal RPCs)" ON public.inventory_movements FOR INSERT TO authenticated 
    WITH CHECK (
        public.get_my_role() IN ('super_admin', 'inventory_manager') OR
        public.get_my_branch_id() = branch_id
    );

-- 6. Menu Items
CREATE POLICY "Read menu items" ON public.menu_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Write menu items" ON public.menu_items FOR ALL TO authenticated USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));

-- 7. Recipes & Recipe Ingredients
CREATE POLICY "Read recipes" ON public.recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Write recipes" ON public.recipes FOR ALL TO authenticated USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));

CREATE POLICY "Read recipe ingredients" ON public.recipe_ingredients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Write recipe ingredients" ON public.recipe_ingredients FOR ALL TO authenticated USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));

-- 8. Stock Receipts
CREATE POLICY "Read stock receipts" ON public.stock_receipts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Write stock receipts" ON public.stock_receipts FOR ALL TO authenticated USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));

CREATE POLICY "Read stock receipt items" ON public.stock_receipt_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Write stock receipt items" ON public.stock_receipt_items FOR ALL TO authenticated USING (public.get_my_role() IN ('super_admin', 'inventory_manager'));

-- 9. Transfer Requests
CREATE POLICY "Read transfer requests" ON public.transfer_requests FOR SELECT TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
        public.get_my_branch_id() IN (source_branch_id, target_branch_id)
    );
CREATE POLICY "Write transfer requests" ON public.transfer_requests FOR ALL TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager') OR
        public.get_my_branch_id() IN (source_branch_id, target_branch_id)
    );

CREATE POLICY "Read transfer items" ON public.transfer_items FOR SELECT TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.transfer_requests r 
            WHERE r.id = transfer_id AND (
                public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
                public.get_my_branch_id() IN (r.source_branch_id, r.target_branch_id)
            )
        )
    );
CREATE POLICY "Write transfer items" ON public.transfer_items FOR ALL TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager') OR
        EXISTS (
            SELECT 1 FROM public.transfer_requests r 
            WHERE r.id = transfer_id AND public.get_my_branch_id() IN (r.source_branch_id, r.target_branch_id)
        )
    );

-- 10. Adjustments
CREATE POLICY "Read adjustments" ON public.stock_adjustments FOR SELECT TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
        public.get_my_branch_id() = branch_id
    );
CREATE POLICY "Write adjustments" ON public.stock_adjustments FOR ALL TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
        public.get_my_branch_id() = branch_id
    );

CREATE POLICY "Read adjustment items" ON public.stock_adjustment_items FOR SELECT TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.stock_adjustments a 
            WHERE a.id = adjustment_id AND (
                public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
                public.get_my_branch_id() = a.branch_id
            )
        )
    );
CREATE POLICY "Write adjustment items" ON public.stock_adjustment_items FOR ALL TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
        EXISTS (
            SELECT 1 FROM public.stock_adjustments a 
            WHERE a.id = adjustment_id AND public.get_my_branch_id() = a.branch_id
        )
    );

-- 11. Sales & Sale Items
CREATE POLICY "Read sales" ON public.sales FOR SELECT TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
        public.get_my_branch_id() = branch_id
    );
CREATE POLICY "Write sales" ON public.sales FOR INSERT TO authenticated 
    WITH CHECK (
        public.get_my_role() IN ('super_admin', 'branch_manager', 'cashier') AND
        public.get_my_branch_id() = branch_id
    );

CREATE POLICY "Read sale items" ON public.sale_items FOR SELECT TO authenticated 
    USING (
        EXISTS (
            SELECT 1 FROM public.sales s 
            WHERE s.id = sale_id AND (
                public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
                public.get_my_branch_id() = s.branch_id
            )
        )
    );
CREATE POLICY "Write sale items" ON public.sale_items FOR INSERT TO authenticated 
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.sales s 
            WHERE s.id = sale_id AND public.get_my_branch_id() = s.branch_id
        )
    );

-- 12. Audit Logs (Read Only)
CREATE POLICY "Read audit logs" ON public.audit_logs FOR SELECT TO authenticated 
    USING (public.get_my_role() IN ('super_admin', 'auditor'));

-- 13. Notifications
CREATE POLICY "Read notifications" ON public.notifications FOR SELECT TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
        public.get_my_branch_id() = branch_id
    );
CREATE POLICY "Write notifications" ON public.notifications FOR ALL TO authenticated 
    USING (
        public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
        public.get_my_branch_id() = branch_id
    );


-- 10. SYSTEM SYNCS (TRIGGERS)

-- Sync auth.users to public.profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role_name, branch_id)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role_name', 'cashier'),
        (NEW.raw_user_meta_data->>'branch_id')::UUID
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- Helper function to write to audit logs from triggers or RPCs
CREATE OR REPLACE FUNCTION public.fn_log_audit(
    p_user_id UUID,
    p_action TEXT,
    p_module TEXT,
    p_old_value JSONB,
    p_new_value JSONB
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.audit_logs (user_id, action, module, old_value, new_value)
    VALUES (p_user_id, p_action, p_module, p_old_value, p_new_value);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 11. RPC FUNCTIONS (ZERO-CLIENT BUSINESS LOGIC)

-- Create Staff from Admin panel
CREATE OR REPLACE FUNCTION public.fn_create_staff(
    p_email TEXT,
    p_password TEXT,
    p_role TEXT,
    p_branch_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_my_role TEXT;
BEGIN
    -- Authorization check
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR v_my_role != 'super_admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only super admins can create staff accounts.';
    END IF;

    -- Insert into auth.users (triggers profile creation)
    INSERT INTO auth.users (
        id,
        instance_id,
        email,
        encrypted_password,
        email_confirmed_at,
        created_at,
        updated_at,
        raw_app_meta_data,
        raw_user_meta_data,
        aud,
        role,
        is_sso_user,
        phone,
        phone_confirmed_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change
    )
    VALUES (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        p_email,
        extensions.crypt(p_password, extensions.gen_salt('bf')),
        now(),
        now(), -- created_at
        now(), -- updated_at
        '{"provider":"email","providers":["email"]}'::jsonb,
        json_build_object('role_name', p_role, 'branch_id', p_branch_id)::jsonb,
        'authenticated',
        'authenticated',
        false,
        NULL,
        NULL,
        '',
        '',
        '',
        ''
    )
    RETURNING id INTO v_user_id;

    -- Insert into auth.identities to link Email Auth Provider
    INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
    )
    VALUES (
        v_user_id,
        v_user_id,
        json_build_object('sub', v_user_id::TEXT, 'email', p_email)::jsonb,
        'email',
        v_user_id::TEXT,
        now(),
        now(),
        now()
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'CREATE_STAFF',
        'User Management',
        NULL,
        json_build_object('staff_id', v_user_id, 'email', p_email, 'role', p_role, 'branch_id', p_branch_id)::jsonb
    );

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Stock receiving completion
CREATE OR REPLACE FUNCTION public.fn_receive_stock(
    p_receipt_id UUID
)
RETURNS VOID AS $$
DECLARE
    r_item RECORD;
    v_branch_id UUID;
    v_status TEXT;
    v_conv NUMERIC;
    v_item_cost NUMERIC;
BEGIN
    -- Read receipt details
    SELECT branch_id, status INTO v_branch_id, v_status FROM public.stock_receipts WHERE id = p_receipt_id;
    
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stock receipt not found.';
    END IF;
    
    IF v_status = 'completed' THEN
        RAISE EXCEPTION 'Stock receipt already processed.';
    END IF;

    -- Process each item
    FOR r_item IN (
        SELECT ri.item_id, ri.quantity_purchased, ri.cost_per_purchase_unit, i.conversion_factor 
        FROM public.stock_receipt_items ri
        JOIN public.inventory_items i ON i.id = ri.item_id
        WHERE ri.receipt_id = p_receipt_id
    ) LOOP
        -- Calculate quantities in base unit
        -- Quantity in base unit = quantity_purchased * conversion_factor
        -- Cost per base unit = cost_per_purchase_unit / conversion_factor
        v_conv := r_item.quantity_purchased * r_item.conversion_factor;
        v_item_cost := r_item.cost_per_purchase_unit / r_item.conversion_factor;

        -- Update Inventory Balance
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
        VALUES (v_branch_id, r_item.item_id, v_conv, now())
        ON CONFLICT (branch_id, item_id) 
        DO UPDATE SET quantity = public.inventory_balances.quantity + v_conv, updated_at = now();

        -- Update cost per base unit in catalog
        UPDATE public.inventory_items
        SET cost_per_base_unit = v_item_cost, updated_at = now()
        WHERE id = r_item.item_id;

        -- Write movement ledger
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_branch_id, r_item.item_id, v_conv, 'stock_in', p_receipt_id, 'stock_receipt', auth.uid());

        -- Alert trigger check
        PERFORM public.fn_check_low_stock(v_branch_id, r_item.item_id);
    END LOOP;

    -- Complete receipt
    UPDATE public.stock_receipts
    SET status = 'completed', received_by = auth.uid()
    WHERE id = p_receipt_id;

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'RECEIVE_STOCK',
        'Stock Receiving',
        NULL,
        json_build_object('receipt_id', p_receipt_id, 'branch_id', v_branch_id)::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- POS Sale Creation with Transaction-safe recipe deduction & validation
CREATE OR REPLACE FUNCTION public.fn_process_sale(
    p_branch_id UUID,
    p_items JSONB -- Array of { "menu_item_id": "...", "quantity": X }
)
RETURNS UUID AS $$
DECLARE
    v_sale_id UUID;
    r_item RECORD;
    r_ing RECORD;
    v_total_amount NUMERIC := 0;
    v_qty_needed NUMERIC;
    v_current_qty NUMERIC;
    v_item_name TEXT;
    v_menu_name TEXT;
    v_price NUMERIC;
    v_subtotal NUMERIC;
BEGIN
    -- 1. Create Sale Record (Draft or 0 total initially)
    INSERT INTO public.sales (branch_id, cashier_id, total_amount, status)
    VALUES (p_branch_id, auth.uid(), 0, 'completed')
    RETURNING id INTO v_sale_id;

    -- 2. Loop menu items to calculate price and check structure
    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id, (value->>'quantity')::INT AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch price of menu item
        SELECT price, name INTO v_price, v_menu_name FROM public.menu_items WHERE id = r_item.menu_item_id;
        
        v_subtotal := v_price * r_item.qty;
        v_total_amount := v_total_amount + v_subtotal;

        -- Insert Sale Item
        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal);

        -- 3. Ingredient Stock Deductions and Validations
        FOR r_ing IN (
            SELECT ri.item_id, ri.quantity_base_unit, i.item_name
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items i ON i.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id
        ) LOOP
            v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

            -- Check Current Balance
            SELECT COALESCE(quantity, 0) INTO v_current_qty 
            FROM public.inventory_balances 
            WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

            IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                RAISE EXCEPTION 'Insufficient stock for ingredient %: required %, current %', r_ing.item_name, v_qty_needed, COALESCE(v_current_qty, 0);
            END IF;

            -- Deduct stock balance
            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

            -- Write movement ledger
            INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
            VALUES (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', auth.uid());

            -- Check for low stock alert
            PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
        END LOOP;
    END LOOP;

    -- 4. Update total amount on sale
    UPDATE public.sales
    SET total_amount = v_total_amount
    WHERE id = v_sale_id;

    -- 5. Audit Log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'POS_SALE',
        'Sales',
        NULL,
        json_build_object('sale_id', v_sale_id, 'branch_id', p_branch_id, 'total_amount', v_total_amount)::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Transfer request
CREATE OR REPLACE FUNCTION public.fn_request_transfer(
    p_source_branch_id UUID,
    p_target_branch_id UUID,
    p_items JSONB -- Array of { "item_id": "...", "quantity_base_unit": X }
)
RETURNS UUID AS $$
DECLARE
    v_transfer_id UUID;
    r_item RECORD;
BEGIN
    -- Create transfer request
    INSERT INTO public.transfer_requests (source_branch_id, target_branch_id, status, requested_by)
    VALUES (p_source_branch_id, p_target_branch_id, 'requested', auth.uid())
    RETURNING id INTO v_transfer_id;

    -- Insert transfer items
    FOR r_item IN (
        SELECT (value->>'item_id')::UUID AS item_id, (value->>'quantity_base_unit')::NUMERIC AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        INSERT INTO public.transfer_items (transfer_id, item_id, quantity_base_unit)
        VALUES (v_transfer_id, r_item.item_id, r_item.qty);
    END LOOP;

    -- Create notification for target branch
    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        p_target_branch_id,
        'transfer_pending',
        'New transfer request pending approval from ' || (SELECT name FROM public.branches WHERE id = p_source_branch_id)
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_REQUEST',
        'Transfers',
        NULL,
        json_build_object('transfer_id', v_transfer_id, 'source', p_source_branch_id, 'target', p_target_branch_id)::jsonb
    );

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Approve Transfer (with execution and stock deduction)
CREATE OR REPLACE FUNCTION public.fn_approve_transfer(
    p_transfer_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_source UUID;
    v_target UUID;
    v_status TEXT;
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
BEGIN
    SELECT source_branch_id, target_branch_id, status INTO v_source, v_target, v_status 
    FROM public.transfer_requests 
    WHERE id = p_transfer_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Transfer request not found.';
    END IF;

    IF v_status != 'requested' THEN
        RAISE EXCEPTION 'Transfer request is not in requested status.';
    END IF;

    -- Loop transfer items to validate source stock
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.transfer_items WHERE transfer_id = p_transfer_id
    ) LOOP
        SELECT COALESCE(quantity, 0) INTO v_bal 
        FROM public.inventory_balances 
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        IF v_bal < r_item.quantity_base_unit THEN
            SELECT item_name INTO v_name FROM public.inventory_items WHERE id = r_item.item_id;
            RAISE EXCEPTION 'Source branch has insufficient stock for item %: required %, available %', v_name, r_item.quantity_base_unit, v_bal;
        END IF;
    END LOOP;

    -- Execute transfer
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.transfer_items WHERE transfer_id = p_transfer_id
    ) LOOP
        -- Deduct from Source
        UPDATE public.inventory_balances
        SET quantity = quantity - r_item.quantity_base_unit, updated_at = now()
        WHERE branch_id = v_source AND item_id = r_item.item_id;

        -- Add to Target
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
        VALUES (v_target, r_item.item_id, r_item.quantity_base_unit, now())
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.quantity_base_unit, updated_at = now();

        -- Record movement: transfer_out on source
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_source, r_item.item_id, -r_item.quantity_base_unit, 'transfer_out', p_transfer_id, 'transfer', auth.uid());

        -- Record movement: transfer_in on target
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_target, r_item.item_id, r_item.quantity_base_unit, 'transfer_in', p_transfer_id, 'transfer', auth.uid());

        -- Check low stock alerts
        PERFORM public.fn_check_low_stock(v_source, r_item.item_id);
    END LOOP;

    -- Complete request
    UPDATE public.transfer_requests
    SET status = 'completed', approved_by = auth.uid(), reviewed_by = auth.uid(), updated_at = now()
    WHERE id = p_transfer_id;

    -- Notification for requester
    INSERT INTO public.notifications (branch_id, type, message)
    VALUES (
        v_source,
        'system',
        'Transfer request ' || p_transfer_id || ' has been approved and completed.'
    );

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'TRANSFER_APPROVE',
        'Transfers',
        NULL,
        json_build_object('transfer_id', p_transfer_id, 'approved_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Stock Adjustment Completion
CREATE OR REPLACE FUNCTION public.fn_process_adjustment(
    p_adjustment_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_branch UUID;
    v_status TEXT;
    v_reason TEXT;
    r_item RECORD;
    v_bal NUMERIC;
    v_name TEXT;
BEGIN
    SELECT branch_id, status, reason INTO v_branch, v_status, v_reason 
    FROM public.stock_adjustments 
    WHERE id = p_adjustment_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Stock adjustment not found.';
    END IF;

    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Stock adjustment already processed.';
    END IF;

    -- Validate stock levels if adjustment is negative (deduction)
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.stock_adjustment_items WHERE adjustment_id = p_adjustment_id
    ) LOOP
        -- If we are reducing stock, ensure we have enough
        IF r_item.quantity_base_unit < 0 THEN
            SELECT COALESCE(quantity, 0) INTO v_bal 
            FROM public.inventory_balances 
            WHERE branch_id = v_branch AND item_id = r_item.item_id;

            IF v_bal < ABS(r_item.quantity_base_unit) THEN
                SELECT item_name INTO v_name FROM public.inventory_items WHERE id = r_item.item_id;
                RAISE EXCEPTION 'Insufficient stock to apply adjustment for %: balance %, required deduction %', v_name, v_bal, ABS(r_item.quantity_base_unit);
            END IF;
        END IF;
    END LOOP;

    -- Apply Adjustments
    FOR r_item IN (
        SELECT item_id, quantity_base_unit FROM public.stock_adjustment_items WHERE adjustment_id = p_adjustment_id
    ) LOOP
        -- Adjust balance
        INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
        VALUES (v_branch, r_item.item_id, r_item.quantity_base_unit, now())
        ON CONFLICT (branch_id, item_id)
        DO UPDATE SET quantity = public.inventory_balances.quantity + r_item.quantity_base_unit, updated_at = now();

        -- Record movement
        INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by)
        VALUES (v_branch, r_item.item_id, r_item.quantity_base_unit, 'adjustment', p_adjustment_id, 'adjustment', auth.uid());

        -- Alert check
        PERFORM public.fn_check_low_stock(v_branch, r_item.item_id);
    END LOOP;

    -- Complete adjustment
    UPDATE public.stock_adjustments
    SET status = 'approved', approved_by = auth.uid()
    WHERE id = p_adjustment_id;

    -- Audit log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'ADJUSTMENT_APPROVE',
        'Adjustments',
        NULL,
        json_build_object('adjustment_id', p_adjustment_id, 'approved_by', auth.uid())::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Helper: Check stock level and insert alert if low
CREATE OR REPLACE FUNCTION public.fn_check_low_stock(
    p_branch_id UUID,
    p_item_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_qty NUMERIC;
    v_reorder NUMERIC;
    v_item_name TEXT;
    v_branch_name TEXT;
BEGIN
    SELECT COALESCE(quantity, 0) INTO v_qty 
    FROM public.inventory_balances 
    WHERE branch_id = p_branch_id AND item_id = p_item_id;

    SELECT reorder_level, item_name INTO v_reorder, v_item_name 
    FROM public.inventory_items 
    WHERE id = p_item_id;

    IF v_qty < v_reorder THEN
        SELECT name INTO v_branch_name FROM public.branches WHERE id = p_branch_id;
        
        -- Insert a low stock notification if not already alerted recently
        IF NOT EXISTS (
            SELECT 1 FROM public.notifications 
            WHERE branch_id = p_branch_id 
              AND type = 'low_stock' 
              AND message LIKE '%' || v_item_name || '%'
              AND is_read = false
        ) THEN
            INSERT INTO public.notifications (branch_id, type, message)
            VALUES (
                p_branch_id,
                'low_stock',
                'Low Stock Warning: ' || v_item_name || ' is at ' || v_qty || ' (Reorder level: ' || v_reorder || ') at branch ' || v_branch_name
            );
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Get Low Stock Alerts
CREATE OR REPLACE FUNCTION public.get_inventory_alerts()
RETURNS TABLE (
    branch_id UUID,
    branch_name TEXT,
    item_id UUID,
    item_name TEXT,
    sku TEXT,
    current_quantity NUMERIC,
    reorder_level NUMERIC,
    base_unit TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id AS branch_id,
        b.name AS branch_name,
        i.id AS item_id,
        i.item_name,
        i.sku,
        COALESCE(ib.quantity, 0) AS current_quantity,
        i.reorder_level,
        i.base_unit
    FROM public.inventory_items i
    CROSS JOIN public.branches b
    LEFT JOIN public.inventory_balances ib ON ib.item_id = i.id AND ib.branch_id = b.id
    WHERE COALESCE(ib.quantity, 0) < i.reorder_level AND i.status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- Dashboard statistics
CREATE OR REPLACE FUNCTION public.get_overall_dashboard_stats()
RETURNS JSONB AS $$
DECLARE
    v_total_inventory_val NUMERIC := 0;
    v_total_sales NUMERIC := 0;
    v_total_branches INT := 0;
    v_low_stock_count INT := 0;
    v_pending_transfers INT := 0;
    v_today_revenue NUMERIC := 0;
BEGIN
    -- 1. Total inventory value (Sum of (balance * cost_per_base_unit))
    SELECT COALESCE(SUM(ib.quantity * i.cost_per_base_unit), 0)
    INTO v_total_inventory_val
    FROM public.inventory_balances ib
    JOIN public.inventory_items i ON i.id = ib.item_id;

    -- 2. Total Sales (completed sales overall)
    SELECT COALESCE(SUM(total_amount), 0)
    INTO v_total_sales
    FROM public.sales
    WHERE status = 'completed';

    -- 3. Total Branches
    SELECT COUNT(*) INTO v_total_branches FROM public.branches;

    -- 4. Low stock items overall
    SELECT COUNT(*)::INT INTO v_low_stock_count FROM (
        SELECT 1 FROM public.get_inventory_alerts()
    ) sub;

    -- 5. Pending transfers
    SELECT COUNT(*)::INT INTO v_pending_transfers 
    FROM public.transfer_requests 
    WHERE status = 'requested';

    -- 6. Today's Revenue
    SELECT COALESCE(SUM(total_amount), 0)
    INTO v_today_revenue
    FROM public.sales
    WHERE status = 'completed' AND created_at >= CURRENT_DATE;

    RETURN json_build_object(
        'totalInventoryValue', v_total_inventory_val,
        'totalSales', v_total_sales,
        'totalBranches', v_total_branches,
        'lowStockCount', v_low_stock_count,
        'pendingTransfersCount', v_pending_transfers,
        'todayRevenue', v_today_revenue
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;


-- Branch analytics comparison and details
CREATE OR REPLACE FUNCTION public.get_branch_analytics(
    p_branch_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB AS $$
DECLARE
    v_revenue NUMERIC := 0;
    v_orders INT := 0;
    v_food_cost NUMERIC := 0;
    v_waste_cost NUMERIC := 0;
    v_top_products JSONB;
    v_waste_summary JSONB;
BEGIN
    -- 1. Revenue & Orders
    SELECT COALESCE(SUM(total_amount), 0), COUNT(*)::INT
    INTO v_revenue, v_orders
    FROM public.sales
    WHERE branch_id = p_branch_id 
      AND status = 'completed'
      AND created_at BETWEEN p_start_date AND p_end_date;

    -- 2. Food Cost (Sum of (deducted ingredients * cost_per_base_unit) from sales in date range)
    SELECT COALESCE(SUM(ABS(im.quantity) * i.cost_per_base_unit), 0)
    INTO v_food_cost
    FROM public.inventory_movements im
    JOIN public.inventory_items i ON i.id = im.item_id
    WHERE im.branch_id = p_branch_id
      AND im.movement_type = 'sale_deduction'
      AND im.created_at BETWEEN p_start_date AND p_end_date;

    -- 3. Waste Cost (From adjustments that are negative)
    SELECT COALESCE(SUM(ABS(im.quantity) * i.cost_per_base_unit), 0)
    INTO v_waste_cost
    FROM public.inventory_movements im
    JOIN public.inventory_items i ON i.id = im.item_id
    WHERE im.branch_id = p_branch_id
      AND im.movement_type = 'adjustment'
      AND im.quantity < 0
      AND im.created_at BETWEEN p_start_date AND p_end_date;

    -- 4. Top Selling Products
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
    INTO v_top_products
    FROM (
        SELECT mi.name, SUM(si.quantity)::INT AS quantity_sold, SUM(si.subtotal) AS revenue
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        JOIN public.menu_items mi ON mi.id = si.menu_item_id
        WHERE s.branch_id = p_branch_id 
          AND s.status = 'completed'
          AND s.created_at BETWEEN p_start_date AND p_end_date
        GROUP BY mi.name
        ORDER BY quantity_sold DESC
        LIMIT 10
    ) t;

    -- 5. Waste Summary by Category/Reason
    SELECT COALESCE(jsonb_agg(w), '[]'::jsonb)
    INTO v_waste_summary
    FROM (
        SELECT sa.reason, SUM(ABS(sai.quantity_base_unit) * ii.cost_per_base_unit) AS cost, COUNT(DISTINCT sa.id)::INT AS events
        FROM public.stock_adjustments sa
        JOIN public.stock_adjustment_items sai ON sai.adjustment_id = sa.id
        JOIN public.inventory_items ii ON ii.id = sai.item_id
        WHERE sa.branch_id = p_branch_id 
          AND sa.status = 'approved'
          AND sa.created_at BETWEEN p_start_date AND p_end_date
        GROUP BY sa.reason
    ) w;

    RETURN jsonb_build_object(
        'branchId', p_branch_id,
        'revenue', v_revenue,
        'orders', v_orders,
        'foodCost', v_food_cost,
        'wasteCost', v_waste_cost,
        'profitEstimate', (v_revenue - v_food_cost - v_waste_cost),
        'topProducts', v_top_products,
        'wasteSummary', v_waste_summary
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
