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
import {
  BookOpen,
  HelpCircle,
  Scale,
  Package,
  Truck,
  Utensils,
  CheckCircle2,
  Sparkles,
  Layers
} from 'lucide-react';
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
  packaging_unit?: string | null;
  package_count?: number | null;
  pieces_per_pack?: number | null;
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
  source_item?: { item_name: string; base_unit: string; purchase_unit?: string; conversion_factor?: number; category: string; cost_per_base_unit: number };
  target_item?: { item_name: string; base_unit: string; purchase_unit?: string; conversion_factor?: number; category: string; cost_per_base_unit: number };
  requested_user?: { full_name: string };
  approved_user?: { full_name: string };
}

export interface PortionPackagingBreakdown {
  hasBreakdown: boolean;
  packCount: number;
  pcsPerPack: number;
  totalPcs: number;
  displayUnit: string;
  badgeText: string;
  fullText: string;
}

export function getPortionPackagingBreakdown(req: PortioningRequest): PortionPackagingBreakdown | null {
  const targetUnit = req.target_item?.base_unit || 'pcs';
  const targetItemName = req.target_item?.item_name || '';

  // 1. Check direct database columns on request
  if (req.package_count && req.pieces_per_pack && Number(req.package_count) > 0 && Number(req.pieces_per_pack) > 0) {
    const packCount = Number(req.package_count);
    const pcsPerPack = Number(req.pieces_per_pack);
    const totalPcs = targetUnit === 'pack' ? packCount * pcsPerPack : Number(req.target_quantity || (packCount * pcsPerPack));
    return {
      hasBreakdown: true,
      packCount,
      pcsPerPack,
      totalPcs,
      displayUnit: targetUnit === 'pack' ? 'pcs' : targetUnit,
      badgeText: `${packCount} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs`,
      fullText: `${packCount} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs/pack = ${totalPcs} pcs total`
    };
  }

  // 2. Check remarks for recorded format like "📦 50 packs × 5 pcs" or "4 packs of 5 pcs"
  if (req.remarks) {
    const match = req.remarks.match(/(\d+(?:\.\d+)?)\s*packs?\s*(?:×|x|of|@)\s*(\d+(?:\.\d+)?)\s*pcs?/i);
    if (match) {
      const packCount = parseFloat(match[1]);
      const pcsPerPack = parseFloat(match[2]);
      const totalPcs = packCount * pcsPerPack;
      return {
        hasBreakdown: true,
        packCount,
        pcsPerPack,
        totalPcs,
        displayUnit: 'pcs',
        badgeText: `${packCount} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs`,
        fullText: `${packCount} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs/pack = ${totalPcs} pcs total`
      };
    }
  }

  // 3. Check target_item metadata (conversion factor / purchase unit)
  const convFactor = req.target_item?.conversion_factor;
  if (convFactor && convFactor > 1) {
    if (targetUnit === 'pack' || targetItemName.toLowerCase().includes('pack')) {
      const packCount = Number(req.target_quantity);
      const pcsPerPack = convFactor;
      const totalPcs = packCount * pcsPerPack;
      return {
        hasBreakdown: true,
        packCount,
        pcsPerPack,
        totalPcs,
        displayUnit: 'pcs',
        badgeText: `${packCount} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs`,
        fullText: `${packCount} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs/pack = ${totalPcs} pcs total`
      };
    } else {
      const pcsPerPack = convFactor;
      const totalPcs = Number(req.target_quantity);
      const packCount = Math.floor(totalPcs / pcsPerPack);
      return {
        hasBreakdown: true,
        packCount: packCount > 0 ? packCount : 1,
        pcsPerPack,
        totalPcs,
        displayUnit: targetUnit,
        badgeText: `${packCount > 0 ? packCount : 1} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs`,
        fullText: `${packCount > 0 ? packCount : 1} ${packCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs/pack = ${totalPcs} ${targetUnit} total`
      };
    }
  }

  return null;
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
  available_branches?: string[] | null;
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
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [guideLanguage, setGuideLanguage] = useState<'both' | 'bisaya' | 'english'>('both');
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
  const [portionPackCount, setPortionPackCount] = useState<string>('4');
  const [portionPackSize, setPortionPackSize] = useState<string>('5');
  const [portionYieldMode, setPortionYieldMode] = useState<'pack' | 'direct'>('pack');

  // Search popover states inside form
  const [sourceSearchTerm, setSourceSearchTerm] = useState('');
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState('All');
  const [targetSearchTerm, setTargetSearchTerm] = useState('');
  const [targetCategoryFilter, setTargetCategoryFilter] = useState('All');
  const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
  const [targetPopoverOpen, setTargetPopoverOpen] = useState(false);

  // Quick New Item Form state
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Portioned Meats');
  const [newItemUnit, setNewItemUnit] = useState('pc');
  const [newItemPackSize, setNewItemPackSize] = useState('5');
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
            source_item:source_item_id (item_name, base_unit, purchase_unit, conversion_factor, category, cost_per_base_unit),
            target_item:target_item_id (item_name, base_unit, purchase_unit, conversion_factor, category, cost_per_base_unit),
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
            source_item:source_item_id (item_name, base_unit, purchase_unit, conversion_factor, category, cost_per_base_unit),
            target_item:target_item_id (item_name, base_unit, purchase_unit, conversion_factor, category, cost_per_base_unit)
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
        .select('*, available_branches')
        .eq('status', 'active')
        .order('item_name', { ascending: true });

      if (catErr) throw catErr;
      setItemsCatalog(catData || []);

      // 3. Fetch Stock Balances for current branch
      const branchIdToFetch = selectedBranch ? selectedBranch.id : (branches[0]?.id || '');
      if (branchIdToFetch) {
        const { data, error: balErr } = await supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .eq('branch_id', branchIdToFetch);

        if (!balErr && data) {
          const map: Record<string, number> = {};
          data.forEach(b => {
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
    setFormTargetQty('20');
    setPortionPackCount('4');
    setPortionPackSize('5');
    setPortionYieldMode('pack');
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
      const packMultiplier = Number(newItemPackSize) > 0 ? Number(newItemPackSize) : 1;
      const { data, error } = await supabase
        .from('inventory_items')
        .insert({
          sku,
          item_name: newItemName.trim(),
          category: newItemCategory,
          base_unit: newItemUnit,
          purchase_unit: 'pack',
          conversion_factor: packMultiplier,
          reorder_level: 10,
          cost_per_base_unit: 0,
          status: 'active'
        })
        .select('*')
        .single();

      if (error) throw error;
      showSuccess(`Item "${data.item_name}" created successfully! (1 pack = ${packMultiplier} ${newItemUnit})`);
      setItemsCatalog(prev => [...prev, data]);
      setFormTargetItemId(data.id);
      setPortionPackSize(packMultiplier.toString());
      setShowQuickItemModal(false);
      setNewItemName('');
      setNewItemSku('');
      setNewItemPackSize('5');
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

    const pkgCount = portionYieldMode === 'pack' ? (Number(portionPackCount) || null) : null;
    const pcsPerPack = portionYieldMode === 'pack' ? (Number(portionPackSize) || null) : null;

    let transparentRemarks = formRemarks.trim();
    if (portionYieldMode === 'pack' && pkgCount && pcsPerPack) {
      const packNote = `${pkgCount} ${pkgCount === 1 ? 'pack' : 'packs'} × ${pcsPerPack} pcs/pack (= ${targetQty} pcs total)`;
      transparentRemarks = transparentRemarks ? `${transparentRemarks} (${packNote})` : packNote;
    }

    try {
      const insertPayload: any = {
        branch_id: formBranchId,
        source_item_id: formSourceItemId,
        source_quantity: sourceQty,
        target_item_id: formTargetItemId,
        target_quantity: targetQty,
        waste_quantity: wasteQty,
        waste_reason: formWasteReason.trim() || null,
        remarks: transparentRemarks || null,
        requested_by: profile?.id,
        status: 'pending'
      };

      if (portionYieldMode === 'pack' && pkgCount && pcsPerPack) {
        insertPayload.packaging_unit = 'pack';
        insertPayload.package_count = pkgCount;
        insertPayload.pieces_per_pack = pcsPerPack;
      }

      const { error } = await supabase.from('portioning_requests').insert(insertPayload);
      if (error) {
        // Fallback in case package_count/pieces_per_pack columns aren't in database yet
        if (error.message?.includes('package_count') || error.message?.includes('pieces_per_pack') || (error as any).code === '42703') {
          delete insertPayload.packaging_unit;
          delete insertPayload.package_count;
          delete insertPayload.pieces_per_pack;
          const { error: fallbackErr } = await supabase.from('portioning_requests').insert(insertPayload);
          if (fallbackErr) throw fallbackErr;
        } else {
          throw error;
        }
      }

      // Update target item standard packaging size if declared in pack mode
      if (portionYieldMode === 'pack' && Number(portionPackSize) > 0) {
        await supabase
          .from('inventory_items')
          .update({
            conversion_factor: Number(portionPackSize),
            purchase_unit: 'pack'
          })
          .eq('id', formTargetItemId);
      }

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
    const breakdown = getPortionPackagingBreakdown(request);
    const breakdownMsg = breakdown && breakdown.hasBreakdown ? ` [${breakdown.fullText}]` : '';

    const confirmed = await confirm(
      'Approve Portioning Request',
      `Are you sure you want to approve this conversion?\n\n- Deduct ${request.source_quantity} ${request.source_item?.base_unit || ''} of ${sourceName}\n- Add ${request.target_quantity} ${request.target_item?.base_unit || 'pcs'} of ${targetName}${breakdownMsg}\n- Recalculate cost per unit for ${targetName}`
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
    <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <ChefHat className="h-8 w-8 text-amber-500" /> Portioning & Yield Conversions
          </h2>
          <p className="text-muted-foreground mt-1">
            Request, track, and approve conversions from bulk raw items (kg/L) into portioned pieces (pcs).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowGuideModal(true)} 
            className="border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 gap-1.5 cursor-pointer"
          >
            <BookOpen className="h-4 w-4 text-amber-500" /> How It Works / Giya
          </Button>
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
      <Card className="border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="pl-6">Control #</TableHead>
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
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
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
                  <TableRow key={req.id} className="hover:bg-muted/40 transition-colors">
                    <TableCell className="pl-6 font-mono font-medium text-amber-500">
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
                      {(() => {
                        const breakdown = getPortionPackagingBreakdown(req);
                        return (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-emerald-500 font-mono">
                                +{req.target_quantity} {req.target_item?.base_unit || 'pcs'}
                              </span>
                              {breakdown && breakdown.hasBreakdown && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                  {breakdown.badgeText}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground font-medium">{req.target_item?.item_name || 'Portion'}</p>
                            {breakdown && breakdown.hasBreakdown && (
                              <p className="text-[11px] text-emerald-400/90 font-mono">
                                Total: {breakdown.totalPcs} {breakdown.displayUnit}
                              </p>
                            )}
                          </div>
                        );
                      })()}
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
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b shrink-0">
            <div className="flex items-start justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2 text-amber-500">
                  <ChefHat className="h-5 w-5" /> Submit Stock Portioning Request
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Convert raw inventory (e.g. 50kg meat) into portioned pieces (e.g. 25pcs portion) at the branch level.
                </DialogDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowGuideModal(true)}
                className="text-xs text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/10 gap-1.5 mr-6 shrink-0 h-8 cursor-pointer"
              >
                <HelpCircle className="h-3.5 w-3.5" /> Guide / Giya
              </Button>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreateRequest} className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                  <div className="flex flex-col gap-2 mb-2">
                    <Select value={sourceCategoryFilter} onValueChange={setSourceCategoryFilter}>
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All">All Categories</SelectItem>
                        {Array.from(new Set(itemsCatalog.filter(c => !(selectedBranch?.name?.toLowerCase().includes('main') && c.category?.toLowerCase().includes('portioned'))).map(c => c.category).filter(Boolean))).sort().map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Search raw item..."
                      value={sourceSearchTerm}
                      onChange={e => setSourceSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {(() => {
                      const isInitialState = sourceSearchTerm.trim() === '' && sourceCategoryFilter === 'All';
                      
                      if (isInitialState) {
                        return (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            Start typing or select a category to view items.
                          </div>
                        );
                      }
                      
                      return itemsCatalog
                        .filter(i => {
                          if (selectedBranch?.name?.toLowerCase().includes('main') && i.category?.toLowerCase().includes('portioned')) {
                            return false;
                          }
                          
                          const isAvailable = !i.available_branches || 
                            i.available_branches.length === 0 || 
                            (formBranchId && i.available_branches.includes(formBranchId));
                          const matchesCategory = sourceCategoryFilter === 'All' || i.category === sourceCategoryFilter;
                          return isAvailable && matchesCategory && i.item_name.toLowerCase().includes(sourceSearchTerm.toLowerCase());
                        })
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
                      ));
                    })()}
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
                  <div className="flex flex-col gap-2 mb-2">
                    <Select value={targetCategoryFilter} onValueChange={setTargetCategoryFilter}>
                      <SelectTrigger className="h-8 w-full">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All">All Categories</SelectItem>
                        {Array.from(new Set(itemsCatalog.filter(c => !(selectedBranch?.name?.toLowerCase().includes('main') && c.category?.toLowerCase().includes('portioned'))).map(c => c.category).filter(Boolean))).sort().map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Search target portion item..."
                      value={targetSearchTerm}
                      onChange={e => setTargetSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {(() => {
                      const isInitialState = targetSearchTerm.trim() === '' && targetCategoryFilter === 'All';
                      
                      if (isInitialState) {
                        return (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            Start typing or select a category to view items.
                          </div>
                        );
                      }
                      
                      return itemsCatalog
                        .filter(i => {
                          if (selectedBranch?.name?.toLowerCase().includes('main') && i.category?.toLowerCase().includes('portioned')) {
                            return false;
                          }
                          
                          const isAvailable = !i.available_branches || 
                            i.available_branches.length === 0 || 
                            (formBranchId && i.available_branches.includes(formBranchId));
                          const matchesCategory = targetCategoryFilter === 'All' || i.category === targetCategoryFilter;
                          return isAvailable && matchesCategory && i.item_name.toLowerCase().includes(targetSearchTerm.toLowerCase());
                        })
                        .map(item => (
                        <div
                          key={item.id}
                          className="p-2 hover:bg-accent rounded text-sm cursor-pointer flex justify-between"
                          onClick={() => {
                            setFormTargetItemId(item.id);
                            setTargetPopoverOpen(false);
                            if (item.conversion_factor && item.conversion_factor > 1) {
                              setPortionPackSize(item.conversion_factor.toString());
                              setPortionYieldMode('pack');
                              const total = (Number(portionPackCount) || 1) * item.conversion_factor;
                              setFormTargetQty(total.toString());
                            } else if (item.base_unit === 'pack' || item.purchase_unit === 'pack') {
                              setPortionYieldMode('pack');
                            }
                          }}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{item.item_name}</span>
                            {item.conversion_factor && item.conversion_factor > 1 && (
                              <span className="text-[10px] text-primary font-mono">1 pack = {item.conversion_factor} {item.base_unit}</span>
                            )}
                          </div>
                          <span className="text-xs text-emerald-400">{item.category} ({item.base_unit})</span>
                        </div>
                      ));
                    })()}
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {/* Yield & Packaging Section */}
            <div className="p-3.5 bg-background border border-border/80 rounded-xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <Label className="text-xs font-semibold text-foreground">Portion Yield & Packaging Format</Label>
                <div className="inline-flex rounded-lg border bg-muted/60 p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setPortionYieldMode('pack');
                      const total = (Number(portionPackCount) || 0) * (Number(portionPackSize) || 0);
                      if (total > 0) setFormTargetQty(total.toString());
                    }}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                      portionYieldMode === 'pack'
                        ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>Packs × Pcs</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPortionYieldMode('direct')}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                      portionYieldMode === 'direct'
                        ? 'bg-background text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Direct ({selectedTargetItem?.base_unit || 'pcs'})
                  </button>
                </div>
              </div>

              {portionYieldMode === 'pack' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Packs Made (Bags / Packs)</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={portionPackCount}
                        onChange={e => {
                          const val = e.target.value;
                          setPortionPackCount(val);
                          const total = (Number(val) || 0) * (Number(portionPackSize) || 0);
                          setFormTargetQty(total > 0 ? total.toString() : '');
                        }}
                        placeholder="e.g. 50"
                        className="h-9 bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium text-muted-foreground">Pieces per Pack</Label>
                      <Input
                        type="number"
                        min="1"
                        step="any"
                        value={portionPackSize}
                        onChange={e => {
                          const val = e.target.value;
                          setPortionPackSize(val);
                          const total = (Number(portionPackCount) || 0) * (Number(val) || 0);
                          setFormTargetQty(total > 0 ? total.toString() : '');
                        }}
                        placeholder="e.g. 5"
                        className="h-9 bg-background"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                    <span className="text-foreground font-medium">
                      <strong>Total Output & Disclosure:</strong>
                    </span>
                    <span className="font-bold text-primary font-mono text-sm">
                      {portionPackCount && portionPackSize
                        ? (() => {
                            const pCount = Number(portionPackCount) || 0;
                            const pSize = Number(portionPackSize) || 0;
                            const pieceUnit = (!selectedTargetItem?.base_unit || selectedTargetItem.base_unit.toLowerCase() === 'pack') ? 'pcs' : selectedTargetItem.base_unit;
                            return `${pCount} ${pCount === 1 ? 'pack' : 'packs'} × ${pSize} ${pieceUnit}/pack = ${formTargetQty} ${pieceUnit} (${pCount} ${pCount === 1 ? 'pack' : 'packs'})`;
                          })()
                        : `0 ${selectedTargetItem?.base_unit || 'pcs'}`}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Total Yielded Quantity ({selectedTargetItem?.base_unit || 'pcs'})</Label>
                  <Input
                    type="number"
                    step="any"
                    value={formTargetQty}
                    onChange={e => setFormTargetQty(e.target.value)}
                    placeholder="e.g. 250"
                    className="h-9 bg-background"
                    required
                  />
                  {selectedTargetItem?.conversion_factor && selectedTargetItem.conversion_factor > 1 && (
                    <p className="text-[11px] text-muted-foreground">
                      Standard packaging: {selectedTargetItem.conversion_factor} pcs/pack (≈ {(Number(formTargetQty) / selectedTargetItem.conversion_factor).toFixed(1)} packs)
                    </p>
                  )}
                </div>
              )}
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
                    • Conversion: <span className="text-white font-medium">{sourceQtyNum} {selectedSourceItem.base_unit}</span> → <span className="text-emerald-400 font-medium">
                      {portionYieldMode === 'pack' && portionPackCount && portionPackSize
                        ? `${portionPackCount} packs × ${portionPackSize} pcs/pack (= ${targetQtyNum} pcs total)`
                        : `${targetQtyNum} ${selectedTargetItem.base_unit}`}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    • Calculated Cost per {(!selectedTargetItem?.base_unit || selectedTargetItem.base_unit.toLowerCase() === 'pack') ? 'pc' : selectedTargetItem.base_unit}: <span className="text-emerald-400 font-bold font-mono">₱{computedUnitCost} / {(!selectedTargetItem?.base_unit || selectedTargetItem.base_unit.toLowerCase() === 'pack') ? 'pc' : selectedTargetItem.base_unit}</span>
                    {portionYieldMode === 'pack' && Number(portionPackSize) > 1 && (
                      <span className="text-muted-foreground ml-2">
                        (₱{(Number(computedUnitCost) * (Number(portionPackSize) || 1)).toFixed(2)} / pack)
                      </span>
                    )}
                  </p>
                </div>
              </Card>
            )}

            </div>

            <DialogFooter className="p-6 pt-4 border-t shrink-0 bg-background/80 backdrop-blur-xs flex justify-end gap-2">
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
                <Label className="text-xs">Pieces per Pack (Standard)</Label>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  placeholder="e.g. 5"
                  value={newItemPackSize}
                  onChange={e => setNewItemPackSize(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">SKU (Optional)</Label>
              <Input
                placeholder="Auto-generated if empty"
                value={newItemSku}
                onChange={e => setNewItemSku(e.target.value)}
              />
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
          <DialogContent className="max-w-md max-h-[90vh] flex flex-col p-0 overflow-hidden">
            <DialogHeader className="p-6 pb-4 border-b shrink-0">
              <DialogTitle className="font-mono text-amber-500 flex items-center justify-between">
                <span>{selectedRequest.control_number || 'PRT-DETAILS'}</span>
                {selectedRequest.status === 'pending' && <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">Pending</Badge>}
                {selectedRequest.status === 'approved' && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">Approved</Badge>}
                {selectedRequest.status === 'rejected' && <Badge variant="outline" className="bg-rose-500/10 text-rose-500 border-rose-500/30">Rejected</Badge>}
              </DialogTitle>
              <DialogDescription>
                Portioning & Yield Conversion Request Details
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-3 text-sm">
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
                  <div>
                    <span className="font-medium text-foreground block">{selectedRequest.source_item?.item_name}</span>
                    <span className="text-xs text-muted-foreground">{selectedRequest.source_item?.category}</span>
                  </div>
                  <span className="font-bold text-base text-amber-400 font-mono">
                    -{selectedRequest.source_quantity} {selectedRequest.source_item?.base_unit}
                  </span>
                </div>
              </div>

              {(() => {
                const breakdown = getPortionPackagingBreakdown(selectedRequest);
                return (
                  <div className="p-3.5 bg-emerald-500/10 rounded-xl border border-emerald-500/30 space-y-2.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                        Target Portion Item Yielded
                      </p>
                      {breakdown && breakdown.hasBreakdown && (
                        <Badge variant="outline" className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px] font-semibold">
                          Packaging Transparency
                        </Badge>
                      )}
                    </div>
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-base text-foreground block">{selectedRequest.target_item?.item_name}</span>
                        <span className="text-xs text-muted-foreground">{selectedRequest.target_item?.category || 'Portioned Goods'}</span>
                      </div>
                      <span className="font-bold text-lg text-emerald-400 font-mono">
                        +{selectedRequest.target_quantity} {selectedRequest.target_item?.base_unit || 'pcs'}
                      </span>
                    </div>

                    {breakdown && breakdown.hasBreakdown && (
                      <div className="mt-2 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs space-y-1.5">
                        <div className="flex items-center justify-between text-emerald-300 font-medium">
                          <span><strong>Packaging Breakdown:</strong></span>
                          <span className="font-mono font-bold text-emerald-200">
                            {breakdown.packCount} {breakdown.packCount === 1 ? 'pack' : 'packs'} × {breakdown.pcsPerPack} pcs/pack
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1.5 border-t border-emerald-500/20">
                          <span>Total Atomic Piece Count:</span>
                          <span className="font-bold text-emerald-400 font-mono text-xs">
                            {breakdown.totalPcs} {breakdown.displayUnit}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground italic pt-0.5">
                          Full transparency: Every pack contains {breakdown.pcsPerPack} pieces. Transfers and menu recipes deduct in atomic {breakdown.displayUnit}.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}

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

            <DialogFooter className="p-6 pt-4 border-t shrink-0">
              <Button variant="ghost" onClick={() => setShowDetailModal(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* MODAL: How Portioning, Packaging & Transfers Work (Bilingual Guide) */}
      <Dialog open={showGuideModal} onOpenChange={setShowGuideModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b shrink-0 bg-amber-500/5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-2 text-xl font-bold text-amber-600 dark:text-amber-400">
                  <BookOpen className="h-5 w-5" /> How Portioning & Packaging Works
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Giya sa Portioning, Repacking ug Pagbalhin sa Stocks (Flow from Raw Kg to Pcs, Packs & Transfers)
                </DialogDescription>
              </div>

              {/* Language Selector */}
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border text-xs shrink-0 self-start sm:self-auto">
                <Button
                  type="button"
                  variant={guideLanguage === 'both' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setGuideLanguage('both')}
                  className="h-7 text-xs px-2.5 cursor-pointer"
                >
                  Both / Tanan
                </Button>
                <Button
                  type="button"
                  variant={guideLanguage === 'bisaya' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setGuideLanguage('bisaya')}
                  className="h-7 text-xs px-2.5 cursor-pointer"
                >
                  Bisaya
                </Button>
                <Button
                  type="button"
                  variant={guideLanguage === 'english' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setGuideLanguage('english')}
                  className="h-7 text-xs px-2.5 cursor-pointer"
                >
                  English
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm">
            {/* Real World Concrete Example Box */}
            <div className="rounded-xl p-4 bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-amber-600 dark:text-amber-400">
                  <Sparkles className="h-4 w-4" />
                  <span>Real-World Scenario / Pananglitan sa Tinuod nga Operasyon</span>
                </div>
                <Badge variant="outline" className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 text-[10px] font-semibold">
                  50kg Calamares Example
                </Badge>
              </div>

              {/* Step progression breadcrumbs */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-lg bg-background/80 border flex flex-col items-center justify-center">
                  <Scale className="h-4 w-4 text-muted-foreground mb-1" />
                  <span className="font-bold text-foreground">50 kg Raw</span>
                  <span className="text-[10px] text-muted-foreground">Hilaw nga nukos (kg)</span>
                </div>
                <div className="p-2.5 rounded-lg bg-background/80 border flex flex-col items-center justify-center">
                  <Utensils className="h-4 w-4 text-amber-500 mb-1" />
                  <span className="font-bold text-amber-600 dark:text-amber-400">25 pcs Cooked</span>
                  <span className="text-[10px] text-muted-foreground">Naluto nga buok (pcs)</span>
                </div>
                <div className="p-2.5 rounded-lg bg-background/80 border flex flex-col items-center justify-center">
                  <Package className="h-4 w-4 text-primary mb-1" />
                  <span className="font-bold text-primary">5 Packs (5 pcs/pk)</span>
                  <span className="text-[10px] text-muted-foreground">Gi-pack sa plastic</span>
                </div>
                <div className="p-2.5 rounded-lg bg-background/80 border flex flex-col items-center justify-center">
                  <Truck className="h-4 w-4 text-blue-500 mb-1" />
                  <span className="font-bold text-blue-600 dark:text-blue-400">Transfer 4 Packs</span>
                  <span className="text-[10px] text-muted-foreground">Gipadala sa Talisay (20 pcs)</span>
                </div>
                <div className="p-2.5 rounded-lg bg-background/80 border flex flex-col items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mb-1" />
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">POS Dish Deduction</span>
                  <span className="text-[10px] text-muted-foreground">1 order = -5 pcs recipe</span>
                </div>
              </div>
            </div>

            {/* 5 Step Detailed Flow Cards */}
            <div className="space-y-4">
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Layers className="h-4 w-4 text-amber-500" />
                <span>5-Step Complete Workflow / 5 ka Lakang sa System</span>
              </h3>

              {/* Step 1 */}
              <div className="p-4 rounded-xl border bg-card/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs">
                      1
                    </span>
                    <h4 className="font-bold text-foreground">
                      Bulk Raw Inventory Intake (Hilaw nga Stock sa Timbang)
                    </h4>
                  </div>
                  <Badge variant="outline" className="text-[11px] font-mono">Unit: kg / L / g</Badge>
                </div>
                
                {(guideLanguage === 'both' || guideLanguage === 'english') && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">English:</strong> Raw ingredients (e.g. 50 kg Raw Calamares or 30 kg Pork Belly) arrive from the supplier and are received directly into Commissary Raw Inventory measured in weight or volume (kg, liters).
                  </p>
                )}

                {(guideLanguage === 'both' || guideLanguage === 'bisaya') && (
                  <p className="text-xs text-amber-700/90 dark:text-amber-300/90 leading-relaxed bg-amber-500/5 p-2 rounded-md border border-amber-500/20">
                    <strong className="text-amber-800 dark:text-amber-200">Bisaya:</strong> Ang mga hilaw nga stocks (sama sa 50 kg nga hilaw nga Nukos o Karne) madawat gikan sa supplier ug i-stock sa Commissary gamit ang timbang (kilograms o litro).
                  </p>
                )}
              </div>

              {/* Step 2 */}
              <div className="p-4 rounded-xl border bg-card/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs">
                      2
                    </span>
                    <h4 className="font-bold text-foreground">
                      Kitchen Cooking & Portion Yield (Pagluto ug Pag-ihap sa Pcs)
                    </h4>
                  </div>
                  <Badge variant="outline" className="text-[11px] font-mono text-amber-500 border-amber-500/30">Unit: pcs / buok</Badge>
                </div>

                {(guideLanguage === 'both' || guideLanguage === 'english') && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">English:</strong> Kitchen staff executes a Portioning Request. They take 50 kg raw, cook or slice it, and count the yielded cooked pieces (e.g., 25 pieces). Any trim loss or waste (e.g. 2 kg bones/fat) is recorded transparently.
                  </p>
                )}

                {(guideLanguage === 'both' || guideLanguage === 'bisaya') && (
                  <p className="text-xs text-amber-700/90 dark:text-amber-300/90 leading-relaxed bg-amber-500/5 p-2 rounded-md border border-amber-500/20">
                    <strong className="text-amber-800 dark:text-amber-200">Bisaya:</strong> Lutoon o hiwaon sa kusina ang 50 kg nga hilaw nga stock. Pagkahuman, maihap kung pila ka buok (pcs) ang resulta (pananglitan 25 pcs nga naluto). Kung naay labay o usik (sama sa 2 kg bukog/panit), i-record pud kini aron klaro sa accounting.
                  </p>
                )}
              </div>

              {/* Step 3 */}
              <div className="p-4 rounded-xl border bg-card/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary font-bold text-xs">
                      3
                    </span>
                    <h4 className="font-bold text-foreground">
                      Packaging into Standard Packs (Pag-repack ngadto sa Packs)
                    </h4>
                  </div>
                  <Badge variant="outline" className="text-[11px] font-mono text-primary border-primary/30">Packs × Pcs</Badge>
                </div>

                {(guideLanguage === 'both' || guideLanguage === 'english') && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">English:</strong> The 25 cooked pieces are packed into standard sealed bags (e.g. 5 packs, with exactly 5 pcs in each pack). The system registers the conversion ratio (<code className="bg-muted px-1 py-0.5 rounded text-foreground">1 pack = 5 pcs</code>).
                  </p>
                )}

                {(guideLanguage === 'both' || guideLanguage === 'bisaya') && (
                  <p className="text-xs text-primary/90 leading-relaxed bg-primary/5 p-2 rounded-md border border-primary/20">
                    <strong className="text-primary">Bisaya:</strong> Ang 25 pcs nga naluto i-sulod sa plastic/pack (pananglitan 5 ka packs, diin matag pack naay 5 pcs). Awtomatiko nga itala sa system nga ang 1 pack = 5 pcs.
                  </p>
                )}
              </div>

              {/* Step 4 */}
              <div className="p-4 rounded-xl border bg-card/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold text-xs">
                      4
                    </span>
                    <h4 className="font-bold text-foreground">
                      Branch Transfer & Admin Pack Adjustment (Pagbalhin sa Branch ug Approval)
                    </h4>
                  </div>
                  <Badge variant="outline" className="text-[11px] font-mono text-blue-500 border-blue-500/30">Transfers</Badge>
                </div>

                {(guideLanguage === 'both' || guideLanguage === 'english') && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">English:</strong> A branch requests 4 packs (20 pcs). In the Transfer Approval modal, the Admin can use the <code className="bg-muted px-1 py-0.5 rounded text-foreground">-1 pk / +1 pk</code> steppers to quickly adjust the shipment. Deducting 1 pack automatically reduces the shipment to 15 pcs without manual math.
                  </p>
                )}

                {(guideLanguage === 'both' || guideLanguage === 'bisaya') && (
                  <p className="text-xs text-blue-700/90 dark:text-blue-300/90 leading-relaxed bg-blue-500/5 p-2 rounded-md border border-blue-500/20">
                    <strong className="text-blue-800 dark:text-blue-200">Bisaya:</strong> Ang branch (sama sa Talisay) mag-request og 4 packs (20 pcs). Sa approval modal, ang Admin maka-click dayon sa <code className="bg-muted px-1 py-0.5 rounded font-bold">-1 pk</code> kung gustong kuhaan og 1 pack ang ipadala. Awtomatiko kining mahimong 15 pcs nga dili na kinahanglan magkwenta sa utok.
                  </p>
                )}
              </div>

              {/* Step 5 */}
              <div className="p-4 rounded-xl border bg-card/60 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                      5
                    </span>
                    <h4 className="font-bold text-foreground">
                      Receiving & POS Recipe Deductions (Pagdawat ug Pagbaligya sa POS)
                    </h4>
                  </div>
                  <Badge variant="outline" className="text-[11px] font-mono text-emerald-500 border-emerald-500/30">POS Deduction</Badge>
                </div>

                {(guideLanguage === 'both' || guideLanguage === 'english') && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">English:</strong> The target branch receives the 4 packs (20 pcs) in their freezer. Kitchen staff counts 4 physical packs. When a cashier sells 1 Calamares dish in POS (which uses 5 pcs in the menu recipe), the system deducts 5 pcs, leaving 15 pcs (3 packs) in stock.
                  </p>
                )}

                {(guideLanguage === 'both' || guideLanguage === 'bisaya') && (
                  <p className="text-xs text-emerald-700/90 dark:text-emerald-300/90 leading-relaxed bg-emerald-500/5 p-2 rounded-md border border-emerald-500/20">
                    <strong className="text-emerald-800 dark:text-emerald-200">Bisaya:</strong> Dawaton sa branch ang 4 ka packs sa freezer (20 pcs). Kung naay mopalit og Calamares sa POS (nga naggamit og 5 pcs matag plato), awtomatiko nga minusan og 5 pcs ang stock. Mahabilin ang 15 pcs (katumbas sa 3 ka packs).
                  </p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="p-4 border-t shrink-0 bg-muted/20">
            <Button type="button" onClick={() => setShowGuideModal(false)} className="w-full sm:w-auto cursor-pointer">
              Got It / Nasabtan Na
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
