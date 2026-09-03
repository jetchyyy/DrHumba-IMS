-- Migration: Stock Portioning & Yield Conversion System
-- Created: 2026-09-04

-- 1. Create portioning_requests table
CREATE TABLE IF NOT EXISTS public.portioning_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT public.get_my_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
    control_number TEXT,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
    source_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    source_quantity NUMERIC NOT NULL CHECK (source_quantity > 0),
    target_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
    target_quantity NUMERIC NOT NULL CHECK (target_quantity > 0),
    waste_quantity NUMERIC DEFAULT 0 CHECK (waste_quantity >= 0),
    waste_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT portioning_requests_tenant_control_number_key UNIQUE (tenant_id, control_number)
);

-- Foreign key constraints for PostgREST profile relationships
ALTER TABLE public.portioning_requests DROP CONSTRAINT IF EXISTS portioning_requests_requested_by_fkey;
ALTER TABLE public.portioning_requests ADD CONSTRAINT portioning_requests_requested_by_fkey 
    FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.portioning_requests DROP CONSTRAINT IF EXISTS portioning_requests_approved_by_fkey;
ALTER TABLE public.portioning_requests ADD CONSTRAINT portioning_requests_approved_by_fkey 
    FOREIGN KEY (approved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 2. Enable RLS and attach tenant auto-stamp trigger
ALTER TABLE public.portioning_requests ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_portioning_requests ON public.portioning_requests;
CREATE TRIGGER tg_auto_stamp_tenant_portioning_requests
  BEFORE INSERT ON public.portioning_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP POLICY IF EXISTS "Read portioning_requests" ON public.portioning_requests;
CREATE POLICY "Read portioning_requests" ON public.portioning_requests 
    FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Insert portioning_requests" ON public.portioning_requests;
CREATE POLICY "Insert portioning_requests" ON public.portioning_requests 
    FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Update portioning_requests" ON public.portioning_requests;
CREATE POLICY "Update portioning_requests" ON public.portioning_requests 
    FOR UPDATE TO authenticated USING (tenant_id = public.get_my_tenant_id());

-- 3. Control Number Generator for Portioning Requests
CREATE OR REPLACE FUNCTION public.fn_generate_portioning_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
    v_tenant_id UUID;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'PRT-' || to_char(now(), 'YYYYMMDD-');
        v_tenant_id := COALESCE(NEW.tenant_id, public.get_my_tenant_id(), '00000000-0000-0000-0000-000000000000');
        
        -- Lock row and increment sequence per tenant
        INSERT INTO public.control_number_sequences (tenant_id, sequence_name, current_val)
        VALUES (v_tenant_id, v_prefix, 1)
        ON CONFLICT (tenant_id, sequence_name) DO UPDATE
        SET current_val = public.control_number_sequences.current_val + 1
        RETURNING current_val INTO v_seq;
        
        NEW.control_number := v_prefix || lpad(v_seq::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tg_generate_portioning_control_number ON public.portioning_requests;
CREATE TRIGGER tg_generate_portioning_control_number
    BEFORE INSERT ON public.portioning_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_generate_portioning_control_number();

-- 4. Update movement_type check constraint on inventory_movements
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check 
    CHECK (movement_type IN (
        'stock_in', 
        'stock_out', 
        'sale_deduction', 
        'transfer_out', 
        'transfer_in', 
        'adjustment', 
        'portioning_out', 
        'portioning_in'
    ));

-- 5. RPC Function: fn_approve_portioning_request
CREATE OR REPLACE FUNCTION public.fn_approve_portioning_request(
    p_request_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_status TEXT;
    v_branch_id UUID;
    v_source_item_id UUID;
    v_source_qty NUMERIC;
    v_target_item_id UUID;
    v_target_qty NUMERIC;
    v_tenant_id UUID;
    v_source_balance NUMERIC;
    v_source_cost NUMERIC;
    v_unit_cost NUMERIC;
    v_my_role TEXT;
    v_source_name TEXT;
    v_target_name TEXT;
BEGIN
    -- Check role permissions
    SELECT role_name INTO v_my_role FROM public.profiles WHERE id = auth.uid();
    IF v_my_role IS NULL OR v_my_role NOT IN ('super_admin', 'inventory_manager', 'branch_manager') THEN
        RAISE EXCEPTION 'Unauthorized: Only Managers and Admins can approve portioning requests.';
    END IF;

    -- Fetch request details
    SELECT status, branch_id, source_item_id, source_quantity, target_item_id, target_quantity, tenant_id
    INTO v_status, v_branch_id, v_source_item_id, v_source_qty, v_target_item_id, v_target_qty, v_tenant_id
    FROM public.portioning_requests
    WHERE id = p_request_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Portioning request not found.';
    END IF;

    IF v_status != 'pending' THEN
        RAISE EXCEPTION 'Portioning request has already been processed.';
    END IF;

    -- Check source item stock balance
    SELECT COALESCE(quantity, 0) INTO v_source_balance
    FROM public.inventory_balances
    WHERE branch_id = v_branch_id AND item_id = v_source_item_id;

    IF v_source_balance < v_source_qty THEN
        RAISE EXCEPTION 'Insufficient inventory balance for source raw item. Available: %, Requested: %', v_source_balance, v_source_qty;
    END IF;

    -- Fetch source item cost per unit & names
    SELECT item_name, cost_per_base_unit INTO v_source_name, v_source_cost
    FROM public.inventory_items WHERE id = v_source_item_id;

    SELECT item_name INTO v_target_name
    FROM public.inventory_items WHERE id = v_target_item_id;

    -- Calculate unit cost for target portioned item (Total cost of source consumed / target pcs)
    IF v_target_qty > 0 AND v_source_cost IS NOT NULL AND v_source_cost > 0 THEN
        v_unit_cost := (v_source_qty * v_source_cost) / v_target_qty;
        UPDATE public.inventory_items
        SET cost_per_base_unit = v_unit_cost,
            updated_at = now()
        WHERE id = v_target_item_id;
    END IF;

    -- 1. Deduct source item stock
    UPDATE public.inventory_balances
    SET quantity = quantity - v_source_qty,
        updated_at = now()
    WHERE branch_id = v_branch_id AND item_id = v_source_item_id;

    -- 2. Add target item stock
    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at)
    VALUES (v_branch_id, v_target_item_id, v_target_qty, now())
    ON CONFLICT (branch_id, item_id)
    DO UPDATE SET quantity = public.inventory_balances.quantity + v_target_qty, updated_at = now();

    -- 3. Log stock movements
    -- Source deduction movement
    INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
    VALUES (v_branch_id, v_source_item_id, -v_source_qty, 'portioning_out', p_request_id, 'portioning', auth.uid(), v_tenant_id);

    -- Target yield movement
    INSERT INTO public.inventory_movements (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
    VALUES (v_branch_id, v_target_item_id, v_target_qty, 'portioning_in', p_request_id, 'portioning', auth.uid(), v_tenant_id);

    -- 4. Mark request approved
    UPDATE public.portioning_requests
    SET status = 'approved',
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    -- 5. Audit log entry
    INSERT INTO public.audit_logs (user_id, action, module, new_value, tenant_id)
    VALUES (
        auth.uid(),
        'APPROVE_PORTIONING_REQUEST',
        'portioning',
        jsonb_build_object(
            'request_id', p_request_id,
            'source_item', v_source_name,
            'source_qty', v_source_qty,
            'target_item', v_target_name,
            'target_qty', v_target_qty,
            'unit_cost', v_unit_cost
        ),
        v_tenant_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
