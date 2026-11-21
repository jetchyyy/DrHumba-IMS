import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Pencil, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';
import {
  errorMessage,
  formatDateTime,
  formatDays,
  formatLeaveRange,
  LEAVE_STATUS_STYLE,
  todayKey,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveType,
  type StaffMember,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { BranchFilter, BranchTag, EmptyState, NoBranchNotice, PageHeader, PageShell } from './shared';
import { FileLeaveDialog } from './FileLeaveDialog';

const COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#6366f1', '#64748b'];

const STARTER_TYPES = [
  { name: 'Vacation', default_days_per_year: 5, is_paid: true, max_days_per_request: null, allow_half_day: true, color: '#10b981', sort_order: 1 },
  { name: 'Sick', default_days_per_year: 5, is_paid: true, max_days_per_request: null, allow_half_day: true, color: '#0ea5e9', sort_order: 2 },
  { name: 'Emergency', default_days_per_year: 3, is_paid: true, max_days_per_request: 2, allow_half_day: true, color: '#f59e0b', sort_order: 3 },
  { name: 'Unpaid', default_days_per_year: 10, is_paid: false, max_days_per_request: null, allow_half_day: true, color: '#64748b', sort_order: 4 },
];

const emptyTypeForm = { name: '', default_days_per_year: '5', max_days_per_request: '', is_paid: true, allow_half_day: true, color: COLORS[0], is_active: true };

type ReviewAction = { request: LeaveRequest; mode: 'approve' | 'reject' | 'cancel' };

const LeaveManagement: React.FC = () => {
  const { branch, isAll, branchName } = useWorkforceBranch();
  const { profile } = useAuth();
  const { showSuccess, showError } = useModal();
  const isSuperAdmin = profile?.role_name === 'super_admin';
  const canManage = ['super_admin', 'branch_manager'].includes(profile?.role_name || '')
    || (profile?.allowed_tabs || []).some(t => t === 'wf-schedule' || t === 'wf-staff');

  const currentYear = Number(todayKey().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'all'>('pending');

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [balancesByStaff, setBalancesByStaff] = useState<Record<string, LeaveBalance[]>>({});
  const [loading, setLoading] = useState(false);

  const [review, setReview] = useState<ReviewAction | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [allowanceEdit, setAllowanceEdit] = useState<{ staff: StaffMember; balance: LeaveBalance } | null>(null);
  const [allowanceValue, setAllowanceValue] = useState('');

  const [typeEdit, setTypeEdit] = useState<LeaveType | 'new' | null>(null);
  const [typeForm, setTypeForm] = useState(emptyTypeForm);

  const [filingFor, setFilingFor] = useState<string | null>(null);
  const [filingOpen, setFilingOpen] = useState(false);

  const [bulkType, setBulkType] = useState<LeaveType | null>(null);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkScope, setBulkScope] = useState<'branch' | 'all'>('branch');
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branch && !isAll) return;
    setLoading(true);
    try {
      const [t, s, r] = await Promise.all([
        supabase.from('staff_leave_types').select('*').order('sort_order').order('name'),
        (branch ? supabase.from('staff_members').select('*').eq('branch_id', branch.id) : supabase.from('staff_members').select('*'))
          .eq('status', 'active').order('full_name'),
        (branch ? supabase.from('staff_leave_requests').select('*').eq('branch_id', branch.id) : supabase.from('staff_leave_requests').select('*'))
          .gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`)
          .order('created_at', { ascending: false }),
      ]);
      for (const x of [t, s, r]) if (x.error) throw x.error;
      const staffRows = (s.data as StaffMember[]) || [];
      setTypes((t.data as LeaveType[]) || []);
      setStaff(staffRows);
      setRequests((r.data as LeaveRequest[]) || []);
      const balances = await Promise.all(staffRows.map(m => supabase.rpc('fn_leave_balances', { p_staff_id: m.id, p_year: year })));
      const map: Record<string, LeaveBalance[]> = {};
      staffRows.forEach((m, i) => { map[m.id] = (balances[i].data as LeaveBalance[]) || []; });
      setBalancesByStaff(map);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [branch, isAll, year, showError]);

  useEffect(() => { load(); }, [load]);

  const staffName = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s.full_name])), [staff]);
  const typeById = useMemo(() => Object.fromEntries(types.map(t => [t.id, t])), [types]);
  const activeTypes = types.filter(t => t.is_active);
  const visibleRequests = requests.filter(r => statusFilter === 'all' || r.status === statusFilter);
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  // ── Review ────────────────────────────────────────────────────────────────
  const runReview = async () => {
    if (!review) return;
    setReviewError(null);
    const { request, mode } = review;
    const { data, error } = mode === 'cancel'
      ? await supabase.rpc('fn_cancel_leave', { p_request_id: request.id, p_note: reviewNote.trim() || null })
      : await supabase.rpc('fn_review_leave', { p_request_id: request.id, p_approve: mode === 'approve', p_note: reviewNote.trim() || null });
    if (error) { setReviewError(errorMessage(error)); return; }
    const res = data as { ok: boolean; error?: string; shifts_cancelled?: number };
    if (!res.ok) { setReviewError(res.error || 'Could not update the request.'); return; }
    showSuccess(
      mode === 'approve'
        ? `Leave approved.${res.shifts_cancelled ? ` ${res.shifts_cancelled} scheduled shift(s) were cancelled.` : ''}`
        : mode === 'reject' ? 'Leave rejected.' : 'Leave cancelled. Any shifts it cancelled are back on the schedule.'
    );
    setReview(null);
    setReviewNote('');
    load();
  };

  // ── Allowances ────────────────────────────────────────────────────────────
  const saveAllowance = async (reset = false) => {
    if (!allowanceEdit) return;
    const { staff: member, balance } = allowanceEdit;
    try {
      const { data: existing, error: selErr } = await supabase
        .from('staff_leave_allowances').select('id')
        .eq('staff_id', member.id).eq('leave_type_id', balance.leave_type_id).eq('year', year).maybeSingle();
      if (selErr) throw selErr;
      if (reset) {
        if (existing) {
          const { error } = await supabase.from('staff_leave_allowances').delete().eq('id', existing.id);
          if (error) throw error;
        }
      } else {
        const days = Number(allowanceValue);
        if (allowanceValue.trim() === '' || Number.isNaN(days) || days < 0 || days > 366) { showError('Enter 0 to 366 days.'); return; }
        if (Math.round(days * 2) !== days * 2) { showError('Use whole or half days (e.g. 5 or 5.5).'); return; }
        const payload = { staff_id: member.id, leave_type_id: balance.leave_type_id, year, allowed_days: days, updated_at: new Date().toISOString() };
        const { error } = existing
          ? await supabase.from('staff_leave_allowances').update(payload).eq('id', existing.id)
          : await supabase.from('staff_leave_allowances').insert(payload);
        if (error) throw error;
      }
      showSuccess(reset ? 'Allowance reset to the leave type default.' : 'Allowance saved.');
      setAllowanceEdit(null);
      load();
    } catch (err) {
      showError(errorMessage(err));
    }
  };

  // ── Apply one limit to everyone (individual cells can still be changed after) ──
  const openBulk = (t: LeaveType) => {
    setBulkType(t);
    setBulkValue(String(Number(t.default_days_per_year)));
    setBulkScope(isAll ? 'all' : 'branch');
  };

  const applyBulk = async (reset: boolean) => {
    if (!bulkType) return;
    const days = Number(bulkValue);
    if (!reset) {
      if (bulkValue.trim() === '' || Number.isNaN(days) || days < 0 || days > 366) { showError('Enter 0 to 366 days.'); return; }
      if (Math.round(days * 2) !== days * 2) { showError('Use whole or half days (e.g. 5 or 5.5).'); return; }
    }
    setBulkSaving(true);
    try {
      let staffIds = staff.map(m => m.id);
      if (bulkScope === 'all') {
        const { data, error } = await supabase.from('staff_members').select('id').eq('status', 'active');
        if (error) throw error;
        staffIds = ((data as { id: string }[]) || []).map(r => r.id);
      }
      if (staffIds.length === 0) { showError('No active staff to update.'); return; }

      const { data: existingRows, error: exErr } = await supabase
        .from('staff_leave_allowances').select('id, staff_id')
        .eq('leave_type_id', bulkType.id).eq('year', year).in('staff_id', staffIds);
      if (exErr) throw exErr;
      const existing = (existingRows as { id: string; staff_id: string }[]) || [];

      if (reset) {
        if (existing.length) {
          const { error } = await supabase.from('staff_leave_allowances').delete().in('id', existing.map(r => r.id));
          if (error) throw error;
        }
      } else {
        const now = new Date().toISOString();
        if (existing.length) {
          const { error } = await supabase.from('staff_leave_allowances')
            .update({ allowed_days: days, updated_at: now }).in('id', existing.map(r => r.id));
          if (error) throw error;
        }
        const have = new Set(existing.map(r => r.staff_id));
        const missing = staffIds.filter(id => !have.has(id))
          .map(id => ({ staff_id: id, leave_type_id: bulkType.id, year, allowed_days: days, updated_at: now }));
        if (missing.length) {
          const { error } = await supabase.from('staff_leave_allowances').insert(missing);
          if (error) throw error;
        }
      }
      showSuccess(reset
        ? `${bulkType.name} limits reset to the default (${Number(bulkType.default_days_per_year)} days) for ${staffIds.length} staff.`
        : `${bulkType.name} set to ${days} day(s) for ${staffIds.length} staff in ${year}. You can still change anyone individually.`);
      setBulkType(null);
      load();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setBulkSaving(false);
    }
  };

  // ── Leave types ───────────────────────────────────────────────────────────
  const openType = (t: LeaveType | 'new') => {
    setTypeForm(t === 'new' ? emptyTypeForm : {
      name: t.name,
      default_days_per_year: String(t.default_days_per_year),
      max_days_per_request: t.max_days_per_request === null ? '' : String(t.max_days_per_request),
      is_paid: t.is_paid,
      allow_half_day: t.allow_half_day,
      color: t.color,
      is_active: t.is_active,
    });
    setTypeEdit(t);
  };

  const saveType = async () => {
    if (!typeEdit) return;
    const def = Number(typeForm.default_days_per_year);
    const max = typeForm.max_days_per_request.trim() === '' ? null : Number(typeForm.max_days_per_request);
    if (!typeForm.name.trim()) { showError('Name is required.'); return; }
    if (Number.isNaN(def) || def < 0 || def > 366) { showError('Days per year must be 0 to 366.'); return; }
    if (max !== null && (Number.isNaN(max) || max <= 0)) { showError('Max per request must be more than 0, or blank for no limit.'); return; }
    const payload = {
      name: typeForm.name.trim(),
      default_days_per_year: def,
      max_days_per_request: max,
      is_paid: typeForm.is_paid,
      allow_half_day: typeForm.allow_half_day,
      color: typeForm.color,
      is_active: typeForm.is_active,
      updated_at: new Date().toISOString(),
    };
    const { error } = typeEdit === 'new'
      ? await supabase.from('staff_leave_types').insert({ ...payload, sort_order: types.length + 1 })
      : await supabase.from('staff_leave_types').update(payload).eq('id', typeEdit.id);
    if (error) {
      showError(error.message.includes('uq_staff_leave_types_tenant_name') ? 'A leave type with that name already exists.' : errorMessage(error));
      return;
    }
    showSuccess('Leave type saved.');
    setTypeEdit(null);
    load();
  };

  const addStarterTypes = async () => {
    const { error } = await supabase.from('staff_leave_types').insert(STARTER_TYPES);
    if (error) { showError(errorMessage(error)); return; }
    showSuccess('Starter leave types added. Adjust the days to match your policy.');
    load();
  };

  if (!branch && !isAll) return <PageShell><PageHeader title="Leave Requests" actions={<BranchFilter />} /><NoBranchNotice /></PageShell>;

  const filingBalances = filingFor ? (balancesByStaff[filingFor] || []) : [];

  return (
    <PageShell>
      <PageHeader
        title="Leave Requests"
        description={`${branch ? branch.name : 'All branches'} · approve leave, and set how many days each person can file per year.`}
        actions={
          <>
            <BranchFilter />
            <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger className="w-24 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            {canManage && (
              <Button size="sm" disabled={staff.length === 0 || activeTypes.length === 0} onClick={() => { setFilingFor(staff[0]?.id || null); setFilingOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> File for staff
              </Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">
            Requests{pendingCount > 0 && <span className="ml-1.5 text-[10px] font-bold px-1.5 rounded-full bg-amber-500 text-black">{pendingCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="balances">Balances & limits</TabsTrigger>
          <TabsTrigger value="types">Leave types</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {(['pending', 'approved', 'rejected', 'cancelled', 'all'] as const).map(s => (
              <Button key={s} size="sm" variant={statusFilter === s ? 'default' : 'outline'} onClick={() => setStatusFilter(s)} className="capitalize h-8">
                {s}
              </Button>
            ))}
            {loading && <span className="text-xs text-muted-foreground self-center ml-2">Loading…</span>}
          </div>
          {visibleRequests.length === 0 ? (
            <EmptyState title={statusFilter === 'pending' ? 'No pending leave requests' : 'No requests'} icon={<CalendarCheck className="h-8 w-8" />} />
          ) : (
            <div className="grid gap-2">
              {visibleRequests.map(r => {
                const t = typeById[r.leave_type_id];
                const st = LEAVE_STATUS_STYLE[r.status];
                const bal = (balancesByStaff[r.staff_id] || []).find(b => b.leave_type_id === r.leave_type_id);
                return (
                  <Card key={r.id}>
                    <CardContent className="p-3 flex flex-col md:flex-row md:items-center gap-3">
                      <span className="hidden md:block w-1.5 self-stretch rounded-full" style={{ backgroundColor: t?.color || '#64748b' }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold">{staffName[r.staff_id] || 'Former staff'} · {t?.name || 'Leave'} · {formatDays(r.days)} {isAll && <BranchTag name={branchName(r.branch_id)} />}</p>
                        <p className="text-sm">{formatLeaveRange(r)}</p>
                        <p className="text-xs text-muted-foreground">
                          Filed {formatDateTime(r.created_at)}{r.reason ? ` · "${r.reason}"` : ''}
                          {bal ? ` · ${Number(bal.remaining_days)} of ${Number(bal.allowed_days)} ${t?.name || ''} days left` : ''}
                        </p>
                        {r.review_note && <p className="text-xs text-muted-foreground">Note: {r.review_note}</p>}
                      </div>
                      <span className={`self-start md:self-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
                      {canManage && r.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => { setReviewNote(''); setReviewError(null); setReview({ request: r, mode: 'reject' }); }}>Reject</Button>
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setReviewNote(''); setReviewError(null); setReview({ request: r, mode: 'approve' }); }}>Approve</Button>
                        </div>
                      )}
                      {canManage && r.status === 'approved' && (
                        <Button size="sm" variant="ghost" onClick={() => { setReviewNote(''); setReviewError(null); setReview({ request: r, mode: 'cancel' }); }}>Cancel leave</Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="balances" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Each cell shows days left / days allowed for {year}. {canManage ? 'Use "Set for everyone" under a leave type to give all staff the same limit, then tap any cell to change one person.' : ''} Limits marked * differ from the leave type default.
          </p>
          {activeTypes.length === 0 || staff.length === 0 ? (
            <EmptyState title={activeTypes.length === 0 ? 'No leave types yet' : 'No active staff at this branch'} />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      {activeTypes.map(t => (
                        <TableHead key={t.id} className="text-center whitespace-nowrap align-bottom py-2">
                          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: t.color }} />{t.name}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openBulk(t)}
                              className="block mx-auto mt-1 text-[10px] font-semibold text-primary hover:underline"
                            >
                              Set for everyone
                            </button>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staff.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium whitespace-nowrap">{m.full_name} {isAll && <BranchTag name={branchName(m.branch_id)} />}</TableCell>
                        {activeTypes.map(t => {
                          const b = (balancesByStaff[m.id] || []).find(x => x.leave_type_id === t.id);
                          if (!b) return <TableCell key={t.id} className="text-center text-muted-foreground">—</TableCell>;
                          const low = Number(b.remaining_days) <= 0;
                          return (
                            <TableCell key={t.id} className="text-center p-1">
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() => { setAllowanceValue(String(Number(b.allowed_days))); setAllowanceEdit({ staff: m, balance: b }); }}
                                className="w-full rounded-md px-2 py-1.5 hover:bg-muted disabled:hover:bg-transparent disabled:cursor-default"
                                aria-label={`${m.full_name} ${t.name}: ${Number(b.remaining_days)} of ${Number(b.allowed_days)} days left`}
                              >
                                <span className={`font-semibold tabular-nums ${low ? 'text-destructive' : ''}`}>{Number(b.remaining_days)}</span>
                                <span className="text-muted-foreground tabular-nums"> / {Number(b.allowed_days)}{b.is_override ? '*' : ''}</span>
                              </button>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="types" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Leave types apply to every branch. {isSuperAdmin ? 'The default days are each person\'s yearly limit unless you change it in Balances & limits.' : 'Only a Super Admin can change leave types.'}
            </p>
            {isSuperAdmin && <Button size="sm" onClick={() => openType('new')}><Plus className="h-4 w-4 mr-1" /> New type</Button>}
          </div>
          {types.length === 0 ? (
            <EmptyState title="No leave types yet">
              {isSuperAdmin ? (
                <div className="space-y-3">
                  <p>Start with common types (Vacation 5, Sick 5, Emergency 3, Unpaid 10 days a year) and adjust them.</p>
                  <Button size="sm" onClick={addStarterTypes}>Add starter leave types</Button>
                </div>
              ) : 'Ask a Super Admin to set up leave types.'}
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {types.map(t => (
                <Card key={t.id} className={t.is_active ? '' : 'opacity-60'}>
                  <CardContent className="p-4 flex gap-3">
                    <span className="w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold">{t.name}</p>
                        <Badge variant="outline" className="text-[10px]">{t.is_paid ? 'Paid' : 'Unpaid'}</Badge>
                        {!t.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                      </div>
                      <p className="text-sm">{formatDays(t.default_days_per_year)} per year</p>
                      <p className="text-xs text-muted-foreground">
                        {t.max_days_per_request ? `Max ${formatDays(t.max_days_per_request)} per request` : 'No per-request limit'}
                        {t.allow_half_day ? ' · half days allowed' : ''}
                      </p>
                      {isSuperAdmin && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 -ml-2" onClick={() => openType(t)}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Review dialog */}
      <Dialog open={review !== null} onOpenChange={o => { if (!o) setReview(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {review?.mode === 'approve' ? 'Approve leave' : review?.mode === 'reject' ? 'Reject leave' : 'Cancel approved leave'}
            </DialogTitle>
            <DialogDescription>
              {review && `${staffName[review.request.staff_id] || ''} · ${typeById[review.request.leave_type_id]?.name || 'Leave'} · ${formatLeaveRange(review.request)} · ${formatDays(review.request.days)}`}
            </DialogDescription>
          </DialogHeader>
          {review?.mode === 'approve' && !review.request.half_day && (
            <p className="text-sm text-muted-foreground">Their scheduled shifts on these dates will be cancelled.</p>
          )}
          {review?.mode === 'cancel' && (
            <p className="text-sm text-muted-foreground">The days go back to their balance and any shifts the leave cancelled are restored.</p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="rv-note">Note to staff (optional)</Label>
            <Input id="rv-note" value={reviewNote} onChange={e => setReviewNote(e.target.value)} maxLength={300} />
          </div>
          {reviewError && <p role="alert" className="text-sm text-destructive">{reviewError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>Back</Button>
            <Button
              onClick={runReview}
              className={review?.mode === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
              variant={review?.mode === 'approve' ? 'default' : 'destructive'}
            >
              {review?.mode === 'approve' ? 'Approve' : review?.mode === 'reject' ? 'Reject' : 'Cancel leave'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Allowance dialog */}
      <Dialog open={allowanceEdit !== null} onOpenChange={o => { if (!o) setAllowanceEdit(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{allowanceEdit?.balance.name} limit for {year}</DialogTitle>
            <DialogDescription>
              {allowanceEdit && `${allowanceEdit.staff.full_name} has used ${Number(allowanceEdit.balance.used_days)} and has ${Number(allowanceEdit.balance.pending_days)} pending. Default for this type: ${typeById[allowanceEdit.balance.leave_type_id]?.default_days_per_year ?? '—'} days.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="al-days">Days allowed in {year}</Label>
            <Input id="al-days" inputMode="decimal" value={allowanceValue} onChange={e => setAllowanceValue(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            {allowanceEdit?.balance.is_override && <Button variant="outline" onClick={() => saveAllowance(true)}>Use default</Button>}
            <Button onClick={() => saveAllowance(false)}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set-for-everyone dialog */}
      <Dialog open={bulkType !== null} onOpenChange={o => { if (!o) setBulkType(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{bulkType?.name} limit for everyone · {year}</DialogTitle>
            <DialogDescription>
              Replaces the {bulkType?.name} limit for every active staff member, including custom ones. You can still change individuals afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bk-days">Days allowed in {year}</Label>
              <Input id="bk-days" inputMode="decimal" value={bulkValue} onChange={e => setBulkValue(e.target.value)} />
            </div>
            {isSuperAdmin && (
              <div className="grid gap-1.5">
                <Label>Apply to</Label>
                <Select value={bulkScope} onValueChange={v => setBulkScope(v as 'branch' | 'all')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {branch && <SelectItem value="branch">Staff at {branch.name} ({staff.length})</SelectItem>}
                    <SelectItem value="all">Staff at all branches</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => applyBulk(true)} disabled={bulkSaving}>
              Reset to default ({bulkType ? Number(bulkType.default_days_per_year) : '—'})
            </Button>
            <Button onClick={() => applyBulk(false)} disabled={bulkSaving}>{bulkSaving ? 'Saving…' : 'Apply to everyone'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave type dialog */}
      <Dialog open={typeEdit !== null} onOpenChange={o => { if (!o) setTypeEdit(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{typeEdit === 'new' ? 'New leave type' : 'Edit leave type'}</DialogTitle>
            <DialogDescription>Changing the default days updates everyone who does not have a custom limit.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lt-name">Name</Label>
              <Input id="lt-name" placeholder="Vacation" value={typeForm.name} onChange={e => setTypeForm({ ...typeForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="lt-days" className="text-xs">Days per year</Label>
                <Input id="lt-days" inputMode="decimal" value={typeForm.default_days_per_year} onChange={e => setTypeForm({ ...typeForm, default_days_per_year: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="lt-max" className="text-xs">Max per request</Label>
                <Input id="lt-max" inputMode="decimal" placeholder="No limit" value={typeForm.max_days_per_request} onChange={e => setTypeForm({ ...typeForm, max_days_per_request: e.target.value })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={typeForm.is_paid} onChange={e => setTypeForm({ ...typeForm, is_paid: e.target.checked })} /> Paid leave
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={typeForm.allow_half_day} onChange={e => setTypeForm({ ...typeForm, allow_half_day: e.target.checked })} /> Allow half days
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={typeForm.is_active} onChange={e => setTypeForm({ ...typeForm, is_active: e.target.checked })} /> Active (staff can file it)
            </label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={typeForm.color === c}
                  onClick={() => setTypeForm({ ...typeForm, color: c })}
                  className={`w-7 h-7 rounded-full border-2 ${typeForm.color === c ? 'border-foreground' : 'border-transparent'}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTypeEdit(null)}>Cancel</Button>
            <Button onClick={saveType}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FileLeaveDialog
        open={filingOpen}
        onOpenChange={setFilingOpen}
        balances={filingBalances}
        staffOptions={staff}
        staffId={filingFor || undefined}
        onStaffChange={setFilingFor}
        onFiled={() => { setFilingOpen(false); load(); }}
      />
    </PageShell>
  );
};

export default LeaveManagement;
