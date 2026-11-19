-- ============================================================
-- MIGRATION: Table Display Order & Natural Sequencing
-- ============================================================

-- 1. Add display_order column to restaurant_tables
ALTER TABLE public.restaurant_tables
ADD COLUMN IF NOT EXISTS display_order INT;

CREATE INDEX IF NOT EXISTS idx_restaurant_tables_display_order
ON public.restaurant_tables (tenant_id, branch_id, display_order);

-- 2. Backfill display_order in natural numeric order (1, 2, ..., 9, 10) for existing tables
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, branch_id
            ORDER BY
                NULLIF(regexp_replace(table_number, '\D', '', 'g'), '')::BIGINT NULLS LAST,
                table_number ASC,
                created_at ASC
        ) AS natural_seq
    FROM public.restaurant_tables
    WHERE display_order IS NULL
)
UPDATE public.restaurant_tables rt
SET display_order = ranked.natural_seq
FROM ranked
WHERE rt.id = ranked.id;

-- 3. Atomic RPC to save arranged table sequence for a branch
CREATE OR REPLACE FUNCTION public.fn_reorder_branch_tables(
    p_branch_id UUID,
    p_table_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID := public.get_my_tenant_id();
BEGIN
    IF p_branch_id IS NULL THEN
        RAISE EXCEPTION 'Branch ID is required.';
    END IF;

    UPDATE public.restaurant_tables rt
    SET display_order = ordered.ord::INT,
        updated_at = now()
    FROM unnest(p_table_ids) WITH ORDINALITY AS ordered(tid, ord)
    WHERE rt.id = ordered.tid
      AND rt.branch_id = p_branch_id
      AND rt.tenant_id = v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_reorder_branch_tables(UUID, UUID[]) TO authenticated;
