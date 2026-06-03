-- Migration: Add Transfer Control Number
-- Created: 2026-06-03

-- 1. Add control_number column to transfer_requests
ALTER TABLE public.transfer_requests ADD COLUMN IF NOT EXISTS control_number TEXT UNIQUE;

-- 2. Create the generator function for the control number (TRF-YYYY-MM-XXXX)
CREATE OR REPLACE FUNCTION public.fn_generate_transfer_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    -- Only generate if control_number is not explicitly provided
    IF NEW.control_number IS NULL THEN
        v_prefix := 'TRF-' || to_char(now(), 'YYYY-MM-');
        
        -- Find the current max sequence for this prefix
        SELECT COALESCE(MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER), 0) + 1
        INTO v_seq
        FROM public.transfer_requests
        WHERE control_number LIKE v_prefix || '%';
        
        NEW.control_number := v_prefix || lpad(v_seq::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Create BEFORE INSERT trigger to automate control number assignment
DROP TRIGGER IF EXISTS trg_generate_transfer_control_number ON public.transfer_requests;
CREATE TRIGGER trg_generate_transfer_control_number
    BEFORE INSERT ON public.transfer_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_generate_transfer_control_number();

-- 4. Backfill existing transfers with control numbers (if any exist without one)
WITH ordered_transfers AS (
    SELECT 
        id,
        created_at,
        row_number() OVER (PARTITION BY to_char(created_at, 'YYYY-MM') ORDER BY created_at) as seq
    FROM public.transfer_requests
)
UPDATE public.transfer_requests r
SET control_number = 'TRF-' || to_char(o.created_at, 'YYYY-MM-') || lpad(o.seq::TEXT, 4, '0')
FROM ordered_transfers o
WHERE r.id = o.id AND r.control_number IS NULL;
