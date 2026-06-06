-- Migration: Add Control Numbers to Stock Receipts, Adjustments, and Sales
-- Created: 2026-06-06

-- 1. Alter tables to add control_number columns
ALTER TABLE public.stock_receipts ADD COLUMN IF NOT EXISTS control_number TEXT UNIQUE;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS control_number TEXT UNIQUE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS control_number TEXT UNIQUE;

-- 2. Create the generator function for stock receipts control number (STI-YYYY-MM-XXXX)
CREATE OR REPLACE FUNCTION public.fn_generate_receipt_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'STI-' || to_char(now(), 'YYYY-MM-');
        
        SELECT COALESCE(MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER), 0) + 1
        INTO v_seq
        FROM public.stock_receipts
        WHERE control_number LIKE v_prefix || '%';
        
        NEW.control_number := v_prefix || lpad(v_seq::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for stock receipts
DROP TRIGGER IF EXISTS trg_generate_receipt_control_number ON public.stock_receipts;
CREATE TRIGGER trg_generate_receipt_control_number
    BEFORE INSERT ON public.stock_receipts
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_generate_receipt_control_number();

-- 3. Create the generator function for stock adjustments / waste control number (ADJ-YYYY-MM-XXXX or WST-YYYY-MM-XXXX)
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
        
        SELECT COALESCE(MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER), 0) + 1
        INTO v_seq
        FROM public.stock_adjustments
        WHERE control_number LIKE v_prefix || '%';
        
        NEW.control_number := v_prefix || lpad(v_seq::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for stock adjustments
DROP TRIGGER IF EXISTS trg_generate_adjustment_control_number ON public.stock_adjustments;
CREATE TRIGGER trg_generate_adjustment_control_number
    BEFORE INSERT ON public.stock_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_generate_adjustment_control_number();

-- 4. Create the generator function for sales control number (INV-YYYY-MM-XXXX)
CREATE OR REPLACE FUNCTION public.fn_generate_sales_control_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_seq INTEGER;
BEGIN
    IF NEW.control_number IS NULL THEN
        v_prefix := 'INV-' || to_char(now(), 'YYYY-MM-');
        
        SELECT COALESCE(MAX(SUBSTRING(control_number FROM 13 FOR 4)::INTEGER), 0) + 1
        INTO v_seq
        FROM public.sales
        WHERE control_number LIKE v_prefix || '%';
        
        NEW.control_number := v_prefix || lpad(v_seq::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for sales
DROP TRIGGER IF EXISTS trg_generate_sales_control_number ON public.sales;
CREATE TRIGGER trg_generate_sales_control_number
    BEFORE INSERT ON public.sales
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_generate_sales_control_number();

-- 5. Backfill existing records

-- Stock Receipts
WITH ordered_receipts AS (
    SELECT 
        id,
        created_at,
        row_number() OVER (PARTITION BY to_char(created_at, 'YYYY-MM') ORDER BY created_at) as seq
    FROM public.stock_receipts
)
UPDATE public.stock_receipts r
SET control_number = 'STI-' || to_char(o.created_at, 'YYYY-MM-') || lpad(o.seq::TEXT, 4, '0')
FROM ordered_receipts o
WHERE r.id = o.id AND r.control_number IS NULL;

-- Stock Adjustments
WITH ordered_adjustments AS (
    SELECT 
        id,
        created_at,
        reason,
        row_number() OVER (
            PARTITION BY to_char(created_at, 'YYYY-MM'), (reason IN ('spoilage', 'damage', 'expired'))
            ORDER BY created_at
        ) as seq
    FROM public.stock_adjustments
)
UPDATE public.stock_adjustments a
SET control_number = CASE 
    WHEN o.reason IN ('spoilage', 'damage', 'expired') THEN 'WST-'
    ELSE 'ADJ-'
END || to_char(o.created_at, 'YYYY-MM-') || lpad(o.seq::TEXT, 4, '0')
FROM ordered_adjustments o
WHERE a.id = o.id AND a.control_number IS NULL;

-- Sales
WITH ordered_sales AS (
    SELECT 
        id,
        created_at,
        row_number() OVER (PARTITION BY to_char(created_at, 'YYYY-MM') ORDER BY created_at) as seq
    FROM public.sales
)
UPDATE public.sales s
SET control_number = 'INV-' || to_char(o.created_at, 'YYYY-MM-') || lpad(o.seq::TEXT, 4, '0')
FROM ordered_sales o
WHERE s.id = o.id AND s.control_number IS NULL;
