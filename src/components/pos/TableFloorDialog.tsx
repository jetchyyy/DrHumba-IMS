import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useModal } from '../../contexts/ModalContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  ReloadIcon as Spinner,
  CheckIcon as Check,
  TableIcon,
} from '@radix-ui/react-icons';
import { Combine, Unlink, ArrowLeftRight, Plus } from 'lucide-react';
import type { RestaurantTable, PosTab } from './types';
import { formatPHP } from './types';
import {
  classifyMergeSelection,
  formatTableGroupLabel,
  getCombinedTableCapacity,
  sortRestaurantTables,
} from './tableUtils';

interface ActiveTabSummary {
  id: string;
  table_id: string;
  merged_tables: RestaurantTable[];
  server_id?: string | null;
  server_name?: string | null;
  pax_count: number;
  status: 'open' | 'billed_out';
  notes?: string | null;
  discount_type?: string | null;
  discount_amount?: number;
  discount_metadata?: any[];
  created_at: string;
  total_amount: number;
  items_count: number;
  combined_capacity: number;
}

interface TableWithTab extends RestaurantTable {
  active_tab?: ActiveTabSummary | null;
}

interface TableFloorDialogProps {
  open: boolean;
  onClose: () => void;
  branchId: string;
  activeTableId?: string | null;
  activeTabId?: string | null;
  isOnline?: boolean;
  initialMode?: 'normal' | 'merge' | 'manage';
  onSelectTable: (table: RestaurantTable, tab: PosTab | null) => void;
}

export const TableFloorDialog: React.FC<TableFloorDialogProps> = ({
  open,
  onClose,
  branchId,
  activeTableId,
  activeTabId,
  isOnline = true,
  initialMode = 'normal',
  onSelectTable,
}) => {
  const { profile } = useAuth();
  const { showError, showSuccess, confirm } = useModal();

  const [tables, setTables] = useState<TableWithTab[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeZone, setActiveZone] = useState<string>('All');

  // Merge Mode state
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [swapMergeOrder, setSwapMergeOrder] = useState(false);

  // Open Table(s) Dialog state (supports 1 or more vacant tables)
  const [openingTables, setOpeningTables] = useState<RestaurantTable[]>([]);
  const [paxCount, setPaxCount] = useState<number>(2);
  const [serverName, setServerName] = useState<string>('');
  const [tableNotes, setTableNotes] = useState<string>('');
  const [openingSubmitting, setOpeningSubmitting] = useState(false);

  // Manage / Unmerge Sub-Dialog state
  const [managingTabId, setManagingTabId] = useState<string | null>(null);
  const [unmergingTableId, setUnmergingTableId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(0);
  const wasOpenRef = useRef(false);
  const lastBranchIdRef = useRef<string | null>(null);

  const buildPosTab = (summary: ActiveTabSummary): PosTab => ({
    id: summary.id,
    table_id: summary.table_id,
    merged_tables: summary.merged_tables,
    branch_id: branchId,
    server_id: summary.server_id,
    server_name: summary.server_name,
    pax_count: summary.pax_count,
    status: summary.status,
    notes: summary.notes,
    discount_type: summary.discount_type,
    discount_amount: summary.discount_amount,
    discount_metadata: summary.discount_metadata,
    created_at: summary.created_at,
  });

  const loadTablesAndTabs = async (): Promise<TableWithTab[]> => {
    if (!branchId) return [];
    setLoading(true);
    try {
      const { data: tablesData, error: tablesErr } = await supabase
        .from('restaurant_tables')
        .select('*')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('table_number', { ascending: true });

      if (tablesErr) throw tablesErr;

      const { data: tabsData, error: tabsErr } = await supabase
        .from('pos_tabs')
        .select(`
          id,
          table_id,
          server_id,
          server_name,
          pax_count,
          status,
          notes,
          created_at,
          discount_type,
          discount_amount,
          discount_metadata,
          pos_tab_tables (
            table_id,
            is_primary
          ),
          pos_tab_items (
            quantity,
            price
          )
        `)
        .eq('branch_id', branchId)
        .in('status', ['open', 'billed_out']);

      if (tabsErr) throw tabsErr;

      const tableById = new Map<string, RestaurantTable>(
        (tablesData || []).map((tbl: RestaurantTable) => [tbl.id, tbl])
      );

      const tabsByTableId = new Map<string, ActiveTabSummary>();
      (tabsData || []).forEach((t: any) => {
        const items = Array.isArray(t.pos_tab_items) ? t.pos_tab_items : [];
        const rawTotal = items.reduce(
          (acc: number, item: any) => acc + Number(item.quantity || 1) * Number(item.price || 0),
          0
        );
        const disc = Number(t.discount_amount || 0);
        const netTotal = Math.max(0, rawTotal - disc);

        const rawLinks = Array.isArray(t.pos_tab_tables) ? t.pos_tab_tables : [];
        const sortedLinks = [...rawLinks].sort((a: any, b: any) => {
          if (Boolean(a.is_primary) !== Boolean(b.is_primary)) {
            return a.is_primary ? -1 : 1;
          }
          const tblA = tableById.get(a.table_id)?.table_number || '';
          const tblB = tableById.get(b.table_id)?.table_number || '';
          return tblA.localeCompare(tblB, undefined, { numeric: true });
        });

        const mergedTables: RestaurantTable[] = [];
        const seenTableIds = new Set<string>();
        for (const link of sortedLinks) {
          const tbl = tableById.get(link.table_id);
          if (tbl && !seenTableIds.has(tbl.id)) {
            seenTableIds.add(tbl.id);
            mergedTables.push(tbl);
          }
        }
        if (t.table_id && !seenTableIds.has(t.table_id)) {
          const primaryTbl = tableById.get(t.table_id);
          if (primaryTbl) {
            seenTableIds.add(primaryTbl.id);
            mergedTables.unshift(primaryTbl);
          }
        }

        const summary: ActiveTabSummary = {
          id: t.id,
          table_id: t.table_id,
          merged_tables: mergedTables,
          server_id: t.server_id,
          server_name: t.server_name,
          pax_count: t.pax_count,
          status: t.status,
          notes: t.notes,
          discount_type: t.discount_type,
          discount_amount: disc,
          discount_metadata: Array.isArray(t.discount_metadata) ? t.discount_metadata : [],
          created_at: t.created_at,
          total_amount: netTotal,
          items_count: items.reduce((acc: number, item: any) => acc + Number(item.quantity || 1), 0),
          combined_capacity: getCombinedTableCapacity(mergedTables),
        };

        mergedTables.forEach(tbl => {
          tabsByTableId.set(tbl.id, summary);
        });
      });

      const combined: TableWithTab[] = (tablesData || []).map((tbl: RestaurantTable) => {
        const tab = tabsByTableId.get(tbl.id) || null;
        return {
          ...tbl,
          active_tab: tab,
          status: tab
            ? (tab.status === 'billed_out' ? 'billed_out' : 'occupied')
            : (tbl.status === 'occupied' || tbl.status === 'billed_out' ? 'available' : tbl.status),
        };
      });

      const sortedCombined = sortRestaurantTables(combined);
      setTables(sortedCombined);
      setNowMs(Date.now());
      return sortedCombined;
    } catch (err: any) {
      console.error('Failed to load tables and tabs:', err);
      showError(err.message || 'Failed to load table floor');
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !branchId) {
      wasOpenRef.current = false;
      return;
    }

    const isFreshOpen = !wasOpenRef.current || lastBranchIdRef.current !== branchId;
    if (!isFreshOpen) return;

    wasOpenRef.current = true;
    lastBranchIdRef.current = branchId;

    setSwapMergeOrder(false);
    setOpeningTables([]);
    setNowMs(Date.now());

    if (initialMode === 'merge' && isOnline) {
      setMergeMode(true);
      setManagingTabId(null);
      setSelectedTableIds(activeTableId ? [activeTableId] : []);
    } else if (initialMode === 'manage' && activeTabId) {
      setMergeMode(false);
      setSelectedTableIds([]);
      setManagingTabId(activeTabId);
    } else {
      setMergeMode(false);
      setSelectedTableIds([]);
      setManagingTabId(null);
    }

    loadTablesAndTabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId, initialMode, activeTabId, activeTableId, isOnline]);

  const zones = ['All', ...Array.from(new Set(tables.map(t => t.zone).filter(Boolean)))];

  const filteredTables = activeZone === 'All'
    ? tables
    : tables.filter(t => t.zone === activeZone);

  const availableCount = tables.filter(t => !t.active_tab && t.status === 'available').length;
  const occupiedCount = tables.filter(t => t.active_tab?.status === 'open').length;
  const billedOutCount = tables.filter(t => t.active_tab?.status === 'billed_out').length;

  const selectedTables = useMemo(
    () =>
      selectedTableIds
        .map(id => tables.find(t => t.id === id))
        .filter((t): t is TableWithTab => Boolean(t)),
    [selectedTableIds, tables]
  );

  const mergeClassification = useMemo(
    () => classifyMergeSelection(selectedTables),
    [selectedTables]
  );

  const managingTab = useMemo(() => {
    if (!managingTabId) return null;
    return tables.find(t => t.active_tab?.id === managingTabId)?.active_tab || null;
  }, [managingTabId, tables]);

  const openNewTabPrompt = (targetTables: RestaurantTable[]) => {
    const combinedCap = getCombinedTableCapacity(targetTables);
    setOpeningTables(targetTables);
    setPaxCount(Math.min(combinedCap, Math.max(2, targetTables.length * 2)));
    setServerName(profile?.full_name || profile?.email?.split('@')[0] || '');
    setTableNotes('');
  };

  const toggleMergeSelection = (tbl: TableWithTab) => {
    setSwapMergeOrder(false);
    setSelectedTableIds(prev => {
      if (prev.includes(tbl.id)) {
        return prev.filter(id => id !== tbl.id);
      }
      // If clicking another table belonging to an already-selected active tab, keep selection clean
      if (tbl.active_tab) {
        const alreadySelectedSameTab = prev.some(
          id => tables.find(t => t.id === id)?.active_tab?.id === tbl.active_tab?.id
        );
        if (alreadySelectedSameTab) {
          return prev.filter(
            id => tables.find(t => t.id === id)?.active_tab?.id !== tbl.active_tab?.id
          );
        }
      }
      return [...prev, tbl.id];
    });
  };

  const handleTableClick = (tbl: TableWithTab) => {
    if (mergeMode) {
      toggleMergeSelection(tbl);
      return;
    }

    if (tbl.active_tab) {
      const primaryTable = tbl.active_tab.merged_tables[0] || tbl;
      onSelectTable(primaryTable, buildPosTab(tbl.active_tab));
      onClose();
    } else {
      openNewTabPrompt([tbl]);
    }
  };

  const handleStartTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (openingTables.length === 0 || !branchId) return;

    setOpeningSubmitting(true);
    try {
      const tableIds = openingTables.map(t => t.id);
      const { data: newTab, error } = await supabase.rpc('fn_open_tab_with_tables', {
        p_branch_id: branchId,
        p_table_ids: tableIds,
        p_server_id: profile?.id || null,
        p_server_name: serverName.trim() || profile?.full_name || 'Staff',
        p_pax_count: Math.max(1, Number(paxCount) || 1),
        p_notes: tableNotes.trim() || null,
      });

      if (error) throw error;

      const label = formatTableGroupLabel(openingTables);
      showSuccess(`Table ${label} opened!`);
      onSelectTable(openingTables[0], {
        ...(newTab as PosTab),
        merged_tables: openingTables,
      });
      setOpeningTables([]);
      setMergeMode(false);
      setSelectedTableIds([]);
      onClose();
    } catch (err: any) {
      console.error('Error starting tab:', err);
      showError(err.message || 'Failed to start table tab');
    } finally {
      setOpeningSubmitting(false);
    }
  };

  const syncSelectedTabWithPos = (updatedTables: TableWithTab[], tabId: string, closeAfter: boolean) => {
    const matched = updatedTables.find(t => t.active_tab?.id === tabId);
    if (matched?.active_tab) {
      const primaryTable = matched.active_tab.merged_tables[0] || matched;
      onSelectTable(primaryTable, buildPosTab(matched.active_tab));
      if (closeAfter) {
        onClose();
      }
    }
  };

  const handleExecuteMergeAction = async () => {
    if (!isOnline) {
      showError('Merging tables requires an online connection.');
      return;
    }

    if (mergeClassification.mode === 'open_merged') {
      openNewTabPrompt(mergeClassification.tables);
      return;
    }

    if (mergeClassification.mode === 'attach_to_tab') {
      setMergeSubmitting(true);
      try {
        const vacantIds = mergeClassification.vacantTables.map(t => t.id);
        const { error } = await supabase.rpc('fn_attach_tables_to_tab', {
          p_tab_id: mergeClassification.targetTabId,
          p_table_ids: vacantIds,
        });
        if (error) throw error;

        const refreshed = await loadTablesAndTabs();
        const targetTab = refreshed.find(t => t.active_tab?.id === mergeClassification.targetTabId)?.active_tab;
        const label = formatTableGroupLabel(targetTab?.merged_tables || mergeClassification.vacantTables);
        showSuccess(`Tables merged into ${label}!`);
        setMergeMode(false);
        setSelectedTableIds([]);

        if (activeTabId === mergeClassification.targetTabId || !activeTabId) {
          syncSelectedTabWithPos(refreshed, mergeClassification.targetTabId, true);
        }
      } catch (err: any) {
        console.error('Failed to attach tables:', err);
        showError(err.message || 'Failed to attach tables to running bill');
      } finally {
        setMergeSubmitting(false);
      }
      return;
    }

    if (mergeClassification.mode === 'merge_tabs') {
      const targetTabId = swapMergeOrder
        ? mergeClassification.sourceTabId
        : mergeClassification.targetTabId;
      const sourceTabId = swapMergeOrder
        ? mergeClassification.targetTabId
        : mergeClassification.sourceTabId;

      const targetSummary = tables.find(t => t.active_tab?.id === targetTabId)?.active_tab;
      const sourceSummary = tables.find(t => t.active_tab?.id === sourceTabId)?.active_tab;
      if (!targetSummary || !sourceSummary) return;

      const targetLabel = formatTableGroupLabel(targetSummary.merged_tables);
      const sourceLabel = formatTableGroupLabel(sourceSummary.merged_tables);
      const warnings: string[] = [];
      if (targetSummary.status === 'billed_out' || sourceSummary.status === 'billed_out') {
        warnings.push('The combined bill will return to Occupied status so you can print an updated Bill Out.');
      }
      if (
        targetSummary.discount_type ||
        (targetSummary.discount_amount || 0) > 0 ||
        sourceSummary.discount_type ||
        (sourceSummary.discount_amount || 0) > 0
      ) {
        warnings.push('Pre-bill discount on the selected tab(s) will be cleared—re-apply discounts on the combined bill.');
      }

      const proceed = await confirm(
        `Merge Table ${sourceLabel} into Table ${targetLabel}?`,
        `This combines ${sourceSummary.items_count} item(s) and ${sourceSummary.pax_count} guest(s) from Table ${sourceLabel} into Table ${targetLabel}'s running bill.${warnings.length ? `\n\nNote: ${warnings.join(' ')}` : ''}`
      );
      if (!proceed) return;

      setMergeSubmitting(true);
      try {
        const { data, error } = await supabase.rpc('fn_merge_tabs', {
          p_target_tab_id: targetTabId,
          p_source_tab_id: sourceTabId,
        });
        if (error) throw error;

        const refreshed = await loadTablesAndTabs();
        const mergedSummary = refreshed.find(t => t.active_tab?.id === targetTabId)?.active_tab;
        const mergedLabel = formatTableGroupLabel(mergedSummary?.merged_tables);

        if (data?.discount_cleared) {
          showSuccess(`Merged into Table ${mergedLabel}. Please re-apply any discount on the combined bill.`);
        } else {
          showSuccess(`Merged Table ${sourceLabel} into Table ${targetLabel}!`);
        }

        setMergeMode(false);
        setSelectedTableIds([]);
        setSwapMergeOrder(false);
        syncSelectedTabWithPos(refreshed, targetTabId, true);
      } catch (err: any) {
        console.error('Failed to merge tabs:', err);
        showError(err.message || 'Failed to merge running bills');
      } finally {
        setMergeSubmitting(false);
      }
    }
  };

  const handleUnmergeTable = async (tab: ActiveTabSummary, tbl: RestaurantTable) => {
    if (!isOnline) {
      showError('Unmerging tables requires an online connection.');
      return;
    }
    if (tab.merged_tables.length < 2) return;

    const proceed = await confirm(
      `Unmerge Table ${tbl.table_number}?`,
      `Table ${tbl.table_number} will be released back to Vacant. All ordered items remain on the running bill.`
    );
    if (!proceed) return;

    setUnmergingTableId(tbl.id);
    try {
      const { error } = await supabase.rpc('fn_unmerge_table_from_tab', {
        p_tab_id: tab.id,
        p_table_id: tbl.id,
      });
      if (error) throw error;

      const refreshed = await loadTablesAndTabs();
      showSuccess(`Table ${tbl.table_number} unmerged and marked Vacant.`);

      if (activeTabId === tab.id) {
        syncSelectedTabWithPos(refreshed, tab.id, false);
      }
    } catch (err: any) {
      console.error('Failed to unmerge table:', err);
      showError(err.message || 'Failed to unmerge table');
    } finally {
      setUnmergingTableId(null);
    }
  };

  const getElapsedTime = (createdStr?: string) => {
    if (!createdStr || !nowMs) return '';
    const diffMs = Math.max(0, nowMs - new Date(createdStr).getTime());
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  const renderMergeFooter = () => {
    if (!mergeMode) return null;

    let actionLabel = '';
    let canExecute = false;
    let swapContent: React.ReactNode = null;

    if (mergeClassification.mode === 'open_merged') {
      const label = formatTableGroupLabel(mergeClassification.tables);
      actionLabel = `Open Merged (${label} • ${mergeClassification.totalCapacity} Pax)`;
      canExecute = true;
    } else if (mergeClassification.mode === 'attach_to_tab') {
      const targetSummary = tables.find(t => t.active_tab?.id === mergeClassification.targetTabId)?.active_tab;
      const targetLabel = formatTableGroupLabel(targetSummary?.merged_tables);
      const addLabel = formatTableGroupLabel(mergeClassification.vacantTables);
      actionLabel = `Attach ${addLabel} to ${targetLabel}`;
      canExecute = true;
    } else if (mergeClassification.mode === 'merge_tabs') {
      const targetId = swapMergeOrder ? mergeClassification.sourceTabId : mergeClassification.targetTabId;
      const sourceId = swapMergeOrder ? mergeClassification.targetTabId : mergeClassification.sourceTabId;
      const targetSummary = tables.find(t => t.active_tab?.id === targetId)?.active_tab;
      const sourceSummary = tables.find(t => t.active_tab?.id === sourceId)?.active_tab;
      const targetLabel = formatTableGroupLabel(targetSummary?.merged_tables);
      const sourceLabel = formatTableGroupLabel(sourceSummary?.merged_tables);
      actionLabel = `Combine ${sourceLabel} → ${targetLabel}`;
      canExecute = true;
      swapContent = (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSwapMergeOrder(prev => !prev)}
          className="h-8 text-xs gap-1.5"
          title="Swap which table group stays primary"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          Swap Target
        </Button>
      );
    }

    return (
      <div className="mt-2 pt-3 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-muted/30 -mx-6 px-6 -mb-6 pb-5 rounded-b-lg">
        <div className="text-xs text-muted-foreground">
          {mergeClassification.mode === 'empty' || mergeClassification.mode === 'invalid' ? (
            <span>{mergeClassification.hint}</span>
          ) : (
            <span className="font-medium text-foreground">
              {selectedTables.length} table(s) selected ({formatTableGroupLabel(selectedTables)})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {swapContent}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setMergeMode(false);
              setSelectedTableIds([]);
              setSwapMergeOrder(false);
            }}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canExecute || mergeSubmitting}
            onClick={handleExecuteMergeAction}
            className="h-8 text-xs font-bold gap-1.5 bg-primary text-primary-foreground"
          >
            {mergeSubmitting ? (
              <Spinner className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Combine className="w-3.5 h-3.5" />
            )}
            <span>{actionLabel || 'Select Tables to Merge'}</span>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-6">
          <DialogHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6">
              <div>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <TableIcon className="w-5 h-5 text-primary" />
                  <span>Table Floor Plan & Running Bills</span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {mergeMode
                    ? 'Select vacant tables to open together, an active tab + vacant tables, or two active tabs to combine.'
                    : 'Select a table to open a new tab, view a running bill, or merge tables.'}
                </DialogDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Button
                  type="button"
                  variant={mergeMode ? 'default' : 'outline'}
                  size="sm"
                  disabled={!isOnline}
                  onClick={() => {
                    setMergeMode(prev => {
                      const next = !prev;
                      setSelectedTableIds([]);
                      setSwapMergeOrder(false);
                      return next;
                    });
                  }}
                  className="h-7 text-xs font-bold gap-1.5"
                  title={isOnline ? 'Merge or combine tables flexibly' : 'Merging tables requires an online connection'}
                >
                  <Combine className="w-3.5 h-3.5" />
                  <span>{mergeMode ? 'Exit Merge Mode' : 'Merge Tables'}</span>
                </Button>

                {/* Status Counters */}
                <Badge variant="outline" className="text-emerald-600 bg-emerald-500/10 border-emerald-500/30 gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {availableCount} Vacant
                </Badge>
                <Badge variant="outline" className="text-rose-600 bg-rose-500/10 border-rose-500/30 gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  {occupiedCount} Occupied
                </Badge>
                <Badge variant="outline" className="text-amber-600 bg-amber-500/10 border-amber-500/30 gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  {billedOutCount} Billed Out
                </Badge>
              </div>
            </div>
          </DialogHeader>

          {/* Zones Tabs */}
          {zones.length > 1 && (
            <div className="flex gap-1.5 p-1 bg-muted/60 rounded-xl border overflow-x-auto text-xs font-medium">
              {zones.map(z => (
                <button
                  key={z}
                  onClick={() => setActiveZone(z)}
                  className={`px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                    activeZone === z
                      ? 'bg-background text-foreground font-bold shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {z} {z === 'All' ? `(${tables.length})` : `(${tables.filter(t => t.zone === z).length})`}
                </button>
              ))}
            </div>
          )}

          {/* Tables Grid */}
          <div className="flex-1 overflow-y-auto min-h-[300px] max-h-[500px] py-2">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
                <Spinner className="w-6 h-6 animate-spin text-primary" />
                <span className="text-xs">Loading tables...</span>
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center p-6 text-muted-foreground">
                <TableIcon className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-sm font-semibold text-foreground">No tables found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add tables under Branches &rarr; Configure Tables to enable table service.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                {filteredTables.map(tbl => {
                  const hasTab = Boolean(tbl.active_tab);
                  const isBilledOut = tbl.active_tab?.status === 'billed_out';
                  const isMergedGroup = (tbl.active_tab?.merged_tables.length || 0) > 1;
                  const mergedLabel = isMergedGroup
                    ? formatTableGroupLabel(tbl.active_tab?.merged_tables)
                    : '';
                  const isCurrentActive = activeTabId
                    ? tbl.active_tab?.id === activeTabId
                    : activeTableId === tbl.id;
                  const isSelectedDirect = selectedTableIds.includes(tbl.id);
                  const isSelectedViaSibling = Boolean(
                    mergeMode &&
                    tbl.active_tab &&
                    selectedTables.some(s => s.active_tab?.id === tbl.active_tab?.id)
                  );
                  const isSelected = isSelectedDirect || isSelectedViaSibling;

                  let borderClass = 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500 hover:shadow-md';
                  let badgeText = 'Vacant';
                  let badgeClass = 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300';

                  if (isBilledOut) {
                    borderClass = 'border-amber-500/60 bg-amber-500/10 hover:border-amber-500 hover:shadow-md';
                    badgeText = 'Billed Out';
                    badgeClass = 'bg-amber-500 text-black font-bold';
                  } else if (hasTab) {
                    borderClass = 'border-rose-500/50 bg-rose-500/10 hover:border-rose-500 hover:shadow-md';
                    badgeText = 'Occupied';
                    badgeClass = 'bg-rose-500 text-white font-bold';
                  }

                  if (isSelected) {
                    borderClass += ' ring-2 ring-primary ring-offset-2 border-primary';
                  } else if (isCurrentActive) {
                    borderClass += ' ring-2 ring-primary ring-offset-2';
                  }

                  return (
                    <div
                      key={tbl.id}
                      onClick={() => handleTableClick(tbl)}
                      className={`cursor-pointer border-2 rounded-2xl p-4 flex flex-col justify-between transition-all select-none ${borderClass}`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-1">
                          <span className="text-base font-black tracking-tight text-foreground">
                            {tbl.table_number}
                          </span>
                          <div className="flex items-center gap-1">
                            {mergeMode && (
                              <span
                                className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] font-bold ${
                                  isSelected
                                    ? 'bg-primary border-primary text-primary-foreground'
                                    : 'border-muted-foreground/40 bg-background/60'
                                }`}
                              >
                                {isSelected && <Check className="w-3 h-3" />}
                              </span>
                            )}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ${badgeClass}`}>
                              {badgeText}
                            </span>
                          </div>
                        </div>

                        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
                          <span>{tbl.capacity} Pax</span>
                          <span>&bull;</span>
                          <span className="truncate">{tbl.zone}</span>
                        </div>

                        {isMergedGroup && (
                          <div className="mt-2 flex items-center justify-between gap-1">
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 h-5 border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-bold truncate"
                              title={`Merged group: ${mergedLabel}`}
                            >
                              <Combine className="w-2.5 h-2.5 mr-1 shrink-0" />
                              {mergedLabel}
                            </Badge>
                            {!mergeMode && isOnline && tbl.active_tab && (
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  setManagingTabId(tbl.active_tab!.id);
                                }}
                                className="text-[10px] font-bold text-muted-foreground hover:text-foreground underline shrink-0"
                                title="Manage or unmerge tables in this group"
                              >
                                Manage
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {hasTab ? (
                        <div className="mt-3 pt-2.5 border-t border-border/60 space-y-1">
                          <div className="flex items-center justify-between text-xs font-bold text-foreground">
                            <span>{formatPHP(tbl.active_tab?.total_amount || 0)}</span>
                            <span className="text-[10px] font-normal text-muted-foreground">
                              {getElapsedTime(tbl.active_tab?.created_at)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>{tbl.active_tab?.items_count || 0} items &bull; {tbl.active_tab?.pax_count} pax</span>
                            <span className="truncate max-w-[80px]" title={tbl.active_tab?.server_name || ''}>
                              {tbl.active_tab?.server_name || 'Staff'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 pt-2.5 border-t border-border/40 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center justify-between">
                          <span>{mergeMode ? (isSelected ? 'Selected' : '+ Select') : '+ Open Table'}</span>
                          <span className="text-xs">&rarr;</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {renderMergeFooter()}
        </DialogContent>
      </Dialog>

      {/* Start / Open Table(s) Sub-Dialog */}
      {openingTables.length > 0 && (
        <Dialog open={openingTables.length > 0} onOpenChange={isOpen => { if (!isOpen) setOpeningTables([]); }}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2 flex-wrap">
                <TableIcon className="w-4 h-4 text-primary" />
                <span>
                  Open {openingTables.length > 1 ? 'Merged Tables' : ''} {formatTableGroupLabel(openingTables)}
                </span>
                <Badge variant="outline" className="text-xs">
                  Max: {getCombinedTableCapacity(openingTables)} Pax
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {openingTables.length > 1
                  ? `Start a single running bill combining ${openingTables.length} tables.`
                  : 'Start a new dining session and running bill for this table.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleStartTab} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Number of Guests (Pax) *</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    required
                    value={paxCount}
                    onChange={e => setPaxCount(parseInt(e.target.value, 10) || 1)}
                    className="text-sm font-semibold"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    {[2, 4, 6, 8].map(num => (
                      <Button
                        key={num}
                        type="button"
                        variant={paxCount === num ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPaxCount(num)}
                        className="h-9 w-9 text-xs p-0"
                      >
                        {num}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Assigned Waiter / Server Name</Label>
                <Input
                  placeholder="e.g. Maria S."
                  value={serverName}
                  onChange={e => setServerName(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Special Table Notes (Optional)</Label>
                <Input
                  placeholder="e.g. Birthday celebration, High chair requested"
                  value={tableNotes}
                  onChange={e => setTableNotes(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpeningTables([])}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={openingSubmitting}
                  className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                >
                  {openingSubmitting ? (
                    <Spinner className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Open {openingTables.length > 1 ? 'Merged Tables' : 'Table'} & Take Order
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Manage / Unmerge Tables Sub-Dialog */}
      {managingTab && (
        <Dialog open={Boolean(managingTab)} onOpenChange={isOpen => { if (!isOpen) setManagingTabId(null); }}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <Combine className="w-4 h-4 text-primary" />
                <span>Manage Tables — {formatTableGroupLabel(managingTab.merged_tables)}</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Unmerge tables no longer needed by this party, or attach another table.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2.5 pt-2">
              {managingTab.merged_tables.map((tbl, idx) => {
                const isOnlyTable = managingTab.merged_tables.length <= 1;
                const isPrimary = idx === 0 || tbl.id === managingTab.table_id;
                return (
                  <div
                    key={tbl.id}
                    className="flex items-center justify-between p-3 rounded-xl border bg-muted/20"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm">{tbl.table_number}</span>
                        {isPrimary && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                            Primary
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {tbl.capacity} Pax &bull; {tbl.zone}
                      </span>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isOnlyTable || unmergingTableId === tbl.id || !isOnline}
                      onClick={() => handleUnmergeTable(managingTab, tbl)}
                      className="h-8 text-xs gap-1.5 text-rose-600 hover:text-rose-700 border-rose-500/30 hover:bg-rose-500/10"
                      title={isOnlyTable ? 'At least 1 table must remain on the tab' : `Release ${tbl.table_number}`}
                    >
                      {unmergingTableId === tbl.id ? (
                        <Spinner className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Unlink className="w-3.5 h-3.5" />
                      )}
                      <span>Unmerge</span>
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center gap-2 pt-3 border-t">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isOnline}
                onClick={() => {
                  const seedTableId = managingTab.merged_tables[0]?.id || managingTab.table_id;
                  setManagingTabId(null);
                  setMergeMode(true);
                  setSelectedTableIds(seedTableId ? [seedTableId] : []);
                }}
                className="text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Attach / Merge More</span>
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={() => setManagingTabId(null)}
                className="text-xs"
              >
                Done
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
