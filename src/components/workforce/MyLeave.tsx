import React, { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import {
  errorMessage,
  formatDays,
  formatLeaveRange,
  LEAVE_STATUS_STYLE,
  todayKey,
  type LeaveBalance,
  type LeaveRequest,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { EmptyState, PageHeader, PageShell } from './shared';
import { FileLeaveDialog } from './FileLeaveDialog';

const MyLeave: React.FC = () => {
  const { showSuccess, showError, confirm } = useModal();
  const year = Number(todayKey().slice(0, 4));
  const [linked, setLinked] = useState<boolean | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [filing, setFiling] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: status, error: sErr } = await supabase.rpc('fn_my_clock_status');
      if (sErr) throw sErr;
      const st = status as { linked: boolean; staff_id?: string };
      setLinked(st.linked);
      if (!st.linked || !st.staff_id) return;
      setStaffId(st.staff_id);
      const [b, r] = await Promise.all([
        supabase.rpc('fn_leave_balances', { p_year: year }),
        supabase.from('staff_leave_requests').select('*').eq('staff_id', st.staff_id).order('start_date', { ascending: false }).limit(50),
      ]);
      if (b.error) throw b.error;
      if (r.error) throw r.error;
      setBalances((b.data as LeaveBalance[]) || []);
      setRequests((r.data as LeaveRequest[]) || []);
    } catch (err) {
      showError(errorMessage(err));
    }
  }, [showError, year]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (r: LeaveRequest) => {
    if (!(await confirm('Cancel leave request', `Cancel your ${formatDays(r.days)} leave on ${formatLeaveRange(r)}?`))) return;
    const { data, error } = await supabase.rpc('fn_cancel_leave', { p_request_id: r.id });
    const res = data as { ok: boolean; error?: string } | null;
    if (error || !res?.ok) { showError(error ? errorMessage(error) : res?.error || 'Could not cancel.'); return; }
    showSuccess('Leave request cancelled.');
    load();
  };

  const typeName = (id: string) => balances.find(b => b.leave_type_id === id)?.name || 'Leave';

  if (linked === null) return <PageShell><p className="text-sm text-muted-foreground">Loading…</p></PageShell>;

  if (!linked) {
    return (
      <PageShell>
        <PageHeader title="My Leave" />
        <EmptyState title="Your login is not linked to a staff record" icon={<CalendarOff className="h-8 w-8" />}>
          Ask your manager to link your account in Workforce → Staff Directory. Your manager can also file leave for you.
        </EmptyState>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="My Leave"
        description={`Your leave balance for ${year}. Pending requests are already counted against what's left.`}
        actions={<Button size="sm" onClick={() => setFiling(true)} disabled={balances.length === 0}><Plus className="h-4 w-4 mr-1" /> File leave</Button>}
      />

      {balances.length === 0 ? (
        <EmptyState title="No leave types set up yet">Your admin has not set up leave types. Ask them to add them in Workforce → Leave Requests.</EmptyState>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map(b => {
            const pct = b.allowed_days > 0 ? Math.min(100, ((Number(b.used_days) + Number(b.pending_days)) / Number(b.allowed_days)) * 100) : 100;
            return (
              <Card key={b.leave_type_id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                      {b.name}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{b.is_paid ? 'Paid' : 'Unpaid'}</span>
                  </div>
                  <div>
                    <span className="text-4xl font-bold tabular-nums">{Number(b.remaining_days)}</span>
                    <span className="text-sm text-muted-foreground"> of {Number(b.allowed_days)} days left</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden" role="presentation">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: b.color }} />
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Used {Number(b.used_days)}</span>
                    <span>Pending {Number(b.pending_days)}</span>
                    {b.max_days_per_request && <span>Max {Number(b.max_days_per_request)}/request</span>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <h2 className="font-semibold">My requests</h2>
        {requests.length === 0 && <p className="text-sm text-muted-foreground">You have not filed any leave yet.</p>}
        {requests.map(r => {
          const st = LEAVE_STATUS_STYLE[r.status];
          return (
            <Card key={r.id}>
              <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{typeName(r.leave_type_id)} · {formatDays(r.days)}</p>
                  <p className="text-sm text-muted-foreground">{formatLeaveRange(r)}{r.reason ? ` · ${r.reason}` : ''}</p>
                  {r.review_note && <p className="text-xs text-muted-foreground mt-0.5">Manager: {r.review_note}</p>}
                </div>
                <span className={`self-start sm:self-center text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
                {r.status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={() => cancel(r)}>Cancel</Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {staffId && (
        <FileLeaveDialog
          open={filing}
          onOpenChange={setFiling}
          balances={balances}
          onFiled={() => { setFiling(false); load(); }}
        />
      )}
    </PageShell>
  );
};

export default MyLeave;
