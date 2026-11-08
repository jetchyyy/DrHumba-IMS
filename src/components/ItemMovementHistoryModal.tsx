import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useModal } from '../contexts/ModalContext';
import {
  ReloadIcon as RefreshCw,
  MagnifyingGlassIcon as Search
} from '@radix-ui/react-icons';
import {
  History,
  Truck,
  Layers,
  ArrowRightLeft,
  Sparkles,
  Scale,
  CheckCircle2,
  Package,
  Utensils
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

export interface ItemMovementHistoryTarget {
  id: string;
  item_name: string;
  base_unit?: string;
  sku?: string;
  category?: string;
}

export interface ItemTransferRecord {
  id: string;
  transfer_id: string;
  control_number: string;
  created_at: string;
  source_branch_id: string;
  source_branch_name: string;
  target_branch_id: string;
  target_branch_name: string;
  status: string;
  quantity_base_unit: number;
  packaging_unit?: string | null;
  package_count?: number | null;
  pieces_per_pack?: number | null;
  received_quantity_base_unit?: number | null;
  requested_by_name: string;
  approved_by_name: string;
}

export interface ItemMovementRecord {
  id: string;
  branch_id: string;
  branch_name: string;
  movement_type: string;
  quantity: number;
  reference_id?: string | null;
  reference_type?: string | null;
  created_at: string;
  created_by_name: string;
}

interface ItemMovementHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ItemMovementHistoryTarget | null;
}

export const ItemMovementHistoryModal: React.FC<ItemMovementHistoryModalProps> = ({
  open,
  onOpenChange,
  item
}) => {
  const { branches } = useAuth();
  const { showError } = useModal();

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'transfers' | 'movements'>('transfers');
  const [transfers, setTransfers] = useState<ItemTransferRecord[]>([]);
  const [movements, setMovements] = useState<ItemMovementRecord[]>([]);
  const [branchBalances, setBranchBalances] = useState<{ branch_id: string; branch_name: string; quantity: number }[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (open && item?.id) {
      loadHistory(item.id);
    } else if (!open) {
      setTransfers([]);
      setMovements([]);
      setBranchBalances([]);
      setSearchTerm('');
      setBranchFilter('all');
      setActiveTab('transfers');
    }
  }, [open, item?.id]);

  const loadHistory = async (itemId: string) => {
    setLoading(true);
    try {
      // 1. Fetch Transfer Items for this item
      const { data: tiRows, error: tiErr } = await supabase
        .from('transfer_items')
        .select('id, transfer_id, quantity_base_unit, original_quantity_base_unit, received_quantity_base_unit, packaging_unit, package_count, pieces_per_pack, is_rejected, missing_reason')
        .eq('item_id', itemId);

      if (tiErr) throw tiErr;

      let formattedTransfers: ItemTransferRecord[] = [];
      if (tiRows && tiRows.length > 0) {
        const transferIds = Array.from(new Set(tiRows.map(t => t.transfer_id).filter(Boolean)));
        const { data: trRows, error: trErr } = await supabase
          .from('transfer_requests')
          .select(`
            id,
            control_number,
            source_branch_id,
            target_branch_id,
            status,
            remarks,
            created_at,
            requested_by,
            approved_by,
            source_branch:branches!transfer_requests_source_branch_id_fkey(name),
            target_branch:branches!transfer_requests_target_branch_id_fkey(name)
          `)
          .in('id', transferIds)
          .order('created_at', { ascending: false });

        if (trErr) throw trErr;

        const userIds = Array.from(new Set((trRows || []).flatMap(r => [r.requested_by, r.approved_by]).filter(Boolean)));
        const profileMap = new Map<string, string>();
        if (userIds.length > 0) {
          let { data: profs, error: pErr } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', userIds);
          if (pErr && /full_name|column/i.test(pErr.message || '')) {
            const leg = await supabase.from('profiles').select('id, email').in('id', userIds);
            profs = leg.data?.map(p => ({ ...p, full_name: null })) || null;
          }
          (profs || []).forEach(p => {
            profileMap.set(p.id, p.full_name?.trim() || p.email || 'Staff');
          });
        }

        const trMap = new Map((trRows || []).map(r => [r.id, r]));

        formattedTransfers = tiRows
          .map(ti => {
            const parent = trMap.get(ti.transfer_id);
            if (!parent) return null;
            const srcBranch: any = Array.isArray(parent?.source_branch) ? parent?.source_branch[0] : parent?.source_branch;
            const tgtBranch: any = Array.isArray(parent?.target_branch) ? parent?.target_branch[0] : parent?.target_branch;
            return {
              id: ti.id,
              transfer_id: ti.transfer_id,
              control_number: parent?.control_number || 'TRF-PENDING',
              created_at: parent?.created_at || '',
              source_branch_id: parent?.source_branch_id || '',
              source_branch_name: srcBranch?.name || 'Main Kitchen',
              target_branch_id: parent?.target_branch_id || '',
              target_branch_name: tgtBranch?.name || 'Destination Branch',
              status: parent?.status || 'requested',
              quantity_base_unit: Number(ti.quantity_base_unit || 0),
              packaging_unit: ti.packaging_unit,
              package_count: ti.package_count ? Number(ti.package_count) : null,
              pieces_per_pack: ti.pieces_per_pack ? Number(ti.pieces_per_pack) : null,
              received_quantity_base_unit: ti.received_quantity_base_unit != null ? Number(ti.received_quantity_base_unit) : null,
              requested_by_name: parent?.requested_by ? profileMap.get(parent.requested_by) || 'Staff' : 'Staff',
              approved_by_name: parent?.approved_by ? profileMap.get(parent.approved_by) || 'Manager' : '—',
            };
          })
          .filter(Boolean) as ItemTransferRecord[];

        formattedTransfers.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      }
      setTransfers(formattedTransfers);

      // 2. Fetch inventory_movements for this item
      const { data: movRows, error: movErr } = await supabase
        .from('inventory_movements')
        .select(`
          id,
          branch_id,
          quantity,
          movement_type,
          reference_id,
          reference_type,
          created_at,
          created_by,
          branches:branch_id (name)
        `)
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (movErr) throw movErr;

      let formattedMovements: ItemMovementRecord[] = [];
      if (movRows && movRows.length > 0) {
        const movUserIds = Array.from(new Set(movRows.map(m => m.created_by).filter(Boolean)));
        const movProfileMap = new Map<string, string>();
        if (movUserIds.length > 0) {
          let { data: mProfs, error: mpErr } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', movUserIds);
          if (mpErr && /full_name|column/i.test(mpErr.message || '')) {
            const leg = await supabase.from('profiles').select('id, email').in('id', movUserIds);
            mProfs = leg.data?.map(p => ({ ...p, full_name: null })) || null;
          }
          (mProfs || []).forEach(p => {
            movProfileMap.set(p.id, p.full_name?.trim() || p.email || 'Staff');
          });
        }

        formattedMovements = movRows.map(m => {
          const br: any = Array.isArray(m.branches) ? m.branches[0] : m.branches;
          return {
            id: m.id,
            branch_id: m.branch_id,
            branch_name: br?.name || 'Branch',
            movement_type: m.movement_type,
            quantity: Number(m.quantity || 0),
            reference_id: m.reference_id,
            reference_type: m.reference_type,
            created_at: m.created_at,
            created_by_name: m.created_by ? movProfileMap.get(m.created_by) || 'Staff' : 'System',
          };
        });
      }
      setMovements(formattedMovements);

      // 3. Fetch Stock Balances across branches
      const { data: balRows } = await supabase
        .from('inventory_balances')
        .select('branch_id, quantity, branches:branch_id(name)')
        .eq('item_id', itemId);

      if (balRows) {
        setBranchBalances(balRows.map(b => {
          const br: any = Array.isArray(b.branches) ? b.branches[0] : b.branches;
          return {
            branch_id: b.branch_id,
            branch_name: br?.name || 'Branch',
            quantity: Number(b.quantity || 0),
          };
        }));
      }
    } catch (err: any) {
      showError(err.message || 'Failed to load item movement history.');
    } finally {
      setLoading(false);
    }
  };

  const getMovementBadge = (type: string) => {
    switch (type) {
      case 'portioning_in':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 gap-1 text-[10px]">
            <Sparkles className="w-3 h-3" /> Portion Yield (In)
          </Badge>
        );
      case 'portioning_out':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 gap-1 text-[10px]">
            <Scale className="w-3 h-3" /> Portion Raw Used (Out)
          </Badge>
        );
      case 'transfer_out':
        return (
          <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 gap-1 text-[10px]">
            <Truck className="w-3 h-3" /> Transfer Out
          </Badge>
        );
      case 'transfer_in':
        return (
          <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30 gap-1 text-[10px]">
            <CheckCircle2 className="w-3 h-3" /> Transfer In
          </Badge>
        );
      case 'stock_in':
        return (
          <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/30 gap-1 text-[10px]">
            <Package className="w-3 h-3" /> Stock In
          </Badge>
        );
      case 'sale_deduction':
        return (
          <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 gap-1 text-[10px]">
            <Utensils className="w-3 h-3" /> Sale Deduction
          </Badge>
        );
      case 'adjustment':
        return (
          <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/30 gap-1 text-[10px]">
            <Layers className="w-3 h-3" /> Adjustment / Loss
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px]">
            {type}
          </Badge>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b shrink-0 bg-gradient-to-r from-card to-muted/30">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl font-bold text-foreground">
                <History className="h-5 w-5 text-amber-500 shrink-0" />
                <span>{item?.item_name || 'Item History'}</span>
              </DialogTitle>
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                {item?.sku && (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    SKU: {item.sku}
                  </Badge>
                )}
                {item?.category && (
                  <Badge variant="secondary" className="text-[10px]">
                    {item.category}
                  </Badge>
                )}
                <span className="text-muted-foreground/70">
                  Base Unit: <strong className="text-foreground">{item?.base_unit || 'pcs'}</strong>
                </span>
              </div>
            </div>

            {/* Branch stock pills */}
            {branchBalances.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                {branchBalances.map(b => (
                  <div
                    key={b.branch_id}
                    className="px-2.5 py-1 rounded-md bg-background border text-[11px] flex items-center gap-1.5 shadow-2xs"
                  >
                    <span className="text-muted-foreground">{b.branch_name}:</span>
                    <span className={`font-mono font-bold ${b.quantity <= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {b.quantity} {item?.base_unit || ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogHeader>

        {/* Subheader Filters & Tab Switcher */}
        <div className="p-4 border-b bg-muted/20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          <Tabs
            value={activeTab}
            onValueChange={v => setActiveTab(v as 'transfers' | 'movements')}
            className="w-full sm:w-auto"
          >
            <TabsList className="grid grid-cols-2 w-full sm:w-80">
              <TabsTrigger value="transfers" className="text-xs flex items-center gap-1.5 cursor-pointer">
                <Truck className="w-3.5 h-3.5" />
                <span>Transfer History</span>
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
                  {transfers.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="movements" className="text-xs flex items-center gap-1.5 cursor-pointer">
                <Layers className="w-3.5 h-3.5" />
                <span>All Movements</span>
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 h-4">
                  {movements.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 sm:w-48">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search history..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            {branches.length > 1 && (
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="h-8 text-xs w-[140px]">
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
              <p className="text-xs">Loading item movement records...</p>
            </div>
          ) : activeTab === 'transfers' ? (
            /* TAB 1: TRANSFERS */
            (() => {
              const term = searchTerm.toLowerCase();
              const filtered = transfers.filter(t => {
                const matchesBranch =
                  branchFilter === 'all' ||
                  t.source_branch_id === branchFilter ||
                  t.target_branch_id === branchFilter;
                const matchesText =
                  t.control_number.toLowerCase().includes(term) ||
                  t.source_branch_name.toLowerCase().includes(term) ||
                  t.target_branch_name.toLowerCase().includes(term) ||
                  t.status.toLowerCase().includes(term) ||
                  t.requested_by_name.toLowerCase().includes(term) ||
                  t.approved_by_name.toLowerCase().includes(term);
                return matchesBranch && matchesText;
              });

              if (filtered.length === 0) {
                return (
                  <div className="py-12 text-center text-muted-foreground space-y-2">
                    <Truck className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <p className="text-sm font-medium">No branch transfers recorded for this item.</p>
                    <p className="text-xs text-muted-foreground/80 max-w-sm mx-auto">
                      This item has not been dispatched or transferred between branches yet. Check "All Movements" to see portioning yields and adjustments.
                    </p>
                  </div>
                );
              }

              return (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs pl-4">Transfer #</TableHead>
                        <TableHead className="text-xs">Date</TableHead>
                        <TableHead className="text-xs">Route (From → To)</TableHead>
                        <TableHead className="text-xs">Quantity Dispatched</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Staff Involved</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(t => {
                        const hasPack = t.package_count && t.pieces_per_pack && Number(t.package_count) > 0;
                        return (
                          <TableRow key={t.id} className="text-xs hover:bg-muted/30">
                            <TableCell className="pl-4 font-mono font-medium text-amber-500">
                              {t.control_number}
                            </TableCell>
                            <TableCell className="text-muted-foreground whitespace-nowrap">
                              {t.created_at ? (
                                <>
                                  <span>{new Date(t.created_at).toLocaleDateString()}</span>
                                  <span className="block text-[10px]">
                                    {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </>
                              ) : '—'}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-foreground">{t.source_branch_name}</span>
                                <ArrowRightLeft className="w-3 h-3 text-muted-foreground" />
                                <span className="font-semibold text-foreground">{t.target_branch_name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-0.5">
                                <span className="font-mono font-bold text-foreground">
                                  {t.quantity_base_unit} {item?.base_unit || 'pcs'}
                                </span>
                                {hasPack && (
                                  <Badge variant="outline" className="block w-fit text-[10px] px-1 py-0 bg-blue-500/10 text-blue-400 border-blue-500/30 font-normal">
                                    {t.package_count} {Number(t.package_count) === 1 ? 'pack' : 'packs'} × {t.pieces_per_pack} pcs
                                  </Badge>
                                )}
                                {t.received_quantity_base_unit != null && (
                                  <span className="text-[10px] text-muted-foreground block">
                                    Received: {t.received_quantity_base_unit} {item?.base_unit || 'pcs'}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {t.status === 'completed' && (
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                                  Completed
                                </Badge>
                              )}
                              {t.status === 'approved' && (
                                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">
                                  Approved / In Transit
                                </Badge>
                              )}
                              {t.status === 'in_transit' && (
                                <Badge variant="outline" className="bg-sky-500/10 text-sky-400 border-sky-500/30 text-[10px]">
                                  In Transit
                                </Badge>
                              )}
                              {t.status === 'requested' && (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]">
                                  Requested
                                </Badge>
                              )}
                              {t.status === 'rejected' && (
                                <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/30 text-[10px]">
                                  Rejected
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              <div>
                                <span className="text-[11px] block">Req: <strong className="text-foreground">{t.requested_by_name}</strong></span>
                                {t.approved_by_name && t.approved_by_name !== '—' && (
                                  <span className="text-[10px] block">Appr: {t.approved_by_name}</span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })()
          ) : (
            /* TAB 2: ALL MOVEMENTS */
            (() => {
              const term = searchTerm.toLowerCase();
              const filtered = movements.filter(m => {
                const matchesBranch = branchFilter === 'all' || m.branch_id === branchFilter;
                const matchesText =
                  m.movement_type.toLowerCase().includes(term) ||
                  m.branch_name.toLowerCase().includes(term) ||
                  m.created_by_name.toLowerCase().includes(term);
                return matchesBranch && matchesText;
              });

              if (filtered.length === 0) {
                return (
                  <div className="py-12 text-center text-muted-foreground space-y-2">
                    <Layers className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <p className="text-sm font-medium">No stock movements recorded for this item.</p>
                    <p className="text-xs text-muted-foreground/80 max-w-sm mx-auto">
                      Stock movement records are generated when portioning is approved, transfers are received, or inventory adjustments are recorded.
                    </p>
                  </div>
                );
              }

              return (
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-xs pl-4">Date</TableHead>
                        <TableHead className="text-xs">Movement Type</TableHead>
                        <TableHead className="text-xs">Branch</TableHead>
                        <TableHead className="text-xs">Change</TableHead>
                        <TableHead className="text-xs">Logged By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(m => (
                        <TableRow key={m.id} className="text-xs hover:bg-muted/30">
                          <TableCell className="pl-4 text-muted-foreground whitespace-nowrap">
                            <span>{new Date(m.created_at).toLocaleDateString()}</span>
                            <span className="block text-[10px]">
                              {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </TableCell>
                          <TableCell>{getMovementBadge(m.movement_type)}</TableCell>
                          <TableCell className="font-medium text-foreground">{m.branch_name}</TableCell>
                          <TableCell>
                            <span
                              className={`font-mono font-bold text-sm ${
                                m.quantity > 0 ? 'text-emerald-500' : 'text-rose-400'
                              }`}
                            >
                              {m.quantity > 0 ? `+${m.quantity}` : m.quantity} {item?.base_unit || ''}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{m.created_by_name}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })()
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20 shrink-0 flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">
            Showing movements and transfers for <strong className="text-foreground">{item?.item_name}</strong>
          </span>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

