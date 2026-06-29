-- ============================================================
-- MIGRATION: Offline POS Sync and Terminals Table
-- ============================================================

-- 1. Create terminals table
CREATE TABLE IF NOT EXISTS public.terminals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    terminal_code TEXT NOT NULL,
    name TEXT NOT NULL,
    device_key_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, branch_id, terminal_code)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.terminals ENABLE ROW LEVEL SECURITY;

-- Apply auto-stamp tenant trigger
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_terminals ON public.terminals;
CREATE TRIGGER tg_auto_stamp_tenant_terminals
  BEFORE INSERT ON public.terminals
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- RLS Policies for terminals
DROP POLICY IF EXISTS "Read terminals" ON public.terminals;
CREATE POLICY "Read terminals" ON public.terminals
    FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write terminals" ON public.terminals;
CREATE POLICY "Write terminals" ON public.terminals
    FOR ALL TO authenticated
    USING (
        (public.get_my_role() = 'super_admin' AND tenant_id = public.get_my_tenant_id()) 
        OR public.is_platform_admin()
    );


-- 2. Create the offline sales sync function fn_process_offline_sale
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
BEGIN
    -- Validate payment_method
    IF p_payment_method NOT IN ('cash', 'card', 'gcash', 'maya', 'other') THEN
        RAISE EXCEPTION 'Invalid payment method: %', p_payment_method;
    END IF;

    -- Validate control number uniqueness to prevent duplicate syncs
    IF EXISTS (SELECT 1 FROM public.sales WHERE control_number = p_control_number) THEN
        SELECT id INTO v_sale_id FROM public.sales WHERE control_number = p_control_number;
        RETURN v_sale_id; -- Return existing ID if already synced
    END IF;

    -- 1. Create Sale Record
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

        -- Insert sale line item with cost_price
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

                SELECT COALESCE(quantity, 0) INTO v_current_qty
                FROM public.inventory_balances
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                    RAISE EXCEPTION 'Insufficient stock for ingredient %: required %, current %',
                        r_ing.item_name, v_qty_needed, COALESCE(v_current_qty, 0);
                END IF;

                UPDATE public.inventory_balances
                SET quantity = quantity - v_qty_needed, updated_at = now()
                WHERE branch_id = p_branch_id AND item_id = r_ing.item_id;

                INSERT INTO public.inventory_movements
                    (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, created_at)
                VALUES
                    (p_branch_id, r_ing.item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', p_cashier_id, p_created_at);

                PERFORM public.fn_check_low_stock(p_branch_id, r_ing.item_id);
            END LOOP;
            
        ELSIF v_type = 'retail' THEN
            IF v_inventory_item_id IS NULL THEN
                RAISE EXCEPTION 'Retail product % has no linked inventory item.', v_menu_name;
            END IF;

            v_qty_needed := r_item.qty;

            SELECT COALESCE(quantity, 0), i.item_name INTO v_current_qty, v_item_name
            FROM public.inventory_balances ib
            JOIN public.inventory_items i ON i.id = ib.item_id
            WHERE ib.branch_id = p_branch_id AND ib.item_id = v_inventory_item_id;

            IF v_item_name IS NULL THEN
                SELECT item_name INTO v_item_name FROM public.inventory_items WHERE id = v_inventory_item_id;
            END IF;

            IF v_current_qty IS NULL OR v_current_qty < v_qty_needed THEN
                RAISE EXCEPTION 'Insufficient stock for product %: required %, current %',
                    COALESCE(v_item_name, 'Retail Item'), v_qty_needed, COALESCE(v_current_qty, 0);
            END IF;

            UPDATE public.inventory_balances
            SET quantity = quantity - v_qty_needed, updated_at = now()
            WHERE branch_id = p_branch_id AND item_id = v_inventory_item_id;

            INSERT INTO public.inventory_movements
                (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, created_at)
            VALUES
                (p_branch_id, v_inventory_item_id, -v_qty_needed, 'sale_deduction', v_sale_id, 'sale', p_cashier_id, p_created_at);

            PERFORM public.fn_check_low_stock(p_branch_id, v_inventory_item_id);
        END IF;
    END LOOP;

    -- 4. Calculate change
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
        p_cashier_id,
        'POS_SALE_OFFLINE',
        'Sales',
        NULL,
        json_build_object(
            'sale_id',        v_sale_id,
            'branch_id',      p_branch_id,
            'total_amount',   v_total_amount,
            'payment_method', p_payment_method,
            'amount_tendered',p_amount_tendered,
            'change_given',   v_change,
            'offline_control_number', p_control_number
        )::jsonb
    );

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_process_offline_sale(UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated;
