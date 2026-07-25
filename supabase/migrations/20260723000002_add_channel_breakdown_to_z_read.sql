-- ============================================================
-- MIGRATION: Include Sales Channels (Foodpanda, Grab, Dine-in) in X/Z Read Summaries
-- ============================================================

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
$$ LANGUAGE plpgsql SECURITY DEFINER;
