-- ============================================================
-- MIGRATION: Optional void approval workflow
-- File: 20261126120000_void_approval_workflow.sql
-- ============================================================
-- Tenants can turn on "Require approval for all voids" (system_settings key
-- 'void_approval' = {"require_approval": true}). When ON, only void approvers
-- can void directly; everyone else submits a request that an approver decides.
--
-- Void approvers: super_admin, branch_manager, inventory_manager, platform admin,
-- or staff with the 'sales_void_approve' permission in allowed_tabs.
--
-- When the switch is OFF (default, and for every existing tenant), behaviour is
-- unchanged.
--
-- Also fixes a pre-existing gap: fn_void_sale_items never checked that the sale
-- belongs to the caller's tenant.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_void_requires_approval(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT (value->>'require_approval')::BOOLEAN
         FROM public.system_settings
         WHERE tenant_id = p_tenant_id AND key = 'void_approval'),
        FALSE
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_can_approve_voids()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
              p.role_name IN ('super_admin', 'branch_manager', 'inventory_manager')
              OR COALESCE(p.is_platform_admin, FALSE)
              OR 'sales_void_approve' = ANY(COALESCE(p.allowed_tabs, ARRAY[]::TEXT[]))
          )
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_void_requires_approval(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_can_approve_voids() TO authenticated;

-- ------------------------------------------------------------
-- 2. void_requests table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.void_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    branch_id       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    sale_id         UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
    items           JSONB,              -- NULL = void all remaining items
    refund_amount   NUMERIC NOT NULL DEFAULT 0,
    void_reason     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_by    UUID NOT NULL REFERENCES auth.users(id),
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by      UUID REFERENCES auth.users(id),
    decided_at      TIMESTAMPTZ,
    decision_note   TEXT
);

-- Only one open request per sale at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_void_requests_one_pending_per_sale
    ON public.void_requests (sale_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_void_requests_tenant_status
    ON public.void_requests (tenant_id, status, requested_at DESC);

ALTER TABLE public.void_requests ENABLE ROW LEVEL SECURITY;

-- Read: requester sees own; approvers see their tenant (branch-scoped unless tenant-wide role)
DROP POLICY IF EXISTS "Read void requests" ON public.void_requests;
CREATE POLICY "Read void requests" ON public.void_requests FOR SELECT TO authenticated
    USING (
        tenant_id = (SELECT public.get_my_tenant_id()) AND (
            requested_by = auth.uid()
            OR (SELECT public.get_my_role()) IN ('super_admin', 'inventory_manager', 'auditor')
            OR (SELECT public.is_platform_admin())
            OR ((SELECT public.fn_can_approve_voids()) AND branch_id = (SELECT public.get_my_branch_id()))
        )
    );
-- No INSERT/UPDATE/DELETE policies: all writes go through the SECURITY DEFINER RPCs below.

GRANT SELECT ON public.void_requests TO authenticated;
GRANT ALL ON public.void_requests TO service_role;

-- Realtime so approvers' pending counts update live
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'void_requests'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.void_requests;
        END IF;
    END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Internal void engine (body of the previous fn_void_sale_items, no auth check)
--    Not callable by clients; only by the RPCs below.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fn_apply_sale_void(
    p_sale_id      UUID,
    p_items        JSONB,
    p_void_reason  TEXT,
    p_requested_by UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_status          TEXT;
    v_branch_id       UUID;
    v_tenant_id       UUID;
    v_sale_category   TEXT;
    v_total_amount    NUMERIC;
    v_total_refund    NUMERIC := 0;
    v_remaining_qty   INT;
    r_item            RECORD;
    r_ing             RECORD;
    v_qty_to_void     INT;
    v_qty_return      NUMERIC;
    v_elem            JSONB;
    v_sale_item_id    UUID;
    v_is_dine_in      BOOLEAN := FALSE;
BEGIN
    IF p_void_reason IS NULL OR length(trim(p_void_reason)) < 3 THEN
        RAISE EXCEPTION 'Void reason must be at least 3 characters.';
    END IF;

    SELECT status, branch_id, tenant_id, total_amount, sale_category
    INTO v_status, v_branch_id, v_tenant_id, v_total_amount, v_sale_category
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    IF v_status = 'refunded' THEN
        RAISE EXCEPTION 'Sale % has already been fully refunded.', p_sale_id;
    END IF;

    v_is_dine_in := LOWER(TRIM(COALESCE(v_sale_category, ''))) IN ('dine in', 'dine-in', 'dine');

    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            v_sale_item_id := (v_elem->>'sale_item_id')::UUID;
            v_qty_to_void  := COALESCE((v_elem->>'quantity_to_void')::INT, 1);

            IF v_qty_to_void <= 0 THEN
                CONTINUE;
            END IF;

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

            UPDATE public.sale_items
            SET voided_quantity = voided_quantity + v_qty_to_void,
                void_reason     = p_void_reason,
                voided_at       = now(),
                voided_by       = auth.uid()
            WHERE id = v_sale_item_id;

            v_total_refund := v_total_refund + (r_item.unit_price * v_qty_to_void);

            IF r_item.type = 'restaurant' THEN
                FOR r_ing IN (
                    SELECT ri.item_id, ri.quantity_base_unit, i.item_name
                    FROM public.recipe_ingredients ri
                    JOIN public.recipes         r ON r.id = ri.recipe_id
                    JOIN public.inventory_items i ON i.id = ri.item_id
                    WHERE r.menu_item_id = r_item.menu_item_id
                      AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(i.category, ''))) = 'packaging')
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
                      AND NOT (v_is_dine_in AND LOWER(TRIM(COALESCE(i.category, ''))) = 'packaging')
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

    SELECT COALESCE(SUM(quantity - voided_quantity), 0)
    INTO v_remaining_qty
    FROM public.sale_items
    WHERE sale_id = p_sale_id;

    IF v_remaining_qty <= 0 THEN
        UPDATE public.sales
        SET status          = 'refunded',
            refunded_amount = total_amount,
            voided_by       = auth.uid(),
            voided_at       = now(),
            void_reason     = p_void_reason
        WHERE id = p_sale_id;
    ELSE
        UPDATE public.sales
        SET refunded_amount = COALESCE(refunded_amount, 0) + v_total_refund,
            void_reason     = p_void_reason
        WHERE id = p_sale_id;
    END IF;

    PERFORM public.fn_log_audit(
        auth.uid(),
        'VOID_SALE_ITEMS',
        'Sales',
        json_build_object('sale_id', p_sale_id, 'status', v_status)::jsonb,
        jsonb_strip_nulls(json_build_object(
            'sale_id',         p_sale_id,
            'refund_amount',   v_total_refund,
            'remaining_qty',   v_remaining_qty,
            'void_reason',     p_void_reason,
            'requested_by',    p_requested_by,
            'approved_by',     CASE WHEN p_requested_by IS NOT NULL THEN auth.uid() END
        )::jsonb)
    );

    RETURN v_total_refund;
END;
$function$;

REVOKE ALL ON FUNCTION public._fn_apply_sale_void(UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. fn_void_sale_items: same signature, now a guarded wrapper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_void_sale_items(p_sale_id UUID, p_items JSONB, p_void_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_my_role         TEXT;
    v_my_allowed_tabs TEXT[];
    v_my_tenant_id    UUID;
    v_sale_tenant_id  UUID;
BEGIN
    SELECT role_name, allowed_tabs, tenant_id
    INTO v_my_role, v_my_allowed_tabs, v_my_tenant_id
    FROM public.profiles
    WHERE id = auth.uid();

    IF NOT (
        v_my_role IN ('super_admin', 'branch_manager', 'inventory_manager')
        OR 'sales_void' = ANY(COALESCE(v_my_allowed_tabs, ARRAY[]::TEXT[]))
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Only super_admin, branch_manager, or staff authorized with void permissions can void sale items.';
    END IF;

    SELECT tenant_id INTO v_sale_tenant_id FROM public.sales WHERE id = p_sale_id;
    IF v_sale_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;
    IF v_sale_tenant_id IS DISTINCT FROM v_my_tenant_id AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    IF public.fn_void_requires_approval(v_sale_tenant_id) AND NOT public.fn_can_approve_voids() THEN
        RAISE EXCEPTION 'Voids require approval. Submit a void request instead.';
    END IF;

    PERFORM public._fn_apply_sale_void(p_sale_id, p_items, p_void_reason, NULL);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_void_sale_items(UUID, JSONB, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. fn_request_void: anyone in the tenant who can see the sale may request
--    while approval is on.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_request_void(p_sale_id UUID, p_items JSONB, p_void_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_my_role      TEXT;
    v_my_tenant_id UUID;
    v_my_branch_id UUID;
    v_sale         RECORD;
    v_elem         JSONB;
    v_item         RECORD;
    v_qty          INT;
    v_refund       NUMERIC := 0;
    v_items        JSONB := NULL;
    v_request_id   UUID;
BEGIN
    SELECT role_name, tenant_id, branch_id
    INTO v_my_role, v_my_tenant_id, v_my_branch_id
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_my_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized.';
    END IF;

    IF p_void_reason IS NULL OR length(trim(p_void_reason)) < 3 THEN
        RAISE EXCEPTION 'Void reason must be at least 3 characters.';
    END IF;

    SELECT id, tenant_id, branch_id, status INTO v_sale
    FROM public.sales WHERE id = p_sale_id;

    IF v_sale.id IS NULL OR v_sale.tenant_id <> v_my_tenant_id THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    -- Same visibility as Sales History: tenant-wide roles, otherwise own branch only
    IF v_my_role NOT IN ('super_admin', 'inventory_manager', 'auditor')
       AND v_sale.branch_id IS DISTINCT FROM v_my_branch_id THEN
        RAISE EXCEPTION 'Sale not found.';
    END IF;

    IF v_sale.status = 'refunded' THEN
        RAISE EXCEPTION 'This sale has already been fully refunded.';
    END IF;

    IF NOT public.fn_void_requires_approval(v_my_tenant_id) THEN
        RAISE EXCEPTION 'Void approval is not enabled for this business. Void the sale directly.';
    END IF;

    IF EXISTS (SELECT 1 FROM public.void_requests WHERE sale_id = p_sale_id AND status = 'pending') THEN
        RAISE EXCEPTION 'A void request for this sale is already pending approval.';
    END IF;

    -- Validate quantities now so approvers don't receive impossible requests
    IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
        v_items := '[]'::JSONB;
        FOR v_elem IN SELECT * FROM jsonb_array_elements(p_items) LOOP
            v_qty := COALESCE((v_elem->>'quantity_to_void')::INT, 0);
            CONTINUE WHEN v_qty <= 0;

            SELECT si.id, si.quantity, si.voided_quantity, si.unit_price INTO v_item
            FROM public.sale_items si
            WHERE si.id = (v_elem->>'sale_item_id')::UUID AND si.sale_id = p_sale_id;

            IF v_item.id IS NULL THEN
                RAISE EXCEPTION 'Sale item not found in this sale.';
            END IF;
            IF (v_item.quantity - v_item.voided_quantity) < v_qty THEN
                RAISE EXCEPTION 'Cannot void % units: only % active units remain for this item.',
                    v_qty, (v_item.quantity - v_item.voided_quantity);
            END IF;

            v_refund := v_refund + v_item.unit_price * v_qty;
            v_items := v_items || jsonb_build_array(jsonb_build_object('sale_item_id', v_item.id, 'quantity_to_void', v_qty));
        END LOOP;

        IF jsonb_array_length(v_items) = 0 THEN
            RAISE EXCEPTION 'Select at least one item and quantity to void.';
        END IF;
    ELSE
        SELECT COALESCE(SUM((quantity - voided_quantity) * unit_price), 0) INTO v_refund
        FROM public.sale_items WHERE sale_id = p_sale_id;
    END IF;

    INSERT INTO public.void_requests
        (tenant_id, branch_id, sale_id, items, refund_amount, void_reason, requested_by)
    VALUES
        (v_sale.tenant_id, v_sale.branch_id, p_sale_id, v_items, v_refund, trim(p_void_reason), auth.uid())
    RETURNING id INTO v_request_id;

    PERFORM public.fn_log_audit(
        auth.uid(), 'VOID_REQUESTED', 'Sales', NULL,
        jsonb_build_object('request_id', v_request_id, 'sale_id', p_sale_id,
                           'refund_amount', v_refund, 'void_reason', trim(p_void_reason))
    );

    RETURN v_request_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_request_void(UUID, JSONB, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 6. fn_decide_void_request: approve (runs the void) or reject
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_decide_void_request(p_request_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_my_role      TEXT;
    v_my_tenant_id UUID;
    v_my_branch_id UUID;
    v_req          RECORD;
    v_refund       NUMERIC;
BEGIN
    IF NOT public.fn_can_approve_voids() THEN
        RAISE EXCEPTION 'Unauthorized: you are not allowed to approve void requests.';
    END IF;

    SELECT role_name, tenant_id, branch_id
    INTO v_my_role, v_my_tenant_id, v_my_branch_id
    FROM public.profiles WHERE id = auth.uid();

    SELECT * INTO v_req FROM public.void_requests WHERE id = p_request_id FOR UPDATE;

    IF v_req.id IS NULL OR (v_req.tenant_id <> v_my_tenant_id AND NOT public.is_platform_admin()) THEN
        RAISE EXCEPTION 'Void request not found.';
    END IF;

    IF v_my_role NOT IN ('super_admin', 'inventory_manager')
       AND NOT public.is_platform_admin()
       AND v_req.branch_id IS DISTINCT FROM v_my_branch_id THEN
        RAISE EXCEPTION 'You can only decide void requests for your own branch.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'This void request was already %.', v_req.status;
    END IF;

    IF p_approve THEN
        v_refund := public._fn_apply_sale_void(v_req.sale_id, v_req.items, v_req.void_reason, v_req.requested_by);
    ELSIF p_note IS NULL OR length(trim(p_note)) < 3 THEN
        RAISE EXCEPTION 'Please give a rejection reason (at least 3 characters).';
    END IF;

    UPDATE public.void_requests
    SET status        = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        decided_by    = auth.uid(),
        decided_at    = now(),
        decision_note = NULLIF(trim(COALESCE(p_note, '')), ''),
        refund_amount = COALESCE(v_refund, refund_amount)
    WHERE id = p_request_id;

    PERFORM public.fn_log_audit(
        auth.uid(),
        CASE WHEN p_approve THEN 'VOID_REQUEST_APPROVED' ELSE 'VOID_REQUEST_REJECTED' END,
        'Sales',
        jsonb_build_object('request_id', p_request_id, 'status', 'pending'),
        jsonb_strip_nulls(jsonb_build_object(
            'request_id', p_request_id, 'sale_id', v_req.sale_id,
            'requested_by', v_req.requested_by, 'decision_note', NULLIF(trim(COALESCE(p_note, '')), ''),
            'refund_amount', COALESCE(v_refund, v_req.refund_amount)
        ))
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_decide_void_request(UUID, BOOLEAN, TEXT) TO authenticated;
