import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  addDaysKey,
  downloadCsv,
  errorMessage,
  formatDateLabel,
  formatDays,
  formatLeaveRange,
  formatTime,
  LEAVE_STATUS_STYLE,
  minutesToHours,
  startOfWeekKey,
  todayKey,
  type LeaveRequest,
  type StaffMember,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

interface DayRow {
  staff_id: string;
  work_date: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_minutes: number;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  overtime_minutes: number;
  punch_count: number;
  manual_count: number;
  missing_out: boolean;
}

type DayStatus = 'present' | 'late' | 'absent' | 'leave' | 'half_leave' | 'no_out' | 'upcoming' | 'off' | 'working';

const STATUS: Record<DayStatus, { label: string; cell: string; dot: string }> = {
  present: { label: 'Present', cell: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300', dot: 'bg-emerald-500' },
  late: { label: 'Late', cell: 'bg-amber-500/20 text-amber-800 dark:text-amber-300', dot: 'bg-amber-500' },
  absent: { label: 'Absent', cell: 'bg-destructive/15 text-destructive', dot: 'bg-destructive' },
  leave: { label: 'On leave', cell: 'bg-sky-500/15 text-sky-800 dark:text-sky-300', dot: 'bg-sky-500' },
  half_leave: { label: 'Half-day leave', cell: 'bg-sky-500/10 text-sky-800 dark:text-sky-300', dot: 'bg-sky-400' },
  no_out: { label: 'No time out', cell: 'bg-orange-500/15 text-orange-800 dark:text-orange-300', dot: 'bg-orange-500' },
  working: { label: 'On duty', cell: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300', dot: 'bg-emerald-400' },
  upcoming: { label: 'Scheduled', cell: 'bg-muted text-foreground', dot: 'bg-muted-foreground' },
  off: { label: 'Day off', cell: 'text-muted-foreground', dot: 'bg-transparent border' },
};
const LEGEND: DayStatus[] = ['present', 'late', 'absent', 'leave', 'no_out', 'upcoming'];

interface Props {
  staff: StaffMember | null;
  leaveTypeName: (id: string) => string;
  onClose: () => void;
}

export const StaffHistoryDialog: React.FC<Props> = ({ staff, leaveTypeName, onClose }) => {
  const today = todayKey();
  const [monthKey, setMonthKey] = useState(`${today.slice(0, 7)}-01`);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const monthEnd = addDaysKey(`${addDaysKey(monthKey, 31).slice(0, 7)}-01`, -1);

  const load = useCallback(async () => {
    if (!staff?.branch_id) return;
    setLoading(true);
    setError(null);
    try {
      const [ts, lv] = await Promise.all([
        supabase.rpc('fn_get_timesheet', { p_branch_id: staff.branch_id, p_from: monthKey, p_to: monthEnd }),
        supabase.from('staff_leave_requests').select('*').eq('staff_id', staff.id).order('start_date', { ascending: false }),
      ]);
      if (ts.error) throw ts.error;
      if (lv.error) throw lv.error;
      setRows(((ts.data as DayRow[]) || []).filter(r => r.staff_id === staff.id));
      setLeaves((lv.data as LeaveRequest[]) || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [staff, monthKey, monthEnd]);

  useEffect(() => { if (staff) load(); }, [staff, load]);

  const rowByDate = useMemo(() => Object.fromEntries(rows.map(r => [r.work_date, r])), [rows]);
  const approved = useMemo(() => leaves.filter(l => l.status === 'approved'), [leaves]);

  const statusFor = useCallback((d: string): DayStatus => {
    const leave = approved.find(l => d >= l.start_date && d <= l.end_date);
    if (leave && !leave.half_day) return 'leave';
    const r = rowByDate[d];
    if (leave?.half_day && !(r && r.punch_count > 0)) return 'half_leave';
    if (r && r.punch_count > 0) {
      if (r.missing_out) return d < today ? 'no_out' : 'working';
      return r.late_minutes > 0 ? 'late' : 'present';
    }
    if (r && r.scheduled_minutes > 0) return d < today ? 'absent' : 'upcoming';
    return 'off';
  }, [approved, rowByDate, today]);

  const gridStart = startOfWeekKey(monthKey);
  const gridDays = Array.from({ length: 42 }, (_, i) => addDaysKey(gridStart, i));
  const monthDays = gridDays.filter(d => d.slice(0, 7) === monthKey.slice(0, 7));

  // Cheap to compute each render (≤ 31 days).
  const summary = (() => {
    const counts: Record<DayStatus, number> = { present: 0, late: 0, absent: 0, leave: 0, half_leave: 0, no_out: 0, upcoming: 0, off: 0, working: 0 };
    for (const d of monthDays) counts[statusFor(d)] += 1;
    const worked = rows.reduce((s, r) => s + r.worked_minutes, 0);
    const late = rows.reduce((s, r) => s + r.late_minutes, 0);
    const ot = rows.reduce((s, r) => s + r.overtime_minutes, 0);
    return { counts, worked, late, ot };
  })();

  const recordDays = monthDays.filter(d => !['off', 'upcoming'].includes(statusFor(d))).reverse();

  const exportCsv = () => {
    if (!staff) return;
    downloadCsv(`attendance_${staff.full_name.replace(/\W+/g, '_')}_${monthKey.slice(0, 7)}.csv`, [
      ['Date', 'Status', 'Scheduled', 'Time in', 'Time out', 'Worked hours', 'Late minutes', 'Overtime minutes', 'Manual entries'],
      ...monthDays.map(d => {
        const r = rowByDate[d];
        return [
          d, STATUS[statusFor(d)].label,
          r?.scheduled_start ? `${formatTime(r.scheduled_start)}-${formatTime(r.scheduled_end)}` : '',
          r?.first_in ? formatTime(r.first_in) : '', r?.last_out ? formatTime(r.last_out) : '',
          r ? (r.worked_minutes / 60).toFixed(2) : '', r?.late_minutes || '', r?.overtime_minutes || '', r?.manual_count || '',
        ];
      }),
    ]);
  };

  return (
    <Dialog open={staff !== null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{staff?.full_name} · attendance history</DialogTitle>
          <DialogDescription>{staff?.position || 'Staff'} · days present, late, absent and on leave.</DialogDescription>
        </DialogHeader>

        {!staff?.branch_id ? (
          <p className="text-sm text-muted-foreground">This staff member has no branch, so there is no schedule to compare against.</p>
        ) : (
          <Tabs defaultValue="attendance">
            <TabsList>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
              <TabsTrigger value="leave">Leave history ({leaves.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="attendance" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonthKey(`${addDaysKey(monthKey, -1).slice(0, 7)}-01`)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => setMonthKey(`${today.slice(0, 7)}-01`)}>This month</Button>
                <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonthKey(`${addDaysKey(monthKey, 31).slice(0, 7)}-01`)}><ChevronRight className="h-4 w-4" /></Button>
                <span className="font-semibold ml-1">{formatDateLabel(monthKey, { month: 'long', year: 'numeric' })}</span>
                {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
                <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv}><Download className="h-4 w-4 mr-1" /> CSV</Button>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[
                  { label: 'Present', value: summary.counts.present + summary.counts.late + summary.counts.working, tone: 'text-emerald-600 dark:text-emerald-400' },
                  { label: 'Late', value: summary.counts.late, tone: 'text-amber-600 dark:text-amber-400' },
                  { label: 'Absent', value: summary.counts.absent, tone: 'text-destructive' },
                  { label: 'On leave', value: summary.counts.leave + summary.counts.half_leave * 0.5, tone: 'text-sky-600 dark:text-sky-400' },
                  { label: 'Hours worked', value: minutesToHours(summary.worked), tone: '' },
                  { label: 'Overtime', value: minutesToHours(summary.ot), tone: '' },
                ].map(c => (
                  <div key={c.label} className="rounded-lg border p-2.5">
                    <p className={`text-lg font-bold tabular-nums ${c.tone}`}>{c.value}</p>
                    <p className="text-[11px] text-muted-foreground">{c.label}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border overflow-hidden">
                <div className="grid grid-cols-7 bg-muted/40 border-b">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="p-1.5 text-[11px] font-semibold text-muted-foreground text-center">{d}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {gridDays.map(d => {
                    const inMonth = d.slice(0, 7) === monthKey.slice(0, 7);
                    const st = statusFor(d);
                    const r = rowByDate[d];
                    return (
                      <div
                        key={d}
                        className={`min-h-[52px] border-b border-r p-1 text-center ${inMonth ? STATUS[st].cell : 'opacity-30'}`}
                        title={inMonth ? `${formatDateLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })}: ${STATUS[st].label}${r?.first_in ? ` · in ${formatTime(r.first_in)}` : ''}${r?.last_out ? ` · out ${formatTime(r.last_out)}` : ''}` : undefined}
                      >
                        <span className={`text-xs font-semibold ${d === today ? 'underline' : ''}`}>{Number(d.slice(8))}</span>
                        {inMonth && st !== 'off' && <span className="block text-[9px] leading-tight mt-0.5 truncate">{STATUS[st].label}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                {LEGEND.map(k => <span key={k} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-full ${STATUS[k].dot}`} />{STATUS[k].label}</span>)}
              </div>

              <div className="rounded-lg border divide-y">
                {recordDays.length === 0 && <p className="p-3 text-sm text-muted-foreground">No attendance records this month.</p>}
                {recordDays.map(d => {
                  const r = rowByDate[d];
                  const st = statusFor(d);
                  return (
                    <div key={d} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-2.5 text-sm">
                      <span className="w-28 font-medium">{formatDateLabel(d)}</span>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS[st].cell}`}>{STATUS[st].label}</span>
                      {r?.first_in && <span className="text-muted-foreground">In {formatTime(r.first_in)}</span>}
                      {r?.last_out && <span className="text-muted-foreground">Out {formatTime(r.last_out)}</span>}
                      {r && r.worked_minutes > 0 && <span className="text-muted-foreground">{minutesToHours(r.worked_minutes)}</span>}
                      {r && r.late_minutes > 0 && <span className="text-amber-600 dark:text-amber-400">{r.late_minutes} min late</span>}
                      {r && r.manual_count > 0 && <span className="text-muted-foreground">manual entry</span>}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            <TabsContent value="leave" className="space-y-2">
              {leaves.length === 0 && <p className="text-sm text-muted-foreground">No leave filed.</p>}
              {leaves.map(l => {
                const st = LEAVE_STATUS_STYLE[l.status];
                return (
                  <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-2.5 text-sm">
                    <span className="font-medium">{leaveTypeName(l.leave_type_id)} · {formatDays(l.days)}</span>
                    <span className="text-muted-foreground">{formatLeaveRange(l)}</span>
                    {l.reason && <span className="text-muted-foreground">“{l.reason}”</span>}
                    <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
                  </div>
                );
              })}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};
