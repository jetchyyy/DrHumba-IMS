-- ============================================================
-- MIGRATION: Workforce leave (types, yearly allowances, requests)
--
-- ADDITIVE ONLY. New tables and new functions. The only object it replaces
-- is fn_generate_staff_shifts, which was introduced by the (also new)
-- workforce migrations; same signature, so no overload is created.
-- Existing (pre-Workforce) tables, functions and policies are untouched.
--
-- Rules:
--   * Each leave type has a default yearly allowance (days).
--   * A manager can override the allowance per staff per year.
--   * Filing is blocked when approved + pending + new days > allowance.
--   * Days counted = the staff's scheduled work days in the range
--     (from recurring rules or scheduled shifts). Staff with no schedule at
--     all count calendar days. Half day = 0.5 (single day only).
--   * Approving cancels the staff's scheduled shifts in the range and stops
--     the generator from re-creating them. Cancelling an approved leave
--     restores those shifts.
-- ============================================================

-- 1. Leave types (tenant-wide)
CREATE TABLE IF NOT EXISTS public.staff_leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    is_paid BOOLEAN NOT NULL DEFAULT true,
    default_days_per_year NUMERIC(5,1) NOT NULL DEFAULT 5 CHECK (default_days_per_year >= 0 AND default_days_per_year <= 366),
    max_days_per_request NUMERIC(5,1) CHECK (max_days_per_request IS NULL OR max_days_per_request > 0),
    allow_half_day BOOLEAN NOT NULL DEFAULT true,
    color TEXT NOT NULL DEFAULT '#10b981',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_tenant_name
    ON public.staff_leave_types (tenant_id, lower(name));

-- 2. Per-staff yearly allowance overrides
CREATE TABLE IF NOT EXISTS public.staff_leave_allowances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES public.staff_leave_types(id) ON DELETE CASCADE,
    year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
    allowed_days NUMERIC(5,1) NOT NULL CHECK (allowed_days >= 0 AND allowed_days <= 366),
    updated_by UUID DEFAULT auth.uid(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_allowances
    ON public.staff_leave_allowances (tenant_id, staff_id, leave_type_id, year);

-- 3. Leave requests
CREATE TABLE IF NOT EXISTS public.staff_leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    leave_type_id UUID NOT NULL REFERENCES public.staff_leave_types(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    half_day BOOLEAN NOT NULL DEFAULT false,
    days NUMERIC(5,1) NOT NULL CHECK (days > 0),
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    filed_by UUID DEFAULT auth.uid(),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date),
    CHECK (NOT half_day OR start_date = end_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_staff ON public.staff_leave_requests (tenant_id, staff_id, start_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_branch_status ON public.staff_leave_requests (tenant_id, branch_id, status);

-- 4. Link cancelled shifts to the leave that cancelled them (new table column, nullable)
ALTER TABLE public.staff_shifts
    ADD COLUMN IF NOT EXISTS leave_request_id UUID REFERENCES public.staff_leave_requests(id) ON DELETE SET NULL;

-- 5. Tenant stamping
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_leave_types ON public.staff_leave_types;
CREATE TRIGGER tg_auto_stamp_tenant_leave_types
    BEFORE INSERT ON public.staff_leave_types
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_leave_allowances ON public.staff_leave_allowances;
CREATE TRIGGER tg_auto_stamp_tenant_leave_allowances
    BEFORE INSERT ON public.staff_leave_allowances
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- 6. Helper: branch of a staff member in my tenant (bypasses RLS safely)
CREATE OR REPLACE FUNCTION public.fn_wf_staff_branch(p_staff_id UUID)
RETURNS UUID AS $$
    SELECT branch_id FROM public.staff_members
    WHERE id = p_staff_id AND tenant_id = public.get_my_tenant_id();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION public.fn_wf_staff_branch(UUID) TO authenticated;

-- 7. Privileges + RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_leave_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_leave_allowances TO authenticated;
GRANT SELECT ON public.staff_leave_requests TO authenticated;
GRANT ALL ON public.staff_leave_types, public.staff_leave_allowances, public.staff_leave_requests TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.staff_leave_requests FROM anon, authenticated;

ALTER TABLE public.staff_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wf read staff_leave_types" ON public.staff_leave_types;
CREATE POLICY "wf read staff_leave_types" ON public.staff_leave_types FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "wf write staff_leave_types" ON public.staff_leave_types;
CREATE POLICY "wf write staff_leave_types" ON public.staff_leave_types FOR ALL TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'super_admin')
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "wf read staff_leave_allowances" ON public.staff_leave_allowances;
CREATE POLICY "wf read staff_leave_allowances" ON public.staff_leave_allowances FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id()
           AND (public.fn_wf_can_view(public.fn_wf_staff_branch(staff_id)) OR staff_id = public.fn_wf_my_staff_id()));

DROP POLICY IF EXISTS "wf write staff_leave_allowances" ON public.staff_leave_allowances;
CREATE POLICY "wf write staff_leave_allowances" ON public.staff_leave_allowances FOR ALL TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(public.fn_wf_staff_branch(staff_id)))
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(public.fn_wf_staff_branch(staff_id)));

DROP POLICY IF EXISTS "wf read staff_leave_requests" ON public.staff_leave_requests;
CREATE POLICY "wf read staff_leave_requests" ON public.staff_leave_requests FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id()
           AND (public.fn_wf_can_view(branch_id) OR staff_id = public.fn_wf_my_staff_id()));

-- 8. Internal: days a leave would use
CREATE OR REPLACE FUNCTION public.fn_wf_leave_days(
    p_staff_id UUID, p_start DATE, p_end DATE, p_half_day BOOLEAN
)
RETURNS NUMERIC AS $$
DECLARE
    v_has_schedule BOOLEAN;
    v_days NUMERIC;
BEGIN
    SELECT EXISTS (SELECT 1 FROM public.staff_schedule_rules WHERE staff_id = p_staff_id AND is_active)
        OR EXISTS (SELECT 1 FROM public.staff_shifts WHERE staff_id = p_staff_id)
    INTO v_has_schedule;

    IF NOT v_has_schedule THEN
        v_days := (p_end - p_start) + 1;
    ELSE
        SELECT count(*) INTO v_days
        FROM generate_series(p_start::TIMESTAMP, p_end::TIMESTAMP, INTERVAL '1 day') AS d
        WHERE EXISTS (
                SELECT 1 FROM public.staff_shifts s
                WHERE s.staff_id = p_staff_id AND s.shift_date = d::DATE
                  AND (s.status = 'scheduled' OR s.leave_request_id IS NOT NULL)
            )
           OR EXISTS (
                SELECT 1 FROM public.staff_schedule_rules r
                JOIN public.shift_templates t ON t.id = r.shift_template_id AND t.is_active
                WHERE r.staff_id = p_staff_id AND r.is_active
                  AND d::DATE >= r.effective_from
                  AND (r.effective_to IS NULL OR d::DATE <= r.effective_to)
                  AND EXTRACT(DOW FROM d)::SMALLINT = ANY (r.weekdays)
            );
    END IF;

    IF p_half_day AND v_days > 0 THEN
        RETURN 0.5;
    END IF;
    RETURN v_days;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- 9. Balances per leave type for one staff and year
CREATE OR REPLACE FUNCTION public.fn_leave_balances(
    p_staff_id UUID DEFAULT NULL,
    p_year INTEGER DEFAULT NULL
)
RETURNS TABLE (
    leave_type_id UUID,
    name TEXT,
    color TEXT,
    is_paid BOOLEAN,
    allow_half_day BOOLEAN,
    max_days_per_request NUMERIC,
    allowed_days NUMERIC,
    is_override BOOLEAN,
    used_days NUMERIC,
    pending_days NUMERIC,
    remaining_days NUMERIC
) AS $$
#variable_conflict use_column
DECLARE
    v_staff UUID := COALESCE(p_staff_id, public.fn_wf_my_staff_id());
    v_year INTEGER := COALESCE(p_year, EXTRACT(YEAR FROM (now() AT TIME ZONE public.fn_wf_tz()))::INTEGER);
BEGIN
    IF v_staff IS NULL THEN
        RETURN;
    END IF;
    IF v_staff IS DISTINCT FROM public.fn_wf_my_staff_id()
       AND NOT public.fn_wf_can_view(public.fn_wf_staff_branch(v_staff)) THEN
        RAISE EXCEPTION 'Not authorized';
    END IF;

    RETURN QUERY
    SELECT lt.id, lt.name, lt.color, lt.is_paid, lt.allow_half_day, lt.max_days_per_request,
           COALESCE(la.allowed_days, lt.default_days_per_year),
           la.id IS NOT NULL,
           COALESCE(u.used, 0),
           COALESCE(u.pending, 0),
           COALESCE(la.allowed_days, lt.default_days_per_year) - COALESCE(u.used, 0) - COALESCE(u.pending, 0)
    FROM public.staff_leave_types lt
    LEFT JOIN public.staff_leave_allowances la
           ON la.leave_type_id = lt.id AND la.staff_id = v_staff AND la.year = v_year
    LEFT JOIN LATERAL (
        SELECT sum(r.days) FILTER (WHERE r.status = 'approved') AS used,
               sum(r.days) FILTER (WHERE r.status = 'pending') AS pending
        FROM public.staff_leave_requests r
        WHERE r.staff_id = v_staff AND r.leave_type_id = lt.id
          AND EXTRACT(YEAR FROM r.start_date)::INTEGER = v_year
    ) u ON true
    WHERE lt.tenant_id = public.get_my_tenant_id() AND lt.is_active
    ORDER BY lt.sort_order, lt.name;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- 10. File a leave request (self, or a manager on behalf of staff)
CREATE OR REPLACE FUNCTION public.fn_file_leave(
    p_leave_type_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_reason TEXT DEFAULT NULL,
    p_half_day BOOLEAN DEFAULT false,
    p_staff_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_tenant UUID := public.get_my_tenant_id();
    v_my_staff UUID := public.fn_wf_my_staff_id();
    v_staff public.staff_members%ROWTYPE;
    v_type public.staff_leave_types%ROWTYPE;
    v_days NUMERIC;
    v_allowed NUMERIC;
    v_taken NUMERIC;
    v_year INTEGER;
    v_id UUID;
    v_half BOOLEAN := COALESCE(p_half_day, false);
BEGIN
    IF v_tenant IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Not signed in.');
    END IF;

    IF p_staff_id IS NULL OR p_staff_id = v_my_staff THEN
        IF v_my_staff IS NULL THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Your login is not linked to a staff record. Ask your manager.');
        END IF;
        SELECT * INTO v_staff FROM public.staff_members WHERE id = v_my_staff;
    ELSE
        SELECT * INTO v_staff FROM public.staff_members WHERE id = p_staff_id AND tenant_id = v_tenant;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Staff member not found.');
        END IF;
        IF NOT public.fn_wf_is_manager(v_staff.branch_id) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Not authorized to file leave for this staff member.');
        END IF;
    END IF;
    IF v_staff.status <> 'active' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'This staff record is inactive.');
    END IF;

    SELECT * INTO v_type FROM public.staff_leave_types WHERE id = p_leave_type_id AND tenant_id = v_tenant AND is_active;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Leave type not found.');
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Check the dates: the end date is before the start date.');
    END IF;
    IF EXTRACT(YEAR FROM p_start_date) <> EXTRACT(YEAR FROM p_end_date) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'A leave cannot cross into the next year. File it as two requests.');
    END IF;
    IF p_end_date - p_start_date > 60 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'A single request can cover at most 61 days.');
    END IF;
    IF v_half AND p_start_date <> p_end_date THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Half-day leave must be a single day.');
    END IF;
    IF v_half AND NOT v_type.allow_half_day THEN
        RETURN jsonb_build_object('ok', false, 'error', v_type.name || ' cannot be filed as a half day.');
    END IF;
    IF p_start_date < (now() AT TIME ZONE public.fn_wf_tz())::DATE - 30 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Leave older than 30 days cannot be filed.');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.staff_leave_requests
        WHERE staff_id = v_staff.id AND status IN ('pending', 'approved')
          AND start_date <= p_end_date AND end_date >= p_start_date
    ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'These dates overlap another pending or approved leave.');
    END IF;

    v_days := public.fn_wf_leave_days(v_staff.id, p_start_date, p_end_date, v_half);
    IF v_days <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'There are no scheduled work days in those dates.');
    END IF;
    IF v_type.max_days_per_request IS NOT NULL AND v_days > v_type.max_days_per_request THEN
        RETURN jsonb_build_object('ok', false, 'error',
            v_type.name || ' can be filed for at most ' || trim_scale(v_type.max_days_per_request) || ' day(s) per request.');
    END IF;

    v_year := EXTRACT(YEAR FROM p_start_date)::INTEGER;
    SELECT COALESCE(la.allowed_days, v_type.default_days_per_year) INTO v_allowed
    FROM (SELECT 1) x
    LEFT JOIN public.staff_leave_allowances la
      ON la.staff_id = v_staff.id AND la.leave_type_id = v_type.id AND la.year = v_year;

    SELECT COALESCE(sum(days), 0) INTO v_taken
    FROM public.staff_leave_requests
    WHERE staff_id = v_staff.id AND leave_type_id = v_type.id
      AND status IN ('pending', 'approved')
      AND EXTRACT(YEAR FROM start_date)::INTEGER = v_year;

    IF v_taken + v_days > v_allowed THEN
        RETURN jsonb_build_object('ok', false, 'error',
            'Not enough ' || v_type.name || ' left for ' || v_year || ': this needs ' || trim_scale(v_days) ||
            ' day(s), you have ' || trim_scale(GREATEST(v_allowed - v_taken, 0)) || ' left (pending requests count).');
    END IF;

    INSERT INTO public.staff_leave_requests (
        tenant_id, staff_id, branch_id, leave_type_id, start_date, end_date, half_day, days, reason, status, filed_by
    ) VALUES (
        v_staff.tenant_id, v_staff.id, v_staff.branch_id, v_type.id, p_start_date, p_end_date, v_half, v_days,
        NULLIF(btrim(COALESCE(p_reason, '')), ''), 'pending', auth.uid()
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'id', v_id, 'days', v_days);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 11. Approve / reject (manager of the staff's branch)
CREATE OR REPLACE FUNCTION public.fn_review_leave(
    p_request_id UUID,
    p_approve BOOLEAN,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_req public.staff_leave_requests%ROWTYPE;
    v_staff public.staff_members%ROWTYPE;
    v_allowed NUMERIC;
    v_used NUMERIC;
    v_cancelled INTEGER := 0;
BEGIN
    SELECT * INTO v_req FROM public.staff_leave_requests
    WHERE id = p_request_id AND tenant_id = public.get_my_tenant_id()
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Leave request not found.');
    END IF;
    SELECT * INTO v_staff FROM public.staff_members WHERE id = v_req.staff_id;
    IF NOT public.fn_wf_is_manager(v_staff.branch_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Not authorized.');
    END IF;
    IF v_staff.profile_id = auth.uid() AND public.get_my_role() <> 'super_admin' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'You cannot review your own leave.');
    END IF;
    IF v_req.status <> 'pending' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'This request is already ' || v_req.status || '.');
    END IF;

    IF p_approve THEN
        SELECT COALESCE(la.allowed_days, lt.default_days_per_year) INTO v_allowed
        FROM public.staff_leave_types lt
        LEFT JOIN public.staff_leave_allowances la
          ON la.leave_type_id = lt.id AND la.staff_id = v_req.staff_id
         AND la.year = EXTRACT(YEAR FROM v_req.start_date)::INTEGER
        WHERE lt.id = v_req.leave_type_id;

        SELECT COALESCE(sum(days), 0) INTO v_used
        FROM public.staff_leave_requests
        WHERE staff_id = v_req.staff_id AND leave_type_id = v_req.leave_type_id AND status = 'approved'
          AND EXTRACT(YEAR FROM start_date) = EXTRACT(YEAR FROM v_req.start_date);

        IF v_used + v_req.days > v_allowed THEN
            RETURN jsonb_build_object('ok', false, 'error',
                'Approving this would go over the allowance (' || trim_scale(v_allowed) || ' day(s), ' || trim_scale(v_used) || ' already used). Raise the allowance first.');
        END IF;

        UPDATE public.staff_leave_requests
        SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
            review_note = NULLIF(btrim(COALESCE(p_note, '')), ''), updated_at = now()
        WHERE id = v_req.id;

        -- Whole-day leave frees the staff from their shifts on those dates.
        IF NOT v_req.half_day THEN
            UPDATE public.staff_shifts
            SET status = 'cancelled', leave_request_id = v_req.id, updated_at = now()
            WHERE staff_id = v_req.staff_id AND status = 'scheduled'
              AND shift_date BETWEEN v_req.start_date AND v_req.end_date;
            GET DIAGNOSTICS v_cancelled = ROW_COUNT;
        END IF;
    ELSE
        UPDATE public.staff_leave_requests
        SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
            review_note = NULLIF(btrim(COALESCE(p_note, '')), ''), updated_at = now()
        WHERE id = v_req.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
                              'shifts_cancelled', v_cancelled);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 12. Cancel: staff can cancel their own pending request; a manager can
--     cancel pending or approved (approved restores the cancelled shifts).
CREATE OR REPLACE FUNCTION public.fn_cancel_leave(p_request_id UUID, p_note TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_req public.staff_leave_requests%ROWTYPE;
    v_is_manager BOOLEAN;
BEGIN
    SELECT * INTO v_req FROM public.staff_leave_requests
    WHERE id = p_request_id AND tenant_id = public.get_my_tenant_id()
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Leave request not found.');
    END IF;
    v_is_manager := public.fn_wf_is_manager(public.fn_wf_staff_branch(v_req.staff_id));

    IF v_req.status = 'pending' THEN
        IF NOT (v_is_manager OR v_req.staff_id = public.fn_wf_my_staff_id()) THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Not authorized.');
        END IF;
    ELSIF v_req.status = 'approved' THEN
        IF NOT v_is_manager THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Ask your manager to cancel an approved leave.');
        END IF;
        UPDATE public.staff_shifts
        SET status = 'scheduled', leave_request_id = NULL, updated_at = now()
        WHERE leave_request_id = v_req.id;
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'This request is already ' || v_req.status || '.');
    END IF;

    UPDATE public.staff_leave_requests
    SET status = 'cancelled', updated_at = now(),
        review_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), review_note)
    WHERE id = v_req.id;

    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 13. Shift generator: same as before, but skips days covered by approved whole-day leave.
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
        r.tenant_id, r.branch_id, r.staff_id, d::DATE,
        (d::DATE + t.start_time) AT TIME ZONE v_tz,
        (d::DATE + t.end_time
            + CASE WHEN t.end_time <= t.start_time THEN INTERVAL '1 day' ELSE INTERVAL '0' END
        ) AT TIME ZONE v_tz,
        t.break_minutes, t.id, r.id, 'rule', 'scheduled'
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
      AND NOT EXISTS (
          SELECT 1 FROM public.staff_leave_requests lr
          WHERE lr.staff_id = r.staff_id AND lr.status = 'approved' AND NOT lr.half_day
            AND d::DATE BETWEEN lr.start_date AND lr.end_date
      )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 14. Grants
GRANT EXECUTE ON FUNCTION public.fn_leave_balances(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_file_leave(UUID, DATE, DATE, TEXT, BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_review_leave(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancel_leave(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_generate_staff_shifts(DATE, DATE, UUID) TO authenticated;
-- Internal helper: takes any staff id, so keep it away from clients.
REVOKE EXECUTE ON FUNCTION public.fn_wf_leave_days(UUID, DATE, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Keep anonymous (not signed in) callers out.
REVOKE ALL ON public.staff_leave_types, public.staff_leave_allowances, public.staff_leave_requests FROM anon;
REVOKE EXECUTE ON FUNCTION
    public.fn_wf_staff_branch(UUID),
    public.fn_leave_balances(UUID, INTEGER),
    public.fn_file_leave(UUID, DATE, DATE, TEXT, BOOLEAN, UUID),
    public.fn_review_leave(UUID, BOOLEAN, TEXT),
    public.fn_cancel_leave(UUID, TEXT),
    public.fn_generate_staff_shifts(DATE, DATE, UUID)
FROM PUBLIC, anon;
