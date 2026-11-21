-- ============================================================
-- MIGRATION: Workforce foundation (staff scheduling + time clock)
--
-- ADDITIVE ONLY. Safe to run on a live database:
--   * creates new tables (IF NOT EXISTS) and adds 3 nullable columns to branches
--   * does not alter any existing table's data, constraints, functions,
--     policies or triggers
--   * re-runnable: every statement is guarded
-- The feature stays hidden until tenants.features.staff_scheduling = true.
-- ============================================================

-- 1. Branch geofence (nullable: NULL means "not set up yet")
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER;

-- 2. Staff members (people on the schedule; may or may not have a login)
CREATE TABLE IF NOT EXISTS public.staff_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL CHECK (length(btrim(full_name)) > 0),
    position TEXT,
    employment_type TEXT NOT NULL DEFAULT 'full_time'
        CHECK (employment_type IN ('full_time', 'part_time', 'contractual', 'on_call')),
    hourly_rate NUMERIC CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_members_tenant_profile
    ON public.staff_members (tenant_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_members_tenant_branch
    ON public.staff_members (tenant_id, branch_id);

-- 3. Kiosk PINs live in their own table with NO policies: only SECURITY DEFINER
--    functions can read or write them, so hashes never reach the browser.
CREATE TABLE IF NOT EXISTS public.staff_member_pins (
    staff_id UUID PRIMARY KEY REFERENCES public.staff_members(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    pin_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Shift templates ("Opening 07:00-15:00"). end_time <= start_time means overnight.
CREATE TABLE IF NOT EXISTS public.shift_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 480),
    color TEXT NOT NULL DEFAULT '#6366f1',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_templates_tenant ON public.shift_templates (tenant_id, branch_id);

-- 5. Recurring schedule rules: "this staff works this template on these weekdays"
--    weekdays uses Postgres DOW: 0 = Sunday ... 6 = Saturday
CREATE TABLE IF NOT EXISTS public.staff_schedule_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE CASCADE,
    weekdays SMALLINT[] NOT NULL
        CHECK (cardinality(weekdays) > 0 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_staff_schedule_rules_staff ON public.staff_schedule_rules (tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_schedule_rules_branch ON public.staff_schedule_rules (tenant_id, branch_id);

-- 6. Actual shifts on a date (generated from rules, or added by hand)
CREATE TABLE IF NOT EXISTS public.staff_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
    shift_date DATE NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    break_minutes INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 480),
    shift_template_id UUID REFERENCES public.shift_templates(id) ON DELETE SET NULL,
    rule_id UUID REFERENCES public.staff_schedule_rules(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('rule', 'manual')),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
    notes TEXT,
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_at > start_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_shifts_staff_start
    ON public.staff_shifts (tenant_id, staff_id, start_at);
-- One generated shift per rule per day, even after a manager edits its times.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_shifts_rule_day
    ON public.staff_shifts (tenant_id, rule_id, shift_date) WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_shifts_branch_date
    ON public.staff_shifts (tenant_id, branch_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_staff_date
    ON public.staff_shifts (staff_id, shift_date);

-- 7. Attendance punches (append-only; corrections are new 'manual' rows)
CREATE TABLE IF NOT EXISTS public.attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000',
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
    shift_id UUID REFERENCES public.staff_shifts(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('in', 'out', 'break_start', 'break_end')),
    event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    accuracy_m DOUBLE PRECISION,
    distance_m DOUBLE PRECISION,
    within_geofence BOOLEAN,
    method TEXT NOT NULL CHECK (method IN ('self', 'kiosk', 'manual')),
    device_info TEXT,
    recorded_by UUID DEFAULT auth.uid(),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_staff_time
    ON public.attendance_logs (tenant_id, staff_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_branch_time
    ON public.attendance_logs (tenant_id, branch_id, event_at DESC);

-- 8. Tenant auto-stamp triggers
DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_staff_members ON public.staff_members;
CREATE TRIGGER tg_auto_stamp_tenant_staff_members
    BEFORE INSERT ON public.staff_members
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_shift_templates ON public.shift_templates;
CREATE TRIGGER tg_auto_stamp_tenant_shift_templates
    BEFORE INSERT ON public.shift_templates
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_staff_schedule_rules ON public.staff_schedule_rules;
CREATE TRIGGER tg_auto_stamp_tenant_staff_schedule_rules
    BEFORE INSERT ON public.staff_schedule_rules
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_staff_shifts ON public.staff_shifts;
CREATE TRIGGER tg_auto_stamp_tenant_staff_shifts
    BEFORE INSERT ON public.staff_shifts
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

-- 9. Access helpers (new names only; nothing existing is replaced)
CREATE OR REPLACE FUNCTION public.fn_wf_is_manager(p_branch_id UUID)
RETURNS BOOLEAN AS $$
    SELECT CASE
        WHEN public.get_my_role() = 'super_admin' THEN true
        WHEN p_branch_id IS NULL THEN false
        WHEN public.get_my_role() = 'branch_manager' AND public.get_my_branch_id() = p_branch_id THEN true
        WHEN public.get_my_branch_id() = p_branch_id
             AND COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[]) && ARRAY['wf-schedule', 'wf-staff'] THEN true
        ELSE false
    END;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_wf_can_view(p_branch_id UUID)
RETURNS BOOLEAN AS $$
    SELECT public.get_my_role() IN ('super_admin', 'auditor')
        OR public.fn_wf_is_manager(p_branch_id)
        OR (p_branch_id IS NOT NULL
            AND public.get_my_branch_id() = p_branch_id
            AND 'wf-attendance' = ANY(COALESCE(public.get_my_allowed_tabs(), ARRAY[]::TEXT[])));
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.fn_wf_my_staff_id()
RETURNS UUID AS $$
    SELECT id FROM public.staff_members
    WHERE profile_id = auth.uid()
      AND tenant_id = public.get_my_tenant_id()
    LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.fn_wf_is_manager(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wf_can_view(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wf_my_staff_id() TO authenticated;

-- 10. Table privileges. Stated explicitly because newer Supabase projects no
--     longer grant new public tables to API roles by default. RLS below still
--     decides which rows each user can touch. anon gets nothing.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_schedule_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_shifts TO authenticated;
GRANT SELECT ON public.attendance_logs TO authenticated;
GRANT ALL ON public.staff_members, public.staff_member_pins, public.shift_templates,
             public.staff_schedule_rules, public.staff_shifts, public.attendance_logs TO service_role;
REVOKE ALL ON public.staff_member_pins FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_logs FROM anon, authenticated;

-- 11. Row Level Security
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_member_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_schedule_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs ENABLE ROW LEVEL SECURITY;

-- staff_members
DROP POLICY IF EXISTS "wf read staff_members" ON public.staff_members;
CREATE POLICY "wf read staff_members" ON public.staff_members FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id()
           AND (public.fn_wf_can_view(branch_id) OR profile_id = auth.uid()));

DROP POLICY IF EXISTS "wf insert staff_members" ON public.staff_members;
CREATE POLICY "wf insert staff_members" ON public.staff_members FOR INSERT TO authenticated
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id));

DROP POLICY IF EXISTS "wf update staff_members" ON public.staff_members;
CREATE POLICY "wf update staff_members" ON public.staff_members FOR UPDATE TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id))
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id));

DROP POLICY IF EXISTS "wf delete staff_members" ON public.staff_members;
CREATE POLICY "wf delete staff_members" ON public.staff_members FOR DELETE TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id));

-- staff_member_pins: intentionally no policies (SECURITY DEFINER access only)

-- shift_templates (tenant-wide templates, branch_id NULL, are super_admin only)
DROP POLICY IF EXISTS "wf read shift_templates" ON public.shift_templates;
CREATE POLICY "wf read shift_templates" ON public.shift_templates FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS "wf write shift_templates" ON public.shift_templates;
CREATE POLICY "wf write shift_templates" ON public.shift_templates FOR ALL TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id))
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id));

-- staff_schedule_rules
DROP POLICY IF EXISTS "wf read staff_schedule_rules" ON public.staff_schedule_rules;
CREATE POLICY "wf read staff_schedule_rules" ON public.staff_schedule_rules FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id()
           AND (public.fn_wf_can_view(branch_id) OR staff_id = public.fn_wf_my_staff_id()));

DROP POLICY IF EXISTS "wf write staff_schedule_rules" ON public.staff_schedule_rules;
CREATE POLICY "wf write staff_schedule_rules" ON public.staff_schedule_rules FOR ALL TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id))
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id));

-- staff_shifts
DROP POLICY IF EXISTS "wf read staff_shifts" ON public.staff_shifts;
CREATE POLICY "wf read staff_shifts" ON public.staff_shifts FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id()
           AND (public.fn_wf_can_view(branch_id) OR staff_id = public.fn_wf_my_staff_id()));

DROP POLICY IF EXISTS "wf write staff_shifts" ON public.staff_shifts;
CREATE POLICY "wf write staff_shifts" ON public.staff_shifts FOR ALL TO authenticated
    USING (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id))
    WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.fn_wf_is_manager(branch_id));

-- attendance_logs: read only; all writes go through fn_clock_event / fn_manual_attendance
DROP POLICY IF EXISTS "wf read attendance_logs" ON public.attendance_logs;
CREATE POLICY "wf read attendance_logs" ON public.attendance_logs FOR SELECT TO authenticated
    USING (tenant_id = public.get_my_tenant_id()
           AND (public.fn_wf_can_view(branch_id) OR staff_id = public.fn_wf_my_staff_id()));

-- 12. Keep anonymous (not signed in) callers out entirely. Older Supabase
--     projects grant new tables/functions to anon by default; RLS already
--     blocks them, this removes the privilege as well.
REVOKE ALL ON public.staff_members, public.staff_member_pins, public.shift_templates,
              public.staff_schedule_rules, public.staff_shifts, public.attendance_logs FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_wf_is_manager(UUID), public.fn_wf_can_view(UUID),
                           public.fn_wf_my_staff_id() FROM PUBLIC, anon;
