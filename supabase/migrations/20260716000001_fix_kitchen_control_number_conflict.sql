-- ============================================================
-- MIGRATION: Fix Kitchen Control Number Conflict Target
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_generate_kitchen_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'KIT-' || to_char(now(), 'YYYY-MM-');
        
        -- Lock row and increment atomically using composite tenant sequence key
        INSERT INTO public.control_number_sequences (tenant_id, sequence_name, current_val)
        VALUES (NEW.tenant_id, v_prefix, 1)
        ON CONFLICT (tenant_id, sequence_name) DO UPDATE
        SET current_val = public.control_number_sequences.current_val + 1
        RETURNING current_val INTO v_seq;
        
        NEW.control_number := v_prefix || lpad(v_seq::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
