-- ============================================================
-- MIGRATION: Flexible Table Merging for POS Running Bills
-- ============================================================

-- 1. Create pos_tab_tables join table (tracks all tables on a tab)
CREATE TABLE IF NOT EXISTS public.pos_tab_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    tab_id UUID NOT NULL REFERENCES public.pos_tabs(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_pos_tab_tables_tab_table UNIQUE (tenant_id, tab_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_tab_tables_tab_id ON public.pos_tab_tables(tab_id);
CREATE INDEX IF NOT EXISTS idx_pos_tab_tables_table_id ON public.pos_tab_tables(table_id);

-- 2. Enable RLS & auto-stamp tenant trigger
ALTER TABLE public.pos_tab_tables ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_pos_tab_tables ON public.pos_tab_tables;
CREATE TRIGGER tg_auto_stamp_tenant_pos_tab_tables
  BEFORE INSERT ON public.pos_tab_tables
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP POLICY IF EXISTS "Read pos_tab_tables" ON public.pos_tab_tables;
CREATE POLICY "Read pos_tab_tables" ON public.pos_tab_tables
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "Write pos_tab_tables" ON public.pos_tab_tables;
CREATE POLICY "Write pos_tab_tables" ON public.pos_tab_tables
  FOR ALL TO authenticated
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

-- 3. Backfill existing pos_tabs into pos_tab_tables
INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
SELECT t.tenant_id, t.id, t.table_id, true
FROM public.pos_tabs t
ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;

-- 4. Update tab -> table status synchronization trigger for multi-table tabs
CREATE OR REPLACE FUNCTION public.fn_sync_table_status_from_tab()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
        VALUES (NEW.tenant_id, NEW.id, NEW.table_id, true)
        ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;

        UPDATE public.restaurant_tables
        SET current_tab_id = NEW.id,
            status = CASE WHEN NEW.status = 'billed_out' THEN 'billed_out' ELSE 'occupied' END,
            updated_at = now()
        WHERE id = NEW.table_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('settled', 'cancelled') AND NEW.status IN ('open', 'billed_out') THEN
            RAISE EXCEPTION 'Cannot reopen a settled or cancelled tab.';
        END IF;

        IF NEW.status IN ('settled', 'cancelled') THEN
            UPDATE public.restaurant_tables
            SET current_tab_id = NULL,
                status = 'available',
                updated_at = now()
            WHERE (
                id = NEW.table_id
                OR current_tab_id = NEW.id
                OR id IN (SELECT ptt.table_id FROM public.pos_tab_tables ptt WHERE ptt.tab_id = NEW.id)
            )
            AND (current_tab_id = NEW.id OR current_tab_id IS NULL);
        ELSIF NEW.status = 'billed_out' THEN
            UPDATE public.restaurant_tables
            SET current_tab_id = NEW.id,
                status = 'billed_out',
                updated_at = now()
            WHERE (
                id = NEW.table_id
                OR current_tab_id = NEW.id
                OR id IN (SELECT ptt.table_id FROM public.pos_tab_tables ptt WHERE ptt.tab_id = NEW.id)
            )
            AND (current_tab_id = NEW.id OR current_tab_id IS NULL);
        ELSIF NEW.status = 'open' THEN
            UPDATE public.restaurant_tables
            SET current_tab_id = NEW.id,
                status = 'occupied',
                updated_at = now()
            WHERE (
                id = NEW.table_id
                OR current_tab_id = NEW.id
                OR id IN (SELECT ptt.table_id FROM public.pos_tab_tables ptt WHERE ptt.tab_id = NEW.id)
            )
            AND (current_tab_id = NEW.id OR current_tab_id IS NULL);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. RPC: Open a new tab across 1 or more vacant tables atomically
CREATE OR REPLACE FUNCTION public.fn_open_tab_with_tables(
    p_branch_id   UUID,
    p_table_ids   UUID[],
    p_server_id   UUID DEFAULT NULL,
    p_server_name TEXT DEFAULT NULL,
    p_pax_count   INT  DEFAULT 1,
    p_notes       TEXT DEFAULT NULL
)
RETURNS public.pos_tabs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id   UUID := public.get_my_tenant_id();
    v_unique_ids  UUID[];
    v_locked_cnt  INT;
    v_bad_cnt     INT;
    v_tab         public.pos_tabs;
    v_tid         UUID;
    v_idx         INT := 0;
BEGIN
    IF p_branch_id IS NULL THEN
        RAISE EXCEPTION 'Branch ID is required.';
    END IF;

    SELECT ARRAY(
        SELECT u.tid
        FROM unnest(p_table_ids) WITH ORDINALITY AS u(tid, ord)
        WHERE u.tid IS NOT NULL
        GROUP BY u.tid
        ORDER BY MIN(u.ord)
    ) INTO v_unique_ids;

    IF v_unique_ids IS NULL OR array_length(v_unique_ids, 1) IS NULL OR array_length(v_unique_ids, 1) < 1 THEN
        RAISE EXCEPTION 'Select at least one table to open.';
    END IF;

    -- Lock requested tables to prevent concurrent opens/merges
    SELECT COUNT(*),
           COUNT(*) FILTER (
               WHERE branch_id <> p_branch_id
                  OR is_active IS NOT TRUE
                  OR current_tab_id IS NOT NULL
                  OR status IN ('occupied', 'billed_out')
           )
    INTO v_locked_cnt, v_bad_cnt
    FROM (
        SELECT id, branch_id, is_active, current_tab_id, status
        FROM public.restaurant_tables
        WHERE tenant_id = v_tenant_id
          AND id = ANY(v_unique_ids)
        ORDER BY id
        FOR UPDATE
    ) locked_tables;

    IF v_locked_cnt <> array_length(v_unique_ids, 1) THEN
        RAISE EXCEPTION 'One or more selected tables could not be found.';
    END IF;

    IF v_bad_cnt > 0 THEN
        RAISE EXCEPTION 'One or more selected tables are no longer vacant.';
    END IF;

    INSERT INTO public.pos_tabs (
        tenant_id,
        branch_id,
        table_id,
        server_id,
        server_name,
        pax_count,
        status,
        notes
    ) VALUES (
        v_tenant_id,
        p_branch_id,
        v_unique_ids[1],
        p_server_id,
        COALESCE(NULLIF(TRIM(p_server_name), ''), 'Staff'),
        GREATEST(1, COALESCE(p_pax_count, 1)),
        'open',
        NULLIF(TRIM(p_notes), '')
    )
    RETURNING * INTO v_tab;

    FOREACH v_tid IN ARRAY v_unique_ids LOOP
        v_idx := v_idx + 1;
        INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
        VALUES (v_tenant_id, v_tab.id, v_tid, v_idx = 1)
        ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;
    END LOOP;

    UPDATE public.restaurant_tables
    SET current_tab_id = v_tab.id,
        status = 'occupied',
        updated_at = now()
    WHERE tenant_id = v_tenant_id
      AND id = ANY(v_unique_ids);

    RETURN v_tab;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_open_tab_with_tables(UUID, UUID[], UUID, TEXT, INT, TEXT) TO authenticated;

-- 6. RPC: Attach 1 or more vacant tables onto an active running tab
CREATE OR REPLACE FUNCTION public.fn_attach_tables_to_tab(
    p_tab_id    UUID,
    p_table_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id   UUID := public.get_my_tenant_id();
    v_tab         public.pos_tabs;
    v_unique_ids  UUID[];
    v_locked_cnt  INT;
    v_bad_cnt     INT;
    v_tid         UUID;
    v_table_status TEXT;
BEGIN
    SELECT * INTO v_tab
    FROM public.pos_tabs
    WHERE id = p_tab_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF v_tab.id IS NULL THEN
        RAISE EXCEPTION 'Target tab not found.';
    END IF;

    IF v_tab.status NOT IN ('open', 'billed_out') THEN
        RAISE EXCEPTION 'Cannot attach tables to a closed or settled tab.';
    END IF;

    SELECT ARRAY(
        SELECT u.tid
        FROM unnest(p_table_ids) WITH ORDINALITY AS u(tid, ord)
        WHERE u.tid IS NOT NULL
        GROUP BY u.tid
        ORDER BY MIN(u.ord)
    ) INTO v_unique_ids;

    IF v_unique_ids IS NULL OR array_length(v_unique_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Select at least one vacant table to attach.';
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (
               WHERE branch_id <> v_tab.branch_id
                  OR is_active IS NOT TRUE
                  OR current_tab_id IS NOT NULL
                  OR status IN ('occupied', 'billed_out')
           )
    INTO v_locked_cnt, v_bad_cnt
    FROM (
        SELECT id, branch_id, is_active, current_tab_id, status
        FROM public.restaurant_tables
        WHERE tenant_id = v_tenant_id
          AND id = ANY(v_unique_ids)
        ORDER BY id
        FOR UPDATE
    ) locked_tables;

    IF v_locked_cnt <> array_length(v_unique_ids, 1) THEN
        RAISE EXCEPTION 'One or more selected tables could not be found.';
    END IF;

    IF v_bad_cnt > 0 THEN
        RAISE EXCEPTION 'One or more selected tables are already occupied or unavailable.';
    END IF;

    -- Ensure primary row exists for target tab
    INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
    VALUES (v_tenant_id, p_tab_id, v_tab.table_id, true)
    ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;

    FOREACH v_tid IN ARRAY v_unique_ids LOOP
        INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
        VALUES (v_tenant_id, p_tab_id, v_tid, false)
        ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;
    END LOOP;

    v_table_status := CASE WHEN v_tab.status = 'billed_out' THEN 'billed_out' ELSE 'occupied' END;

    UPDATE public.restaurant_tables
    SET current_tab_id = p_tab_id,
        status = v_table_status,
        updated_at = now()
    WHERE tenant_id = v_tenant_id
      AND id = ANY(v_unique_ids);

    UPDATE public.pos_tabs
    SET updated_at = now()
    WHERE id = p_tab_id;

    RETURN jsonb_build_object(
        'tab_id', p_tab_id,
        'attached_count', array_length(v_unique_ids, 1)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_attach_tables_to_tab(UUID, UUID[]) TO authenticated;

-- 7. RPC: Merge two active tabs into one unified running bill
CREATE OR REPLACE FUNCTION public.fn_merge_tabs(
    p_target_tab_id UUID,
    p_source_tab_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id         UUID := public.get_my_tenant_id();
    v_target            public.pos_tabs;
    v_source            public.pos_tabs;
    v_combined_notes    TEXT;
    v_discount_cleared  BOOLEAN := false;
    v_reopened          BOOLEAN := false;
    v_lock_id           UUID;
BEGIN
    IF p_target_tab_id IS NULL OR p_source_tab_id IS NULL OR p_target_tab_id = p_source_tab_id THEN
        RAISE EXCEPTION 'Two distinct active tabs are required to merge.';
    END IF;

    -- Lock both tabs in deterministic UUID order to prevent deadlocks
    FOR v_lock_id IN
        SELECT id
        FROM public.pos_tabs
        WHERE tenant_id = v_tenant_id
          AND id IN (p_target_tab_id, p_source_tab_id)
        ORDER BY id
        FOR UPDATE
    LOOP
        NULL;
    END LOOP;

    SELECT * INTO v_target FROM public.pos_tabs WHERE id = p_target_tab_id AND tenant_id = v_tenant_id;
    SELECT * INTO v_source FROM public.pos_tabs WHERE id = p_source_tab_id AND tenant_id = v_tenant_id;

    IF v_target.id IS NULL OR v_source.id IS NULL THEN
        RAISE EXCEPTION 'One or both tabs could not be found.';
    END IF;

    IF v_target.branch_id <> v_source.branch_id THEN
        RAISE EXCEPTION 'Cannot merge tabs from different branches.';
    END IF;

    IF v_target.status NOT IN ('open', 'billed_out') OR v_source.status NOT IN ('open', 'billed_out') THEN
        RAISE EXCEPTION 'Only open or billed-out tabs can be merged.';
    END IF;

    -- Lock all linked tables across both tabs
    PERFORM id
    FROM public.restaurant_tables
    WHERE tenant_id = v_tenant_id
      AND (
          current_tab_id IN (p_target_tab_id, p_source_tab_id)
          OR id IN (
              SELECT table_id
              FROM public.pos_tab_tables
              WHERE tenant_id = v_tenant_id
                AND tab_id IN (p_target_tab_id, p_source_tab_id)
          )
      )
    ORDER BY id
    FOR UPDATE;

    -- Move ordered items from source to target (preserve round_number and kitchen_status)
    UPDATE public.pos_tab_items
    SET tab_id = p_target_tab_id
    WHERE tab_id = p_source_tab_id
      AND tenant_id = v_tenant_id;

    -- Ensure target primary row exists, then transfer source table mappings before cancelling source
    INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
    VALUES (v_tenant_id, p_target_tab_id, v_target.table_id, true)
    ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;

    INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
    SELECT v_tenant_id, p_target_tab_id, ptt.table_id, false
    FROM public.pos_tab_tables ptt
    WHERE ptt.tab_id = p_source_tab_id
      AND ptt.tenant_id = v_tenant_id
    ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;

    -- Fallback for any legacy source tab missing from pos_tab_tables
    INSERT INTO public.pos_tab_tables (tenant_id, tab_id, table_id, is_primary)
    VALUES (v_tenant_id, p_target_tab_id, v_source.table_id, false)
    ON CONFLICT (tenant_id, tab_id, table_id) DO NOTHING;

    DELETE FROM public.pos_tab_tables
    WHERE tab_id = p_source_tab_id
      AND tenant_id = v_tenant_id;

    -- Reassign all physical tables to target tab BEFORE cancelling source
    UPDATE public.restaurant_tables
    SET current_tab_id = p_target_tab_id,
        status = 'occupied',
        updated_at = now()
    WHERE tenant_id = v_tenant_id
      AND (
          current_tab_id = p_source_tab_id
          OR id IN (
              SELECT table_id
              FROM public.pos_tab_tables
              WHERE tab_id = p_target_tab_id AND tenant_id = v_tenant_id
          )
      );

    -- Combine notes cleanly
    v_combined_notes := NULLIF(
        TRIM(
            CONCAT_WS(
                ' | ',
                NULLIF(TRIM(v_target.notes), ''),
                NULLIF(TRIM(v_source.notes), '')
            )
        ),
        ''
    );

    v_reopened := (v_target.status = 'billed_out' OR v_source.status = 'billed_out');

    IF v_target.discount_type IS NOT NULL
       OR COALESCE(v_target.discount_amount, 0) > 0
       OR v_source.discount_type IS NOT NULL
       OR COALESCE(v_source.discount_amount, 0) > 0 THEN
        v_discount_cleared := true;
    END IF;

    UPDATE public.pos_tabs
    SET pax_count = GREATEST(1, COALESCE(v_target.pax_count, 1) + COALESCE(v_source.pax_count, 1)),
        notes = v_combined_notes,
        status = 'open',
        discount_type = CASE WHEN v_discount_cleared THEN NULL ELSE v_target.discount_type END,
        discount_amount = CASE WHEN v_discount_cleared THEN 0 ELSE COALESCE(v_target.discount_amount, 0) END,
        discount_metadata = CASE WHEN v_discount_cleared THEN '[]'::jsonb ELSE COALESCE(v_target.discount_metadata, '[]'::jsonb) END,
        updated_at = now()
    WHERE id = p_target_tab_id;

    UPDATE public.pos_tabs
    SET status = 'cancelled',
        closed_at = now(),
        updated_at = now(),
        notes = COALESCE(NULLIF(TRIM(v_source.notes), '') || ' | ', '') || 'Merged into tab ' || p_target_tab_id::text
    WHERE id = p_source_tab_id;

    RETURN jsonb_build_object(
        'target_tab_id', p_target_tab_id,
        'source_tab_id', p_source_tab_id,
        'discount_cleared', v_discount_cleared,
        'reopened_from_billed_out', v_reopened
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_merge_tabs(UUID, UUID) TO authenticated;

-- 8. RPC: Unmerge/detach one table from a multi-table tab
CREATE OR REPLACE FUNCTION public.fn_unmerge_table_from_tab(
    p_tab_id   UUID,
    p_table_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id         UUID := public.get_my_tenant_id();
    v_tab               public.pos_tabs;
    v_total_tables      INT;
    v_next_primary_id   UUID;
BEGIN
    SELECT * INTO v_tab
    FROM public.pos_tabs
    WHERE id = p_tab_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF v_tab.id IS NULL THEN
        RAISE EXCEPTION 'Tab not found.';
    END IF;

    IF v_tab.status NOT IN ('open', 'billed_out') THEN
        RAISE EXCEPTION 'Cannot unmerge tables on a closed or settled tab.';
    END IF;

    -- Lock table mappings for this tab
    SELECT COUNT(*)
    INTO v_total_tables
    FROM (
        SELECT id
        FROM public.pos_tab_tables
        WHERE tab_id = p_tab_id AND tenant_id = v_tenant_id
        ORDER BY is_primary DESC, created_at ASC
        FOR UPDATE
    ) locked_links;

    IF v_total_tables < 2 THEN
        RAISE EXCEPTION 'At least one table must remain on the running tab.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.pos_tab_tables
        WHERE tab_id = p_tab_id AND table_id = p_table_id AND tenant_id = v_tenant_id
    ) THEN
        RAISE EXCEPTION 'Selected table is not part of this tab.';
    END IF;

    DELETE FROM public.pos_tab_tables
    WHERE tab_id = p_tab_id
      AND table_id = p_table_id
      AND tenant_id = v_tenant_id;

    v_next_primary_id := v_tab.table_id;

    IF v_tab.table_id = p_table_id THEN
        SELECT ptt.table_id INTO v_next_primary_id
        FROM public.pos_tab_tables ptt
        WHERE ptt.tab_id = p_tab_id AND ptt.tenant_id = v_tenant_id
        ORDER BY ptt.is_primary DESC, ptt.created_at ASC
        LIMIT 1;

        UPDATE public.pos_tab_tables
        SET is_primary = (table_id = v_next_primary_id)
        WHERE tab_id = p_tab_id AND tenant_id = v_tenant_id;

        UPDATE public.pos_tabs
        SET table_id = v_next_primary_id,
            updated_at = now()
        WHERE id = p_tab_id;
    ELSE
        UPDATE public.pos_tabs
        SET updated_at = now()
        WHERE id = p_tab_id;
    END IF;

    UPDATE public.restaurant_tables
    SET current_tab_id = NULL,
        status = 'available',
        updated_at = now()
    WHERE id = p_table_id
      AND tenant_id = v_tenant_id;

    RETURN jsonb_build_object(
        'tab_id', p_tab_id,
        'removed_table_id', p_table_id,
        'primary_table_id', v_next_primary_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_unmerge_table_from_tab(UUID, UUID) TO authenticated;
