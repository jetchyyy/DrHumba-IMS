import React, { useCallback, useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { addDaysKey, formatDateLabel, formatTime, minutesToHours, todayKey, type StaffShift } from '../../lib/workforce';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { EmptyState, PageHeader, PageShell } from './shared';
import { errorMessage } from '../../lib/workforce';

const DAYS_AHEAD = 14;

const MySchedule: React.FC = () => {
  const { showError } = useModal();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: status, error: sErr } = await supabase.rpc('fn_my_clock_status');
      if (sErr) throw sErr;
      const st = status as { linked: boolean; staff_id?: string };
      setLinked(st.linked);
      if (!st.linked || !st.staff_id) return;

      const from = todayKey();
      const to = addDaysKey(from, DAYS_AHEAD - 1);
      // Make sure recurring rules are expanded for the window (safe to repeat).
      await supabase.rpc('fn_generate_staff_shifts', { p_from: from, p_to: to });

      const { data, error } = await supabase
        .from('staff_shifts')
        .select('*')
        .eq('staff_id', st.staff_id)
        .gte('shift_date', from)
        .lte('shift_date', to)
        .order('start_at');
      if (error) throw error;
      setShifts((data as StaffShift[]) || []);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => { load(); }, [load]);

  const today = todayKey();
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDaysKey(today, i));

  return (
    <PageShell>
      <PageHeader title="My Schedule" description={`Your shifts for the next ${DAYS_AHEAD} days.`} />
      {loading && linked === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !linked ? (
        <EmptyState title="Your login is not linked to a staff record" icon={<CalendarDays className="h-8 w-8" />}>
          Ask your manager to link your account in Workforce → Staff Directory.
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {days.map(day => {
            const dayShifts = shifts.filter(s => s.shift_date === day);
            return (
              <Card key={day} className={day === today ? 'border-primary/50' : ''}>
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                  <div className="w-36 flex-shrink-0">
                    <p className="font-semibold">{formatDateLabel(day)}</p>
                    {day === today && <p className="text-xs text-primary font-semibold">Today</p>}
                  </div>
                  <div className="flex-1 flex flex-wrap gap-2">
                    {dayShifts.length === 0 && <span className="text-sm text-muted-foreground">Day off</span>}
                    {dayShifts.map(s => {
                      const mins = (new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 60000 - s.break_minutes;
                      return (
                        <div key={s.id} className={`rounded-lg border px-3 py-2 text-sm ${s.status === 'cancelled' ? 'opacity-60 line-through' : 'bg-primary/5 border-primary/20'}`}>
                          <span className="font-semibold">{formatTime(s.start_at)} – {formatTime(s.end_at)}</span>
                          <span className="text-muted-foreground"> · {minutesToHours(mins)}</span>
                          {s.status === 'cancelled' && <Badge variant={s.leave_request_id ? 'secondary' : 'destructive'} className="ml-2 text-[10px]">{s.leave_request_id ? 'On leave' : 'Cancelled'}</Badge>}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
};

export default MySchedule;
