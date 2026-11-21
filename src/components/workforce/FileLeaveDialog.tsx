import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { errorMessage, formatDays, todayKey, type LeaveBalance, type StaffMember } from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Balances of the person the leave is for (reloaded by the parent when staff changes). */
  balances: LeaveBalance[];
  onFiled: () => void;
  /** Manager mode: pick which staff member to file for. */
  staffOptions?: StaffMember[];
  staffId?: string;
  onStaffChange?: (id: string) => void;
}

export const FileLeaveDialog: React.FC<Props> = ({ open, onOpenChange, balances, onFiled, staffOptions, staffId, onStaffChange }) => {
  const { showSuccess } = useModal();
  const [typeId, setTypeId] = useState('');
  const [start, setStart] = useState(todayKey());
  const [end, setEnd] = useState(todayKey());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setTypeId(t => (balances.some(b => b.leave_type_id === t) ? t : balances[0]?.leave_type_id || ''));
    }
  }, [open, balances]);

  const selected = balances.find(b => b.leave_type_id === typeId);
  const singleDay = start === end;

  const submit = async () => {
    setError(null);
    if (!typeId) { setError('Choose a leave type.'); return; }
    if (staffOptions && !staffId) { setError('Choose a staff member.'); return; }
    if (end < start) { setError('The end date is before the start date.'); return; }
    setSaving(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('fn_file_leave', {
        p_leave_type_id: typeId,
        p_start_date: start,
        p_end_date: end,
        p_reason: reason.trim() || null,
        p_half_day: singleDay && halfDay,
        p_staff_id: staffOptions ? staffId : null,
      });
      if (rpcErr) throw rpcErr;
      const res = data as { ok: boolean; error?: string; days?: number };
      if (!res.ok) { setError(res.error || 'Could not file the leave.'); return; }
      showSuccess(`Leave filed for ${formatDays(res.days ?? 0)}. It is waiting for approval.`);
      setReason('');
      setHalfDay(false);
      onFiled();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>File leave</DialogTitle>
          <DialogDescription>Only scheduled work days count against the balance.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {staffOptions && (
            <div className="grid gap-1.5">
              <Label>Staff</Label>
              <Select value={staffId || ''} onValueChange={v => onStaffChange?.(v)}>
                <SelectTrigger><SelectValue placeholder="Choose staff" /></SelectTrigger>
                <SelectContent>
                  {staffOptions.map(s => <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Leave type</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger><SelectValue placeholder="Choose type" /></SelectTrigger>
              <SelectContent>
                {balances.map(b => (
                  <SelectItem key={b.leave_type_id} value={b.leave_type_id}>
                    {b.name} · {Number(b.remaining_days)} left
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected?.max_days_per_request && (
              <p className="text-xs text-muted-foreground">Up to {Number(selected.max_days_per_request)} day(s) per request.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="lv-start" className="text-xs">From</Label>
              <Input id="lv-start" type="date" value={start} onChange={e => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="lv-end" className="text-xs">To</Label>
              <Input id="lv-end" type="date" min={start} value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          {singleDay && selected?.allow_half_day && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={halfDay} onChange={e => setHalfDay(e.target.checked)} />
              Half day only
            </label>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="lv-reason">Reason (optional)</Label>
            <Input id="lv-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Filing…' : 'File leave'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
