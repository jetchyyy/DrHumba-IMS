-- MIGRATION: Include Cashier Name, Email, and Total Payments Reconciliation in Session Summary & Z-Read Reports

-- 1. Ensure full_name column exists on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT;

-- 2. Redefine fn_get_session_summary to include cashierName, cashierEmail, and totalPayments
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

-- 3. Permissions
GRANT EXECUTE ON FUNCTION public.fn_get_session_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_session_summary(UUID) TO service_role;
