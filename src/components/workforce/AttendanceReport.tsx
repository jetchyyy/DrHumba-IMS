import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  addDaysKey,
  downloadCsv,
  EVENT_LABELS,
  formatDateLabel,
  formatDateTime,
  formatTime,
  localDateTimeToIso,
  mapsLink,
  minutesToHours,
  startOfWeekKey,
  todayKey,
  type AttendanceLog,
  type ClockEventType,
  type StaffMember,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { BranchFilter, BranchTag, EmptyState, NoBranchNotice, PageHeader, PageShell } from './shared';
import { errorMessage } from '../../lib/workforce';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';

interface TimesheetRow {
  staff_id: string;
  staff_name: string;
  branch_id: string;
  work_date: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  scheduled_minutes: number;
  first_in: string | null;
  last_out: string | null;
  worked_minutes: number;
  break_minutes: number;
  late_minutes: number;
  undertime_minutes: number;
  overtime_minutes: number;
  punch_count: number;
  manual_count: number;
  missing_out: boolean;
}

type Preset = 'this_week' | 'last_week' | 'this_month' | 'custom';

function rangeFor(preset: Preset, custom: { from: string; to: string }) {
  const today = todayKey();
  if (preset === 'this_week') { const s = startOfWeekKey(today); return { from: s, to: addDaysKey(s, 6) }; }
  if (preset === 'last_week') { const s = addDaysKey(startOfWeekKey(today), -7); return { from: s, to: addDaysKey(s, 6) }; }
  if (preset === 'this_month') return { from: `${today.slice(0, 7)}-01`, to: today };
  return custom;
}

const AttendanceReport: React.FC = () => {
  const { branch, isAll, branchName } = useWorkforceBranch();
  const { profile } = useAuth();
  const { showSuccess, showError } = useModal();
  const canCorrect = ['super_admin', 'branch_manager'].includes(profile?.role_name || '')
    || (profile?.allowed_tabs || []).some(t => t === 'wf-schedule' || t === 'wf-staff');

  const [preset, setPreset] = useState<Preset>('this_week');
  const [custom, setCustom] = useState(() => ({ from: addDaysKey(todayKey(), -13), to: todayKey() }));
  const range = useMemo(() => rangeFor(preset, custom), [preset, custom]);

  const [rows, setRows] = useState<TimesheetRow[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ staff_id: '', event_type: 'out' as ClockEventType, date: todayKey(), time: '17:00', note: '' });

  const load = useCallback(async () => {
    if (!branch && !isAll) return;
    if (range.to < range.from) { showError('End date is before the start date.'); return; }
    setLoading(true);
    try {
      const [ts, lg, st] = await Promise.all([
        supabase.rpc('fn_get_timesheet', { p_branch_id: branch?.id ?? null, p_from: range.from, p_to: range.to }),
        (branch
          ? supabase.from('attendance_logs').select('*').eq('branch_id', branch.id)
          : supabase.from('attendance_logs').select('*'))
          .gte('event_at', localDateTimeToIso(range.from, '00:00'))
          .lt('event_at', localDateTimeToIso(range.to, '00:00', 1))
          .order('event_at', { ascending: false })
          .limit(1000),
        (branch ? supabase.from('staff_members').select('*').eq('branch_id', branch.id) : supabase.from('staff_members').select('*')).order('full_name'),
      ]);
      if (ts.error) throw ts.error;
      if (lg.error) throw lg.error;
      if (st.error) throw st.error;
      setRows((ts.data as TimesheetRow[]) || []);
      setLogs((lg.data as AttendanceLog[]) || []);
      setStaff((st.data as StaffMember[]) || []);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [branch, isAll, range.from, range.to, showError]);

  useEffect(() => { load(); }, [load]);

  const staffName = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s.full_name])), [staff]);

  const summary = useMemo(() => {
    const map = new Map<string, { name: string; branchId: string; days: number; worked: number; scheduled: number; late: number; lateCount: number; ot: number; missing: number }>();
    for (const r of rows) {
      const cur = map.get(r.staff_id) || { name: r.staff_name, branchId: r.branch_id, days: 0, worked: 0, scheduled: 0, late: 0, lateCount: 0, ot: 0, missing: 0 };
      if (r.worked_minutes > 0) cur.days += 1;
      cur.worked += r.worked_minutes;
      cur.scheduled += r.scheduled_minutes;
      cur.late += r.late_minutes;
      if (r.late_minutes > 0) cur.lateCount += 1;
      cur.ot += r.overtime_minutes;
      if ((r.missing_out && r.work_date < todayKey()) || (r.scheduled_minutes > 0 && r.punch_count === 0 && r.work_date < todayKey())) cur.missing += 1;
      map.set(r.staff_id, cur);
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows]);

  const exportCsv = () => {
    downloadCsv(`timesheet_${(branch?.name || 'all_branches').replace(/\W+/g, '_')}_${range.from}_${range.to}.csv`, [
      ['Staff', 'Branch', 'Date', 'Scheduled start', 'Scheduled end', 'Scheduled hours', 'First in', 'Last out', 'Worked hours', 'Break minutes', 'Late minutes', 'Undertime minutes', 'Overtime minutes', 'Missing time out', 'Manual entries'],
      ...rows.map(r => [
        r.staff_name, branchName(r.branch_id), r.work_date,
        r.scheduled_start ? formatTime(r.scheduled_start) : '', r.scheduled_end ? formatTime(r.scheduled_end) : '',
        (r.scheduled_minutes / 60).toFixed(2),
        r.first_in ? formatTime(r.first_in) : '', r.last_out ? formatTime(r.last_out) : '',
        (r.worked_minutes / 60).toFixed(2), r.break_minutes, r.late_minutes, r.undertime_minutes, r.overtime_minutes,
        r.missing_out ? 'Yes' : '', r.manual_count || '',
      ]),
    ]);
  };

  const saveManual = async () => {
    if (!manual.staff_id) { showError('Choose a staff member.'); return; }
    if (manual.note.trim().length < 3) { showError('Write a reason for the manual entry.'); return; }
    const { error } = await supabase.rpc('fn_manual_attendance', {
      p_staff_id: manual.staff_id,
      p_event_type: manual.event_type,
      p_event_at: localDateTimeToIso(manual.date, manual.time),
      p_note: manual.note.trim(),
    });
    if (error) { showError(errorMessage(error)); return; }
    showSuccess('Manual entry added. The original punches are kept.');
    setManualOpen(false);
    setManual(m => ({ ...m, note: '' }));
    load();
  };

  if (!branch && !isAll) return <PageShell><PageHeader title="Attendance" actions={<BranchFilter />} /><NoBranchNotice /></PageShell>;

  return (
    <PageShell>
      <PageHeader
        title="Attendance & Timesheets"
        description={`${branch ? branch.name : 'All branches'} · ${formatDateLabel(range.from, { month: 'short', day: 'numeric' })} – ${formatDateLabel(range.to, { month: 'short', day: 'numeric', year: 'numeric' })}`}
        actions={
          <>
            <BranchFilter />
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4 mr-1" /> CSV</Button>
            {canCorrect && <Button size="sm" onClick={() => setManualOpen(true)}><Plus className="h-4 w-4 mr-1" /> Manual entry</Button>}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label className="text-xs">Period</Label>
          <Select value={preset} onValueChange={v => setPreset(v as Preset)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="this_week">This week</SelectItem>
              <SelectItem value="last_week">Last week</SelectItem>
              <SelectItem value="this_month">This month</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {preset === 'custom' && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="at-from" className="text-xs">From</Label>
              <Input id="at-from" type="date" value={custom.from} onChange={e => setCustom({ ...custom, from: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="at-to" className="text-xs">To</Label>
              <Input id="at-to" type="date" value={custom.to} onChange={e => setCustom({ ...custom, to: e.target.value })} />
            </div>
          </>
        )}
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="daily">Daily timesheet</TabsTrigger>
          <TabsTrigger value="punches">Punch log</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          {summary.length === 0 ? (
            <EmptyState title="No schedule or attendance in this period" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summary.map(([id, s]) => (
                <Card key={id}>
                  <CardHeader className="pb-2"><CardTitle className="text-base">{s.name} {isAll && <BranchTag name={branchName(s.branchId)} />}</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-2 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Worked</span><span className="font-semibold text-right">{minutesToHours(s.worked)}</span>
                    <span className="text-muted-foreground">Scheduled</span><span className="text-right">{minutesToHours(s.scheduled)}</span>
                    <span className="text-muted-foreground">Days worked</span><span className="text-right">{s.days}</span>
                    <span className="text-muted-foreground">Late</span><span className={`text-right ${s.lateCount ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>{s.lateCount}× · {s.late} min</span>
                    <span className="text-muted-foreground">Overtime</span><span className="text-right">{minutesToHours(s.ot)}</span>
                    <span className="text-muted-foreground">Missing punches</span><span className={`text-right ${s.missing ? 'text-destructive font-semibold' : ''}`}>{s.missing}</span>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="daily">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead className="text-right">Worked</TableHead>
                    <TableHead className="text-right">Late</TableHead>
                    <TableHead className="text-right">OT</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No records.</TableCell></TableRow>
                  )}
                  {rows.map(r => {
                    const absent = r.scheduled_minutes > 0 && r.punch_count === 0 && r.work_date < todayKey();
                    return (
                      <TableRow key={`${r.staff_id}-${r.work_date}`}>
                        <TableCell className="whitespace-nowrap">{formatDateLabel(r.work_date)}</TableCell>
                        <TableCell className="font-medium">{r.staff_name} {isAll && <BranchTag name={branchName(r.branch_id)} />}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {r.scheduled_start ? `${formatTime(r.scheduled_start)}–${formatTime(r.scheduled_end)}` : 'Not scheduled'}
                        </TableCell>
                        <TableCell>{formatTime(r.first_in)}</TableCell>
                        <TableCell>{formatTime(r.last_out)}</TableCell>
                        <TableCell className="text-right">{r.worked_minutes ? minutesToHours(r.worked_minutes) : '—'}</TableCell>
                        <TableCell className={`text-right ${r.late_minutes ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>{r.late_minutes ? `${r.late_minutes}m` : '—'}</TableCell>
                        <TableCell className="text-right">{r.overtime_minutes ? `${r.overtime_minutes}m` : '—'}</TableCell>
                        <TableCell className="space-x-1 whitespace-nowrap">
                          {absent && <Badge variant="destructive" className="text-[10px]">Absent</Badge>}
                          {r.missing_out && r.work_date === todayKey() && <Badge variant="secondary" className="text-[10px]">On duty</Badge>}
                          {r.missing_out && r.work_date !== todayKey() && <Badge variant="destructive" className="text-[10px]">No time out</Badge>}
                          {r.manual_count > 0 && <Badge variant="outline" className="text-[10px]">Manual</Badge>}
                          {!r.scheduled_start && r.punch_count > 0 && <Badge variant="outline" className="text-[10px]">Unscheduled</Badge>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="punches">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Distance</TableHead>
                    <TableHead className="text-right">GPS accuracy</TableHead>
                    <TableHead>Location / note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No punches.</TableCell></TableRow>
                  )}
                  {logs.map(l => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(l.event_at)}</TableCell>
                      <TableCell className="font-medium">{staffName[l.staff_id] || '—'} {isAll && <BranchTag name={branchName(l.branch_id)} />}</TableCell>
                      <TableCell>{EVENT_LABELS[l.event_type]}</TableCell>
                      <TableCell><Badge variant={l.method === 'manual' ? 'outline' : 'secondary'} className="text-[10px] capitalize">{l.method}</Badge></TableCell>
                      <TableCell className="text-right">{l.distance_m !== null ? `${Math.round(l.distance_m)} m` : '—'}</TableCell>
                      <TableCell className="text-right">{l.accuracy_m !== null ? `±${Math.round(l.accuracy_m)} m` : '—'}</TableCell>
                      <TableCell className="text-xs">
                        {l.latitude !== null && l.longitude !== null && (
                          <a href={mapsLink(l.latitude, l.longitude)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                            Map <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {l.note && <span className="text-muted-foreground ml-1">{l.note}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Manual attendance entry</DialogTitle>
            <DialogDescription>For a missed or wrong punch. It is saved as a new entry with your name and reason; nothing is deleted.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Staff</Label>
              <Select value={manual.staff_id} onValueChange={v => setManual({ ...manual, staff_id: v })}>
                <SelectTrigger><SelectValue placeholder="Choose staff" /></SelectTrigger>
                <SelectContent>
                  {staff.filter(s => s.status === 'active').map(s => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Action</Label>
              <Select value={manual.event_type} onValueChange={v => setManual({ ...manual, event_type: v as ClockEventType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVENT_LABELS) as ClockEventType[]).map(k => <SelectItem key={k} value={k}>{EVENT_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="mn-date" className="text-xs">Date</Label>
                <Input id="mn-date" type="date" max={todayKey()} value={manual.date} onChange={e => setManual({ ...manual, date: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="mn-time" className="text-xs">Time</Label>
                <Input id="mn-time" type="time" value={manual.time} onChange={e => setManual({ ...manual, time: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mn-note">Reason</Label>
              <Input id="mn-note" placeholder="e.g. Forgot to time out, phone battery died" value={manual.note} onChange={e => setManual({ ...manual, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
            <Button onClick={saveManual}>Save entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default AttendanceReport;
