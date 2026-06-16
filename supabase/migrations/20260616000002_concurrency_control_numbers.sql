-- Migration: Implement Concurrency Controls for sequential control numbers (Option A)
-- Created: 2026-06-16

-- 1. Create the sequence tracker table
CREATE TABLE IF NOT EXISTS public.control_number_sequences (
    sequence_name VARCHAR(100) PRIMARY KEY,
    current_val   INTEGER      NOT NULL DEFAULT 0
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.control_number_sequences ENABLE ROW LEVEL SECURITY;

-- 2. Backfill/Seed the tracker table with existing sequences to prevent duplicate collisions
-- Seed sales sequences (INV-YYYY-MM-XXXX)
INSERT INTO public.control_number_sequences (sequence_name, current_val)
SELECT 
    'INV-' || to_char(created_at, 'YYYY-MM-') AS seq_name,
    MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER) AS max_val
FROM public.sales
WHERE control_number IS NOT NULL AND control_number LIKE 'INV-%'
GROUP BY 1
ON CONFLICT (sequence_name) DO UPDATE 
SET current_val = GREATEST(public.control_number_sequences.current_val, EXCLUDED.current_val);

-- Seed stock receipts sequences (STI-YYYY-MM-XXXX)
INSERT INTO public.control_number_sequences (sequence_name, current_val)
SELECT 
    'STI-' || to_char(created_at, 'YYYY-MM-') AS seq_name,
    MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER) AS max_val
FROM public.stock_receipts
WHERE control_number IS NOT NULL AND control_number LIKE 'STI-%'
GROUP BY 1
ON CONFLICT (sequence_name) DO UPDATE 
SET current_val = GREATEST(public.control_number_sequences.current_val, EXCLUDED.current_val);

-- Seed stock adjustments ADJ sequences (ADJ-YYYY-MM-XXXX)
INSERT INTO public.control_number_sequences (sequence_name, current_val)
SELECT 
    'ADJ-' || to_char(created_at, 'YYYY-MM-') AS seq_name,
    MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER) AS max_val
FROM public.stock_adjustments
WHERE control_number IS NOT NULL AND control_number LIKE 'ADJ-%'
GROUP BY 1
ON CONFLICT (sequence_name) DO UPDATE 
SET current_val = GREATEST(public.control_number_sequences.current_val, EXCLUDED.current_val);

-- Seed stock adjustments WST sequences (WST-YYYY-MM-XXXX)
INSERT INTO public.control_number_sequences (sequence_name, current_val)
SELECT 
    'WST-' || to_char(created_at, 'YYYY-MM-') AS seq_name,
    MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER) AS max_val
FROM public.stock_adjustments
WHERE control_number IS NOT NULL AND control_number LIKE 'WST-%'
GROUP BY 1
ON CONFLICT (sequence_name) DO UPDATE 
SET current_val = GREATEST(public.control_number_sequences.current_val, EXCLUDED.current_val);

-- Seed transfer requests sequences (TRF-YYYY-MM-XXXX)
INSERT INTO public.control_number_sequences (sequence_name, current_val)
SELECT 
    'TRF-' || to_char(created_at, 'YYYY-MM-') AS seq_name,
    MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER) AS max_val
FROM public.transfer_requests
WHERE control_number IS NOT NULL AND control_number LIKE 'TRF-%'
GROUP BY 1
ON CONFLICT (sequence_name) DO UPDATE 
SET current_val = GREATEST(public.control_number_sequences.current_val, EXCLUDED.current_val);


-- 3. Redefine trigger functions as SECURITY DEFINER to bypass client RLS for sequence table
-- Redefine Sales trigger function
CREATE OR REPLACE FUNCTION public.fn_generate_sales_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'INV-' || to_char(now(), 'YYYY-MM-');
        
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

-- Redefine Stock Receipts trigger function
CREATE OR REPLACE FUNCTION public.fn_generate_receipt_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'STI-' || to_char(now(), 'YYYY-MM-');
        
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

-- Redefine Stock Adjustments trigger function
CREATE OR REPLACE FUNCTION public.fn_generate_adjustment_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        IF NEW.reason IN ('spoilage', 'damage', 'expired') THEN
            v_prefix := 'WST-' || to_char(now(), 'YYYY-MM-');
        ELSE
            v_prefix := 'ADJ-' || to_char(now(), 'YYYY-MM-');
        END IF;
        
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

-- Redefine Transfer Requests trigger function
CREATE OR REPLACE FUNCTION public.fn_generate_transfer_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'TRF-' || to_char(now(), 'YYYY-MM-');
        
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
