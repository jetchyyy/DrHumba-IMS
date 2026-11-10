-- ============================================================
-- MIGRATION: Branch Table Management & POS Running Bills
-- ============================================================

-- 1. Add enable_table_service flag to branches
ALTER TABLE public.branches 
ADD COLUMN IF NOT EXISTS enable_table_service BOOLEAN NOT NULL DEFAULT false;

-- 2. Create restaurant_tables table
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    table_number TEXT NOT NULL,
    zone TEXT NOT NULL DEFAULT 'Main Dining',
    capacity INT NOT NULL DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'billed_out', 'cleaning', 'reserved')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    current_tab_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_branch_table UNIQUE (tenant_id, branch_id, table_number)
);

-- 3. Create pos_tabs table (Open Tabs / Running Bills)
CREATE TABLE IF NOT EXISTS public.pos_tabs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
    server_id UUID REFERENCES public.profiles(id),
    server_name TEXT,
    pax_count INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'billed_out', 'settled', 'cancelled')),
    notes TEXT,
    discount_type TEXT,
    discount_amount NUMERIC(12,2) DEFAULT 0,
    discount_metadata JSONB DEFAULT '[]'::jsonb,
    sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);

-- 4. Foreign key from restaurant_tables.current_tab_id to pos_tabs.id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_restaurant_tables_current_tab'
    ) THEN
        ALTER TABLE public.restaurant_tables
        ADD CONSTRAINT fk_restaurant_tables_current_tab
        FOREIGN KEY (current_tab_id) REFERENCES public.pos_tabs(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 5. Create pos_tab_items table
CREATE TABLE IF NOT EXISTS public.pos_tab_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    tab_id UUID NOT NULL REFERENCES public.pos_tabs(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES public.menu_items(id),
    quantity INT NOT NULL DEFAULT 1,
    price NUMERIC(12,2) NOT NULL,
    notes TEXT,
    round_number INT NOT NULL DEFAULT 1,
    kitchen_status TEXT NOT NULL DEFAULT 'pending' CHECK (kitchen_status IN ('pending', 'sent', 'served', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_tab_items ENABLE ROW LEVEL SECURITY;

-- 7. Auto stamp tenant triggers
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_restaurant_tables ON public.restaurant_tables;
CREATE TRIGGER tg_auto_stamp_tenant_restaurant_tables
  BEFORE INSERT ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_pos_tabs ON public.pos_tabs;
CREATE TRIGGER tg_auto_stamp_tenant_pos_tabs
  BEFORE INSERT ON public.pos_tabs
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_pos_tab_items ON public.pos_tab_items;
CREATE TRIGGER tg_auto_stamp_tenant_pos_tab_items
  BEFORE INSERT ON public.pos_tab_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- 8. RLS Policies
-- restaurant_tables
DROP POLICY IF EXISTS "Read restaurant_tables" ON public.restaurant_tables;
CREATE POLICY "Read restaurant_tables" ON public.restaurant_tables
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write restaurant_tables" ON public.restaurant_tables;
CREATE POLICY "Write restaurant_tables" ON public.restaurant_tables
  FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

-- pos_tabs
DROP POLICY IF EXISTS "Read pos_tabs" ON public.pos_tabs;
CREATE POLICY "Read pos_tabs" ON public.pos_tabs
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write pos_tabs" ON public.pos_tabs;
CREATE POLICY "Write pos_tabs" ON public.pos_tabs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

-- pos_tab_items
DROP POLICY IF EXISTS "Read pos_tab_items" ON public.pos_tab_items;
CREATE POLICY "Read pos_tab_items" ON public.pos_tab_items
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write pos_tab_items" ON public.pos_tab_items;
CREATE POLICY "Write pos_tab_items" ON public.pos_tab_items
  FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

-- 9. Automatic synchronization between pos_tabs and restaurant_tables status
CREATE OR REPLACE FUNCTION public.fn_sync_table_status_from_tab()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.restaurant_tables
        SET current_tab_id = NEW.id,
            status = CASE WHEN NEW.status = 'billed_out' THEN 'billed_out' ELSE 'occupied' END,
            updated_at = now()
        WHERE id = NEW.table_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status IN ('settled', 'cancelled') THEN
            UPDATE public.restaurant_tables
            SET current_tab_id = NULL,
                status = 'available',
                updated_at = now()
            WHERE id = NEW.table_id AND (current_tab_id = NEW.id OR current_tab_id IS NULL);
        ELSIF NEW.status = 'billed_out' THEN
            UPDATE public.restaurant_tables
            SET status = 'billed_out',
                updated_at = now()
            WHERE id = NEW.table_id;
        ELSIF NEW.status = 'open' THEN
            UPDATE public.restaurant_tables
            SET current_tab_id = NEW.id,
                status = 'occupied',
                updated_at = now()
            WHERE id = NEW.table_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_sync_table_status_from_tab ON public.pos_tabs;
CREATE TRIGGER tr_sync_table_status_from_tab
    AFTER INSERT OR UPDATE ON public.pos_tabs
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_sync_table_status_from_tab();

