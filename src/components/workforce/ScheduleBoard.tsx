import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Plus, Repeat, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  addDaysKey,
  formatClockTime,
  formatDateLabel,
  formatTime,
  localDateTimeToIso,
  minutesToHours,
  startOfWeekKey,
  todayKey,
  WEEKDAY_SHORT,
  type ScheduleRule,
  type ShiftTemplate,
  type StaffMember,
  type StaffShift,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { BranchFilter, BranchTag, EmptyState, NoBranchNotice, PageHeader, PageShell } from './shared';
import { errorMessage } from '../../lib/workforce';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';

const CUSTOM = '__custom__';
const GENERATE_AHEAD_DAYS = 14;

interface ShiftForm {
  staff_id: string;
  date: string;
  template_id: string;
  start: string;
  end: string;
  break_minutes: string;
  notes: string;
}

interface RuleForm {
  staff_id: string;
  template_id: string;
  weekdays: number[];
  effective_from: string;
  effective_to: string;
}

const toHHMM = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const ScheduleBoard: React.FC = () => {
  const { branch, isAll, branchName } = useWorkforceBranch();
  const { profile } = useAuth();
  const { showSuccess, showError, confirm } = useModal();
  const canEdit = ['super_admin', 'branch_manager'].includes(profile?.role_name || '')
    || (profile?.allowed_tabs || []).includes('wf-schedule');

  const [tab, setTab] = useState<'calendar' | 'week' | 'rules'>('calendar');
  const [monthKey, setMonthKey] = useState(() => `${todayKey().slice(0, 7)}-01`);
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeekKey(todayKey()));
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [loading, setLoading] = useState(false);

  const [shiftDialog, setShiftDialog] = useState<{ shift: StaffShift | null } | null>(null);
  const [shiftForm, setShiftForm] = useState<ShiftForm | null>(null);
  const [ruleDialog, setRuleDialog] = useState<{ rule: ScheduleRule | null } | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i)), [weekStart]);
  const weekEnd = days[6];
  const today = todayKey();
  // Month calendar: 6 Monday-first weeks covering the month.
  const gridStart = startOfWeekKey(monthKey);
  const gridDays = useMemo(() => Array.from({ length: 42 }, (_, i) => addDaysKey(gridStart, i)), [gridStart]);
  const rangeStart = tab === 'calendar' ? gridStart : weekStart;
  const rangeEnd = tab === 'calendar' ? gridDays[41] : weekEnd;

  const load = useCallback(async () => {
    if (!branch && !isAll) return;
    setLoading(true);
    try {
      // Roll recurring rules forward for the visible future days (idempotent).
      if (rangeEnd >= today) {
        const from = rangeStart > today ? rangeStart : today;
        await supabase.rpc('fn_generate_staff_shifts', { p_from: from, p_to: rangeEnd, p_branch_id: branch?.id ?? null });
      }
      const [st, tp, sh, rl] = await Promise.all([
        (branch ? supabase.from('staff_members').select('*').eq('branch_id', branch.id) : supabase.from('staff_members').select('*'))
          .eq('status', 'active').order('full_name'),
        (branch
          ? supabase.from('shift_templates').select('*').or(`branch_id.eq.${branch.id},branch_id.is.null`)
          : supabase.from('shift_templates').select('*')).order('start_time'),
        (branch ? supabase.from('staff_shifts').select('*').eq('branch_id', branch.id) : supabase.from('staff_shifts').select('*'))
          .gte('shift_date', rangeStart).lte('shift_date', rangeEnd).order('start_at'),
        (branch ? supabase.from('staff_schedule_rules').select('*').eq('branch_id', branch.id) : supabase.from('staff_schedule_rules').select('*'))
          .order('created_at'),
      ]);
      for (const r of [st, tp, sh, rl]) if (r.error) throw r.error;
      setStaff((st.data as StaffMember[]) || []);
      setTemplates((tp.data as ShiftTemplate[]) || []);
      setShifts((sh.data as StaffShift[]) || []);
      setRules((rl.data as ScheduleRule[]) || []);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [branch, isAll, rangeStart, rangeEnd, today, showError]);

  useEffect(() => { load(); }, [load]);

  const templateById = useMemo(() => Object.fromEntries(templates.map(t => [t.id, t])), [templates]);
  const staffById = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s])), [staff]);
  const activeTemplates = templates.filter(t => t.is_active);
  /** Templates a staff member can use: tenant-wide ones plus their own branch's. */
  const templatesFor = (staffId: string) => {
    const b = staffById[staffId]?.branch_id;
    return activeTemplates.filter(t => !t.branch_id || !b || t.branch_id === b);
  };
  const staffBranch = (staffId: string) => staffById[staffId]?.branch_id || branch?.id || null;

  // ── Shift dialog ──────────────────────────────────────────────────────────
  const openNewShift = (staffId: string, date: string) => {
    if (!canEdit) return;
    setDayOpen(null);
    const t = templatesFor(staffId)[0];
    setShiftForm({
      staff_id: staffId,
      date,
      template_id: t ? t.id : CUSTOM,
      start: t ? t.start_time.slice(0, 5) : '09:00',
      end: t ? t.end_time.slice(0, 5) : '17:00',
      break_minutes: String(t ? t.break_minutes : 60),
      notes: '',
    });
    setShiftDialog({ shift: null });
  };

  const openShift = (s: StaffShift) => {
    setDayOpen(null);
    setShiftForm({
      staff_id: s.staff_id,
      date: s.shift_date,
      template_id: s.shift_template_id && templateById[s.shift_template_id] ? s.shift_template_id : CUSTOM,
      start: toHHMM(s.start_at),
      end: toHHMM(s.end_at),
      break_minutes: String(s.break_minutes),
      notes: s.notes || '',
    });
    setShiftDialog({ shift: s });
  };

  const pickTemplate = (id: string) => {
    if (!shiftForm) return;
    const t = templateById[id];
    setShiftForm(t
      ? { ...shiftForm, template_id: id, start: t.start_time.slice(0, 5), end: t.end_time.slice(0, 5), break_minutes: String(t.break_minutes) }
      : { ...shiftForm, template_id: CUSTOM });
  };

  const saveShift = async () => {
    if (!shiftForm || !shiftDialog) return;
    const shiftBranch = staffBranch(shiftForm.staff_id);
    if (!shiftBranch) { showError('This staff member has no branch. Set one in Staff Directory.'); return; }
    const brk = Number(shiftForm.break_minutes || 0);
    if (!shiftForm.staff_id) { showError('Choose a staff member.'); return; }
    if (shiftForm.start === shiftForm.end) { showError('Start and end time cannot be the same.'); return; }
    if (Number.isNaN(brk) || brk < 0 || brk > 480) { showError('Break must be 0–480 minutes.'); return; }
    const overnight = shiftForm.end <= shiftForm.start;
    const payload = {
      branch_id: shiftBranch,
      staff_id: shiftForm.staff_id,
      shift_date: shiftForm.date,
      start_at: localDateTimeToIso(shiftForm.date, shiftForm.start),
      end_at: localDateTimeToIso(shiftForm.date, shiftForm.end, overnight ? 1 : 0),
      break_minutes: brk,
      shift_template_id: shiftForm.template_id === CUSTOM ? null : shiftForm.template_id,
      notes: shiftForm.notes.trim() || null,
      // Editing a generated shift turns it into a manual one, so rule changes leave it alone.
      source: 'manual' as const,
      updated_at: new Date().toISOString(),
    };
    const { error } = shiftDialog.shift
      ? await supabase.from('staff_shifts').update(payload).eq('id', shiftDialog.shift.id)
      : await supabase.from('staff_shifts').insert(payload);
    if (error) { showError(errorMessage(error)); return; }
    showSuccess('Shift saved.');
    setShiftDialog(null);
    load();
  };

  const setShiftStatus = async (s: StaffShift, status: StaffShift['status']) => {
    const { error } = await supabase.from('staff_shifts').update({ status, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (error) { showError(errorMessage(error)); return; }
    showSuccess(status === 'cancelled' ? 'Shift cancelled. It will not be re-created by its recurring rule.' : 'Shift restored.');
    setShiftDialog(null);
    load();
  };

  const deleteShift = async (s: StaffShift) => {
    if (s.rule_id) {
      showError('This shift comes from a recurring rule. Cancel it instead, or it will be re-created.');
      return;
    }
    if (!(await confirm('Delete shift', 'Delete this shift?'))) return;
    const { error } = await supabase.from('staff_shifts').delete().eq('id', s.id);
    if (error) { showError(errorMessage(error)); return; }
    setShiftDialog(null);
    load();
  };

  // ── Rule dialog ───────────────────────────────────────────────────────────
  const openRule = (rule: ScheduleRule | null) => {
    setRuleForm(rule
      ? {
          staff_id: rule.staff_id,
          template_id: rule.shift_template_id,
          weekdays: rule.weekdays,
          effective_from: rule.effective_from,
          effective_to: rule.effective_to || '',
        }
      : {
          staff_id: staff[0]?.id || '',
          template_id: (staff[0] ? templatesFor(staff[0].id) : activeTemplates)[0]?.id || '',
          weekdays: [1, 2, 3, 4, 5],
          effective_from: today,
          effective_to: '',
        });
    setRuleDialog({ rule });
  };

  /** Remove future, untouched shifts made by a rule so it can be regenerated. */
  const clearFutureRuleShifts = async (ruleId: string) => {
    const { error } = await supabase
      .from('staff_shifts')
      .delete()
      .eq('rule_id', ruleId)
      .eq('source', 'rule')
      .gte('shift_date', today);
    if (error) throw error;
  };

  const generateAhead = async () => {
    await supabase.rpc('fn_generate_staff_shifts', {
      p_from: today, p_to: addDaysKey(today, GENERATE_AHEAD_DAYS - 1), p_branch_id: branch?.id ?? null,
    });
  };

  const saveRule = async () => {
    if (!ruleForm || !ruleDialog) return;
    const ruleBranch = staffBranch(ruleForm.staff_id);
    if (!ruleBranch) { showError('This staff member has no branch. Set one in Staff Directory.'); return; }
    if (!ruleForm.staff_id || !ruleForm.template_id) { showError('Choose a staff member and a shift template.'); return; }
    if (ruleForm.weekdays.length === 0) { showError('Pick at least one day.'); return; }
    if (ruleForm.effective_to && ruleForm.effective_to < ruleForm.effective_from) { showError('End date is before the start date.'); return; }
    const payload = {
      branch_id: ruleBranch,
      staff_id: ruleForm.staff_id,
      shift_template_id: ruleForm.template_id,
      weekdays: [...ruleForm.weekdays].sort(),
      effective_from: ruleForm.effective_from,
      effective_to: ruleForm.effective_to || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    try {
      if (ruleDialog.rule) {
        await clearFutureRuleShifts(ruleDialog.rule.id);
        const { error } = await supabase.from('staff_schedule_rules').update(payload).eq('id', ruleDialog.rule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('staff_schedule_rules').insert(payload);
        if (error) throw error;
      }
      await generateAhead();
      showSuccess(`Recurring schedule saved. Shifts are filled in for the next ${GENERATE_AHEAD_DAYS} days and keep rolling forward.`);
      setRuleDialog(null);
      load();
    } catch (err) {
      showError(errorMessage(err));
    }
  };

  const toggleRule = async (rule: ScheduleRule) => {
    try {
      if (rule.is_active) await clearFutureRuleShifts(rule.id);
      const { error } = await supabase.from('staff_schedule_rules').update({ is_active: !rule.is_active, updated_at: new Date().toISOString() }).eq('id', rule.id);
      if (error) throw error;
      if (!rule.is_active) await generateAhead();
      load();
    } catch (err) {
      showError(errorMessage(err));
    }
  };

  const deleteRule = async (rule: ScheduleRule) => {
    if (!(await confirm('Delete recurring schedule', 'Future shifts from this rule are removed. Past shifts and shifts you edited by hand stay.'))) return;
    try {
      await clearFutureRuleShifts(rule.id);
      const { error } = await supabase.from('staff_schedule_rules').delete().eq('id', rule.id);
      if (error) throw error;
      showSuccess('Recurring schedule deleted.');
      load();
    } catch (err) {
      showError(errorMessage(err));
    }
  };

  if (!branch && !isAll) return <PageShell><PageHeader title="Schedule Board" actions={<BranchFilter />} /><NoBranchNotice /></PageShell>;

  const weekLabel = `${formatDateLabel(weekStart, { month: 'short', day: 'numeric' })} – ${formatDateLabel(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <PageShell>
      <PageHeader
        title="Schedule Board"
        actions={<BranchFilter />}
        description={`${branch ? branch.name : 'All branches'} · ${canEdit ? 'Tap a day to add a shift, or set up a recurring schedule so shifts fill in automatically.' : 'Read-only view.'}`}
      />

      <Tabs value={tab} onValueChange={v => setTab(v as 'calendar' | 'week' | 'rules')}>
        <TabsList>
          <TabsTrigger value="calendar"><CalendarDays className="h-4 w-4 mr-1.5" />Calendar</TabsTrigger>
          <TabsTrigger value="week"><CalendarClock className="h-4 w-4 mr-1.5" />By staff</TabsTrigger>
          <TabsTrigger value="rules"><Repeat className="h-4 w-4 mr-1.5" />Recurring schedules</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setMonthKey(`${addDaysKey(monthKey, -1).slice(0, 7)}-01`)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setMonthKey(`${today.slice(0, 7)}-01`)}>This month</Button>
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setMonthKey(`${addDaysKey(monthKey, 31).slice(0, 7)}-01`)}><ChevronRight className="h-4 w-4" /></Button>
            <span className="font-semibold ml-1">{formatDateLabel(monthKey, { month: 'long', year: 'numeric' })}</span>
            {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
          </div>
          <div className="rounded-xl border overflow-hidden bg-card">
            <div className="grid grid-cols-7 border-b bg-muted/40">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                <div key={d} className="p-2 text-[11px] font-semibold text-muted-foreground text-center sm:text-left">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {gridDays.map(d => {
                const inMonth = d.slice(0, 7) === monthKey.slice(0, 7);
                const dayShifts = shifts.filter(s => s.shift_date === d);
                const working = dayShifts.filter(s => s.status === 'scheduled');
                const onLeave = dayShifts.filter(s => s.leave_request_id);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDayOpen(d)}
                    aria-label={`${formatDateLabel(d, { weekday: 'long', month: 'long', day: 'numeric' })}: ${working.length} on shift${onLeave.length ? `, ${onLeave.length} on leave` : ''}`}
                    className={`min-h-[64px] sm:min-h-[104px] border-b border-r p-1 sm:p-1.5 text-left align-top flex flex-col gap-1 hover:bg-muted/50 transition-colors ${inMonth ? '' : 'bg-muted/20 text-muted-foreground'} ${d === today ? 'bg-primary/5' : ''}`}
                  >
                    <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${d === today ? 'bg-primary text-primary-foreground' : ''}`}>
                      {Number(d.slice(8))}
                    </span>
                    {/* Phones: just counts */}
                    <span className="sm:hidden flex flex-col gap-0.5">
                      {working.length > 0 && <span className="text-[10px] font-semibold text-primary">{working.length} on</span>}
                      {onLeave.length > 0 && <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{onLeave.length} leave</span>}
                    </span>
                    {/* Larger screens: shift chips */}
                    <span className="hidden sm:flex flex-col gap-0.5 w-full">
                      {dayShifts.slice(0, 3).map(s => {
                        const t = s.shift_template_id ? templateById[s.shift_template_id] : undefined;
                        const name = staffById[s.staff_id]?.full_name.split(' ')[0] || 'Staff';
                        return (
                          <span
                            key={s.id}
                            className={`block truncate rounded px-1.5 py-0.5 text-[10px] leading-tight border-l-2 ${s.leave_request_id ? 'bg-emerald-500/10' : 'bg-muted'} ${s.status === 'cancelled' && !s.leave_request_id ? 'line-through opacity-50' : ''}`}
                            style={{ borderLeftColor: s.leave_request_id ? '#10b981' : (t?.color || '#64748b') }}
                          >
                            {s.leave_request_id ? `${name} · leave` : `${formatTime(s.start_at)} ${name}`}
                          </span>
                        );
                      })}
                      {dayShifts.length > 3 && <span className="text-[10px] text-muted-foreground px-1">+{dayShifts.length - 3} more</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Tap a day to see everyone on shift{canEdit ? ' or add a shift' : ''}. Green = on approved leave. Times are Philippine time.</p>
        </TabsContent>

        <TabsContent value="week" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeekStart(addDaysKey(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeekKey(today))}>This week</Button>
            <Button variant="outline" size="icon" aria-label="Next week" onClick={() => setWeekStart(addDaysKey(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
            <span className="font-semibold ml-1">{weekLabel}</span>
            {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
          </div>

          {staff.length === 0 ? (
            <EmptyState title="No active staff at this branch">Add staff in Workforce → Staff Directory first.</EmptyState>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[880px]">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left p-2 w-44 font-semibold sticky left-0 bg-muted/40">Staff</th>
                      {days.map(d => {
                        const count = shifts.filter(s => s.shift_date === d && s.status === 'scheduled').length;
                        return (
                          <th key={d} className={`p-2 text-left font-semibold ${d === today ? 'text-primary' : ''}`}>
                            {formatDateLabel(d)}
                            <span className="block text-[10px] font-normal text-muted-foreground">{count} on shift</span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map(member => {
                      const weekMinutes = shifts
                        .filter(s => s.staff_id === member.id && s.status === 'scheduled')
                        .reduce((sum, s) => sum + (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 60000 - s.break_minutes, 0);
                      return (
                        <tr key={member.id} className="border-b last:border-0 align-top">
                          <td className="p-2 sticky left-0 bg-card">
                            <p className="font-medium truncate">{member.full_name}</p>
                            {isAll && <BranchTag name={branchName(member.branch_id)} />}
                            <p className="text-[11px] text-muted-foreground">{member.position || 'Staff'} · {minutesToHours(weekMinutes)}</p>
                          </td>
                          {days.map(d => {
                            const cell = shifts.filter(s => s.staff_id === member.id && s.shift_date === d);
                            return (
                              <td
                                key={d}
                                className={`p-1.5 min-w-[110px] ${canEdit && cell.length === 0 ? 'cursor-pointer hover:bg-muted/50' : ''} ${d === today ? 'bg-primary/5' : ''}`}
                                onClick={() => { if (cell.length === 0) openNewShift(member.id, d); }}
                              >
                                <div className="flex flex-col gap-1">
                                  {cell.map(s => {
                                    const t = s.shift_template_id ? templateById[s.shift_template_id] : undefined;
                                    const color = t?.color || '#64748b';
                                    return (
                                      <button
                                        key={s.id}
                                        type="button"
                                        onClick={e => { e.stopPropagation(); openShift(s); }}
                                        className={`text-left rounded-md px-2 py-1 text-[11px] leading-tight border-l-4 hover:bg-muted ${s.leave_request_id ? 'bg-emerald-500/10' : 'bg-muted/60'} ${s.status === 'cancelled' && !s.leave_request_id ? 'opacity-50 line-through' : ''}`}
                                        style={{ borderLeftColor: color }}
                                      >
                                        <span className="font-semibold block">{formatTime(s.start_at)}–{formatTime(s.end_at)}</span>
                                        <span className="text-muted-foreground">{s.leave_request_id ? 'On leave' : `${t?.name || 'Custom'}${s.rule_id ? ' ↻' : ''}`}</span>
                                      </button>
                                    );
                                  })}
                                  {canEdit && cell.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); openNewShift(member.id, d); }}
                                      className="text-[10px] text-muted-foreground hover:text-foreground text-left px-1"
                                    >
                                      + add
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">↻ = created by a recurring schedule. Green = on approved leave. Times are Philippine time.</p>
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Set each person's usual week once. Shifts are created automatically for the next {GENERATE_AHEAD_DAYS} days and keep rolling forward.
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => openRule(null)} disabled={staff.length === 0 || activeTemplates.length === 0}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            )}
          </div>
          {activeTemplates.length === 0 && (
            <EmptyState title="Create a shift template first">Recurring schedules use shift templates. Add one in Workforce → Shift Templates.</EmptyState>
          )}
          {rules.length === 0 && activeTemplates.length > 0 && (
            <EmptyState title="No recurring schedules yet" icon={<Repeat className="h-8 w-8" />} />
          )}
          <div className="grid gap-2">
            {rules.map(r => {
              const t = templateById[r.shift_template_id];
              const member = staffById[r.staff_id];
              return (
                <Card key={r.id} className={r.is_active ? '' : 'opacity-60'}>
                  <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <span className="hidden sm:block w-1.5 self-stretch rounded-full" style={{ backgroundColor: t?.color || '#64748b' }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{member?.full_name || 'Inactive staff'} {isAll && <BranchTag name={branchName(r.branch_id)} />}</p>
                      <p className="text-sm">
                        {t ? `${t.name} · ${formatClockTime(t.start_time)} – ${formatClockTime(t.end_time)}` : 'Template removed'}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {WEEKDAY_SHORT.map((label, i) => (
                          <span key={label} className={`text-[10px] px-1.5 py-0.5 rounded ${r.weekdays.includes(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{label}</span>
                        ))}
                        <span className="text-[11px] text-muted-foreground ml-1">
                          from {formatDateLabel(r.effective_from, { month: 'short', day: 'numeric', year: 'numeric' })}
                          {r.effective_to ? ` to ${formatDateLabel(r.effective_to, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                        </span>
                        {!r.is_active && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openRule(r)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleRule(r)}>{r.is_active ? 'Pause' : 'Resume'}</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" aria-label="Delete recurring schedule" onClick={() => deleteRule(r)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Day dialog (calendar) */}
      <Dialog open={dayOpen !== null} onOpenChange={o => { if (!o) setDayOpen(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{dayOpen && formatDateLabel(dayOpen, { weekday: 'long', month: 'long', day: 'numeric' })}</DialogTitle>
            <DialogDescription>{branch ? branch.name : 'All branches'}</DialogDescription>
          </DialogHeader>
          {dayOpen && (() => {
            const list = shifts.filter(s => s.shift_date === dayOpen);
            return (
              <div className="grid gap-2 max-h-80 overflow-y-auto">
                {list.length === 0 && <p className="text-sm text-muted-foreground">No shifts on this day.</p>}
                {list.map(s => {
                  const t = s.shift_template_id ? templateById[s.shift_template_id] : undefined;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openShift(s)}
                      className="flex items-center gap-3 rounded-lg border p-2.5 text-left hover:bg-muted"
                    >
                      <span className="w-1.5 self-stretch rounded-full" style={{ backgroundColor: s.leave_request_id ? '#10b981' : (t?.color || '#64748b') }} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium truncate">
                          {staffById[s.staff_id]?.full_name || 'Staff'} {isAll && <BranchTag name={branchName(s.branch_id)} />}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatTime(s.start_at)} – {formatTime(s.end_at)} · {s.leave_request_id ? 'On leave' : s.status === 'cancelled' ? 'Cancelled' : (t?.name || 'Custom')}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {canEdit && dayOpen && (
            <DialogFooter>
              <Button onClick={() => openNewShift(staff[0]?.id || '', dayOpen)} disabled={staff.length === 0}>
                <Plus className="h-4 w-4 mr-1" /> Add shift
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Shift dialog */}
      <Dialog open={shiftDialog !== null} onOpenChange={o => { if (!o) setShiftDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{shiftDialog?.shift ? 'Shift' : 'Add shift'}</DialogTitle>
            <DialogDescription>
              {shiftForm && `${staffById[shiftForm.staff_id]?.full_name || ''} · ${formatDateLabel(shiftForm.date, { weekday: 'long', month: 'short', day: 'numeric' })}`}
              {shiftDialog?.shift?.rule_id ? ' · from recurring schedule' : ''}
            </DialogDescription>
          </DialogHeader>
          {shiftForm && (
            <fieldset disabled={!canEdit} className="grid gap-3">
              {!shiftDialog?.shift && (
                <div className="grid gap-1.5">
                  <Label>Staff</Label>
                  <Select value={shiftForm.staff_id} onValueChange={v => setShiftForm({ ...shiftForm, staff_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose staff" /></SelectTrigger>
                    <SelectContent>
                      {staff.map(m => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>Shift template</Label>
                <Select value={shiftForm.template_id} onValueChange={pickTemplate}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {templatesFor(shiftForm.staff_id).map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name} · {formatClockTime(t.start_time)}–{formatClockTime(t.end_time)}</SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>Custom time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="sh-start" className="text-xs">Start</Label>
                  <Input id="sh-start" type="time" value={shiftForm.start} onChange={e => setShiftForm({ ...shiftForm, start: e.target.value, template_id: CUSTOM })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="sh-end" className="text-xs">End</Label>
                  <Input id="sh-end" type="time" value={shiftForm.end} onChange={e => setShiftForm({ ...shiftForm, end: e.target.value, template_id: CUSTOM })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="sh-break" className="text-xs">Break (min)</Label>
                  <Input id="sh-break" inputMode="numeric" value={shiftForm.break_minutes} onChange={e => setShiftForm({ ...shiftForm, break_minutes: e.target.value.replace(/\D/g, '') })} />
                </div>
              </div>
              {shiftForm.end <= shiftForm.start && shiftForm.start !== shiftForm.end && (
                <p className="text-xs text-amber-600 dark:text-amber-400">Ends the next day (overnight).</p>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="sh-notes">Notes</Label>
                <Input id="sh-notes" value={shiftForm.notes} onChange={e => setShiftForm({ ...shiftForm, notes: e.target.value })} />
              </div>
            </fieldset>
          )}
          {canEdit && (
            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                {shiftDialog?.shift && shiftDialog.shift.status === 'scheduled' && (
                  <Button variant="outline" onClick={() => setShiftStatus(shiftDialog.shift!, 'cancelled')}>Cancel shift</Button>
                )}
                {shiftDialog?.shift && shiftDialog.shift.status === 'cancelled' && (
                  <Button variant="outline" onClick={() => setShiftStatus(shiftDialog.shift!, 'scheduled')}>Restore</Button>
                )}
                {shiftDialog?.shift && !shiftDialog.shift.rule_id && (
                  <Button variant="ghost" className="text-destructive" aria-label="Delete shift" onClick={() => deleteShift(shiftDialog.shift!)}><Trash2 className="h-4 w-4" /></Button>
                )}
              </div>
              <Button onClick={saveShift}>Save</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Rule dialog */}
      <Dialog open={ruleDialog !== null} onOpenChange={o => { if (!o) setRuleDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{ruleDialog?.rule ? 'Edit recurring schedule' : 'Add recurring schedule'}</DialogTitle>
            <DialogDescription>Future shifts from this rule are rebuilt when you save. Shifts you edited by hand are kept.</DialogDescription>
          </DialogHeader>
          {ruleForm && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Staff</Label>
                <Select value={ruleForm.staff_id} onValueChange={v => setRuleForm({ ...ruleForm, staff_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose staff" /></SelectTrigger>
                  <SelectContent>
                    {staff.map(s => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Shift template</Label>
                <Select value={ruleForm.template_id} onValueChange={v => setRuleForm({ ...ruleForm, template_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose template" /></SelectTrigger>
                  <SelectContent>
                    {templatesFor(ruleForm.staff_id).map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name} · {formatClockTime(t.start_time)}–{formatClockTime(t.end_time)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Days</Label>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_SHORT.map((label, i) => {
                    const on = ruleForm.weekdays.includes(i);
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setRuleForm({ ...ruleForm, weekdays: on ? ruleForm.weekdays.filter(x => x !== i) : [...ruleForm.weekdays, i] })}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-semibold border ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground'}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label htmlFor="rl-from" className="text-xs">Starts</Label>
                  <Input id="rl-from" type="date" value={ruleForm.effective_from} onChange={e => setRuleForm({ ...ruleForm, effective_from: e.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="rl-to" className="text-xs">Ends (optional)</Label>
                  <Input id="rl-to" type="date" value={ruleForm.effective_to} onChange={e => setRuleForm({ ...ruleForm, effective_to: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialog(null)}>Cancel</Button>
            <Button onClick={saveRule}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default ScheduleBoard;

