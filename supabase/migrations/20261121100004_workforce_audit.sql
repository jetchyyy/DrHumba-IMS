-- ============================================================
-- MIGRATION: Workforce audit trail
--
-- ADDITIVE ONLY. Creates one new table (staff_audit_logs) and audit
-- triggers on the Workforce tables created by 20261121100000-03.
-- The existing audit_logs table and every pre-Workforce table are untouched.
-- It also re-creates fn_set_branch_geofence (a Workforce function, same
-- signature) so geofence changes are logged; behaviour is otherwise the same.
-- Re-runnable.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    staff_id UUID,                       -- the staff member the change is about (no FK: survives deletes)
    staff_name TEXT,
    actor_id UUID,                       -- who made the change (NULL = system)
    actor_name TEXT,
    entity TEXT NOT NULL,                -- staff, shift, schedule_rule, shift_template, attendance, leave_request, leave_allowance, leave_type, pin, geofence
    entity_id UUID,
    action TEXT NOT NULL,                -- created, updated, deleted, approved, rejected, cancelled, filed, set, removed
    summary TEXT NOT NULL,
    changes JSONB,                       -- {"field": {"from": x, "to": y}} for updates
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_audit_logs_tenant_time ON public.staff_audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_audit_logs_branch_time ON public.staff_audit_logs (tenant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_audit_logs_staff ON public.staff_audit_logs (tenant_id, staff_id, created_at DESC);

ALTER TABLE public.staff_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.staff_audit_logs TO authenticated;
GRANT ALL ON public.staff_audit_logs TO service_role;
REVOKE ALL ON public.staff_audit_logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.staff_audit_logs FROM authenticated;

-- Managers see their branch; Super Admin / Auditor see everything, incl. tenant-wide rows.
DROP POLICY IF EXISTS "wf read staff_audit_logs" ON public.staff_audit_logs;
CREATE POLICY "wf read staff_audit_logs" ON public.staff_audit_logs FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id()
           AND (public.get_my_role() IN ('super_admin', 'auditor')
                OR (branch_id IS NOT NULL AND public.fn_wf_can_view(branch_id))));

-- ------------------------------------------------------------
-- Writer used by the triggers and by fn_set_branch_geofence
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_wf_write_audit(
    p_tenant_id UUID, p_branch_id UUID, p_staff_id UUID,
    p_entity TEXT, p_entity_id UUID, p_action TEXT, p_summary TEXT, p_changes JSONB,
    p_staff_name TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_actor_name TEXT;
    v_staff_name TEXT;
BEGIN
    SELECT COALESCE(NULLIF(btrim(full_name), ''), email) INTO v_actor_name
    FROM public.profiles WHERE id = auth.uid();
    v_staff_name := p_staff_name;
    IF v_staff_name IS NULL AND p_staff_id IS NOT NULL THEN
        SELECT full_name INTO v_staff_name FROM public.staff_members WHERE id = p_staff_id;
    END IF;
    INSERT INTO public.staff_audit_logs (
        tenant_id, branch_id, staff_id, staff_name, actor_id, actor_name,
        entity, entity_id, action, summary, changes
    ) VALUES (
        p_tenant_id, p_branch_id, p_staff_id, v_staff_name, auth.uid(), COALESCE(v_actor_name, 'System'),
        p_entity, p_entity_id, p_action, p_summary, p_changes
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
REVOKE EXECUTE ON FUNCTION public.fn_wf_write_audit(UUID, UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- Changed fields between two row images, ignoring bookkeeping columns.
CREATE OR REPLACE FUNCTION public.fn_wf_row_changes(p_old JSONB, p_new JSONB)
RETURNS JSONB AS $$
    SELECT COALESCE(jsonb_object_agg(n.key, jsonb_build_object('from', p_old -> n.key, 'to', n.value)), '{}'::jsonb)
    FROM jsonb_each(p_new) n
    WHERE n.key NOT IN ('updated_at', 'created_at', 'tenant_id', 'pin_hash', 'failed_attempts', 'locked_until')
      AND (p_old -> n.key) IS DISTINCT FROM n.value;
$$ LANGUAGE sql IMMUTABLE;
REVOKE EXECUTE ON FUNCTION public.fn_wf_row_changes(JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- One trigger function for all Workforce tables
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_wf_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_new JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    v_old JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
    v_row JSONB := COALESCE(v_new, v_old);
    v_changes JSONB;
    v_staff UUID := (v_row ->> 'staff_id')::UUID;
    v_branch UUID := (v_row ->> 'branch_id')::UUID;
    v_name TEXT;
    v_entity TEXT;
    v_action TEXT;
    v_summary TEXT;
    v_type TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN v_action := 'created';
    ELSIF TG_OP = 'UPDATE' THEN v_action := 'updated';
    ELSE v_action := 'deleted'; END IF;

    IF TG_OP = 'UPDATE' THEN
        v_changes := public.fn_wf_row_changes(v_old, v_new);
        -- PIN rows hide the hash from the diff, so they are checked separately below.
        IF v_changes = '{}'::jsonb AND TG_TABLE_NAME <> 'staff_member_pins' THEN RETURN NULL; END IF;
    END IF;

    -- Rows removed because their staff member was deleted: the staff deletion is the log entry.
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('staff_shifts', 'staff_schedule_rules', 'staff_leave_requests',
                                              'staff_leave_allowances', 'staff_member_pins')
       AND NOT EXISTS (SELECT 1 FROM public.staff_members WHERE id = v_staff) THEN
        RETURN NULL;
    END IF;

    IF TG_TABLE_NAME = 'staff_members' THEN
        v_entity := 'staff';
        v_staff := (v_row ->> 'id')::UUID;
        v_name := v_row ->> 'full_name';
        v_summary := CASE v_action
            WHEN 'created' THEN 'Added staff ' || v_name
            WHEN 'deleted' THEN 'Deleted staff ' || v_name
            ELSE 'Edited staff ' || v_name END;

    ELSIF TG_TABLE_NAME = 'staff_shifts' THEN
        -- Shifts generated from recurring rules, and shifts cancelled/restored by
        -- leave, are logged through the rule or the leave request instead.
        IF TG_OP = 'INSERT' AND v_row ->> 'source' = 'rule' THEN RETURN NULL; END IF;
        IF TG_OP = 'UPDATE' AND (v_changes ? 'leave_request_id') THEN RETURN NULL; END IF;
        v_entity := 'shift';
        v_summary := CASE
            WHEN TG_OP = 'UPDATE' AND v_changes ? 'status' AND v_new ->> 'status' = 'cancelled' THEN 'Cancelled shift on ' || (v_row ->> 'shift_date')
            WHEN TG_OP = 'UPDATE' AND v_changes ? 'status' AND v_new ->> 'status' = 'scheduled' THEN 'Restored shift on ' || (v_row ->> 'shift_date')
            WHEN v_action = 'created' THEN 'Added shift on ' || (v_row ->> 'shift_date')
            WHEN v_action = 'deleted' THEN 'Deleted shift on ' || (v_row ->> 'shift_date')
            ELSE 'Changed shift on ' || (v_row ->> 'shift_date') END;

    ELSIF TG_TABLE_NAME = 'staff_schedule_rules' THEN
        v_entity := 'schedule_rule';
        v_summary := CASE
            WHEN TG_OP = 'UPDATE' AND v_changes ? 'is_active' THEN
                CASE WHEN (v_new ->> 'is_active')::BOOLEAN THEN 'Resumed recurring schedule' ELSE 'Paused recurring schedule' END
            WHEN v_action = 'created' THEN 'Added recurring schedule'
            WHEN v_action = 'deleted' THEN 'Deleted recurring schedule'
            ELSE 'Changed recurring schedule' END;

    ELSIF TG_TABLE_NAME = 'shift_templates' THEN
        v_entity := 'shift_template';
        v_staff := NULL;
        v_summary := CASE v_action
            WHEN 'created' THEN 'Added shift template '
            WHEN 'deleted' THEN 'Deleted shift template '
            ELSE 'Changed shift template ' END || (v_row ->> 'name');

    ELSIF TG_TABLE_NAME = 'attendance_logs' THEN
        -- Normal punches are already a log; only manual corrections are audited.
        IF v_row ->> 'method' <> 'manual' THEN RETURN NULL; END IF;
        v_entity := 'attendance';
        v_summary := 'Manual ' || CASE v_row ->> 'event_type'
                WHEN 'in' THEN 'time in' WHEN 'out' THEN 'time out'
                WHEN 'break_start' THEN 'break start' ELSE 'break end' END
            || ' at ' || to_char((v_row ->> 'event_at')::TIMESTAMPTZ AT TIME ZONE public.fn_wf_tz(), 'Mon DD HH12:MI AM')
            || ': ' || COALESCE(v_row ->> 'note', '');

    ELSIF TG_TABLE_NAME = 'staff_leave_requests' THEN
        v_entity := 'leave_request';
        SELECT name INTO v_type FROM public.staff_leave_types WHERE id = (v_row ->> 'leave_type_id')::UUID;
        IF TG_OP = 'INSERT' THEN
            v_action := 'filed';
            v_summary := 'Filed ' || COALESCE(v_type, 'leave') || ' for ' || (v_row ->> 'start_date')
                || CASE WHEN v_row ->> 'end_date' <> v_row ->> 'start_date' THEN ' to ' || (v_row ->> 'end_date') ELSE '' END
                || ' (' || trim_scale((v_row ->> 'days')::NUMERIC) || ' day(s))';
        ELSIF TG_OP = 'UPDATE' AND v_changes ? 'status' THEN
            v_action := v_new ->> 'status';
            v_summary := initcap(v_new ->> 'status') || ' ' || COALESCE(v_type, 'leave') || ' for ' || (v_row ->> 'start_date')
                || CASE WHEN v_row ->> 'end_date' <> v_row ->> 'start_date' THEN ' to ' || (v_row ->> 'end_date') ELSE '' END
                || CASE WHEN COALESCE(v_new ->> 'review_note', '') <> '' THEN ': ' || (v_new ->> 'review_note') ELSE '' END;
        ELSE
            v_summary := initcap(v_action) || ' ' || COALESCE(v_type, 'leave') || ' request';
        END IF;

    ELSIF TG_TABLE_NAME = 'staff_leave_allowances' THEN
        v_entity := 'leave_allowance';
        SELECT name INTO v_type FROM public.staff_leave_types WHERE id = (v_row ->> 'leave_type_id')::UUID;
        SELECT branch_id INTO v_branch FROM public.staff_members WHERE id = v_staff;
        v_summary := CASE v_action
            WHEN 'deleted' THEN COALESCE(v_type, 'Leave') || ' limit for ' || (v_row ->> 'year') || ' reset to default'
            ELSE COALESCE(v_type, 'Leave') || ' limit for ' || (v_row ->> 'year') || ' set to ' || trim_scale((v_row ->> 'allowed_days')::NUMERIC) || ' day(s)' END;

    ELSIF TG_TABLE_NAME = 'staff_leave_types' THEN
        v_entity := 'leave_type';
        v_staff := NULL;
        v_summary := CASE v_action
            WHEN 'created' THEN 'Added leave type ' || (v_row ->> 'name')
            WHEN 'deleted' THEN 'Deleted leave type ' || (v_row ->> 'name')
            ELSE 'Changed leave type ' || (v_row ->> 'name') END;

    ELSIF TG_TABLE_NAME = 'staff_member_pins' THEN
        v_entity := 'pin';
        v_staff := (v_row ->> 'staff_id')::UUID;
        SELECT branch_id INTO v_branch FROM public.staff_members WHERE id = v_staff;
        -- Failed-attempt counters and lockouts are not changes worth logging.
        IF TG_OP = 'UPDATE' AND (v_old ->> 'pin_hash') = (v_new ->> 'pin_hash') THEN
            RETURN NULL;
        END IF;
        v_action := CASE WHEN TG_OP = 'DELETE' THEN 'removed' ELSE 'set' END;
        v_summary := CASE WHEN TG_OP = 'DELETE' THEN 'Removed kiosk PIN' ELSE 'Set kiosk PIN' END;
        v_changes := NULL;
    ELSE
        RETURN NULL;
    END IF;

    PERFORM public.fn_wf_write_audit(
        (v_row ->> 'tenant_id')::UUID, v_branch, v_staff, v_entity,
        COALESCE((v_row ->> 'id')::UUID, v_staff), v_action, v_summary,
        CASE WHEN TG_OP = 'UPDATE' THEN v_changes END,
        v_name
    );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['staff_members', 'staff_shifts', 'staff_schedule_rules', 'shift_templates',
                             'attendance_logs', 'staff_leave_requests', 'staff_leave_allowances',
                             'staff_leave_types', 'staff_member_pins']
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS tg_wf_audit_%1$s ON public.%1$I', t);
        EXECUTE format('CREATE TRIGGER tg_wf_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
                        FOR EACH ROW EXECUTE FUNCTION public.tg_wf_audit()', t);
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- Geofence changes (branches is an existing table, so no trigger there:
-- the Workforce function that changes it writes the audit row instead).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_branch_geofence(
    p_branch_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_radius_m INTEGER DEFAULT 100
)
RETURNS VOID AS $$
DECLARE
    v_name TEXT;
BEGIN
    SELECT name INTO v_name FROM public.branches
    WHERE id = p_branch_id AND tenant_id = public.get_my_tenant_id();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Branch not found';
    END IF;
    IF NOT (public.get_my_role() = 'super_admin'
            OR (public.get_my_role() = 'branch_manager' AND public.get_my_branch_id() = p_branch_id)) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    IF p_latitude IS NULL OR p_longitude IS NULL THEN
        UPDATE public.branches
        SET latitude = NULL, longitude = NULL, geofence_radius_m = NULL
        WHERE id = p_branch_id;
        PERFORM public.fn_wf_write_audit(public.get_my_tenant_id(), p_branch_id, NULL, 'geofence', p_branch_id,
                                         'removed', 'Cleared time clock location for ' || v_name, NULL);
        RETURN;
    END IF;

    IF p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
        RAISE EXCEPTION 'Invalid coordinates';
    END IF;
    IF COALESCE(p_radius_m, 100) NOT BETWEEN 25 AND 1000 THEN
        RAISE EXCEPTION 'Radius must be between 25 and 1000 metres';
    END IF;

    UPDATE public.branches
    SET latitude = p_latitude, longitude = p_longitude, geofence_radius_m = COALESCE(p_radius_m, 100)
    WHERE id = p_branch_id;
    PERFORM public.fn_wf_write_audit(public.get_my_tenant_id(), p_branch_id, NULL, 'geofence', p_branch_id,
        'set', 'Set time clock location for ' || v_name || ' (' || COALESCE(p_radius_m, 100) || ' m radius)',
        jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude, 'radius_m', COALESCE(p_radius_m, 100)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.fn_set_branch_geofence(UUID, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_branch_geofence(UUID, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC, anon;
