-- ============================================================
-- MIGRATION: Kitchen Receipts Management
-- ============================================================

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.kitchen_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    control_number TEXT UNIQUE, -- e.g. KIT-YYYY-MM-XXXX
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.kitchen_receipts ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
DROP POLICY IF EXISTS "Read kitchen receipts" ON public.kitchen_receipts;
CREATE POLICY "Read kitchen receipts" ON public.kitchen_receipts FOR SELECT TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'inventory_manager', 'auditor') OR 
            public.get_my_branch_id() = branch_id
        )
    );

DROP POLICY IF EXISTS "Write kitchen receipts" ON public.kitchen_receipts;
CREATE POLICY "Write kitchen receipts" ON public.kitchen_receipts FOR ALL TO authenticated 
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            public.get_my_role() IN ('super_admin', 'branch_manager', 'cashier') AND
            public.get_my_branch_id() = branch_id
        )
    );

-- 4. Auto tenant stamp trigger
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_kitchen_receipts ON public.kitchen_receipts;
CREATE TRIGGER tg_auto_stamp_tenant_kitchen_receipts
  BEFORE INSERT ON public.kitchen_receipts
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- 5. Control number generator
CREATE OR REPLACE FUNCTION public.fn_generate_kitchen_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'KIT-' || to_char(now(), 'YYYY-MM-');
        
        -- Lock row and increment atomically
        INSERT INTO public.control_number_sequences (sequence_name, current_val)
        VALUES (v_prefix, 1)
        ON CONFLICT (sequence_name) DO UPDATE
        SET current_val = public.control_number_sequences.current_val + 1
        RETURNING current_val INTO v_seq;
        
        NEW.control_number := v_prefix || lpad(v_seq::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_generate_kitchen_control_number ON public.kitchen_receipts;
CREATE TRIGGER tr_generate_kitchen_control_number
    BEFORE INSERT ON public.kitchen_receipts
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_generate_kitchen_control_number();

-- 6. Automatic receipt generation on sale insert
CREATE OR REPLACE FUNCTION public.fn_create_kitchen_receipt_on_sale()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.kitchen_receipts (tenant_id, sale_id, branch_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.branch_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_create_kitchen_receipt_on_sale ON public.sales;
CREATE TRIGGER tr_create_kitchen_receipt_on_sale
    AFTER INSERT ON public.sales
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_create_kitchen_receipt_on_sale();
