import React, { useCallback, useEffect, useState } from 'react';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatClockTime, minutesToHours, templateMinutes, type ShiftTemplate } from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { BranchFilter, BranchTag, EmptyState, NoBranchNotice, PageHeader, PageShell } from './shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { errorMessage } from '../../lib/workforce';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899', '#64748b'];

const emptyForm = { name: '', start_time: '07:00', end_time: '15:00', break_minutes: '60', color: COLORS[0], allBranches: false, branch_id: '' };

const ShiftTemplates: React.FC = () => {
  const { branch, isAll, options: branchOptions, branchName } = useWorkforceBranch();
  const defaultBranchId = branch?.id || branchOptions[0]?.id || '';
  const { profile } = useAuth();
  const { showSuccess, showError, confirm } = useModal();
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [editing, setEditing] = useState<ShiftTemplate | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const isSuperAdmin = profile?.role_name === 'super_admin';

  const load = useCallback(async () => {
    if (!branch && !isAll) return;
    const base = supabase.from('shift_templates').select('*');
    const { data, error } = await (branch ? base.or(`branch_id.eq.${branch.id},branch_id.is.null`) : base).order('start_time');
    if (error) { showError(errorMessage(error)); return; }
    setTemplates((data as ShiftTemplate[]) || []);
  }, [branch, isAll, showError]);

  useEffect(() => { load(); }, [load]);

  const openEdit = (t: ShiftTemplate) => {
    setForm({
      name: t.name,
      start_time: t.start_time.slice(0, 5),
      end_time: t.end_time.slice(0, 5),
      break_minutes: String(t.break_minutes),
      color: t.color,
      allBranches: t.branch_id === null,
      branch_id: t.branch_id || defaultBranchId,
    });
    setEditing(t);
  };

  const save = async () => {
    if (!editing) return;
    const brk = Number(form.break_minutes || 0);
    if (!form.name.trim()) { showError('Name is required.'); return; }
    if (Number.isNaN(brk) || brk < 0 || brk > 480) { showError('Break must be 0–480 minutes.'); return; }
    if (form.start_time === form.end_time) { showError('Start and end time cannot be the same.'); return; }
    const payload = {
      name: form.name.trim(),
      start_time: form.start_time,
      end_time: form.end_time,
      break_minutes: brk,
      color: form.color,
      branch_id: isSuperAdmin && form.allBranches ? null : (form.branch_id || defaultBranchId),
      updated_at: new Date().toISOString(),
    };
    const { error } = editing === 'new'
      ? await supabase.from('shift_templates').insert(payload)
      : await supabase.from('shift_templates').update(payload).eq('id', editing.id);
    if (error) { showError(errorMessage(error)); return; }
    showSuccess('Shift template saved. Shifts already on the schedule keep their old times.');
    setEditing(null);
    load();
  };

  const toggleActive = async (t: ShiftTemplate) => {
    const { error } = await supabase.from('shift_templates').update({ is_active: !t.is_active }).eq('id', t.id);
    if (error) { showError(errorMessage(error)); return; }
    load();
  };

  const remove = async (t: ShiftTemplate) => {
    if (!(await confirm('Delete template', `Delete "${t.name}"? Recurring rules that use it are deleted too. Shifts already generated stay on the schedule.`))) return;
    const { error } = await supabase.from('shift_templates').delete().eq('id', t.id);
    if (error) { showError(errorMessage(error)); return; }
    showSuccess('Template deleted.');
    load();
  };

  if (!branch && !isAll) return <PageShell><PageHeader title="Shift Templates" actions={<BranchFilter />} /><NoBranchNotice /></PageShell>;

  const overnight = form.end_time <= form.start_time;

  return (
    <PageShell>
      <PageHeader
        title="Shift Templates"
        description="Reusable shift times, e.g. Opening 7:00 AM – 3:00 PM. Used by recurring schedules and when adding shifts."
        actions={<><BranchFilter /><Button size="sm" onClick={() => { setForm({ ...emptyForm, branch_id: defaultBranchId }); setEditing('new'); }}><Plus className="h-4 w-4 mr-1" /> New template</Button></>}
      />

      {templates.length === 0 ? (
        <EmptyState title="No shift templates yet" icon={<LayoutTemplate className="h-8 w-8" />}>
          Create templates like Opening, Mid and Closing to build schedules faster.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map(t => (
            <Card key={t.id} className={t.is_active ? '' : 'opacity-60'}>
              <CardContent className="p-4 flex gap-3">
                <span className="w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{t.name}</p>
                    {t.branch_id === null ? <Badge variant="outline" className="text-[10px]">All branches</Badge> : (isAll && <BranchTag name={branchName(t.branch_id)} />)}
                    {!t.is_active && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </div>
                  <p className="text-sm">{formatClockTime(t.start_time)} – {formatClockTime(t.end_time)}</p>
                  <p className="text-xs text-muted-foreground">
                    {minutesToHours(templateMinutes(t))} paid{t.break_minutes ? ` · ${t.break_minutes} min break` : ''}
                    {t.end_time <= t.start_time ? ' · overnight' : ''}
                  </p>
                  <div className="flex gap-1 mt-2">
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => toggleActive(t)}>{t.is_active ? 'Deactivate' : 'Activate'}</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'New shift template' : 'Edit shift template'}</DialogTitle>
            <DialogDescription>Times are Philippine time.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="st-name">Name</Label>
              <Input id="st-name" placeholder="Opening" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="st-start">Start</Label>
                <Input id="st-start" type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="st-end">End</Label>
                <Input id="st-end" type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
              </div>
            </div>
            {overnight && form.start_time !== form.end_time && (
              <p className="text-xs text-amber-600 dark:text-amber-400">Ends the next day (overnight shift).</p>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="st-break">Unpaid break (minutes)</Label>
              <Input id="st-break" inputMode="numeric" value={form.break_minutes} onChange={e => setForm({ ...form, break_minutes: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color ${c}`}
                    aria-pressed={form.color === c}
                    onClick={() => setForm({ ...form, color: c })}
                    className={`w-7 h-7 rounded-full border-2 ${form.color === c ? 'border-foreground' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            {!(isSuperAdmin && form.allBranches) && branchOptions.length > 1 && (
              <div className="grid gap-1.5">
                <Label>Branch</Label>
                <Select value={form.branch_id || defaultBranchId} onValueChange={v => setForm({ ...form, branch_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {branchOptions.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isSuperAdmin && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.allBranches} onChange={e => setForm({ ...form, allBranches: e.target.checked })} />
                Available to all branches
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default ShiftTemplates;
