-- ============================================================
-- MIGRATION: Workforce functions (shift generator, time clock, timesheet)
--
-- ADDITIVE ONLY. Every function here has a NEW name that did not exist
-- before, so no existing RPC is replaced and no overload is created.
-- Business errors are returned as {"ok": false, "error": "..."} instead of
-- RAISE where a write must survive the error (failed PIN counter).
-- ============================================================

-- Local time zone used to turn "07:00 on 2026-12-01" into a timestamp.
CREATE OR REPLACE FUNCTION public.fn_wf_tz()
RETURNS TEXT AS $$ SELECT 'Asia/Manila'::TEXT; $$
LANGUAGE sql IMMUTABLE;

-- Great-circle distance in metres (haversine). No PostGIS needed.
CREATE OR REPLACE FUNCTION public.fn_wf_distance_m(
    p_lat1 DOUBLE PRECISION, p_lng1 DOUBLE PRECISION,
    p_lat2 DOUBLE PRECISION, p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION AS $$
    SELECT 2 * 6371000 * asin(sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    ));
$$ LANGUAGE sql IMMUTABLE;

-- ------------------------------------------------------------
-- Shift generator: expands active rules into staff_shifts.
-- Idempotent (ON CONFLICT DO NOTHING); never touches existing rows, so
-- manual edits and cancellations are kept.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_generate_staff_shifts(
    p_from DATE,
    p_to DATE,
    p_branch_id UUID DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_tenant UUID := public.get_my_tenant_id();
    v_tz TEXT := public.fn_wf_tz();
    v_count INTEGER := 0;
BEGIN
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
        RAISE EXCEPTION 'Invalid date range';
    END IF;
    IF p_to - p_from > 62 THEN
        RAISE EXCEPTION 'Date range too large (max 62 days)';
    END IF;

    INSERT INTO public.staff_shifts (
        tenant_id, branch_id, staff_id, shift_date, start_at, end_at,
        break_minutes, shift_template_id, rule_id, source, status
    )
    SELECT
        r.tenant_id,
        r.branch_id,
        r.staff_id,
        d::DATE,
        (d::DATE + t.start_time) AT TIME ZONE v_tz,
        (d::DATE + t.end_time
            + CASE WHEN t.end_time <= t.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END
        ) AT TIME ZONE v_tz,
        t.break_minutes,
        t.id,
        r.id,
        'rule',
        'scheduled'
    FROM public.staff_schedule_rules r
    JOIN public.shift_templates t ON t.id = r.shift_template_id AND t.is_active
    JOIN public.staff_members s ON s.id = r.staff_id AND s.status = 'active'
    CROSS JOIN LATERAL generate_series(
        GREATEST(p_from, r.effective_from)::TIMESTAMP,
        LEAST(p_to, COALESCE(r.effective_to, p_to))::TIMESTAMP,
        INTERVAL '1 day'
    ) AS d
    WHERE r.tenant_id = v_tenant
      AND r.is_active
      AND (p_branch_id IS NULL OR r.branch_id = p_branch_id)
      AND EXTRACT(DOW FROM d)::SMALLINT = ANY (r.weekdays)
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Kiosk PIN management
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_staff_pin(p_staff_id UUID, p_pin TEXT)
RETURNS VOID AS $$
DECLARE
    v_staff public.staff_members%ROWTYPE;
BEGIN
    SELECT * INTO v_staff FROM public.staff_members
    WHERE id = p_staff_id AND tenant_id = public.get_my_tenant_id();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found';
    END IF;
    IF NOT public.fn_wf_is_manager(v_staff.branch_id) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    IF p_pin IS NULL OR btrim(p_pin) = '' THEN
        DELETE FROM public.staff_member_pins WHERE staff_id = p_staff_id;
        RETURN;
    END IF;

    IF p_pin !~ '^[0-9]{4,6}$' THEN
        RAISE EXCEPTION 'PIN must be 4 to 6 digits';
    END IF;

    INSERT INTO public.staff_member_pins (staff_id, tenant_id, pin_hash, failed_attempts, locked_until, updated_at)
    VALUES (p_staff_id, v_staff.tenant_id, extensions.crypt(p_pin, extensions.gen_salt('bf')), 0, NULL, now())
    ON CONFLICT (staff_id) DO UPDATE
        SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- ------------------------------------------------------------
-- Branch geofence setup
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_branch_geofence(
    p_branch_id UUID,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_radius_m INTEGER DEFAULT 100
)
RETURNS VOID AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.branches
        WHERE id = p_branch_id AND tenant_id = public.get_my_tenant_id()
    ) THEN
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
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Current clock status of one staff member (internal helper)
-- Returns 'off', 'working' or 'break'. An 'in' older than 20 hours with no
-- 'out' counts as a missed punch, so the staff can clock in the next day.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_wf_clock_state(p_staff_id UUID)
RETURNS TABLE (state TEXT, last_event_at TIMESTAMPTZ, last_shift_id UUID) AS $$
    WITH last_ev AS (
        SELECT event_type, event_at, shift_id
        FROM public.attendance_logs
        WHERE staff_id = p_staff_id
        ORDER BY event_at DESC, created_at DESC
        LIMIT 1
    ),
    last_in AS (
        SELECT event_at FROM public.attendance_logs
        WHERE staff_id = p_staff_id AND event_type = 'in'
        ORDER BY event_at DESC LIMIT 1
    )
    SELECT
        CASE
            WHEN NOT EXISTS (SELECT 1 FROM last_ev) THEN 'off'
            WHEN (SELECT event_type FROM last_ev) = 'out' THEN 'off'
            WHEN (SELECT event_at FROM last_in) < now() - INTERVAL '20 hours' THEN 'off'
            WHEN (SELECT event_type FROM last_ev) = 'break_start' THEN 'break'
            ELSE 'working'
        END,
        (SELECT event_at FROM last_ev),
        (SELECT shift_id FROM last_ev);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Kiosk: list staff of a branch with their current status (no PIN hashes)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_kiosk_staff_list(p_branch_id UUID)
RETURNS TABLE (
    id UUID,
    full_name TEXT,
    "position" TEXT,
    has_pin BOOLEAN,
    clock_state TEXT,
    last_event_at TIMESTAMPTZ
) AS $$
#variable_conflict use_column
BEGIN
    IF public.get_my_tenant_id() IS NULL THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF NOT (public.get_my_role() IN ('super_admin', 'auditor', 'inventory_manager')
            OR public.get_my_branch_id() = p_branch_id) THEN
        RAISE EXCEPTION 'This device is not assigned to that branch';
    END IF;

    RETURN QUERY
    SELECT s.id, s.full_name, s.position,
           EXISTS (SELECT 1 FROM public.staff_member_pins p WHERE p.staff_id = s.id),
           cs.state, cs.last_event_at
    FROM public.staff_members s
    CROSS JOIN LATERAL public.fn_wf_clock_state(s.id) cs
    WHERE s.tenant_id = public.get_my_tenant_id()
      AND s.branch_id = p_branch_id
      AND s.status = 'active'
    ORDER BY s.full_name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- My status (for the self-service Time Clock screen)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_my_clock_status()
RETURNS JSONB AS $$
DECLARE
    v_staff public.staff_members%ROWTYPE;
    v_state RECORD;
    v_branch public.branches%ROWTYPE;
    v_next RECORD;
BEGIN
    SELECT * INTO v_staff FROM public.staff_members WHERE id = public.fn_wf_my_staff_id();
    IF NOT FOUND THEN
        RETURN jsonb_build_object('linked', false);
    END IF;

    SELECT * INTO v_state FROM public.fn_wf_clock_state(v_staff.id);
    SELECT * INTO v_branch FROM public.branches WHERE id = v_staff.branch_id;

    SELECT id, start_at, end_at, break_minutes INTO v_next
    FROM public.staff_shifts
    WHERE staff_id = v_staff.id AND status = 'scheduled' AND end_at > now()
    ORDER BY start_at
    LIMIT 1;

    RETURN jsonb_build_object(
        'linked', true,
        'staff_id', v_staff.id,
        'full_name', v_staff.full_name,
        'position', v_staff.position,
        'status', v_staff.status,
        'branch_id', v_staff.branch_id,
        'branch_name', v_branch.name,
        'branch_has_geofence', v_branch.latitude IS NOT NULL AND v_branch.longitude IS NOT NULL,
        'geofence_radius_m', COALESCE(v_branch.geofence_radius_m, 100),
        'clock_state', v_state.state,
        'last_event_at', v_state.last_event_at,
        'next_shift', CASE WHEN v_next.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', v_next.id, 'start_at', v_next.start_at, 'end_at', v_next.end_at,
            'break_minutes', v_next.break_minutes) END
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Clock event (self-service or kiosk PIN). Server time only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_clock_event(
    p_event_type TEXT,
    p_latitude DOUBLE PRECISION,
    p_longitude DOUBLE PRECISION,
    p_accuracy_m DOUBLE PRECISION,
    p_staff_id UUID DEFAULT NULL,
    p_pin TEXT DEFAULT NULL,
    p_device_info TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    c_max_accuracy CONSTANT DOUBLE PRECISION := 150;
    c_max_attempts CONSTANT INTEGER := 5;
    v_tenant UUID := public.get_my_tenant_id();
    v_my_staff UUID := public.fn_wf_my_staff_id();
    v_staff public.staff_members%ROWTYPE;
    v_branch public.branches%ROWTYPE;
    v_pin public.staff_member_pins%ROWTYPE;
    v_method TEXT;
    v_state RECORD;
    v_distance DOUBLE PRECISION;
    v_radius INTEGER;
    v_shift_id UUID;
    v_id UUID;
    v_event_at TIMESTAMPTZ;
BEGIN
    IF v_tenant IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Not signed in.');
    END IF;
    IF p_event_type NOT IN ('in', 'out', 'break_start', 'break_end') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Unknown clock action.');
    END IF;

    -- Who is punching?
    IF p_staff_id IS NULL OR (p_staff_id = v_my_staff AND p_pin IS NULL) THEN
        IF v_my_staff IS NULL THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Your login is not linked to a staff record. Ask your manager.');
        END IF;
        SELECT * INTO v_staff FROM public.staff_members WHERE id = v_my_staff;
        v_method := 'self';
    ELSE
        SELECT * INTO v_staff FROM public.staff_members
        WHERE id = p_staff_id AND tenant_id = v_tenant;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Staff member not found.');
        END IF;
        IF NOT (public.get_my_role() IN ('super_admin', 'auditor', 'inventory_manager')
                OR public.get_my_branch_id() = v_staff.branch_id) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'This device is not assigned to this staff member''s branch.');
        END IF;

        SELECT * INTO v_pin FROM public.staff_member_pins WHERE staff_id = v_staff.id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'error', 'No PIN set for this staff member. Ask your manager.');
        END IF;
        IF v_pin.locked_until IS NOT NULL AND v_pin.locked_until > now() THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'Too many wrong PINs. Try again after ' || to_char(v_pin.locked_until AT TIME ZONE public.fn_wf_tz(), 'HH12:MI AM') || '.');
        END IF;
        IF p_pin IS NULL OR v_pin.pin_hash <> extensions.crypt(p_pin, v_pin.pin_hash) THEN
            UPDATE public.staff_member_pins
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE WHEN failed_attempts + 1 >= c_max_attempts
                                    THEN now() + INTERVAL '15 minutes' ELSE NULL END
            WHERE staff_id = v_staff.id;
            RETURN jsonb_build_object('ok', false, 'error', 'Incorrect PIN.');
        END IF;
        UPDATE public.staff_member_pins SET failed_attempts = 0, locked_until = NULL WHERE staff_id = v_staff.id;
        v_method := 'kiosk';
    END IF;

    IF v_staff.status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'This staff record is inactive.');
    END IF;
    IF v_staff.branch_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'No branch assigned to this staff member.');
    END IF;

    -- Geofence
    SELECT * INTO v_branch FROM public.branches WHERE id = v_staff.branch_id;
    IF v_branch.latitude IS NULL OR v_branch.longitude IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'The branch location is not set up yet. Ask your admin to set it in Workforce Settings.');
    END IF;
    IF p_latitude IS NULL OR p_longitude IS NULL
       OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude NOT BETWEEN -180 AND 180 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Location is required to clock in or out.');
    END IF;
    IF p_accuracy_m IS NULL OR p_accuracy_m > c_max_accuracy THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'GPS signal is too weak (' || COALESCE(round(p_accuracy_m)::TEXT, '?') || ' m). Move near a window or outside and try again.');
    END IF;

    v_radius := COALESCE(v_branch.geofence_radius_m, 100);
    v_distance := public.fn_wf_distance_m(p_latitude, p_longitude, v_branch.latitude, v_branch.longitude);
    IF v_distance > v_radius THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'You are ' || round(v_distance)::TEXT || ' m from ' || v_branch.name ||
            '. You must be within ' || v_radius || ' m to clock in or out.',
            'distance_m', round(v_distance));
    END IF;

    -- State machine
    SELECT * INTO v_state FROM public.fn_wf_clock_state(v_staff.id);
    IF p_event_type = 'in' AND v_state.state <> 'off' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Already clocked in.');
    ELSIF p_event_type = 'out' AND v_state.state = 'off' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Not clocked in yet.');
    ELSIF p_event_type = 'break_start' AND v_state.state <> 'working' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'You can only start a break while working.');
    ELSIF p_event_type = 'break_end' AND v_state.state <> 'break' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'You are not on a break.');
    END IF;

    -- Link to a shift
    IF p_event_type = 'in' THEN
        SELECT id INTO v_shift_id
        FROM public.staff_shifts
        WHERE staff_id = v_staff.id AND status = 'scheduled'
          AND now() BETWEEN start_at - INTERVAL '2 hours' AND end_at
        ORDER BY abs(extract(epoch FROM (start_at - now())))
        LIMIT 1;
    ELSE
        v_shift_id := v_state.last_shift_id;
    END IF;

    INSERT INTO public.attendance_logs (
        tenant_id, branch_id, staff_id, shift_id, event_type, event_at,
        latitude, longitude, accuracy_m, distance_m, within_geofence,
        method, device_info, recorded_by
    ) VALUES (
        v_staff.tenant_id, v_staff.branch_id, v_staff.id, v_shift_id, p_event_type, clock_timestamp(),
        p_latitude, p_longitude, p_accuracy_m, round(v_distance::NUMERIC, 1), true,
        v_method, left(p_device_info, 300), auth.uid()
    )
    RETURNING id, event_at INTO v_id, v_event_at;

    RETURN jsonb_build_object(
        'ok', true,
        'id', v_id,
        'event_type', p_event_type,
        'event_at', v_event_at,
        'staff_name', v_staff.full_name,
        'distance_m', round(v_distance)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- ------------------------------------------------------------
-- Manual correction by a manager (note required; original rows untouched)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_manual_attendance(
    p_staff_id UUID,
    p_event_type TEXT,
    p_event_at TIMESTAMPTZ,
    p_note TEXT
)
RETURNS UUID AS $$
DECLARE
    v_staff public.staff_members%ROWTYPE;
    v_shift_id UUID;
    v_id UUID;
BEGIN
    SELECT * INTO v_staff FROM public.staff_members
    WHERE id = p_staff_id AND tenant_id = public.get_my_tenant_id();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Staff member not found';
    END IF;
    IF NOT public.fn_wf_is_manager(v_staff.branch_id) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF v_staff.branch_id IS NULL THEN
        RAISE EXCEPTION 'Staff member has no branch';
    END IF;
    IF p_event_type NOT IN ('in', 'out', 'break_start', 'break_end') THEN
        RAISE EXCEPTION 'Unknown clock action';
    END IF;
    IF p_event_at IS NULL OR p_event_at > now() + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'Time cannot be in the future';
    END IF;
    IF p_note IS NULL OR length(btrim(p_note)) < 3 THEN
        RAISE EXCEPTION 'A reason is required for manual entries';
    END IF;

    SELECT id INTO v_shift_id
    FROM public.staff_shifts
    WHERE staff_id = v_staff.id AND status = 'scheduled'
      AND p_event_at BETWEEN start_at - INTERVAL '2 hours' AND end_at + INTERVAL '4 hours'
    ORDER BY abs(extract(epoch FROM (start_at - p_event_at)))
    LIMIT 1;

    INSERT INTO public.attendance_logs (
        tenant_id, branch_id, staff_id, shift_id, event_type, event_at,
        method, recorded_by, note
    ) VALUES (
        v_staff.tenant_id, v_staff.branch_id, v_staff.id, v_shift_id, p_event_type, p_event_at,
        'manual', auth.uid(), btrim(p_note)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Timesheet: one row per staff per local day in the range
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_get_timesheet(
    p_branch_id UUID,
    p_from DATE,
    p_to DATE
)
RETURNS TABLE (
    staff_id UUID,
    staff_name TEXT,
    branch_id UUID,
    work_date DATE,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    scheduled_minutes INTEGER,
    first_in TIMESTAMPTZ,
    last_out TIMESTAMPTZ,
    worked_minutes INTEGER,
    break_minutes INTEGER,
    late_minutes INTEGER,
    undertime_minutes INTEGER,
    overtime_minutes INTEGER,
    punch_count INTEGER,
    manual_count INTEGER,
    missing_out BOOLEAN
) AS $$
#variable_conflict use_column
DECLARE
    v_tenant UUID := public.get_my_tenant_id();
    v_tz TEXT := public.fn_wf_tz();
BEGIN
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF p_branch_id IS NULL THEN
        IF public.get_my_role() NOT IN ('super_admin', 'auditor') THEN
            RAISE EXCEPTION 'Not authorized';
        END IF;
    ELSIF NOT public.fn_wf_can_view(p_branch_id) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 92 THEN
        RAISE EXCEPTION 'Invalid date range (max 92 days)';
    END IF;

    RETURN QUERY
    WITH ev AS (
        SELECT a.staff_id, a.branch_id, a.event_type, a.event_at, a.method,
               lead(a.event_type) OVER w AS next_type,
               lead(a.event_at) OVER w AS next_at
        FROM public.attendance_logs a
        WHERE a.tenant_id = v_tenant
          AND (p_branch_id IS NULL OR a.branch_id = p_branch_id)
          AND a.event_at >= (p_from::TIMESTAMP AT TIME ZONE v_tz) - INTERVAL '1 day'
          AND a.event_at <  ((p_to + 2)::TIMESTAMP AT TIME ZONE v_tz)
        WINDOW w AS (PARTITION BY a.staff_id ORDER BY a.event_at, a.created_at)
    ),
    att AS (
        SELECT e.staff_id,
               min(e.branch_id::TEXT)::UUID AS branch_id,
               (e.event_at AT TIME ZONE v_tz)::DATE AS d,
               min(e.event_at) FILTER (WHERE e.event_type = 'in') AS first_in,
               max(e.event_at) FILTER (WHERE e.event_type = 'out') AS last_out,
               COALESCE(sum(extract(epoch FROM (e.next_at - e.event_at)) / 60)
                   FILTER (WHERE e.event_type IN ('in', 'break_end')
                             AND e.next_type IN ('out', 'break_start')
                             AND e.next_at - e.event_at < INTERVAL '20 hours'), 0)::INTEGER AS worked,
               COALESCE(sum(extract(epoch FROM (e.next_at - e.event_at)) / 60)
                   FILTER (WHERE e.event_type = 'break_start' AND e.next_type = 'break_end'), 0)::INTEGER AS brk,
               count(*)::INTEGER AS punches,
               count(*) FILTER (WHERE e.method = 'manual')::INTEGER AS manual_punches,
               bool_or(e.event_type IN ('in', 'break_end', 'break_start')
                       AND (e.next_type IS NULL OR e.next_type = 'in')) AS open_end
        FROM ev e
        GROUP BY e.staff_id, (e.event_at AT TIME ZONE v_tz)::DATE
    ),
    sch AS (
        SELECT s.staff_id,
               min(s.branch_id::TEXT)::UUID AS branch_id,
               s.shift_date AS d,
               min(s.start_at) AS s_start,
               max(s.end_at) AS s_end,
               sum(extract(epoch FROM (s.end_at - s.start_at)) / 60 - s.break_minutes)::INTEGER AS s_minutes
        FROM public.staff_shifts s
        WHERE s.tenant_id = v_tenant
          AND s.status = 'scheduled'
          AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
          AND s.shift_date BETWEEN p_from AND p_to
        GROUP BY s.staff_id, s.shift_date
    ),
    days AS (
        SELECT COALESCE(sch.staff_id, att.staff_id) AS staff_id,
               COALESCE(sch.branch_id, att.branch_id) AS branch_id,
               COALESCE(sch.d, att.d) AS d,
               sch.s_start, sch.s_end, sch.s_minutes,
               att.first_in, att.last_out, att.worked, att.brk, att.punches, att.manual_punches, att.open_end
        FROM sch
        FULL OUTER JOIN att ON att.staff_id = sch.staff_id AND att.d = sch.d
    )
    SELECT dd.staff_id,
           sm.full_name,
           dd.branch_id,
           dd.d,
           dd.s_start,
           dd.s_end,
           COALESCE(dd.s_minutes, 0),
           dd.first_in,
           dd.last_out,
           COALESCE(dd.worked, 0),
           COALESCE(dd.brk, 0),
           CASE WHEN dd.s_start IS NOT NULL AND dd.first_in IS NOT NULL
                THEN GREATEST(0, floor(extract(epoch FROM (dd.first_in - dd.s_start)) / 60))::INTEGER
                ELSE 0 END,
           CASE WHEN dd.s_end IS NOT NULL AND dd.last_out IS NOT NULL
                THEN GREATEST(0, floor(extract(epoch FROM (dd.s_end - dd.last_out)) / 60))::INTEGER
                ELSE 0 END,
           CASE WHEN dd.s_minutes IS NOT NULL
                THEN GREATEST(0, COALESCE(dd.worked, 0) - dd.s_minutes)
                ELSE 0 END,
           COALESCE(dd.punches, 0),
           COALESCE(dd.manual_punches, 0),
           COALESCE(dd.open_end, false)
    FROM days dd
    JOIN public.staff_members sm ON sm.id = dd.staff_id
    WHERE dd.d BETWEEN p_from AND p_to
    ORDER BY dd.d DESC, sm.full_name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.fn_wf_tz() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wf_distance_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_generate_staff_shifts(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_staff_pin(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_branch_geofence(UUID, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kiosk_staff_list(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_my_clock_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_clock_event(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_manual_attendance(UUID, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_timesheet(UUID, DATE, DATE) TO authenticated;

-- fn_wf_clock_state is an internal helper: it takes any staff id, so keep it
-- away from direct client calls.
REVOKE EXECUTE ON FUNCTION public.fn_wf_clock_state(UUID) FROM PUBLIC, anon, authenticated;

-- Keep anonymous (not signed in) callers out of every Workforce RPC.
REVOKE EXECUTE ON FUNCTION
    public.fn_wf_tz(),
    public.fn_wf_distance_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION),
    public.fn_generate_staff_shifts(DATE, DATE, UUID),
    public.fn_set_staff_pin(UUID, TEXT),
    public.fn_set_branch_geofence(UUID, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER),
    public.fn_kiosk_staff_list(UUID),
    public.fn_my_clock_status(),
    public.fn_clock_event(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, TEXT, TEXT),
    public.fn_manual_attendance(UUID, TEXT, TIMESTAMPTZ, TEXT),
    public.fn_get_timesheet(UUID, DATE, DATE)
FROM PUBLIC, anon;
