import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Coffee, LogIn, LogOut, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import {
  allowedClockActions,
  deviceInfo,
  EVENT_LABELS,
  formatDateTime,
  formatTime,
  getDevicePosition,
  type AttendanceLog,
  type ClockEventType,
  type ClockResult,
  type ClockState,
  STATE_BADGE,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { EmptyState, PageHeader, PageShell } from './shared';
import { errorMessage } from '../../lib/workforce';

interface MyStatus {
  linked: boolean;
  staff_id?: string;
  full_name?: string;
  position?: string | null;
  status?: string;
  branch_name?: string | null;
  branch_has_geofence?: boolean;
  geofence_radius_m?: number;
  clock_state?: ClockState;
  last_event_at?: string | null;
  next_shift?: { id: string; start_at: string; end_at: string; break_minutes: number } | null;
}

const ACTION_STYLE: Record<ClockEventType, { icon: React.ElementType; className: string }> = {
  in: { icon: LogIn, className: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
  out: { icon: LogOut, className: 'bg-rose-600 hover:bg-rose-700 text-white' },
  break_start: { icon: Coffee, className: 'bg-amber-500 hover:bg-amber-600 text-black' },
  break_end: { icon: Coffee, className: 'bg-sky-600 hover:bg-sky-700 text-white' },
};


const TimeClock: React.FC = () => {
  const { showSuccess, showError } = useModal();
  const [status, setStatus] = useState<MyStatus | null>(null);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ClockEventType | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_my_clock_status');
      if (error) throw error;
      const s = data as MyStatus;
      setStatus(s);
      if (s?.linked && s.staff_id) {
        const { data: rows, error: logErr } = await supabase
          .from('attendance_logs')
          .select('*')
          .eq('staff_id', s.staff_id)
          .order('event_at', { ascending: false })
          .limit(10);
        if (logErr) throw logErr;
        setLogs((rows as AttendanceLog[]) || []);
      }
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { load(); }, [load]);

  const punch = async (eventType: ClockEventType) => {
    setBusy(eventType);
    setLastError(null);
    try {
      const pos = await getDevicePosition();
      const { data, error } = await supabase.rpc('fn_clock_event', {
        p_event_type: eventType,
        p_latitude: pos.latitude,
        p_longitude: pos.longitude,
        p_accuracy_m: pos.accuracy,
        p_device_info: deviceInfo(),
      });
      if (error) throw error;
      const result = data as ClockResult;
      if (!result.ok) {
        setLastError(result.error || 'Could not record your punch.');
        return;
      }
      showSuccess(`${EVENT_LABELS[eventType]} recorded at ${formatTime(result.event_at)}.`);
      await load();
    } catch (err) {
      setLastError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !status) {
    return <PageShell><p className="text-sm text-muted-foreground">Loading your time clock…</p></PageShell>;
  }

  if (!status?.linked) {
    return (
      <PageShell>
        <PageHeader title="My Time Clock" />
        <EmptyState title="Your login is not linked to a staff record" icon={<Clock className="h-8 w-8" />}>
          Ask your manager to open <span className="font-semibold">Workforce → Staff Directory</span> and link your
          account to your staff record. Crew without a login can use the Branch Time Clock with a PIN.
        </EmptyState>
      </PageShell>
    );
  }

  const state: ClockState = status.clock_state || 'off';
  const actions = allowedClockActions(state);
  const badge = STATE_BADGE[state];

  return (
    <PageShell>
      <PageHeader
        title="My Time Clock"
        description={`${status.full_name}${status.position ? ` · ${status.position}` : ''} · ${status.branch_name || 'No branch'}`}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardContent className="p-6 flex flex-col items-center text-center gap-5">
            <span className={`text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full ${badge.className}`}>
              {badge.label}
            </span>
            <div>
              <div className="text-5xl md:text-6xl font-bold tabular-nums tracking-tight">
                {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(now)}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' }).format(now)}
              </div>
              {status.last_event_at && (
                <div className="text-xs text-muted-foreground mt-2">Last punch: {formatDateTime(status.last_event_at)}</div>
              )}
            </div>

            {!status.branch_has_geofence ? (
              <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                Your branch location is not set up yet, so time in/out is disabled. Ask your admin to set it in
                Workforce → Branch Geofence.
              </div>
            ) : (
              <div className={`grid gap-3 w-full ${actions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {actions.map(a => {
                  const style = ACTION_STYLE[a];
                  const Icon = style.icon;
                  return (
                    <Button
                      key={a}
                      onClick={() => punch(a)}
                      disabled={busy !== null}
                      className={`h-16 text-lg font-bold ${style.className}`}
                    >
                      {busy === a ? <RefreshCw className="h-5 w-5 mr-2 animate-spin" /> : <Icon className="h-5 w-5 mr-2" />}
                      {busy === a ? 'Getting location…' : EVENT_LABELS[a]}
                    </Button>
                  );
                })}
              </div>
            )}

            {lastError && (
              <div role="alert" className="w-full rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {lastError}
              </div>
            )}

            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              You must be within {status.geofence_radius_m ?? 100} m of {status.branch_name || 'your branch'}. Your location is
              saved with each punch.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Next shift</CardTitle></CardHeader>
            <CardContent>
              {status.next_shift ? (
                <div>
                  <p className="text-lg font-semibold">
                    {formatTime(status.next_shift.start_at)} – {formatTime(status.next_shift.end_at)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(status.next_shift.start_at))}
                    {status.next_shift.break_minutes ? ` · ${status.next_shift.break_minutes} min break` : ''}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No upcoming shift scheduled.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Recent punches</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {logs.length === 0 && <p className="text-sm text-muted-foreground">No punches yet.</p>}
              {logs.map(l => (
                <div key={l.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                  <span className="font-medium">{EVENT_LABELS[l.event_type]}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {l.method === 'manual' && <Badge variant="outline" className="text-[10px]">Manual</Badge>}
                    {l.method === 'kiosk' && <Badge variant="outline" className="text-[10px]">Kiosk</Badge>}
                    {formatDateTime(l.event_at)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
};

export default TimeClock;
