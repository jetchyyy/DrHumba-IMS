-- 1. TENANTS & PAYMENT TABLES
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    subdomain TEXT UNIQUE,
    plan_type TEXT NOT NULL DEFAULT 'starter' CHECK (plan_type IN ('starter', 'professional', 'enterprise')),
    billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended')),
    max_branches INT NOT NULL DEFAULT 3,
    max_users INT NOT NULL DEFAULT 10,
    features JSONB NOT NULL DEFAULT '{
        "pos": true,
        "sales_history": true,
        "inventory": true,
        "global_inventory": true,
        "receiving": true,
        "transfers": true,
        "adjustments": true,
        "transactions": true,
        "recipes": true,
        "branches": true,
        "analytics": true,
        "audit_logs": true,
        "users": true,
        "settings": true
    }'::jsonb,
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Dr. Humba (Default Tenant)
INSERT INTO public.tenants (id, name, subdomain, plan_type, billing_cycle, status, max_branches, max_users)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    'Dr. Humba',
    NULL, -- primary client does not use subdomain routing
    'enterprise',
    'yearly',
    'active',
    100, -- High quotas for primary client
    100
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tenant_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL,
    subdomain TEXT NOT NULL UNIQUE,
    admin_email TEXT NOT NULL,
    admin_password_hash TEXT NOT NULL, -- temporary representation
    plan_type TEXT NOT NULL CHECK (plan_type IN ('starter', 'professional', 'enterprise')),
    billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
    payment_reference TEXT NOT NULL CHECK (length(payment_reference) >= 5), -- reference to verify payment
    payment_receipt_url TEXT NOT NULL, -- required proof of payment
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_qr_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_method TEXT NOT NULL, -- GCash, Maya, Bank Transfer, etc.
    account_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    qr_code_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. ALTER OPERATIONAL TABLES TO ADD TENANT_ID
-- We add tenant_id to all tables, defaulting to the Dr. Humba tenant UUID ('00000000-0000-0000-0000-000000000000')

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Setup initial platform superadmin flag on existing admin account if needed (seeded later or toggled manually)

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.inventory_balances ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.recipe_ingredients ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.stock_receipts ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.stock_receipt_items ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.transfer_requests ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.transfer_items ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.stock_adjustment_items ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS tenant_id UUID NOT NULL REFERENCES public.tenants(id) DEFAULT '00000000-0000-0000-0000-000000000000';

-- Modify unique constraints to support dynamic tenant SKUs
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS inventory_items_sku_key;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_tenant_sku_key UNIQUE (tenant_id, sku);

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_sku_key;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_tenant_sku_key UNIQUE (tenant_id, sku);

-- 3. RLS HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS UUID AS $$
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN AS $$
    SELECT COALESCE(is_platform_admin, false) FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 4. DROPPING AND RE-CREATING RLS POLICIES WITH TENANT ISOLATION
-- Enable RLS on newly created tables
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_qr_codes ENABLE ROW LEVEL SECURITY;

-- Tenants Policies
DROP POLICY IF EXISTS "Allow public read tenants" ON public.tenants;
CREATE POLICY "Allow public read tenants" ON public.tenants FOR SELECT USING (true);
DROP POLICY IF EXISTS "Platform admins manage tenants" ON public.tenants;
CREATE POLICY "Platform admins manage tenants" ON public.tenants FOR ALL TO authenticated USING (public.is_platform_admin());

-- Tenant Applications Policies
DROP POLICY IF EXISTS "Allow anyone to apply" ON public.tenant_applications;
CREATE POLICY "Allow anyone to apply" ON public.tenant_applications FOR INSERT WITH CHECK (status = 'pending');
DROP POLICY IF EXISTS "Platform admins manage applications" ON public.tenant_applications;
CREATE POLICY "Platform admins manage applications" ON public.tenant_applications FOR ALL TO authenticated USING (public.is_platform_admin());

-- Payment QR Codes Policies
DROP POLICY IF EXISTS "Allow public read active QR codes" ON public.payment_qr_codes;
CREATE POLICY "Allow public read active QR codes" ON public.payment_qr_codes FOR SELECT USING (is_active = true);
DROP POLICY IF EXISTS "Platform admins manage QR codes" ON public.payment_qr_codes;
CREATE POLICY "Platform admins manage QR codes" ON public.payment_qr_codes FOR ALL TO authenticated USING (public.is_platform_admin());

-- Profiles
DROP POLICY IF EXISTS "Allow public read profile" ON public.profiles;
CREATE POLICY "Allow public read profile" ON public.profiles FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Allow profile update self or admin" ON public.profiles;
CREATE POLICY "Allow profile update self or admin" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());
DROP POLICY IF EXISTS "Admin full manage profile" ON public.profiles;
CREATE POLICY "Admin full manage profile" ON public.profiles FOR ALL TO authenticated USING ((public.get_my_role() = 'super_admin' AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Branches
DROP POLICY IF EXISTS "Read branches" ON public.branches;
CREATE POLICY "Read branches" ON public.branches FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Admin manage branches" ON public.branches;
CREATE POLICY "Admin manage branches" ON public.branches FOR ALL TO authenticated USING ((public.get_my_role() = 'super_admin' AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Inventory Items
DROP POLICY IF EXISTS "Read inventory items" ON public.inventory_items;
CREATE POLICY "Read inventory items" ON public.inventory_items FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Write inventory items" ON public.inventory_items;
CREATE POLICY "Write inventory items" ON public.inventory_items FOR ALL TO authenticated USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Inventory Balances
DROP POLICY IF EXISTS "Read inventory balances" ON public.inventory_balances;
CREATE POLICY "Read inventory balances" ON public.inventory_balances FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );
DROP POLICY IF EXISTS "Write inventory balances (admin/manager)" ON public.inventory_balances;
CREATE POLICY "Write inventory balances (admin/manager)" ON public.inventory_balances FOR ALL TO authenticated 
    USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Inventory Movements
DROP POLICY IF EXISTS "Read inventory movements" ON public.inventory_movements;
CREATE POLICY "Read inventory movements" ON public.inventory_movements FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );
DROP POLICY IF EXISTS "Write inventory movements (internal RPCs)" ON public.inventory_movements;
CREATE POLICY "Write inventory movements (internal RPCs)" ON public.inventory_movements FOR INSERT TO authenticated 
    WITH CHECK (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );

-- Menu Items
DROP POLICY IF EXISTS "Read menu items" ON public.menu_items;
CREATE POLICY "Read menu items" ON public.menu_items FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Write menu items" ON public.menu_items;
CREATE POLICY "Write menu items" ON public.menu_items FOR ALL TO authenticated USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Recipes
DROP POLICY IF EXISTS "Read recipes" ON public.recipes;
CREATE POLICY "Read recipes" ON public.recipes FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Write recipes" ON public.recipes;
CREATE POLICY "Write recipes" ON public.recipes FOR ALL TO authenticated USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Recipe Ingredients
DROP POLICY IF EXISTS "Read recipe ingredients" ON public.recipe_ingredients;
CREATE POLICY "Read recipe ingredients" ON public.recipe_ingredients FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Write recipe ingredients" ON public.recipe_ingredients;
CREATE POLICY "Write recipe ingredients" ON public.recipe_ingredients FOR ALL TO authenticated USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Stock Receipts
DROP POLICY IF EXISTS "Read stock receipts" ON public.stock_receipts;
CREATE POLICY "Read stock receipts" ON public.stock_receipts FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Write stock receipts" ON public.stock_receipts;
CREATE POLICY "Write stock receipts" ON public.stock_receipts FOR ALL TO authenticated USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

DROP POLICY IF EXISTS "Read stock receipt items" ON public.stock_receipt_items;
CREATE POLICY "Read stock receipt items" ON public.stock_receipt_items FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Write stock receipt items" ON public.stock_receipt_items;
CREATE POLICY "Write stock receipt items" ON public.stock_receipt_items FOR ALL TO authenticated USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

-- Transfer Requests
DROP POLICY IF EXISTS "Read transfer requests" ON public.transfer_requests;
CREATE POLICY "Read transfer requests" ON public.transfer_requests FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() IN (source_branch_id, target_branch_id)
        ) OR public.is_platform_admin()
    );
DROP POLICY IF EXISTS "Write transfer requests" ON public.transfer_requests;
CREATE POLICY "Write transfer requests" ON public.transfer_requests FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() IN (source_branch_id, target_branch_id)
        ) OR public.is_platform_admin()
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
        ) OR public.is_platform_admin()
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
        ) OR public.is_platform_admin()
    );

-- Adjustments
DROP POLICY IF EXISTS "Read adjustments" ON public.stock_adjustments;
CREATE POLICY "Read adjustments" ON public.stock_adjustments FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );
DROP POLICY IF EXISTS "Write adjustments" ON public.stock_adjustments;
CREATE POLICY "Write adjustments" ON public.stock_adjustments FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
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
        ) OR public.is_platform_admin()
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
        ) OR public.is_platform_admin()
    );

-- Sales & Sale Items
DROP POLICY IF EXISTS "Read sales" ON public.sales;
CREATE POLICY "Read sales" ON public.sales FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );
DROP POLICY IF EXISTS "Write sales" ON public.sales;
CREATE POLICY "Write sales" ON public.sales FOR INSERT TO authenticated 
    WITH CHECK (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'branch_manager', 'cashier') AND
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
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
        ) OR public.is_platform_admin()
    );
DROP POLICY IF EXISTS "Write sale items" ON public.sale_items;
CREATE POLICY "Write sale items" ON public.sale_items FOR INSERT TO authenticated 
    WITH CHECK (
        tenant_id = public.get_my_tenant_id() AND (
            EXISTS (
                SELECT 1 FROM public.sales s 
                WHERE s.id = sale_id AND public.get_my_branch_id() = s.branch_id
            )
        ) OR public.is_platform_admin()
    );

-- Audit Logs
DROP POLICY IF EXISTS "Read audit logs" ON public.audit_logs;
CREATE POLICY "Read audit logs" ON public.audit_logs FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'auditor')
        ) OR public.is_platform_admin()
    );

-- Notifications
DROP POLICY IF EXISTS "Read notifications" ON public.notifications;
CREATE POLICY "Read notifications" ON public.notifications FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );
DROP POLICY IF EXISTS "Write notifications" ON public.notifications;
CREATE POLICY "Write notifications" ON public.notifications FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR 
            public.get_my_branch_id() = branch_id
        ) OR public.is_platform_admin()
    );

-- 5. RE-DEFINE TRIGGERS & RPC FUNCTIONS WITH TENANT CONTEXT

-- Recreate trigger on_auth_user_created trigger function to include tenant_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, role_name, branch_id, tenant_id)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role_name', 'cashier'),
        (NEW.raw_user_meta_data->>'branch_id')::UUID,
        COALESCE(
            (NEW.raw_user_meta_data->>'tenant_id')::UUID,
            '00000000-0000-0000-0000-000000000000' -- default to Dr. Humba if tenant context not supplied
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate fn_create_staff with tenant_id context
CREATE OR REPLACE FUNCTION public.fn_create_staff(
    p_email TEXT,
    p_password TEXT,
    p_role TEXT,
    p_branch_id UUID,
    p_allowed_tabs TEXT[]
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_my_role TEXT;
    v_my_tenant_id UUID;
BEGIN
    -- Authorization & Tenant context check
    SELECT role_name, tenant_id INTO v_my_role, v_my_tenant_id FROM public.profiles WHERE id = auth.uid();
    IF (v_my_role IS NULL OR v_my_role != 'super_admin') AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can create staff accounts.';
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
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        json_build_object('role_name', p_role, 'branch_id', p_branch_id, 'tenant_id', v_my_tenant_id)::jsonb,
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

    -- Set custom allowed tabs on the profile
    UPDATE public.profiles
    SET allowed_tabs = p_allowed_tabs
    WHERE id = v_user_id;

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

-- 6. DYNAMIC QUOTA ENFORCEMENT TRIGGERS
-- Trigger for branch limit
CREATE OR REPLACE FUNCTION public.check_branch_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_limit INT;
    v_count INT;
BEGIN
    SELECT max_branches INTO v_limit FROM public.tenants WHERE id = NEW.tenant_id;
    SELECT COUNT(*) INTO v_count FROM public.branches WHERE tenant_id = NEW.tenant_id;
    
    IF v_count >= v_limit THEN
        RAISE EXCEPTION 'Branch limit reached for this tenant plan (max: %).', v_limit;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_check_branch_limit ON public.branches;
CREATE TRIGGER tg_check_branch_limit
BEFORE INSERT ON public.branches
FOR EACH ROW EXECUTE PROCEDURE public.check_branch_limit();

-- Trigger for user limit
CREATE OR REPLACE FUNCTION public.check_user_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_limit INT;
    v_count INT;
BEGIN
    SELECT max_users INTO v_limit FROM public.tenants WHERE id = NEW.tenant_id;
    SELECT COUNT(*) INTO v_count FROM public.profiles WHERE tenant_id = NEW.tenant_id;
    
    IF v_count >= v_limit THEN
        RAISE EXCEPTION 'User account limit reached for this tenant plan (max: %).', v_limit;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_check_user_limit ON public.profiles;
CREATE TRIGGER tg_check_user_limit
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE PROCEDURE public.check_user_limit();

-- 7. PLATFORM ADMINISTRATIVE FUNCTIONS (SECURITY DEFINER)
-- Helper function to provision a new user under a specific tenant (for admin users)
CREATE OR REPLACE FUNCTION public.internal_provision_tenant_admin(
    p_email TEXT,
    p_password TEXT,
    p_tenant_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
BEGIN
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
        now(),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        json_build_object('role_name', 'super_admin', 'branch_id', NULL, 'tenant_id', p_tenant_id)::jsonb,
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

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Platform admin function to manually onboard a tenant and its admin in a transaction
CREATE OR REPLACE FUNCTION public.fn_create_tenant_manually(
    p_name TEXT,
    p_subdomain TEXT,
    p_plan TEXT,
    p_cycle TEXT,
    p_email TEXT,
    p_password TEXT
)
RETURNS UUID AS $$
DECLARE
    v_tenant_id UUID;
    v_admin_id UUID;
    v_max_branches INT;
    v_max_users INT;
BEGIN
    -- Authorization check
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Only platform superadmins can manually onboard tenants.';
    END IF;

    -- Determine quotas based on plans
    IF p_plan = 'starter' THEN
        v_max_branches := 1;
        v_max_users := 3;
    ELSIF p_plan = 'professional' THEN
        v_max_branches := 3;
        v_max_users := 10;
    ELSE
        v_max_branches := 10;
        v_max_users := 30;
    END IF;

    -- Insert tenant
    INSERT INTO public.tenants (name, subdomain, plan_type, billing_cycle, status, max_branches, max_users)
    VALUES (p_name, LOWER(p_subdomain), p_plan, p_cycle, 'active', v_max_branches, v_max_users)
    RETURNING id INTO v_tenant_id;

    -- Provision admin user
    v_admin_id := public.internal_provision_tenant_admin(p_email, p_password, v_tenant_id);

    RETURN v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Platform admin function to approve a self-registered tenant application
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

    -- Create active tenant
    INSERT INTO public.tenants (name, subdomain, plan_type, billing_cycle, status, max_branches, max_users)
    VALUES (r_app.business_name, LOWER(r_app.subdomain), r_app.plan_type, r_app.billing_cycle, 'active', v_max_branches, v_max_users)
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
