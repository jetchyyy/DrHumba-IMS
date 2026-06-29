-- ============================================================
-- MIGRATION: BIR-Compliant X-Read & Z-Report Shift Compliance
-- ============================================================

-- 1. Create terminal_counters table to track lifetime cumulative grand totals
CREATE TABLE IF NOT EXISTS public.terminal_counters (
    branch_id UUID PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    last_z_counter INT NOT NULL DEFAULT 0,
    grand_cumulative_sales NUMERIC NOT NULL DEFAULT 0 CHECK (grand_cumulative_sales >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Create cashier_sessions table to manage registers shifts
CREATE TABLE IF NOT EXISTS public.cashier_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    cashier_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    opening_balance NUMERIC NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
    closing_balance NUMERIC CHECK (closing_balance >= 0),
    actual_cash NUMERIC CHECK (actual_cash >= 0),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    z_counter INT NOT NULL DEFAULT 0,
    grand_total_start NUMERIC NOT NULL DEFAULT 0,
    grand_total_end NUMERIC NOT NULL DEFAULT 0,
    sales_summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Enable RLS on both tables
ALTER TABLE public.terminal_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashier_sessions ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies with tenant isolation
DROP POLICY IF EXISTS "Read terminal counters" ON public.terminal_counters;
CREATE POLICY "Read terminal counters" ON public.terminal_counters FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "Write terminal counters" ON public.terminal_counters;
CREATE POLICY "Write terminal counters" ON public.terminal_counters FOR ALL TO authenticated
    USING ((public.get_my_role() IN ('super_admin', 'inventory_manager') AND tenant_id = public.get_my_tenant_id()) OR public.is_platform_admin());

DROP POLICY IF EXISTS "Read cashier sessions" ON public.cashier_sessions;
CREATE POLICY "Read cashier sessions" ON public.cashier_sessions FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());

DROP POLICY IF EXISTS "Write cashier sessions" ON public.cashier_sessions;
CREATE POLICY "Write cashier sessions" ON public.cashier_sessions FOR ALL TO authenticated
    USING (tenant_id = public.get_my_tenant_id() OR public.is_platform_admin());

-- 5. Attach auto-tenant stamp triggers
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_counters ON public.terminal_counters;
CREATE TRIGGER tg_auto_stamp_tenant_counters
  BEFORE INSERT ON public.terminal_counters
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_cashier_sessions ON public.cashier_sessions;
CREATE TRIGGER tg_auto_stamp_cashier_sessions
  BEFORE INSERT ON public.cashier_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();


-- 6. Trigger inside fn_process_sale to update terminal grand totals
-- We'll create a trigger to auto-update terminal counters on completed sales.
CREATE OR REPLACE FUNCTION public.fn_increment_terminal_grand_total()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        INSERT INTO public.terminal_counters (branch_id, tenant_id, last_z_counter, grand_cumulative_sales)
        VALUES (NEW.branch_id, NEW.tenant_id, 0, NEW.total_amount)
        ON CONFLICT (branch_id) DO UPDATE SET
            grand_cumulative_sales = public.terminal_counters.grand_cumulative_sales + EXCLUDED.grand_cumulative_sales,
            updated_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tg_increment_terminal_grand_total ON public.sales;
CREATE TRIGGER tg_increment_terminal_grand_total
    AFTER INSERT ON public.sales
    FOR EACH ROW EXECUTE FUNCTION public.fn_increment_terminal_grand_total();


-- 7. RPC: Open register session
CREATE OR REPLACE FUNCTION public.fn_open_cashier_session(
    p_branch_id UUID,
    p_opening_balance NUMERIC
)
RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
    v_last_z INT := 0;
    v_grand_sales NUMERIC := 0;
    v_tenant_id UUID;
BEGIN
    v_tenant_id := public.get_my_tenant_id();

    -- Check if there is already an active session open for this cashier + branch
    IF EXISTS (
        SELECT 1 FROM public.cashier_sessions
        WHERE branch_id = p_branch_id 
          AND cashier_id = auth.uid() 
          AND status = 'open' 
          AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'You already have an active cash drawer session open for this branch.';
    END IF;

    -- Fetch latest terminal state
    SELECT COALESCE(last_z_counter, 0), COALESCE(grand_cumulative_sales, 0)
    INTO v_last_z, v_grand_sales
    FROM public.terminal_counters
    WHERE branch_id = p_branch_id AND tenant_id = v_tenant_id;

    -- If no terminal row exists, insert one
    IF v_grand_sales IS NULL OR NOT FOUND THEN
        INSERT INTO public.terminal_counters (branch_id, tenant_id, last_z_counter, grand_cumulative_sales)
        VALUES (p_branch_id, v_tenant_id, 0, 0)
        RETURNING last_z_counter, grand_cumulative_sales INTO v_last_z, v_grand_sales;
    END IF;

    -- Open the session
    INSERT INTO public.cashier_sessions (
        tenant_id, branch_id, cashier_id, status, opening_balance,
        z_counter, grand_total_start, grand_total_end
    )
    VALUES (
        v_tenant_id, p_branch_id, auth.uid(), 'open', p_opening_balance,
        v_last_z, v_grand_sales, v_grand_sales
    )
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 8. RPC: Get session summary (computes totals dynamically)
CREATE OR REPLACE FUNCTION public.fn_get_session_summary(
    p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
    r_session RECORD;
    v_summary JSONB;
BEGIN
    -- Fetch session details
    SELECT * INTO r_session FROM public.cashier_sessions WHERE id = p_session_id;
    IF r_session IS NULL THEN
        RAISE EXCEPTION 'Register session not found.';
    END IF;

    -- Compute aggregates for sales completed under this cashier & branch during session hours
    SELECT json_build_object(
        'openedAt',        r_session.opened_at,
        'closedAt',        r_session.closed_at,
        'cashierId',       r_session.cashier_id,
        'openingBalance',  r_session.opening_balance,
        'status',          r_session.status,
        'zCounter',        r_session.z_counter,
        'grandTotalStart', r_session.grand_total_start,
        'grandTotalEnd',   r_session.grand_total_end,
        'grossSales',      COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0),
        'netSales',        COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) / 1.12,
        'vatAmount',       (COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) / 1.12) * 0.12,
        'transactionCount',COUNT(*)::INT,
        'cashSales',       COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'cash' THEN total_amount ELSE 0 END), 0),
        'gcashSales',      COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'gcash' THEN total_amount ELSE 0 END), 0),
        'mayaSales',       COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'maya' THEN total_amount ELSE 0 END), 0),
        'cardSales',       COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'card' THEN total_amount ELSE 0 END), 0),
        'otherSales',      COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'other' THEN total_amount ELSE 0 END), 0),
        'voidCount',       COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0)::INT,
        'voidAmount',      COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_amount ELSE 0 END), 0)
    ) INTO v_summary
    FROM public.sales
    WHERE branch_id = r_session.branch_id
      AND cashier_id = r_session.cashier_id
      -- Stricter session window check: only count sales between open and close
      AND created_at BETWEEN r_session.opened_at AND COALESCE(r_session.closed_at, now());

    RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 9. RPC: Close register session (performs Z-Read)
CREATE OR REPLACE FUNCTION public.fn_close_cashier_session(
    p_session_id UUID,
    p_actual_cash NUMERIC
)
RETURNS JSONB AS $$
DECLARE
    r_session RECORD;
    v_summary JSONB;
    v_last_z INT;
    v_grand_sales NUMERIC;
    v_expected_closing NUMERIC;
    v_expected_cash NUMERIC;
BEGIN
    -- 1. Fetch open session
    SELECT * INTO r_session FROM public.cashier_sessions WHERE id = p_session_id FOR UPDATE;
    IF r_session IS NULL THEN
        RAISE EXCEPTION 'Register session not found.';
    END IF;
    IF r_session.status = 'closed' THEN
        RAISE EXCEPTION 'Register session has already been closed.';
    END IF;

    -- 2. Lock & increment Z-counter on branch terminal
    SELECT COALESCE(last_z_counter, 0) + 1, COALESCE(grand_cumulative_sales, 0)
    INTO v_last_z, v_grand_sales
    FROM public.terminal_counters
    WHERE branch_id = r_session.branch_id FOR UPDATE;

    UPDATE public.terminal_counters
    SET last_z_counter = v_last_z,
        updated_at = now()
    WHERE branch_id = r_session.branch_id;

    -- 3. Calculate dynamic session values
    v_summary := public.fn_get_session_summary(p_session_id);
    
    v_expected_cash := (v_summary->>'cashSales')::NUMERIC;
    v_expected_closing := r_session.opening_balance + v_expected_cash;

    -- Update summary json with closure specifics
    v_summary := v_summary || jsonb_build_object(
        'closedAt',      now(),
        'status',        'closed',
        'zCounter',      v_last_z,
        'grandTotalEnd', v_grand_sales,
        'actualCash',    p_actual_cash,
        'expectedCash',  v_expected_cash,
        'discrepancy',   (p_actual_cash - v_expected_closing)
    );

    -- 4. Close the session in DB
    UPDATE public.cashier_sessions
    SET status = 'closed',
        closed_at = now(),
        actual_cash = p_actual_cash,
        closing_balance = v_expected_closing,
        z_counter = v_last_z,
        grand_total_end = v_grand_sales,
        sales_summary = v_summary,
        updated_at = now()
    WHERE id = p_session_id;

    -- 5. Audit log closure
    PERFORM public.fn_log_audit(
        auth.uid(),
        'CLOSE_SHIFT_Z_READ',
        'Sales',
        NULL,
        json_build_object(
            'session_id',     p_session_id,
            'branch_id',      r_session.branch_id,
            'z_counter',      v_last_z,
            'grand_total_end',v_grand_sales,
            'actual_cash',    p_actual_cash,
            'closing_balance',v_expected_closing
        )::jsonb
    );

    RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
