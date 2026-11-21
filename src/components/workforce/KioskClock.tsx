import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Delete, RefreshCw, Search, Tablet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import {
  allowedClockActions,
  deviceInfo,
  EVENT_LABELS,
  formatTime,
  getDevicePosition,
  STATE_BADGE,
  type ClockEventType,
  type ClockResult,
  type ClockState,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { BranchFilter, EmptyState, NoBranchNotice, PageHeader, PageShell } from './shared';
import { errorMessage } from '../../lib/workforce';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';

interface KioskStaff {
  id: string;
  full_name: string;
  position: string | null;
  has_pin: boolean;
  clock_state: ClockState;
  last_event_at: string | null;
}

const KioskClock: React.FC = () => {
  // A kiosk always serves one branch, even if other screens show all branches.
  const { branch: filteredBranch, selectedBranch } = useWorkforceBranch();
  const branch = filteredBranch || selectedBranch;
  const { showSuccess, showError } = useModal();
  const [staff, setStaff] = useState<KioskStaff[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<KioskStaff | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<ClockEventType | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branch) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_kiosk_staff_list', { p_branch_id: branch.id });
      if (error) throw error;
      setStaff((data as KioskStaff[]) || []);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [branch, showError]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? staff.filter(s => s.full_name.toLowerCase().includes(q)) : staff;
  }, [staff, search]);

  const close = () => { setPicked(null); setPin(''); setPinError(null); };

  const punch = async (eventType: ClockEventType) => {
    if (!picked) return;
    if (!/^\d{4,6}$/.test(pin)) { setPinError('Enter your 4–6 digit PIN.'); return; }
    setBusy(eventType);
    setPinError(null);
    try {
      const pos = await getDevicePosition();
      const { data, error } = await supabase.rpc('fn_clock_event', {
        p_event_type: eventType,
        p_latitude: pos.latitude,
        p_longitude: pos.longitude,
        p_accuracy_m: pos.accuracy,
        p_staff_id: picked.id,
        p_pin: pin,
        p_device_info: deviceInfo(),
      });
      if (error) throw error;
      const result = data as ClockResult;
      if (!result.ok) {
        setPinError(result.error || 'Could not record the punch.');
        setPin('');
        return;
      }
      showSuccess(`${result.staff_name}: ${EVENT_LABELS[eventType]} at ${formatTime(result.event_at)}.`);
      close();
      load();
    } catch (err) {
      setPinError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!branch) return <PageShell><PageHeader title="Branch Time Clock" actions={<BranchFilter allowAll={false} />} /><NoBranchNotice /></PageShell>;

  const pressDigit = (d: string) => { setPinError(null); setPin(p => (p.length < 6 ? p + d : p)); };

  return (
    <PageShell>
      <PageHeader
        title="Branch Time Clock"
        description={`Shared device for ${branch.name}. Staff tap their name and enter their PIN. This device's location is checked against the branch.`}
        actions={
          <>
            <BranchFilter allowAll={false} />
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </>
        }
      />

      <div className="relative max-w-sm">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find your name" className="pl-9" aria-label="Find your name" />
      </div>

      {staff.length === 0 && !loading ? (
        <EmptyState title="No active staff at this branch" icon={<Tablet className="h-8 w-8" />}>
          Add staff in Workforce → Staff Directory and give each one a PIN.
        </EmptyState>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map(s => {
            const badge = STATE_BADGE[s.clock_state];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setPicked(s)}
                disabled={!s.has_pin}
                className="text-left rounded-xl border bg-card p-4 hover:border-primary hover:shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold mb-3">
                  {s.full_name.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <p className="font-semibold truncate">{s.full_name}</p>
                <p className="text-xs text-muted-foreground truncate">{s.position || 'Staff'}</p>
                <span className={`inline-block mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${badge.className}`}>
                  {s.has_pin ? badge.label : 'No PIN set'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={picked !== null} onOpenChange={o => { if (!o) close(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{picked?.full_name}</DialogTitle>
            <DialogDescription>Enter your PIN, then choose an action.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center gap-2 py-2" aria-label="PIN entered">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < pin.length ? 'bg-foreground border-foreground' : 'border-muted-foreground/40'}`} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
              <Button key={d} variant="outline" className="h-14 text-xl font-semibold" onClick={() => pressDigit(d)}>{d}</Button>
            ))}
            <Button variant="ghost" className="h-14" onClick={() => setPin('')}>Clear</Button>
            <Button variant="outline" className="h-14 text-xl font-semibold" onClick={() => pressDigit('0')}>0</Button>
            <Button variant="ghost" className="h-14" onClick={() => setPin(p => p.slice(0, -1))} aria-label="Delete digit"><Delete className="h-5 w-5" /></Button>
          </div>
          {pinError && <p role="alert" className="text-sm text-destructive text-center">{pinError}</p>}
          {picked && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {allowedClockActions(picked.clock_state).map(a => (
                <Button
                  key={a}
                  onClick={() => punch(a)}
                  disabled={busy !== null}
                  className={`h-12 font-bold ${a === 'in' ? 'col-span-2 bg-emerald-600 hover:bg-emerald-700 text-white' : a === 'out' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-amber-500 hover:bg-amber-600 text-black'}`}
                >
                  {busy === a ? 'Checking location…' : EVENT_LABELS[a]}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default KioskClock;
