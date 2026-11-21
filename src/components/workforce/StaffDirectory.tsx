import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarSearch, KeyRound, Pencil, Plus, RefreshCw, Trash2, UserRound, Users } from 'lucide-react';
import { StaffHistoryDialog } from './StaffHistoryDialog';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import { EMPLOYMENT_LABELS, type StaffMember } from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { BranchFilter, EmptyState, NoBranchNotice, PageHeader, PageShell } from './shared';
import { errorMessage } from '../../lib/workforce';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';

interface LoginOption {
  id: string;
  email: string;
  full_name: string | null;
  role_name: string;
  branch_id: string | null;
  status: string | null;
  is_platform_admin: boolean | null;
}

const ROLE_POSITION: Record<string, string> = {
  super_admin: 'Admin',
  branch_manager: 'Branch Manager',
  inventory_manager: 'Inventory Manager',
  cashier: 'Cashier',
  auditor: 'Auditor',
};

const displayName = (l: LoginOption) => l.full_name?.trim() || l.email.split('@')[0];

const NONE = '__none__';

const emptyForm = {
  full_name: '',
  position: '',
  employment_type: 'full_time' as StaffMember['employment_type'],
  hourly_rate: '',
  profile_id: NONE,
  status: 'active' as StaffMember['status'],
  branch_id: '',
};

const StaffDirectory: React.FC = () => {
  const { branch, isAll, options: branchOptions, branchName: nameOfBranch } = useWorkforceBranch();
  const { tenant } = useTenant();
  const { profile, branches } = useAuth();
  // Branch used for new staff when viewing all branches.
  const defaultBranchId = branch?.id || branchOptions[0]?.id || '';
  const optionIds = branchOptions.map(b => b.id).join(',');
  // Only a Super Admin may create staff at other branches (RLS enforces the same).
  const canImportAnyBranch = profile?.role_name === 'super_admin';
  const { showSuccess, showError, confirm } = useModal();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [pins, setPins] = useState<Record<string, boolean>>({});
  const [logins, setLogins] = useState<LoginOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pinFor, setPinFor] = useState<StaffMember | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPicked, setImportPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importBranch, setImportBranch] = useState<Record<string, string>>({});
  const [linkedAnywhere, setLinkedAnywhere] = useState<Set<string>>(new Set());
  const [historyFor, setHistoryFor] = useState<StaffMember | null>(null);
  const [leaveTypeNames, setLeaveTypeNames] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from('staff_leave_types').select('id, name').then(({ data }) => {
      setLeaveTypeNames(Object.fromEntries(((data as { id: string; name: string }[]) || []).map(t => [t.id, t.name])));
    });
  }, []);

  const tenantId = tenant?.id;

  const load = useCallback(async () => {
    if (!branch && !isAll) return;
    setLoading(true);
    try {
      let staffQ = supabase.from('staff_members').select('*').order('full_name');
      if (branch) staffQ = staffQ.eq('branch_id', branch.id);
      const pinBranches = branch ? [branch.id] : optionIds.split(',').filter(Boolean);
      const [{ data: staffRows, error: sErr }, ...pinResults] = await Promise.all([
        staffQ,
        ...pinBranches.map(id => supabase.rpc('fn_kiosk_staff_list', { p_branch_id: id })),
      ]);
      if (sErr) throw sErr;
      setStaff((staffRows as StaffMember[]) || []);
      const pinMap: Record<string, boolean> = {};
      for (const r of pinResults) {
        if (r.error) throw r.error;
        for (const k of (r.data as { id: string; has_pin: boolean }[]) || []) pinMap[k.id] = k.has_pin;
      }
      setPins(pinMap);

      let q = supabase.from('profiles').select('id, email, full_name, role_name, branch_id, status, is_platform_admin').order('email');
      if (tenantId) q = q.eq('tenant_id', tenantId);
      const { data: profs } = await q;
      // Platform (ODYSSEY) admins and suspended users are never offered as staff.
      setLogins(((profs as LoginOption[]) || []).filter(l => !l.is_platform_admin && l.status !== 'suspended'));

      // Logins already linked to a staff record at any branch you can see.
      const { data: linkedRows } = await supabase.from('staff_members').select('profile_id').not('profile_id', 'is', null);
      setLinkedAnywhere(new Set(((linkedRows as { profile_id: string }[]) || []).map(r => r.profile_id)));
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [branch, isAll, optionIds, tenantId, showError]);

  useEffect(() => { load(); }, [load]);

  const linkedIds = useMemo(() => new Set(staff.map(s => s.profile_id).filter(Boolean)), [staff]);
  const branchName = useMemo(() => Object.fromEntries(branches.map(b => [b.id, b.name])), [branches]);
  // Super Admin: every unlinked user in the tenant. Others: users of this branch or with no branch.
  const importable = useMemo(() => logins.filter(l =>
    !linkedIds.has(l.id) && !linkedAnywhere.has(l.id)
    && (canImportAnyBranch || !l.branch_id || l.branch_id === defaultBranchId)
  ), [logins, linkedIds, linkedAnywhere, canImportAnyBranch, defaultBranchId]);

  const openImport = () => {
    // Each user goes to the branch on their login; users without one go to the branch you are viewing.
    setImportBranch(Object.fromEntries(importable.map(l => [
      l.id,
      canImportAnyBranch && l.branch_id && branchName[l.branch_id] ? l.branch_id : defaultBranchId,
    ])));
    // Pre-tick users who have an assigned branch; admins/auditors with no branch stay unticked.
    setImportPicked(new Set(importable.filter(l => !!l.branch_id).map(l => l.id)));
    setImportOpen(true);
  };

  const togglePicked = (id: string) => setImportPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const runImport = async () => {
    if (!defaultBranchId || importPicked.size === 0) return;
    setImporting(true);
    let added = 0;
    let elsewhere = 0;
    const skipped: string[] = [];
    // One at a time so a login already linked at another branch only skips that person.
    for (const l of importable.filter(x => importPicked.has(x.id))) {
      const { error } = await supabase.from('staff_members').insert({
        full_name: displayName(l),
        position: ROLE_POSITION[l.role_name] || null,
        employment_type: 'full_time',
        profile_id: l.id,
        branch_id: importBranch[l.id] || defaultBranchId,
        status: 'active',
      });
      if (error) skipped.push(`${displayName(l)}: ${errorMessage(error)}`);
      else {
        added += 1;
        if (branch && (importBranch[l.id] || defaultBranchId) !== branch.id) elsewhere += 1;
      }
    }
    setImporting(false);
    setImportOpen(false);
    if (skipped.length) {
      showError(`Added ${added}. Skipped ${skipped.length}:\n${skipped.join('\n')}`);
    } else {
      showSuccess(`Added ${added} staff member${added === 1 ? '' : 's'} linked to their logins${elsewhere ? ` (${elsewhere} at other branches: pick them in the branch filter, or choose All branches)` : ''}. Set a PIN for anyone who will use the Branch Time Clock.`);
    }
    load();
  };
  const loginById = useMemo(() => Object.fromEntries(logins.map(l => [l.id, l])), [logins]);
  const visible = staff.filter(s => showInactive || s.status === 'active');

  const openNew = () => { setForm({ ...emptyForm, branch_id: defaultBranchId }); setEditing('new'); };
  const openEdit = (s: StaffMember) => {
    setForm({
      full_name: s.full_name,
      position: s.position || '',
      employment_type: s.employment_type,
      hourly_rate: s.hourly_rate === null ? '' : String(s.hourly_rate),
      profile_id: s.profile_id || NONE,
      status: s.status,
      branch_id: s.branch_id || defaultBranchId,
    });
    setEditing(s);
  };

  const save = async () => {
    if (!editing) return;
    if (!form.full_name.trim()) { showError('Name is required.'); return; }
    if (!form.branch_id) { showError('Choose a branch.'); return; }
    const rate = form.hourly_rate.trim() === '' ? null : Number(form.hourly_rate);
    if (rate !== null && (Number.isNaN(rate) || rate < 0)) { showError('Hourly rate must be a positive number.'); return; }
    const payload = {
      full_name: form.full_name.trim(),
      position: form.position.trim() || null,
      employment_type: form.employment_type,
      hourly_rate: rate,
      profile_id: form.profile_id === NONE ? null : form.profile_id,
      status: form.status,
      branch_id: form.branch_id,
      updated_at: new Date().toISOString(),
    };
    setSaving(true);
    try {
      const { error } = editing === 'new'
        ? await supabase.from('staff_members').insert(payload)
        : await supabase.from('staff_members').update(payload).eq('id', editing.id);
      if (error) throw error;
      showSuccess(editing === 'new' ? 'Staff member added.' : 'Staff member updated.');
      setEditing(null);
      load();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: StaffMember) => {
    if (!(await confirm('Delete staff member', `Delete ${s.full_name}? Their schedule is removed too. Staff with attendance records can only be set to Inactive.`))) return;
    const { error } = await supabase.from('staff_members').delete().eq('id', s.id);
    if (error) { showError(errorMessage(error)); return; }
    showSuccess('Staff member deleted.');
    load();
  };

  const savePin = async (clear = false) => {
    if (!pinFor) return;
    if (!clear && !/^\d{4,6}$/.test(pinValue)) { showError('PIN must be 4 to 6 digits.'); return; }
    const { error } = await supabase.rpc('fn_set_staff_pin', { p_staff_id: pinFor.id, p_pin: clear ? null : pinValue });
    if (error) { showError(errorMessage(error)); return; }
    showSuccess(clear ? 'PIN removed.' : `PIN set for ${pinFor.full_name}.`);
    setPinFor(null);
    setPinValue('');
    load();
  };

  if (!branch && !isAll) return <PageShell><PageHeader title="Staff Directory" actions={<BranchFilter />} /><NoBranchNotice /></PageShell>;

  return (
    <PageShell>
      <PageHeader
        title="Staff Directory"
        description={`People on the schedule at ${branch ? branch.name : 'all branches'}. Staff do not need a login: give them a PIN for the Branch Time Clock.`}
        actions={
          <>
            <BranchFilter />
            <Button variant="outline" size="sm" onClick={() => setShowInactive(v => !v)}>
              {showInactive ? 'Hide inactive' : 'Show inactive'}
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={openImport} disabled={importable.length === 0} title={importable.length === 0 ? 'Every user is already linked' : undefined}>
              <Users className="h-4 w-4 mr-1" /> Import existing users
            </Button>
            <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add staff</Button>
          </>
        }
      />

      {visible.length === 0 && !loading ? (
        <EmptyState title="No staff yet" icon={<UserRound className="h-8 w-8" />}>
          Add your crew here, then create shift templates and build the schedule.
        </EmptyState>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <button type="button" onClick={() => setHistoryFor(s)} className="hover:underline text-left">{s.full_name}</button>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{nameOfBranch(s.branch_id)}</TableCell>
                    <TableCell>{s.position || '—'}</TableCell>
                    <TableCell>{EMPLOYMENT_LABELS[s.employment_type]}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.profile_id ? (loginById[s.profile_id]?.email || 'Linked') : 'None'}
                    </TableCell>
                    <TableCell>
                      {pins[s.id] ? <Badge variant="secondary">Set</Badge> : <Badge variant="outline">Not set</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === 'active' ? 'default' : 'outline'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" title="Attendance history" aria-label={`Attendance history for ${s.full_name}`} onClick={() => setHistoryFor(s)}>
                        <CalendarSearch className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Set PIN" aria-label={`Set PIN for ${s.full_name}`} onClick={() => { setPinFor(s); setPinValue(''); }}>
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Edit" aria-label={`Edit ${s.full_name}`} onClick={() => openEdit(s)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Delete" aria-label={`Delete ${s.full_name}`} onClick={() => remove(s)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={editing !== null} onOpenChange={o => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Add staff member' : 'Edit staff member'}</DialogTitle>
            <DialogDescription>Staff appear on the schedule, time clock and leave of the branch you pick.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Branch</Label>
              <Select value={form.branch_id} onValueChange={v => setForm({ ...form, branch_id: v })} disabled={branchOptions.length <= 1}>
                <SelectTrigger><SelectValue placeholder="Choose branch" /></SelectTrigger>
                <SelectContent>
                  {branchOptions.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wf-name">Full name</Label>
              <Input id="wf-name" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="wf-pos">Position</Label>
                <Input id="wf-pos" placeholder="Cook, Cashier…" value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Employment</Label>
                <Select value={form.employment_type} onValueChange={v => setForm({ ...form, employment_type: v as StaffMember['employment_type'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="wf-rate">Hourly rate (₱, optional)</Label>
                <Input id="wf-rate" inputMode="decimal" value={form.hourly_rate} onChange={e => setForm({ ...form, hourly_rate: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v as StaffMember['status'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Link to login (optional)</Label>
              <Select value={form.profile_id} onValueChange={v => setForm({ ...form, profile_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No login (PIN only)</SelectItem>
                  {logins
                    .filter(l => (!linkedIds.has(l.id) && !linkedAnywhere.has(l.id)) || (editing !== 'new' && editing?.profile_id === l.id))
                    .map(l => (
                      <SelectItem key={l.id} value={l.id}>
                        {(l.full_name || l.email)} · {l.role_name.replace('_', ' ')}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Linked staff can use My Time Clock on their own phone.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import existing users</DialogTitle>
            <DialogDescription>
              Creates a staff record for each ticked user, linked to their login, at the branch shown. {canImportAnyBranch ? 'Each user goes to the branch on their login; you can change it.' : `Staff are added to ${nameOfBranch(defaultBranchId)}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{importPicked.size} of {importable.length} selected</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setImportPicked(new Set(importable.map(l => l.id)))}>Select all</Button>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => setImportPicked(new Set())}>Clear</Button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
            {importable.length === 0 && <p className="p-4 text-sm text-muted-foreground">Every user is already linked to a staff record.</p>}
            {importable.map(l => (
              <label key={l.id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50">
                <input type="checkbox" checked={importPicked.has(l.id)} onChange={() => togglePicked(l.id)} aria-label={`Import ${displayName(l)}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{displayName(l)}</span>
                  <span className="block text-xs text-muted-foreground truncate">{l.email}</span>
                </span>
                <span className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[11px] capitalize">{l.role_name.replace('_', ' ')}</span>
                  {canImportAnyBranch ? (
                    <select
                      value={importBranch[l.id] || defaultBranchId}
                      onChange={e => setImportBranch(m => ({ ...m, [l.id]: e.target.value }))}
                      onClick={e => e.stopPropagation()}
                      aria-label={`Branch for ${displayName(l)}`}
                      className="h-7 max-w-[150px] rounded-md border bg-background px-1.5 text-[11px]"
                    >
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">{l.branch_id ? branchName[l.branch_id] || 'This branch' : 'No branch → ' + nameOfBranch(defaultBranchId)}</span>
                  )}
                  {l.branch_id && !branchName[l.branch_id] && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">Assigned branch not found</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={runImport} disabled={importing || importPicked.size === 0}>
              {importing ? 'Importing…' : `Import ${importPicked.size || ''}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StaffHistoryDialog
        staff={historyFor}
        leaveTypeName={id => leaveTypeNames[id] || 'Leave'}
        onClose={() => setHistoryFor(null)}
      />

      <Dialog open={pinFor !== null} onOpenChange={o => { if (!o) setPinFor(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Kiosk PIN</DialogTitle>
            <DialogDescription>{pinFor?.full_name} uses this PIN on the Branch Time Clock. 5 wrong tries locks it for 15 minutes.</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            placeholder="4–6 digits"
            value={pinValue}
            onChange={e => setPinValue(e.target.value.replace(/\D/g, ''))}
            aria-label="New PIN"
          />
          <DialogFooter className="gap-2">
            {pinFor && pins[pinFor.id] && <Button variant="outline" onClick={() => savePin(true)}>Remove PIN</Button>}
            <Button onClick={() => savePin(false)}>Save PIN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
};

export default StaffDirectory;
