-- ==============================================================================
-- MIGRATION: Idempotent POS checkout (prevents "double punch" duplicate sales)
--
-- Problem: if the tablet loses the response to fn_process_sale (Wi-Fi blip), the
-- sale is already committed but the POS shows an error and keeps the cart, so the
-- cashier pays again and a duplicate sale is recorded.
--
-- Fix: the POS generates one client_ref (UUID) per payment attempt and calls
-- fn_process_sale_idempotent. A retry with the same client_ref returns the
-- original sale id instead of creating a new sale. fn_process_sale is unchanged.
-- ==============================================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS client_ref UUID;

CREATE UNIQUE INDEX IF NOT EXISTS sales_tenant_client_ref_key
    ON public.sales (tenant_id, client_ref)
    WHERE client_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_process_sale_idempotent(
    p_client_ref        UUID,
    p_branch_id         UUID,
    p_items             JSONB,
    p_payment_method    TEXT    DEFAULT 'cash',
    p_amount_tendered   NUMERIC DEFAULT NULL,
    p_sale_category     TEXT    DEFAULT NULL,
    p_reference_number  TEXT    DEFAULT NULL,
    p_queue_number      TEXT    DEFAULT NULL,
    p_sub_store_id      UUID    DEFAULT NULL,
    p_discount_type     TEXT    DEFAULT NULL,
    p_discount_amount   NUMERIC DEFAULT 0,
    p_discount_metadata JSONB   DEFAULT '[]'::jsonb,
    p_notes             TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID := public.get_my_tenant_id();
    v_sale_id   UUID;
BEGIN
    IF p_client_ref IS NULL THEN
        RAISE EXCEPTION 'p_client_ref is required';
    END IF;

    -- Serialize concurrent attempts carrying the same client_ref.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_client_ref::text, 0));

    SELECT id INTO v_sale_id
    FROM public.sales
    WHERE tenant_id = v_tenant_id AND client_ref = p_client_ref;

    IF v_sale_id IS NOT NULL THEN
        RETURN v_sale_id;  -- Retry of an already-recorded payment.
    END IF;

    v_sale_id := public.fn_process_sale(
        p_branch_id, p_items, p_payment_method, p_amount_tendered, p_sale_category,
        p_reference_number, p_queue_number, p_sub_store_id, p_discount_type,
        p_discount_amount, p_discount_metadata, p_notes
    );

    UPDATE public.sales SET client_ref = p_client_ref WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_process_sale_idempotent(UUID, UUID, JSONB, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TEXT) TO authenticated;
