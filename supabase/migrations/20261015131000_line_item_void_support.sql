-- Migration: Add line item void support and fn_void_sale_items RPC
-- Timestamp: 20261015131000

-- 1. Add void tracking columns to sale_items
ALTER TABLE public.sale_items
    ADD COLUMN IF NOT EXISTS voided_quantity INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS void_reason TEXT,
    ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES public.profiles(id);

-- 2. Add refunded_amount to sales
ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC NOT NULL DEFAULT 0;

-- 3. Create fn_void_sale_items RPC
CREATE OR REPLACE FUNCTION public.fn_void_sale_items(
    p_sale_id     UUID,
    p_items       JSONB,
    p_void_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_my_role         TEXT;
    v_status          TEXT;
    v_branch_id       UUID;
    v_tenant_id       UUID;
    v_total_amount    NUMERIC;
    v_total_refund    NUMERIC := 0;
    v_remaining_qty   INT;
    r_item            RECORD;
    r_ing             RECORD;
    v_qty_to_void     INT;
    v_qty_return      NUMERIC;
    v_elem            JSONB;
    v_sale_item_id    UUID;
    v_my_allowed_tabs TEXT[];
    v_has_void_perm   BOOLEAN := FALSE;
BEGIN
    -- 1. Authorization Check (Role or Granular 'sales_void' Permission)
    SELECT role_name, allowed_tabs
    INTO v_my_role, v_my_allowed_tabs
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_my_role IN ('super_admin', 'branch_manager', 'inventory_manager') THEN
        v_has_void_perm := TRUE;
    ELSIF v_my_allowed_tabs IS NOT NULL AND 'sales_void' = ANY(v_my_allowed_tabs) THEN
        v_has_void_perm := TRUE;
    END IF;

    IF NOT v_has_void_perm THEN
        RAISE EXCEPTION 'Unauthorized: Only super_admin, branch_manager, or staff authorized with void permissions can void sale items.';
    END IF;

    IF p_void_reason IS NULL OR length(trim(p_void_reason)) < 3 THEN
        RAISE EXCEPTION 'Void reason must be at least 3 characters.';
    END IF;

    -- 2. Fetch Sale
    SELECT status, branch_id, tenant_id, total_amount
    INTO v_status, v_branch_id, v_tenant_id, v_total_amount
    FROM public.sales
    WHERE id = p_sale_id;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    IF v_status = 'refunded' THEN
        RAISE EXCEPTION 'Sale % has already been fully refunded.', p_sale_id;
    END IF;

    -- 3. Process Items to Void
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        -- Specific items selected
        FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            v_sale_item_id := (v_elem->>'sale_item_id')::UUID;
            v_qty_to_void  := COALESCE((v_elem->>'quantity_to_void')::INT, 1);

            IF v_qty_to_void <= 0 THEN
                CONTINUE;
            END IF;

            -- Fetch sale item & menu item
            SELECT si.id, si.quantity, si.voided_quantity, si.unit_price, si.subtotal, m.id AS menu_item_id, m.type, m.inventory_item_id
            INTO r_item
            FROM public.sale_items si
            JOIN public.menu_items m ON m.id = si.menu_item_id
            WHERE si.id = v_sale_item_id AND si.sale_id = p_sale_id;

            IF r_item.id IS NULL THEN
                RAISE EXCEPTION 'Sale item % not found in sale %.', v_sale_item_id, p_sale_id;
            END IF;

            IF (r_item.quantity - r_item.voided_quantity) < v_qty_to_void THEN
                RAISE EXCEPTION 'Cannot void % units: only % active units remain for this item.',
                    v_qty_to_void, (r_item.quantity - r_item.voided_quantity);
            END IF;

            -- Update sale_item voided tracking
            UPDATE public.sale_items
            SET voided_quantity = voided_quantity + v_qty_to_void,
                void_reason     = p_void_reason,
                voided_at       = now(),
                voided_by       = auth.uid()
            WHERE id = v_sale_item_id;

            -- Accumulate refund
            v_total_refund := v_total_refund + (r_item.unit_price * v_qty_to_void);

            -- Restock inventory based on item type
            IF r_item.type = 'restaurant' THEN
                FOR r_ing IN (
                    SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                    FROM public.recipe_ingredients ri
                    JOIN public.recipes         r ON r.id = ri.recipe_id
                    JOIN public.inventory_items i ON i.id = ri.item_id
                    WHERE r.menu_item_id = r_item.menu_item_id
                ) LOOP
                    v_qty_return := r_ing.quantity_base_unit * v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_ing.item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_ing.item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END LOOP;

            ELSIF r_item.type = 'retail' THEN
                IF r_item.inventory_item_id IS NOT NULL THEN
                    v_qty_return := v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_item.inventory_item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_item.inventory_item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END IF;
            END IF;
        END LOOP;
    ELSE
        -- Void ALL remaining active items
        FOR r_item IN (
            SELECT si.id, si.quantity, si.voided_quantity, si.unit_price, si.subtotal, m.id AS menu_item_id, m.type, m.inventory_item_id
            FROM public.sale_items si
            JOIN public.menu_items m ON m.id = si.menu_item_id
            WHERE si.sale_id = p_sale_id AND (si.quantity - si.voided_quantity) > 0
        ) LOOP
            v_qty_to_void := r_item.quantity - r_item.voided_quantity;

            UPDATE public.sale_items
            SET voided_quantity = quantity,
                void_reason     = p_void_reason,
                voided_at       = now(),
                voided_by       = auth.uid()
            WHERE id = r_item.id;

            v_total_refund := v_total_refund + (r_item.unit_price * v_qty_to_void);

            IF r_item.type = 'restaurant' THEN
                FOR r_ing IN (
                    SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                    FROM public.recipe_ingredients ri
                    JOIN public.recipes         r ON r.id = ri.recipe_id
                    JOIN public.inventory_items i ON i.id = ri.item_id
                    WHERE r.menu_item_id = r_item.menu_item_id
                ) LOOP
                    v_qty_return := r_ing.quantity_base_unit * v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_ing.item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_ing.item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END LOOP;

            ELSIF r_item.type = 'retail' THEN
                IF r_item.inventory_item_id IS NOT NULL THEN
                    v_qty_return := v_qty_to_void;

                    INSERT INTO public.inventory_balances (branch_id, item_id, quantity, updated_at, tenant_id)
                    VALUES (v_branch_id, r_item.inventory_item_id, v_qty_return, now(), v_tenant_id)
                    ON CONFLICT (branch_id, item_id)
                    DO UPDATE SET quantity = public.inventory_balances.quantity + v_qty_return, updated_at = now();

                    INSERT INTO public.inventory_movements
                        (branch_id, item_id, quantity, movement_type, reference_id, reference_type, created_by, tenant_id)
                    VALUES
                        (v_branch_id, r_item.inventory_item_id, v_qty_return, 'adjustment', p_sale_id, 'void_refund', auth.uid(), v_tenant_id);
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 4. Check if any active items remain
    SELECT COALESCE(SUM(quantity - voided_quantity), 0)
    INTO v_remaining_qty
    FROM public.sale_items
    WHERE sale_id = p_sale_id;

    IF v_remaining_qty <= 0 THEN
        -- 100% of items voided -> full refund
        UPDATE public.sales
        SET status          = 'refunded',
            refunded_amount = total_amount,
            voided_by       = auth.uid(),
            voided_at       = now(),
            void_reason     = p_void_reason
        WHERE id = p_sale_id;
    ELSE
        -- Partial void -> keep completed status, update refunded_amount and reason
        UPDATE public.sales
        SET refunded_amount = COALESCE(refunded_amount, 0) + v_total_refund,
            void_reason     = p_void_reason
        WHERE id = p_sale_id;
    END IF;

    -- 5. Audit Log
    PERFORM public.fn_log_audit(
        auth.uid(),
        'VOID_SALE_ITEMS',
        'Sales',
        json_build_object('sale_id', p_sale_id, 'status', v_status)::jsonb,
        json_build_object(
            'sale_id',         p_sale_id,
            'refund_amount',   v_total_refund,
            'remaining_qty',   v_remaining_qty,
            'void_reason',     p_void_reason
        )::jsonb
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Backward-compatible fn_void_sale wrapper
CREATE OR REPLACE FUNCTION public.fn_void_sale(
    p_sale_id    UUID,
    p_void_reason TEXT
)
RETURNS VOID AS $$
BEGIN
    PERFORM public.fn_void_sale_items(p_sale_id, NULL, p_void_reason);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_void_sale_items(UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_void_sale(UUID, TEXT) TO authenticated;
