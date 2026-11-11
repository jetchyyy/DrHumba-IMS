-- ============================================================
-- MIGRATION: Shift Management Feature Flag & POS Shift Selection
-- ============================================================

-- 1. Ensure shift_name column exists on cashier_sessions
ALTER TABLE public.cashier_sessions
  ADD COLUMN IF NOT EXISTS shift_name TEXT;

-- 2. Drop existing 2-arg signature to avoid overload collision
DROP FUNCTION IF EXISTS public.fn_open_cashier_session(UUID, NUMERIC);

-- 3. Redefine fn_open_cashier_session with optional p_shift_name parameter
CREATE OR REPLACE FUNCTION public.fn_open_cashier_session(
    p_branch_id UUID,
    p_opening_balance NUMERIC,
    p_shift_name TEXT DEFAULT NULL
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

    -- Open the session with optional shift name
    INSERT INTO public.cashier_sessions (
        tenant_id, branch_id, cashier_id, status, opening_balance,
        z_counter, grand_total_start, grand_total_end, shift_name
    )
    VALUES (
        v_tenant_id, p_branch_id, auth.uid(), 'open', p_opening_balance,
        v_last_z, v_grand_sales, v_grand_sales, NULLIF(TRIM(p_shift_name), '')
    )
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.fn_open_cashier_session(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_open_cashier_session(UUID, NUMERIC, TEXT) TO service_role;

-- 4. Update fn_get_session_summary to return shiftName
CREATE OR REPLACE FUNCTION public.fn_get_session_summary(
    p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
    r_session RECORD;
    v_summary JSONB;
    v_cashier_name TEXT;
    v_cashier_email TEXT;
BEGIN
    SELECT * INTO r_session FROM public.cashier_sessions WHERE id = p_session_id;
    IF r_session IS NULL THEN
        RAISE EXCEPTION 'Register session not found.';
    END IF;

    SELECT 
        COALESCE(NULLIF(TRIM(full_name), ''), split_part(email, '@', 1), 'Staff'),
        email
    INTO v_cashier_name, v_cashier_email
    FROM public.profiles
    WHERE id = r_session.cashier_id;

    SELECT json_build_object(
        'openedAt',        r_session.opened_at,
        'closedAt',        r_session.closed_at,
        'cashierId',       r_session.cashier_id,
        'cashierName',     COALESCE(v_cashier_name, 'Staff'),
        'cashierEmail',    v_cashier_email,
        'shiftName',       r_session.shift_name,
        'openingBalance',  r_session.opening_balance,
        'status',          r_session.status,
        'zCounter',        r_session.z_counter,
        'grandTotalStart', r_session.grand_total_start,
        'grandTotalEnd',   r_session.grand_total_end,
        'grossSales',      COALESCE(SUM(CASE WHEN status = 'completed' THEN 
                               (vatable_sales + vat_amount + COALESCE(NULLIF(other_discounts, 0), CASE WHEN LOWER(COALESCE(discount_type, '')) NOT IN ('sc', 'pwd', 'mixed', 'mov', 'solo') THEN discount_amount ELSE 0 END)) + ROUND(vat_exempt_sales * 1.12, 2)
                           ELSE 0 END), 0),
        'netSales',        COALESCE(SUM(CASE WHEN status = 'completed' THEN 
                               vatable_sales + (vat_exempt_sales - COALESCE(NULLIF(sc_pwd_discount, 0), CASE WHEN LOWER(COALESCE(discount_type, '')) IN ('sc', 'pwd', 'mixed', 'mov', 'solo') THEN discount_amount ELSE 0 END))
                           ELSE 0 END), 0),
        'vatAmount',       COALESCE(SUM(CASE WHEN status = 'completed' THEN vat_amount ELSE 0 END), 0),
        'vatExemptSales',  COALESCE(SUM(CASE WHEN status = 'completed' THEN vat_exempt_sales ELSE 0 END), 0),
        'discountAmount',  COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_amount ELSE 0 END), 0),
        'scPwdDiscount',   COALESCE(SUM(CASE WHEN status = 'completed' THEN 
                               COALESCE(NULLIF(sc_pwd_discount, 0), CASE WHEN LOWER(COALESCE(discount_type, '')) IN ('sc', 'pwd', 'mixed', 'mov', 'solo') THEN discount_amount ELSE 0 END)
                           ELSE 0 END), 0),
        'otherDiscount',   COALESCE(SUM(CASE WHEN status = 'completed' THEN 
                               COALESCE(NULLIF(other_discounts, 0), CASE WHEN LOWER(COALESCE(discount_type, '')) NOT IN ('sc', 'pwd', 'mixed', 'mov', 'solo') THEN discount_amount ELSE 0 END)
                           ELSE 0 END), 0),
        'serviceChargeTotal', COALESCE(SUM(CASE WHEN status = 'completed' THEN service_charge_amount ELSE 0 END), 0),
        'totalPayments',   COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0),
        'transactionCount',COUNT(*)::INT,
        -- Physical cash in drawer ONLY (excludes Foodpanda & Grab which are paid online via app)
        'cashSales',       COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'cash' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'gcashSales',      COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'gcash' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'mayaSales',       COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'maya' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'cardSales',       COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND payment_method = 'card' 
                                 AND NOT (
                                     LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' OR 
                                     LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'otherSales',      COALESCE(SUM(CASE 
                                WHEN status = 'completed' 
                                 AND (
                                     payment_method = 'other' 
                                     OR LOWER(COALESCE(sale_category, '')) LIKE '%foodpanda%' 
                                     OR LOWER(COALESCE(sale_category, '')) LIKE '%food panda%' 
                                     OR LOWER(COALESCE(sale_category, '')) LIKE '%grab%'
                                 ) 
                                THEN total_amount ELSE 0 END), 0),
        'foodpandaSales',  COALESCE(SUM(CASE WHEN status = 'completed' AND (LOWER(sale_category) LIKE '%foodpanda%' OR LOWER(sale_category) LIKE '%food panda%') THEN total_amount ELSE 0 END), 0),
        'grabSales',       COALESCE(SUM(CASE WHEN status = 'completed' AND LOWER(sale_category) LIKE '%grab%' THEN total_amount ELSE 0 END), 0),
        'dineInSales',     COALESCE(SUM(CASE WHEN status = 'completed' AND (LOWER(sale_category) LIKE '%dine%' OR sale_category IS NULL OR sale_category = '') THEN total_amount ELSE 0 END), 0),
        'takeOutSales',    COALESCE(SUM(CASE WHEN status = 'completed' AND (LOWER(sale_category) LIKE '%take%' OR LOWER(sale_category) LIKE '%pickup%') THEN total_amount ELSE 0 END), 0),
        'otherChannelSales', COALESCE(SUM(CASE WHEN status = 'completed' AND NOT (
                                LOWER(sale_category) LIKE '%foodpanda%' OR 
                                LOWER(sale_category) LIKE '%food panda%' OR 
                                LOWER(sale_category) LIKE '%grab%' OR 
                                LOWER(sale_category) LIKE '%dine%' OR 
                                LOWER(sale_category) LIKE '%take%' OR 
                                LOWER(sale_category) LIKE '%pickup%' OR 
                                sale_category IS NULL OR 
                                sale_category = ''
                            ) THEN total_amount ELSE 0 END), 0),
        'voidCount',       COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0)::INT,
        'voidAmount',      COALESCE(SUM(CASE WHEN status = 'refunded' THEN total_amount ELSE 0 END), 0)
    ) INTO v_summary
    FROM public.sales
    WHERE branch_id = r_session.branch_id
      AND cashier_id = r_session.cashier_id
      AND created_at BETWEEN r_session.opened_at AND COALESCE(r_session.closed_at, now());

    RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.fn_get_session_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_session_summary(UUID) TO service_role;

-- 5. Enable shift_management for default primary tenant (Dr. Humba)
UPDATE public.tenants
SET features = jsonb_set(
    COALESCE(features, '{}'::jsonb),
    '{shift_management}',
    'true'::jsonb,
    true
)
WHERE id = '00000000-0000-0000-0000-000000000000';

-- 6. Set shift_management in subscription plans
UPDATE public.subscription_plans
SET features = jsonb_set(
    COALESCE(features, '{}'::jsonb),
    '{shift_management}',
    'true'::jsonb,
    true
)
WHERE id = 'enterprise';

UPDATE public.subscription_plans
SET features = jsonb_set(
    COALESCE(features, '{}'::jsonb),
    '{shift_management}',
    'false'::jsonb,
    true
)
WHERE id IN ('starter', 'professional');

