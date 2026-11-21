// Shared helpers for the Workforce module (scheduling + time clock).

export const WF_TIME_ZONE = 'Asia/Manila';

export type ClockEventType = 'in' | 'out' | 'break_start' | 'break_end';
export type ClockState = 'off' | 'working' | 'break';

export interface StaffMember {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  profile_id: string | null;
  full_name: string;
  position: string | null;
  employment_type: 'full_time' | 'part_time' | 'contractual' | 'on_call';
  hourly_rate: number | null;
  status: 'active' | 'inactive';
}

export interface ShiftTemplate {
  id: string;
  branch_id: string | null;
  name: string;
  start_time: string; // HH:MM:SS
  end_time: string;
  break_minutes: number;
  color: string;
  is_active: boolean;
}

export interface ScheduleRule {
  id: string;
  staff_id: string;
  branch_id: string;
  shift_template_id: string;
  weekdays: number[];
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
}

export interface StaffShift {
  id: string;
  branch_id: string;
  staff_id: string;
  shift_date: string;
  start_at: string;
  end_at: string;
  break_minutes: number;
  shift_template_id: string | null;
  rule_id: string | null;
  source: 'rule' | 'manual';
  status: 'scheduled' | 'cancelled';
  notes: string | null;
  leave_request_id?: string | null;
}

export interface AttendanceLog {
  id: string;
  staff_id: string;
  branch_id: string;
  shift_id: string | null;
  event_type: ClockEventType;
  event_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  within_geofence: boolean | null;
  method: 'self' | 'kiosk' | 'manual';
  note: string | null;
}

export interface ClockResult {
  ok: boolean;
  error?: string;
  event_type?: ClockEventType;
  event_at?: string;
  staff_name?: string;
  distance_m?: number;
}

export interface LeaveType {
  id: string;
  name: string;
  is_paid: boolean;
  default_days_per_year: number;
  max_days_per_request: number | null;
  allow_half_day: boolean;
  color: string;
  is_active: boolean;
  sort_order: number;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  staff_id: string;
  branch_id: string | null;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  filed_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export interface LeaveBalance {
  leave_type_id: string;
  name: string;
  color: string;
  is_paid: boolean;
  allow_half_day: boolean;
  max_days_per_request: number | null;
  allowed_days: number;
  is_override: boolean;
  used_days: number;
  pending_days: number;
  remaining_days: number;
}

export const LEAVE_STATUS_STYLE: Record<LeaveStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30' },
  approved: { label: 'Approved', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30' },
  rejected: { label: 'Rejected', className: 'bg-destructive/10 text-destructive border border-destructive/30' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground border' },
};

/** "Nov 27 – Nov 30, 2026" or "Dec 1, 2026 (half day)" */
export function formatLeaveRange(r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'half_day'>): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const year = r.end_date.slice(0, 4);
  if (r.start_date === r.end_date) {
    return `${formatDateLabel(r.start_date, { weekday: 'short', ...opts })}, ${year}${r.half_day ? ' (half day)' : ''}`;
  }
  return `${formatDateLabel(r.start_date, opts)} – ${formatDateLabel(r.end_date, opts)}, ${year}`;
}

export function formatDays(n: number): string {
  const v = Number(n);
  return `${Number.isInteger(v) ? v : v.toFixed(1)} day${v === 1 ? '' : 's'}`;
}

export const EVENT_LABELS: Record<ClockEventType, string> = {
  in: 'Time in',
  out: 'Time out',
  break_start: 'Break start',
  break_end: 'Break end',
};

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const EMPLOYMENT_LABELS: Record<StaffMember['employment_type'], string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractual: 'Contractual',
  on_call: 'On-call',
};

export const STATE_BADGE: Record<ClockState, { label: string; className: string }> = {
  off: { label: 'Off duty', className: 'bg-muted text-muted-foreground border' },
  working: { label: 'On duty', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' },
  break: { label: 'On break', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30' },
};

/** Which buttons make sense for a clock state. */
export function allowedClockActions(state: ClockState): ClockEventType[] {
  if (state === 'off') return ['in'];
  if (state === 'break') return ['break_end', 'out'];
  return ['break_start', 'out'];
}

// ── Geolocation ──────────────────────────────────────────────────────────────

export interface DevicePosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export class GeoError extends Error {}

/** Ask the browser for a fresh high-accuracy fix, with friendly errors. */
export function getDevicePosition(timeoutMs = 15000): Promise<DevicePosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('This device or browser does not support location.'));
      return;
    }
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      reject(new GeoError('Location only works over HTTPS. Open the app from its https:// address.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      err => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new GeoError('Location permission is blocked. Allow location for this site in your browser settings, then try again.'));
        } else if (err.code === err.TIMEOUT) {
          reject(new GeoError('Getting your location took too long. Move near a window or outside and try again.'));
        } else {
          reject(new GeoError('Could not get your location. Turn on Location/GPS and try again.'));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

export function deviceInfo(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.userAgent.slice(0, 300);
}

export function mapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

// ── Dates (Manila local time) ────────────────────────────────────────────────

/** YYYY-MM-DD for a Date, in Manila time. */
export function toLocalDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WF_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function todayKey(): string {
  return toLocalDateKey(new Date());
}

/** Add days to a YYYY-MM-DD key (calendar math, time-zone safe). */
export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD key. */
export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday of the week containing the key. */
export function startOfWeekKey(key: string): string {
  const dow = weekdayOfKey(key);
  return addDaysKey(key, dow === 0 ? -6 : 1 - dow);
}

/** Convert a Manila local date + HH:MM to an ISO timestamp (Manila is fixed UTC+8, no DST). */
export function localDateTimeToIso(dateKey: string, hhmm: string, addDays = 0): string {
  const base = addDays ? addDaysKey(dateKey, addDays) : dateKey;
  return new Date(`${base}T${hhmm.slice(0, 5)}:00+08:00`).toISOString();
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: WF_TIME_ZONE, hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDateLabel(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...opts }).format(new Date(`${key}T00:00:00Z`));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: WF_TIME_ZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

/** "07:00:00" → "7:00 AM" */
export function formatClockTime(hhmmss: string): string {
  const [h, m] = hhmmss.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function minutesToHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Template length in minutes (handles overnight). */
export function templateMinutes(t: Pick<ShiftTemplate, 'start_time' | 'end_time' | 'break_minutes'>): number {
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  let span = toMin(t.end_time) - toMin(t.start_time);
  if (span <= 0) span += 24 * 60;
  return span - (t.break_minutes || 0);
}

export function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: unknown[][]): void {
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function errorMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err && 'message' in err) {
    const msg = String((err as { message: unknown }).message);
    if (msg.includes('attendance_logs_staff_id_fkey') || msg.includes('violates foreign key constraint')) {
      return 'This staff member has attendance records and cannot be deleted. Set them to Inactive instead.';
    }
    if (msg.includes('uq_staff_shifts_staff_start')) {
      return 'This staff member already has a shift starting at that time.';
    }
    if (msg.includes('uq_staff_members_tenant_profile')) {
      return 'That login is already linked to another staff record.';
    }
    if (msg.includes('row-level security')) {
      return 'You do not have permission to change this branch.';
    }
    return msg;
  }
  return 'Something went wrong.';
}

/** Workforce screens, as shown in Staff Management's access list. */
export const WORKFORCE_TAB_INFO: { id: string; name: string; description: string; group: 'Self-service' | 'Management' }[] = [
  { id: 'wf-time-clock', name: 'My Time Clock', description: 'Time in and out on their own phone (GPS checked).', group: 'Self-service' },
  { id: 'wf-my-schedule', name: 'My Schedule', description: 'See their own upcoming shifts.', group: 'Self-service' },
  { id: 'wf-my-leave', name: 'My Leave', description: 'See their leave balance and file leave.', group: 'Self-service' },
  { id: 'wf-kiosk', name: 'Branch Time Clock', description: 'Run the shared PIN time clock on a branch device.', group: 'Management' },
  { id: 'wf-schedule', name: 'Schedule Board', description: 'View and edit shifts and recurring schedules.', group: 'Management' },
  { id: 'wf-attendance', name: 'Attendance', description: 'Timesheets, punch log and manual corrections.', group: 'Management' },
  { id: 'wf-leave', name: 'Leave Requests', description: 'Approve leave and set leave limits.', group: 'Management' },
  { id: 'wf-staff', name: 'Staff Directory', description: 'Add staff, set PINs and see attendance history.', group: 'Management' },
  { id: 'wf-shift-templates', name: 'Shift Templates', description: 'Create reusable shift times.', group: 'Management' },
  { id: 'wf-settings', name: 'Branch Geofence', description: 'Set where staff are allowed to time in.', group: 'Management' },
  { id: 'wf-audit', name: 'Workforce Audit Log', description: 'See who changed schedules, leave, staff and PINs.', group: 'Management' },
];

export interface StaffAuditLog {
  id: string;
  branch_id: string | null;
  staff_id: string | null;
  staff_name: string | null;
  actor_id: string | null;
  actor_name: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  summary: string;
  changes: Record<string, unknown> | null;
  created_at: string;
}

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  staff: 'Staff',
  shift: 'Shift',
  schedule_rule: 'Recurring schedule',
  shift_template: 'Shift template',
  attendance: 'Attendance correction',
  leave_request: 'Leave request',
  leave_allowance: 'Leave limit',
  leave_type: 'Leave type',
  pin: 'Kiosk PIN',
  geofence: 'Branch geofence',
};
