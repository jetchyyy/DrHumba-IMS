-- ============================================================
-- MIGRATION: Isolate Control Sequences and Sync by Tenant
-- ============================================================

-- 1. Alter public.control_number_sequences to include tenant_id
ALTER TABLE public.control_number_sequences 
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- 2. Backfill existing sequence rows with the default tenant ID (Dr. Humba)
UPDATE public.control_number_sequences
SET tenant_id = '00000000-0000-0000-0000-000000000000'
WHERE tenant_id IS NULL;

-- 3. Set NOT NULL and default values
ALTER TABLE public.control_number_sequences 
    ALTER COLUMN tenant_id SET NOT NULL,
    ALTER COLUMN tenant_id SET DEFAULT public.get_my_tenant_id();

-- 4. Rebuild Primary Key to be composite (tenant_id, sequence_name)
ALTER TABLE public.control_number_sequences DROP CONSTRAINT IF EXISTS control_number_sequences_pkey;
ALTER TABLE public.control_number_sequences ADD CONSTRAINT control_number_sequences_pkey PRIMARY KEY (tenant_id, sequence_name);

-- 5. Enable/Re-apply Row-Level Security (RLS) on sequences
ALTER TABLE public.control_number_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read control sequences" ON public.control_number_sequences;
CREATE POLICY "Read control sequences" ON public.control_number_sequences 
    FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Manage control sequences" ON public.control_number_sequences;
CREATE POLICY "Manage control sequences" ON public.control_number_sequences 
    FOR ALL TO authenticated USING (tenant_id = public.get_my_tenant_id());

-- 6. Attach auto-stamp tenant trigger to sequences
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_sequences ON public.control_number_sequences;
CREATE TRIGGER tg_auto_stamp_tenant_sequences
  BEFORE INSERT ON public.control_number_sequences
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- 7. Update Sales Control Number Generator Trigger Function
CREATE OR REPLACE FUNCTION public.fn_generate_sales_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
    v_tenant_id UUID;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'INV-' || to_char(now(), 'YYYY-MM-');
        v_tenant_id := COALESCE(NEW.tenant_id, public.get_my_tenant_id(), '00000000-0000-0000-0000-000000000000');
        
        -- Lock row and increment atomically per tenant
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

-- 8. Update Stock Receipts Control Number Generator Trigger Function
CREATE OR REPLACE FUNCTION public.fn_generate_receipt_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
    v_tenant_id UUID;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'STI-' || to_char(now(), 'YYYY-MM-');
        v_tenant_id := COALESCE(NEW.tenant_id, public.get_my_tenant_id(), '00000000-0000-0000-0000-000000000000');
        
        -- Lock row and increment atomically per tenant
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

-- 9. Update Stock Adjustments Control Number Generator Trigger Function
CREATE OR REPLACE FUNCTION public.fn_generate_adjustment_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
    v_tenant_id UUID;
BEGIN
    IF NEW.control_number IS NULL THEN
        IF NEW.reason IN ('spoilage', 'damage', 'expired') THEN
            v_prefix := 'WST-' || to_char(now(), 'YYYY-MM-');
        ELSE
            v_prefix := 'ADJ-' || to_char(now(), 'YYYY-MM-');
        END IF;
        v_tenant_id := COALESCE(NEW.tenant_id, public.get_my_tenant_id(), '00000000-0000-0000-0000-000000000000');
        
        -- Lock row and increment atomically per tenant
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

-- 10. Update Transfer Requests Control Number Generator Trigger Function
CREATE OR REPLACE FUNCTION public.fn_generate_transfer_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
    v_tenant_id UUID;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'TRF-' || to_char(now(), 'YYYY-MM-');
        v_tenant_id := COALESCE(NEW.tenant_id, public.get_my_tenant_id(), '00000000-0000-0000-0000-000000000000');
        
        -- Lock row and increment atomically per tenant
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

-- 11. Update Z-Read Shift Session Control Number Generator Trigger Function
CREATE OR REPLACE FUNCTION public.fn_generate_zread_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
    v_tenant_id UUID;
BEGIN
    -- Only generate control number when shift session is formally closed (Z-Read is executed)
    IF NEW.status = 'closed' AND NEW.control_number IS NULL THEN
        v_prefix := 'ZRD-' || to_char(now(), 'YYYY-MM-');
        v_tenant_id := COALESCE(NEW.tenant_id, public.get_my_tenant_id(), '00000000-0000-0000-0000-000000000000');
        
        -- Lock row and increment atomically per tenant
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

-- 12. Update fn_process_offline_sale to Isolate Duplicate Control Number Validations by Tenant
CREATE OR REPLACE FUNCTION public.fn_process_offline_sale(
    p_branch_id       UUID,
    p_items           JSONB,   -- [{ "menu_item_id": "...", "quantity": N }]
    p_payment_method  TEXT,
    p_amount_tendered NUMERIC,
    p_sale_category   TEXT,
    p_reference_number TEXT,
    p_control_number  TEXT,
    p_created_at      TIMESTAMPTZ,
    p_cashier_id      UUID
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
    v_type               TEXT;
    v_inventory_item_id  UUID;
    v_cost_price         NUMERIC := 0;
    v_tenant_id          UUID;
BEGIN
    -- Resolve context tenant
    v_tenant_id := public.get_my_tenant_id();

    -- Validate payment_method
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- Validate control number uniqueness strictly within this tenant's scope to prevent duplicate syncs
    IF EXISTS (
        SELECT 1 FROM public.sales 
        WHERE control_number = p_control_number 
          AND tenant_id = v_tenant_id
    ) THEN
        SELECT id INTO v_sale_id FROM public.sales 
        WHERE control_number = p_control_number 
          AND tenant_id = v_tenant_id;
        RETURN v_sale_id; -- Return existing ID if already synced
    END IF;

    -- 1. Create Sale Record (tenant_id auto-stamped by trigger)
    INSERT INTO public.sales (
        branch_id, cashier_id, total_amount, status, payment_method, 
        sale_category, reference_number, control_number, created_at
    )
    VALUES (
        p_branch_id, p_cashier_id, 0, 'completed', p_payment_method, 
        p_sale_category, p_reference_number, p_control_number, p_created_at
    )
    RETURNING id INTO v_sale_id;

    -- 2. Loop menu items
    FOR r_item IN (
        SELECT (value->>'menu_item_id')::UUID AS menu_item_id,
               (value->>'quantity')::INT       AS qty
        FROM jsonb_array_elements(p_items)
    ) LOOP
        -- Fetch item properties
        SELECT price, name, type, inventory_item_id INTO v_price, v_menu_name, v_type, v_inventory_item_id
        FROM public.menu_items
        WHERE id = r_item.menu_item_id;

        IF v_price IS NULL THEN
            RAISE EXCEPTION 'Menu item % not found.', r_item.menu_item_id;
        END IF;

        v_subtotal      := v_price * r_item.qty;
        v_total_amount  := v_total_amount + v_subtotal;

        -- Calculate cost price at time of sale
        IF v_type = 'restaurant' THEN
            SELECT COALESCE(SUM(ri.quantity_base_unit * ii.cost_per_base_unit), 0)
            INTO v_cost_price
            FROM public.recipe_ingredients ri
            JOIN public.recipes r ON r.id = ri.recipe_id
            JOIN public.inventory_items ii ON ii.id = ri.item_id
            WHERE r.menu_item_id = r_item.menu_item_id;
        ELSIF v_type = 'retail' AND v_inventory_item_id IS NOT NULL THEN
            SELECT COALESCE(cost_per_base_unit, 0)
            INTO v_cost_price
            FROM public.inventory_items
            WHERE id = v_inventory_item_id;
        ELSE
            SELECT COALESCE(cost_price, 0)
            INTO v_cost_price
            FROM public.menu_items
            WHERE id = r_item.menu_item_id;
        END IF;

        -- Insert sale line item with cost_price (tenant_id auto-stamped by trigger)
        INSERT INTO public.sale_items (sale_id, menu_item_id, quantity, unit_price, subtotal, cost_price)
        VALUES (v_sale_id, r_item.menu_item_id, r_item.qty, v_price, v_subtotal, COALESCE(v_cost_price, 0));

        -- 3. Stock deductions based on item type
        IF v_type = 'restaurant' THEN
            FOR r_ing IN (
                SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                FROM public.recipe_ingredients ri
                JOIN public.recipes           r  ON r.id  = ri.recipe_id
                JOIN public.inventory_items   i  ON i.id  = ri.item_id
                WHERE r.menu_item_id = r_item.menu_item_id
            ) LOOP
                v_qty_needed := r_ing.quantity_base_unit * r_item.qty;

                -- Deduct stock balance
                UPDATE public.inventory_balances
                SET quantity = quantity - v_qty_needed
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                -- Record inventory movement
                INSERT INTO public.inventory_movements (
                    branch_id, item_id, quantity, movement_type, reference_id, created_at
                )
                VALUES (
                    p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, p_created_at
                );
            END LOOP;
        ELSE
            -- Retail or Service: deduct primary inventory item direct reference if applicable
            IF v_inventory_item_id IS NOT NULL THEN
                UPDATE public.inventory_balances
                SET quantity = quantity - r_item.qty
                WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

                INSERT INTO public.inventory_movements (
                    branch_id, item_id, quantity, movement_type, reference_id, created_at
                )
                VALUES (
                    p_branch_id, v_inventory_item_id, -r_item.qty, 'sale_deduction', v_sale_id, p_created_at
                );
            END IF;
        END IF;
    END LOOP;

    -- Update overall total amount and change
    v_change := p_amount_tendered - v_total_amount;
    IF v_change < 0 THEN
        v_change := 0;
    END IF;

    UPDATE public.sales
    SET total_amount = v_total_amount,
        amount_tendered = p_amount_tendered,
        amount_change = v_change
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
