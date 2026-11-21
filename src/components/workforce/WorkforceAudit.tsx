import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, RefreshCw, ScrollText, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';
import {
  addDaysKey,
  AUDIT_ENTITY_LABELS,
  downloadCsv,
  errorMessage,
  formatDateTime,
  localDateTimeToIso,
  todayKey,
  type StaffAuditLog,
} from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { BranchFilter, BranchTag, EmptyState, NoBranchNotice, PageHeader, PageShell } from './shared';

const PAGE_SIZE = 200;

const ACTION_STYLE: Record<string, string> = {
  created: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  filed: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  set: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  updated: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  rejected: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  deleted: 'bg-destructive/10 text-destructive',
  removed: 'bg-destructive/10 text-destructive',
};

const fieldLabel = (k: string) => k.replace(/_/g, ' ').replace(/\bid\b/, 'ID');
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const WorkforceAudit: React.FC = () => {
  const { branch, isAll, branchName } = useWorkforceBranch();
  const { showError } = useModal();
  const [from, setFrom] = useState(() => addDaysKey(todayKey(), -29));
  const [to, setTo] = useState(() => todayKey());
  const [entity, setEntity] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<StaffAuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!branch && !isAll) return;
    if (to < from) { showError('End date is before the start date.'); return; }
    setLoading(true);
    try {
      let q = supabase.from('staff_audit_logs').select('*')
        .gte('created_at', localDateTimeToIso(from, '00:00'))
        .lt('created_at', localDateTimeToIso(to, '00:00', 1))
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      // A single branch also shows tenant-wide changes (leave types, templates for all branches).
      if (branch) q = q.or(`branch_id.eq.${branch.id},branch_id.is.null`);
      if (entity !== 'all') q = q.eq('entity', entity);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as StaffAuditLog[]) || []);
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [branch, isAll, from, to, entity, showError]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => [r.summary, r.staff_name, r.actor_name].some(v => (v || '').toLowerCase().includes(q)));
  }, [rows, search]);

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const exportCsv = () => downloadCsv(`workforce_audit_${from}_${to}.csv`, [
    ['When', 'Who', 'Branch', 'Staff', 'Area', 'Action', 'What changed'],
    ...visible.map(r => [
      formatDateTime(r.created_at), r.actor_name || 'System', r.branch_id ? branchName(r.branch_id) : 'All branches',
      r.staff_name || '', AUDIT_ENTITY_LABELS[r.entity] || r.entity, r.action, r.summary,
    ]),
  ]);

  if (!branch && !isAll) return <PageShell><PageHeader title="Workforce Audit Log" actions={<BranchFilter />} /><NoBranchNotice /></PageShell>;

  return (
    <PageShell>
      <PageHeader
        title="Workforce Audit Log"
        description={`${branch ? branch.name : 'All branches'} · who changed staff, schedules, leave, PINs and attendance. Entries cannot be edited or deleted.`}
        actions={
          <>
            <BranchFilter />
            <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={visible.length === 0}><Download className="h-4 w-4 mr-1" /> CSV</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="au-from" className="text-xs">From</Label>
          <Input id="au-from" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="au-to" className="text-xs">To</Label>
          <Input id="au-to" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Area</Label>
          <Select value={entity} onValueChange={setEntity}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              {Object.entries(AUDIT_ENTITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff, person or change" className="pl-9" aria-label="Search audit log" />
        </div>
      </div>

      {visible.length === 0 && !loading ? (
        <EmptyState title="No changes in this period" icon={<ScrollText className="h-8 w-8" />} />
      ) : (
        <Card>
          <CardContent className="p-0 divide-y">
            {visible.map(r => {
              const changes = r.changes && Object.keys(r.changes).length > 0 ? r.changes : null;
              const isOpen = open.has(r.id);
              return (
                <div key={r.id} className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                    <span className="text-xs text-muted-foreground whitespace-nowrap sm:w-36 flex-shrink-0">{formatDateTime(r.created_at)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-semibold">{r.actor_name || 'System'}</span>
                        <span className="text-muted-foreground"> · </span>
                        {r.summary}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${ACTION_STYLE[r.action] || 'bg-muted text-muted-foreground'}`}>{r.action}</span>
                        <span className="text-[11px] text-muted-foreground">{AUDIT_ENTITY_LABELS[r.entity] || r.entity}</span>
                        {r.staff_name && <span className="text-[11px]">· {r.staff_name}</span>}
                        {(isAll || !r.branch_id) && <BranchTag name={r.branch_id ? branchName(r.branch_id) : 'All branches'} />}
                        {changes && (
                          <button type="button" onClick={() => toggle(r.id)} className="text-[11px] text-primary inline-flex items-center hover:underline" aria-expanded={isOpen}>
                            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} {Object.keys(changes).length} field{Object.keys(changes).length === 1 ? '' : 's'}
                          </button>
                        )}
                      </div>
                      {changes && isOpen && (
                        <div className="mt-2 rounded-md border bg-muted/30 text-xs divide-y">
                          {Object.entries(changes).map(([k, v]) => {
                            const diff = v as { from?: unknown; to?: unknown } | unknown;
                            const isDiff = typeof diff === 'object' && diff !== null && 'to' in (diff as object);
                            return (
                              <div key={k} className="grid grid-cols-[120px_1fr] gap-2 px-2 py-1.5">
                                <span className="text-muted-foreground capitalize">{fieldLabel(k)}</span>
                                <span className="break-all">
                                  {isDiff
                                    ? <><span className="line-through text-muted-foreground">{show((diff as { from?: unknown }).from)}</span> → {show((diff as { to?: unknown }).to)}</>
                                    : show(diff)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      {rows.length === PAGE_SIZE && (
        <p className="text-xs text-muted-foreground">Showing the latest {PAGE_SIZE} changes. Narrow the dates or area to see older ones.</p>
      )}
    </PageShell>
  );
};

export default WorkforceAudit;
