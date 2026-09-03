import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useModal } from '../contexts/ModalContext';
import {
  ReloadIcon as RefreshCw,
  PlusIcon as Plus,
  CheckIcon as Check,
  Cross2Icon as X,
  EyeOpenIcon as Eye,
  MagnifyingGlassIcon as Search,
  MagicWandIcon as ChefHat,
} from '@radix-ui/react-icons';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Textarea } from './ui/textarea';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface PortioningRequest {
  id: string;
  control_number: string | null;
  branch_id: string;
  source_item_id: string;
  source_quantity: number;
  target_item_id: string;
  target_quantity: number;
  waste_quantity: number;
  waste_reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  remarks: string | null;
  created_at: string;
  branches?: { name: string };
  source_item?: { item_name: string; base_unit: string; category: string; cost_per_base_unit: number };
  target_item?: { item_name: string; base_unit: string; category: string; cost_per_base_unit: number };
  requested_user?: { full_name: string };
  approved_user?: { full_name: string };
}

interface InventoryItem {
  id: string;
  sku: string;
  item_name: string;
  base_unit: string;
  purchase_unit: string;
  conversion_factor: number;
  category: string;
  cost_per_base_unit: number;
}

export const Portioning: React.FC = () => {
  const { profile, branches, selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();

  const [requests, setRequests] = useState<PortioningRequest[]>([]);
  const [itemsCatalog, setItemsCatalog] = useState<InventoryItem[]>([]);
  const [branchBalances, setBranchBalances] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQuickItemModal, setShowQuickItemModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<PortioningRequest | null>(null);

  // Create Request Form state
  const [formBranchId, setFormBranchId] = useState<string>('');
  const [formSourceItemId, setFormSourceItemId] = useState<string>('');
  const [formSourceQty, setFormSourceQty] = useState<string>('50');
  const [formTargetItemId, setFormTargetItemId] = useState<string>('');
  const [formTargetQty, setFormTargetQty] = useState<string>('50');
  const [formWasteQty, setFormWasteQty] = useState<string>('0');
  const [formWasteReason, setFormWasteReason] = useState<string>('');
  const [formRemarks, setFormRemarks] = useState<string>('');

  // Search popover states inside form
  const [sourceSearchTerm, setSourceSearchTerm] = useState('');
  const [targetSearchTerm, setTargetSearchTerm] = useState('');
  const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
  const [targetPopoverOpen, setTargetPopoverOpen] = useState(false);

  // Quick New Item Form state
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Portioned Meats');
  const [newItemUnit, setNewItemUnit] = useState('pc');
  const [newItemSku, setNewItemSku] = useState('');

  // Reject dialog state
  const [rejectionReasonText, setRejectionReasonText] = useState('');

  const isManagerOrAdmin = profile && ['super_admin', 'inventory_manager', 'branch_manager'].includes(profile.role_name);

  useEffect(() => {
    fetchData();
  }, [selectedBranch]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Portioning Requests with fallback if schema cache is pending reload
      let reqData: any[] = [];
      try {
        let query = supabase
          .from('portioning_requests')
          .select(`
            *,
            branches:branch_id (name),
            source_item:source_item_id (item_name, base_unit, category, cost_per_base_unit),
            target_item:target_item_id (item_name, base_unit, category, cost_per_base_unit),
            requested_user:requested_by (full_name),
            approved_user:approved_by (full_name)
          `)
          .order('created_at', { ascending: false });

        if (selectedBranch) {
          query = query.eq('branch_id', selectedBranch.id);
        }

        const { data, error } = await query;
        if (error) throw error;
        reqData = data || [];
      } catch (relErr) {
        // Fallback without embedded user join if schema cache hasn't refreshed
        let query = supabase
          .from('portioning_requests')
          .select(`
            *,
            branches:branch_id (name),
            source_item:source_item_id (item_name, base_unit, category, cost_per_base_unit),
            target_item:target_item_id (item_name, base_unit, category, cost_per_base_unit)
          `)
          .order('created_at', { ascending: false });

        if (selectedBranch) {
          query = query.eq('branch_id', selectedBranch.id);
        }

        const { data, error } = await query;
        if (error) throw error;
        reqData = data || [];

        // Fetch profiles separately
        const userIds = Array.from(new Set(reqData.flatMap(r => [r.requested_by, r.approved_by]).filter(Boolean)));
        if (userIds.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', userIds);

          const profMap = new Map(profs?.map(p => [p.id, p.full_name]) || []);
          reqData = reqData.map(r => ({
            ...r,
            requested_user: r.requested_by ? { full_name: profMap.get(r.requested_by) || 'Staff' } : null,
            approved_user: r.approved_by ? { full_name: profMap.get(r.approved_by) || 'Admin' } : null,
          }));
        }
      }

      setRequests(reqData);

      // 2. Fetch Catalog Items
      const { data: catData, error: catErr } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('status', 'active')
        .order('item_name', { ascending: true });

      if (catErr) throw catErr;
      setItemsCatalog(catData || []);

      // 3. Fetch Stock Balances for current branch
      const branchIdToFetch = selectedBranch ? selectedBranch.id : (branches[0]?.id || '');
      if (branchIdToFetch) {
        const { data: balData, error: balErr } = await supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .eq('branch_id', branchIdToFetch);

        if (!balErr && balData) {
          const map: Record<string, number> = {};
          balData.forEach(b => {
            map[b.item_id] = Number(b.quantity);
          });
          setBranchBalances(map);
        }
      }
    } catch (err: any) {
      showError(err.message || 'Failed to load portioning requests.');
    } finally {
      setLoading(false);
    }
  };

  // Branch balances dynamic change on branch selection in modal
  const fetchBranchBalancesFor = async (branchId: string) => {
    if (!branchId) return;
    const { data, error } = await supabase
      .from('inventory_balances')
      .select('item_id, quantity')
      .eq('branch_id', branchId);

    if (!error && data) {
      const map: Record<string, number> = {};
      data.forEach(b => {
        map[b.item_id] = Number(b.quantity);
      });
      setBranchBalances(map);
    }
  };

  const handleOpenCreateModal = () => {
    const initialBranchId = selectedBranch ? selectedBranch.id : (branches[0]?.id || '');
    setFormBranchId(initialBranchId);
    if (initialBranchId) fetchBranchBalancesFor(initialBranchId);
    setFormSourceItemId('');
    setFormSourceQty('50');
    setFormTargetItemId('');
    setFormTargetQty('50');
    setFormWasteQty('0');
    setFormWasteReason('');
    setFormRemarks('');
    setShowCreateModal(true);
  };

  // Quick Create Target Item
  const handleQuickCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) {
      showError('Please enter an item name.');
      return;
    }

    try {
      const sku = newItemSku.trim() || `PRT-${Date.now().toString().slice(-6)}`;
      const { data, error } = await supabase
        .from('inventory_items')
        .insert({
          sku,
          item_name: newItemName.trim(),
          category: newItemCategory,
          base_unit: newItemUnit,
          purchase_unit: newItemUnit,
          conversion_factor: 1,
          reorder_level: 10,
          cost_per_base_unit: 0,
          status: 'active'
        })
        .select('*')
        .single();

      if (error) throw error;
      showSuccess(`Item "${data.item_name}" created successfully!`);
      setItemsCatalog(prev => [...prev, data]);
      setFormTargetItemId(data.id);
      setShowQuickItemModal(false);
      setNewItemName('');
      setNewItemSku('');
    } catch (err: any) {
      showError(err.message || 'Failed to create new item.');
    }
  };

  // Submit Portioning Request
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formBranchId) {
      showError('Please select a branch.');
      return;
    }
    if (!formSourceItemId) {
      showError('Please select a source raw item.');
      return;
    }
    if (!formTargetItemId) {
      showError('Please select a target portioned item.');
      return;
    }

    const sourceQty = parseFloat(formSourceQty);
    const targetQty = parseFloat(formTargetQty);
    const wasteQty = parseFloat(formWasteQty || '0');

    if (isNaN(sourceQty) || sourceQty <= 0) {
      showError('Please enter a valid source quantity.');
      return;
    }
    if (isNaN(targetQty) || targetQty <= 0) {
      showError('Please enter a valid target yield quantity.');
      return;
    }

    // Stock check
    const availStock = branchBalances[formSourceItemId] || 0;
    if (sourceQty > availStock) {
      showError(`Insufficient stock for source item. Available in branch: ${availStock}`);
      return;
    }

    try {
      const { error } = await supabase
        .from('portioning_requests')
        .insert({
          branch_id: formBranchId,
          source_item_id: formSourceItemId,
          source_quantity: sourceQty,
          target_item_id: formTargetItemId,
          target_quantity: targetQty,
          waste_quantity: wasteQty,
          waste_reason: formWasteReason.trim() || null,
          remarks: formRemarks.trim() || null,
          requested_by: profile?.id,
          status: 'pending'
        });

      if (error) throw error;

      showSuccess('Portioning request submitted successfully! Awaiting Admin approval.');
      setShowCreateModal(false);
      fetchData();
    } catch (err: any) {
      showError(err.message || 'Failed to submit portioning request.');
    }
  };

  // Approve Portioning Request
  const handleApproveRequest = async (request: PortioningRequest) => {
    const sourceName = request.source_item?.item_name || 'Source Item';
    const targetName = request.target_item?.item_name || 'Target Item';

    const confirmed = await confirm(
      'Approve Portioning Request',
      `Are you sure you want to approve this conversion?\n\n- Deduct ${request.source_quantity} ${request.source_item?.base_unit || ''} of ${sourceName}\n- Add ${request.target_quantity} ${request.target_item?.base_unit || 'pcs'} of ${targetName}\n- Recalculate cost per unit for ${targetName}`
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase.rpc('fn_approve_portioning_request', {
        p_request_id: request.id
      });

      if (error) throw error;

      showSuccess(`Portioning Request ${request.control_number || ''} approved and inventory updated!`);
      fetchData();
    } catch (err: any) {
      showError(err.message || 'Failed to approve request.');
    }
  };

  // Reject Portioning Request
  const handleRejectSubmit = async () => {
    if (!selectedRequest) return;
    if (!rejectionReasonText.trim()) {
      showError('Please specify a rejection reason.');
      return;
    }

    try {
      const { error } = await supabase
        .from('portioning_requests')
        .update({
          status: 'rejected',
          rejection_reason: rejectionReasonText.trim(),
          approved_by: profile?.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedRequest.id);

      if (error) throw error;

      showSuccess('Portioning request rejected.');
      setShowRejectModal(false);
      setSelectedRequest(null);
      setRejectionReasonText('');
      fetchData();
    } catch (err: any) {
      showError(err.message || 'Failed to reject request.');
    }
  };

  // Filtered requests list
  const filteredRequests = requests.filter(req => {
    const matchesSearch =
      (req.control_number || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (req.source_item?.item_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (req.target_item?.item_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (req.requested_user?.full_name || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    const matchesBranch = branchFilter === 'all' || req.branch_id === branchFilter;

    return matchesSearch && matchesStatus && matchesBranch;
  });

  // Pagination calculation
  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage);
  const paginatedRequests = filteredRequests.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Summary Metrics
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const approvedCount = requests.filter(r => r.status === 'approved').length;
  const totalPortionedPieces = requests
    .filter(r => r.status === 'approved')
    .reduce((acc, r) => acc + Number(r.target_quantity), 0);
  const totalWasteKg = requests
    .filter(r => r.status === 'approved')
    .reduce((acc, r) => acc + Number(r.waste_quantity || 0), 0);

  // Computed helper for Create Modal
  const selectedSourceItem = itemsCatalog.find(i => i.id === formSourceItemId);
  const selectedTargetItem = itemsCatalog.find(i => i.id === formTargetItemId);
  const availSourceStock = formSourceItemId ? (branchBalances[formSourceItemId] || 0) : 0;
  const sourceQtyNum = parseFloat(formSourceQty) || 0;
  const targetQtyNum = parseFloat(formTargetQty) || 0;
  const computedUnitCost = (selectedSourceItem && sourceQtyNum > 0 && targetQtyNum > 0)
    ? ((sourceQtyNum * (selectedSourceItem.cost_per_base_unit || 0)) / targetQtyNum).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ChefHat className="h-7 w-7 text-amber-500" /> Portioning & Yield Conversions
          </h1>
          <p className="text-sm text-muted-foreground">
            Request, track, and approve conversions from bulk raw items (kg/L) into portioned pieces (pcs).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button className="bg-amber-600 hover:bg-amber-700 text-white" size="sm" onClick={handleOpenCreateModal}>
            <Plus className="h-4 w-4 mr-2" /> New Portioning Request
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Pending Approvals</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              {pendingCount}
              {pendingCount > 0 ? (
                <Badge variant="destructive" className="animate-pulse">Action Needed</Badge>
              ) : (
                <Badge variant="outline">Clear</Badge>
              )}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Approved Portionings</CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-500">{approvedCount}</CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Total Portioned Yield</CardDescription>
            <CardTitle className="text-2xl font-bold text-amber-500">
              {totalPortionedPieces.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">pcs</span>
            </CardTitle>
          </CardHeader>
        </Card>

        <Card className="bg-card/50 backdrop-blur border-border">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs">Total Trim Loss / Waste</CardDescription>
            <CardTitle className="text-2xl font-bold text-rose-500">
              {totalWasteKg.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card className="p-4 border-border bg-card/60">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by control number, item name, staff..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>

            {!selectedBranch && branches.length > 1 && (
              <Select value={branchFilter} onValueChange={v => { setBranchFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </Card>

      {/* Main Table */}
      <Card border-border>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Control #</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Source Raw Item</TableHead>
                <TableHead>Target Portion Yield</TableHead>
                <TableHead>Waste Loss</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading portioning records...
                  </TableCell>
                </TableRow>
              ) : paginatedRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No portioning records found matching filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRequests.map(req => (
                  <TableRow key={req.id}>
                    <TableCell className="font-mono font-medium text-amber-500">
                      {req.control_number || 'PRT-PENDING'}
                    </TableCell>
                    <TableCell>{req.branches?.name || 'Main'}</TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium text-foreground">{req.source_item?.item_name || 'Item'}</span>
                        <p className="text-xs text-muted-foreground">
                          {req.source_quantity} {req.source_item?.base_unit || ''}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium text-emerald-500">
                          +{req.target_quantity} {req.target_item?.base_unit || 'pcs'}
                        </span>
                        <p className="text-xs text-muted-foreground">{req.target_item?.item_name || 'Portion'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {req.waste_quantity > 0 ? (
                        <span className="text-xs font-semibold text-rose-400">
                          {req.waste_quantity} kg ({req.waste_reason || 'Trim loss'})
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">0 kg</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {req.status === 'pending' && <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">Pending Approval</Badge>}
                      {req.status === 'approved' && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Approved</Badge>}
                      {req.status === 'rejected' && <Badge variant="outline" className="bg-rose-500/10 text-rose-500 border-rose-500/30">Rejected</Badge>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {req.requested_user?.full_name || 'Staff'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(req.created_at).toLocaleDateString()} {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setSelectedRequest(req); setShowDetailModal(true); }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {req.status === 'pending' && isManagerOrAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                              onClick={() => handleApproveRequest(req)}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                              onClick={() => { setSelectedRequest(req); setRejectionReasonText(''); setShowRejectModal(true); }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <Pagination className="mt-4">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className={currentPage === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <PaginationItem key={page}>
                <PaginationLink
                  onClick={() => setCurrentPage(page)}
                  isActive={currentPage === page}
                  className="cursor-pointer"
                >
                  {page}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className={currentPage === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      {/* MODAL: Create Portioning Request */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-500">
              <ChefHat className="h-5 w-5" /> Submit Stock Portioning Request
            </DialogTitle>
            <DialogDescription>
              Convert raw inventory (e.g. 50kg meat) into portioned pieces (e.g. 50pcs portion) at the branch level.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRequest} className="space-y-4 py-2">
            {/* Branch Selection */}
            <div>
              <Label className="text-xs">Target Branch</Label>
              <Select
                value={formBranchId}
                onValueChange={v => { setFormBranchId(v); fetchBranchBalancesFor(v); }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Branch" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Source Raw Item */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <Label className="text-xs font-semibold">Source Bulk Raw Item (Used)</Label>
                {selectedSourceItem && (
                  <span className="text-xs text-amber-400 font-mono">
                    Available Stock: {availSourceStock} {selectedSourceItem.base_unit}
                  </span>
                )}
              </div>
              <Popover open={sourcePopoverOpen} onOpenChange={setSourcePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal">
                    {selectedSourceItem ? `${selectedSourceItem.item_name} (${selectedSourceItem.base_unit})` : 'Select Source Item...'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-2" align="start">
                  <Input
                    placeholder="Search raw item..."
                    value={sourceSearchTerm}
                    onChange={e => setSourceSearchTerm(e.target.value)}
                    className="mb-2"
                  />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {itemsCatalog
                      .filter(i => i.item_name.toLowerCase().includes(sourceSearchTerm.toLowerCase()))
                      .map(item => (
                        <div
                          key={item.id}
                          className="p-2 hover:bg-accent rounded text-sm cursor-pointer flex justify-between"
                          onClick={() => {
                            setFormSourceItemId(item.id);
                            setSourcePopoverOpen(false);
                          }}
                        >
                          <span className="font-medium">{item.item_name}</span>
                          <span className="text-xs text-muted-foreground">{item.base_unit} | ₱{item.cost_per_base_unit}/unit</span>
                        </div>
                      ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Raw Quantity Used</Label>
                <Input
                  type="number"
                  step="any"
                  value={formSourceQty}
                  onChange={e => setFormSourceQty(e.target.value)}
                  placeholder="e.g. 50"
                  required
                />
                <span className="text-[10px] text-muted-foreground">Unit: {selectedSourceItem?.base_unit || 'kg'}</span>
              </div>

              <div>
                <Label className="text-xs">Trim Loss / Waste (Optional)</Label>
                <Input
                  type="number"
                  step="any"
                  value={formWasteQty}
                  onChange={e => setFormWasteQty(e.target.value)}
                  placeholder="e.g. 1.5"
                />
                <span className="text-[10px] text-muted-foreground">e.g. fat/bone discarded (kg)</span>
              </div>
            </div>

            {parseFloat(formWasteQty) > 0 && (
              <div>
                <Label className="text-xs">Waste Loss Reason</Label>
                <Input
                  value={formWasteReason}
                  onChange={e => setFormWasteReason(e.target.value)}
                  placeholder="e.g. Fat & bone trimming loss during prep"
                />
              </div>
            )}

            {/* Target Portioned Item */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <Label className="text-xs font-semibold text-emerald-400">Target Portioned Item (Yielded)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-amber-500 hover:text-amber-400 p-0"
                  onClick={() => setShowQuickItemModal(true)}
                >
                  + Create New Portioned Item
                </Button>
              </div>
              <Popover open={targetPopoverOpen} onOpenChange={setTargetPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal">
                    {selectedTargetItem ? `${selectedTargetItem.item_name} (${selectedTargetItem.base_unit})` : 'Select Target Item...'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-2" align="start">
                  <Input
                    placeholder="Search target portion item..."
                    value={targetSearchTerm}
                    onChange={e => setTargetSearchTerm(e.target.value)}
                    className="mb-2"
                  />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {itemsCatalog
                      .filter(i => i.item_name.toLowerCase().includes(targetSearchTerm.toLowerCase()))
                      .map(item => (
                        <div
                          key={item.id}
                          className="p-2 hover:bg-accent rounded text-sm cursor-pointer flex justify-between"
                          onClick={() => {
                            setFormTargetItemId(item.id);
                            setTargetPopoverOpen(false);
                          }}
                        >
                          <span className="font-medium">{item.item_name}</span>
                          <span className="text-xs text-emerald-400">{item.category} ({item.base_unit})</span>
                        </div>
                      ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div>
              <Label className="text-xs">Yielded Pieces Quantity</Label>
              <Input
                type="number"
                step="any"
                value={formTargetQty}
                onChange={e => setFormTargetQty(e.target.value)}
                placeholder="e.g. 50"
                required
              />
              <span className="text-[10px] text-muted-foreground">Unit: {selectedTargetItem?.base_unit || 'pcs'}</span>
            </div>

            <div>
              <Label className="text-xs">Notes / Remarks</Label>
              <Input
                value={formRemarks}
                onChange={e => setFormRemarks(e.target.value)}
                placeholder="e.g. Batch #102 prepped for Guadalupe dinner service"
              />
            </div>

            {/* Yield & Cost Summary Preview Card */}
            {selectedSourceItem && selectedTargetItem && sourceQtyNum > 0 && targetQtyNum > 0 && (
              <Card className="bg-amber-950/20 border-amber-500/30 p-3">
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-amber-400 flex items-center gap-1">
                    <ChefHat className="h-4 w-4" /> Conversion Ratio & Costing Preview:
                  </p>
                  <p className="text-muted-foreground">
                    • Conversion: <span className="text-white font-medium">{sourceQtyNum} {selectedSourceItem.base_unit}</span> → <span className="text-emerald-400 font-medium">{targetQtyNum} {selectedTargetItem.base_unit}</span>
                  </p>
                  <p className="text-muted-foreground">
                    • Calculated Cost per {selectedTargetItem.base_unit}: <span className="text-emerald-400 font-bold font-mono">₱{computedUnitCost} / {selectedTargetItem.base_unit}</span>
                  </p>
                </div>
              </Card>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white">
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: Quick Add Target Item */}
      <Dialog open={showQuickItemModal} onOpenChange={setShowQuickItemModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Quick Create Portioned Item</DialogTitle>
            <DialogDescription>Add a new prepped / portioned item into the master inventory catalog.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleQuickCreateItem} className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Item Name</Label>
              <Input
                placeholder="e.g. Pork Cutlet 100g Portion"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
                required
              />
            </div>

            <div>
              <Label className="text-xs">Category</Label>
              <Select value={newItemCategory} onValueChange={setNewItemCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Portioned Meats">Portioned Meats</SelectItem>
                  <SelectItem value="Prepped Ingredients">Prepped Ingredients</SelectItem>
                  <SelectItem value="Semi-Finished Goods">Semi-Finished Goods</SelectItem>
                  <SelectItem value="Custom Portion">Custom Portion</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Base Unit</Label>
                <Select value={newItemUnit} onValueChange={setNewItemUnit}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pc">pc</SelectItem>
                    <SelectItem value="pcs">pcs</SelectItem>
                    <SelectItem value="portion">portion</SelectItem>
                    <SelectItem value="slice">slice</SelectItem>
                    <SelectItem value="pack">pack</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">SKU (Optional)</Label>
                <Input
                  placeholder="Auto-generated if empty"
                  value={newItemSku}
                  onChange={e => setNewItemSku(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowQuickItemModal(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                Save Item
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* MODAL: Reject Reason */}
      <Dialog open={showRejectModal} onOpenChange={setShowRejectModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-500">Reject Portioning Request</DialogTitle>
            <DialogDescription>Specify why this conversion request is being rejected.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label className="text-xs">Rejection Reason</Label>
            <Textarea
              placeholder="e.g. Quantity mismatch or unauthorized prep batch"
              value={rejectionReasonText}
              onChange={e => setRejectionReasonText(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowRejectModal(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRejectSubmit}>Reject Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Request Details */}
      {selectedRequest && (
        <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-mono text-amber-500 flex items-center justify-between">
                <span>{selectedRequest.control_number || 'PRT-DETAILS'}</span>
                {selectedRequest.status === 'pending' && <Badge variant="outline" className="bg-amber-500/10 text-amber-500">Pending</Badge>}
                {selectedRequest.status === 'approved' && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500">Approved</Badge>}
                {selectedRequest.status === 'rejected' && <Badge variant="outline" className="bg-rose-500/10 text-rose-500">Rejected</Badge>}
              </DialogTitle>
              <DialogDescription>
                Portioning & Yield Conversion Request Details
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm py-2">
              <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 rounded border">
                <div>
                  <span className="text-xs text-muted-foreground block">Branch</span>
                  <span className="font-semibold">{selectedRequest.branches?.name || 'Main'}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block">Requested By</span>
                  <span className="font-semibold">{selectedRequest.requested_user?.full_name || 'Staff'}</span>
                </div>
              </div>

              <div className="p-3 bg-amber-500/5 rounded border border-amber-500/20 space-y-2">
                <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider">Source Raw Item Consumed</p>
                <div className="flex justify-between items-center">
                  <span className="font-medium">{selectedRequest.source_item?.item_name}</span>
                  <span className="font-bold text-amber-400">
                    -{selectedRequest.source_quantity} {selectedRequest.source_item?.base_unit}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-emerald-500/5 rounded border border-emerald-500/20 space-y-2">
                <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">Target Portion Item Yielded</p>
                <div className="flex justify-between items-center">
                  <span className="font-medium">{selectedRequest.target_item?.item_name}</span>
                  <span className="font-bold text-emerald-400">
                    +{selectedRequest.target_quantity} {selectedRequest.target_item?.base_unit}
                  </span>
                </div>
              </div>

              {selectedRequest.waste_quantity > 0 && (
                <div className="p-3 bg-rose-500/5 rounded border border-rose-500/20">
                  <span className="text-xs font-semibold text-rose-400 block">Trim Loss / Waste</span>
                  <p className="text-xs font-bold text-rose-300">
                    {selectedRequest.waste_quantity} kg — {selectedRequest.waste_reason || 'No reason specified'}
                  </p>
                </div>
              )}

              {selectedRequest.remarks && (
                <div>
                  <span className="text-xs text-muted-foreground block">Remarks</span>
                  <p className="text-xs italic bg-muted p-2 rounded">{selectedRequest.remarks}</p>
                </div>
              )}

              {selectedRequest.rejection_reason && (
                <div className="p-2 bg-rose-950/40 border border-rose-500/40 rounded">
                  <span className="text-xs font-bold text-rose-400 block">Rejection Reason</span>
                  <p className="text-xs text-rose-200">{selectedRequest.rejection_reason}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowDetailModal(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
