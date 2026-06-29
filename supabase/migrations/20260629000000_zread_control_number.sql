-- ============================================================
-- MIGRATION: Z-Read Control Number Sequence Compliance
-- ============================================================

-- 1. Add control_number column to cashier_sessions
ALTER TABLE public.cashier_sessions 
    ADD COLUMN IF NOT EXISTS control_number TEXT UNIQUE;

-- 2. Create the trigger function to generate sequential ZRD control numbers
CREATE OR REPLACE FUNCTION public.fn_generate_zread_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    -- Only generate control number when shift session is formally closed (Z-Read is executed)
    IF NEW.status = 'closed' AND NEW.control_number IS NULL THEN
        v_prefix := 'ZRD-' || to_char(now(), 'YYYY-MM-');
        
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

-- 3. Create the trigger on cashier_sessions
DROP TRIGGER IF EXISTS tg_generate_zread_control_number ON public.cashier_sessions;
CREATE TRIGGER tg_generate_zread_control_number
    BEFORE INSERT OR UPDATE ON public.cashier_sessions
    FOR EACH ROW EXECUTE FUNCTION public.fn_generate_zread_control_number();


-- 4. Re-define fn_close_cashier_session to append the control_number
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
    v_final_control_number TEXT;
BEGIN
    -- Fetch open session
    SELECT * INTO r_session FROM public.cashier_sessions WHERE id = p_session_id FOR UPDATE;
    IF r_session IS NULL THEN
        RAISE EXCEPTION 'Register session not found.';
    END IF;
    IF r_session.status = 'closed' THEN
        RAISE EXCEPTION 'Register session has already been closed.';
    END IF;

    -- Lock & increment Z-counter on branch terminal
    SELECT COALESCE(last_z_counter, 0) + 1, COALESCE(grand_cumulative_sales, 0)
    INTO v_last_z, v_grand_sales
    FROM public.terminal_counters
    WHERE branch_id = r_session.branch_id FOR UPDATE;

    UPDATE public.terminal_counters
    SET last_z_counter = v_last_z,
        updated_at = now()
    WHERE branch_id = r_session.branch_id;

    -- Calculate dynamic session values
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

    -- Close the session in DB (this triggers tg_generate_zread_control_number)
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

    -- Retrieve the generated control number
    SELECT control_number INTO v_final_control_number 
    FROM public.cashier_sessions 
    WHERE id = p_session_id;

    -- Append controlNumber to the final summary
    v_summary := v_summary || jsonb_build_object('controlNumber', v_final_control_number);

    -- Save the updated summary containing controlNumber in database
    UPDATE public.cashier_sessions
    SET sales_summary = v_summary
    WHERE id = p_session_id;

    -- Audit log closure
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
            'closing_balance',v_expected_closing,
            'control_number', v_final_control_number
        )::jsonb
    );

    RETURN v_summary;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
