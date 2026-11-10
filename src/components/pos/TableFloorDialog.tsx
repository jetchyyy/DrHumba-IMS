import React, { useState, useEffect } from 'react';
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
import type { RestaurantTable, PosTab } from './types';
import { formatPHP } from './types';

interface TableWithTab extends RestaurantTable {
  active_tab?: {
    id: string;
    server_name?: string | null;
    pax_count: number;
    status: string;
    created_at: string;
    total_amount?: number;
    items_count?: number;
  } | null;
}

interface TableFloorDialogProps {
  open: boolean;
  onClose: () => void;
  branchId: string;
  activeTableId?: string | null;
  onSelectTable: (table: RestaurantTable, tab: PosTab | null) => void;
}

export const TableFloorDialog: React.FC<TableFloorDialogProps> = ({
  open,
  onClose,
  branchId,
  activeTableId,
  onSelectTable,
}) => {
  const { profile } = useAuth();
  const { showError, showSuccess } = useModal();

  const [tables, setTables] = useState<TableWithTab[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeZone, setActiveZone] = useState<string>('All');

  // Open Table Dialog state
  const [openingTable, setOpeningTable] = useState<RestaurantTable | null>(null);
  const [paxCount, setPaxCount] = useState<number>(2);
  const [serverName, setServerName] = useState<string>('');
  const [tableNotes, setTableNotes] = useState<string>('');
  const [openingSubmitting, setOpeningSubmitting] = useState(false);

  const loadTablesAndTabs = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      // 1. Fetch tables
      const { data: tablesData, error: tablesErr } = await supabase
        .from('restaurant_tables')
        .select('*')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .order('table_number', { ascending: true });

      if (tablesErr) throw tablesErr;

      // 2. Fetch active tabs for this branch
      const { data: tabsData, error: tabsErr } = await supabase
        .from('pos_tabs')
        .select(`
          id,
          table_id,
          server_name,
          pax_count,
          status,
          created_at,
          discount_amount,
          pos_tab_items (
            quantity,
            price
          )
        `)
        .eq('branch_id', branchId)
        .in('status', ['open', 'billed_out']);

      if (tabsErr) throw tabsErr;

      // Map tabs by table_id
      const tabsMap = new Map<string, any>();
      (tabsData || []).forEach((t: any) => {
        const items = t.pos_tab_items || [];
        const rawTotal = items.reduce((acc: number, item: any) => acc + (Number(item.quantity || 1) * Number(item.price || 0)), 0);
        const disc = Number(t.discount_amount || 0);
        const netTotal = Math.max(0, rawTotal - disc);

        tabsMap.set(t.table_id, {
          id: t.id,
          server_name: t.server_name,
          pax_count: t.pax_count,
          status: t.status,
          created_at: t.created_at,
          total_amount: netTotal,
          items_count: items.reduce((acc: number, item: any) => acc + Number(item.quantity || 1), 0),
        });
      });

      const combined: TableWithTab[] = (tablesData || []).map(tbl => ({
        ...tbl,
        active_tab: tabsMap.get(tbl.id) || null,
        // Sync status if tab exists
        status: tabsMap.get(tbl.id)
          ? (tabsMap.get(tbl.id).status === 'billed_out' ? 'billed_out' : 'occupied')
          : (tbl.status === 'occupied' || tbl.status === 'billed_out' ? 'available' : tbl.status),
      }));

      setTables(combined);
    } catch (err: any) {
      console.error('Failed to load tables and tabs:', err);
      showError(err.message || 'Failed to load table floor');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && branchId) {
      loadTablesAndTabs();
    }
  }, [open, branchId]);

  const zones = ['All', ...Array.from(new Set(tables.map(t => t.zone).filter(Boolean)))];

  const filteredTables = activeZone === 'All'
    ? tables
    : tables.filter(t => t.zone === activeZone);

  const availableCount = tables.filter(t => !t.active_tab && t.status === 'available').length;
  const occupiedCount = tables.filter(t => t.active_tab?.status === 'open').length;
  const billedOutCount = tables.filter(t => t.active_tab?.status === 'billed_out').length;

  const handleTableClick = (tbl: TableWithTab) => {
    if (tbl.active_tab) {
      // Table already has an active tab -> select and load it directly
      onSelectTable(tbl, {
        id: tbl.active_tab.id,
        table_id: tbl.id,
        branch_id: branchId,
        server_name: tbl.active_tab.server_name,
        pax_count: tbl.active_tab.pax_count,
        status: tbl.active_tab.status as any,
        created_at: tbl.active_tab.created_at,
      });
      onClose();
    } else {
      // Table is vacant -> open prompt to start a new tab
      setOpeningTable(tbl);
      setPaxCount(Math.min(tbl.capacity, 2));
      setServerName(profile?.full_name || profile?.email?.split('@')[0] || '');
      setTableNotes('');
    }
  };

  const handleStartTab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openingTable || !branchId) return;

    setOpeningSubmitting(true);
    try {
      const { data: newTab, error } = await supabase
        .from('pos_tabs')
        .insert({
          branch_id: branchId,
          table_id: openingTable.id,
          server_id: profile?.id || null,
          server_name: serverName.trim() || profile?.full_name || 'Staff',
          pax_count: Math.max(1, Number(paxCount) || 1),
          status: 'open',
          notes: tableNotes.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      showSuccess(`Table ${openingTable.table_number} opened!`);
      onSelectTable(openingTable, newTab);
      setOpeningTable(null);
      onClose();
    } catch (err: any) {
      console.error('Error starting tab:', err);
      showError(err.message || 'Failed to start table tab');
    } finally {
      setOpeningSubmitting(false);
    }
  };

  const getElapsedTime = (createdStr?: string) => {
    if (!createdStr) return '';
    const diffMs = Date.now() - new Date(createdStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
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
                  Select a table to open a new tab or view an ongoing running bill.
                </DialogDescription>
              </div>

              {/* Status Counters */}
              <div className="flex items-center gap-2 text-xs">
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
                  const isCurrentActive = activeTableId === tbl.id;

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

                  if (isCurrentActive) {
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
                          <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ${badgeClass}`}>
                            {badgeText}
                          </span>
                        </div>

                        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
                          <span>{tbl.capacity} Pax</span>
                          <span>&bull;</span>
                          <span className="truncate">{tbl.zone}</span>
                        </div>
                      </div>

                      {hasTab ? (
                        <div className="mt-4 pt-2.5 border-t border-border/60 space-y-1">
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
                          <span>+ Open Table</span>
                          <span className="text-xs">&rarr;</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Start / Open Table Sub-Dialog */}
      {openingTable && (
        <Dialog open={!!openingTable} onOpenChange={isOpen => { if (!isOpen) setOpeningTable(null); }}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <TableIcon className="w-4 h-4 text-primary" />
                <span>Open {openingTable.table_number}</span>
                <Badge variant="outline" className="text-xs">
                  Max: {openingTable.capacity} Pax
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Start a new dining session and running bill for this table.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleStartTab} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Number of Guests (Pax) *</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={paxCount}
                    onChange={e => setPaxCount(parseInt(e.target.value) || 1)}
                    className="text-sm font-semibold"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    {[1, 2, 4, 6].map(num => (
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
                  onClick={() => setOpeningTable(null)}
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
                  Open Table & Take Order
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};
