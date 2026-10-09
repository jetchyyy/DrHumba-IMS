import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { settingsService } from '../lib/settingsService';
import { printTransferSlip } from '../lib/printService';
import { EyeOpenIcon as Eye, ReloadIcon as RefreshCw, SymbolIcon as ArrowRightLeft, TrashIcon as Trash2, FileTextIcon as Printer, CaretSortIcon, MagnifyingGlassIcon, LockClosedIcon as Lock } from '@radix-ui/react-icons';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { format } from 'date-fns';
import { CalendarIcon as Calendar } from '@radix-ui/react-icons';
import { useModal } from '../contexts/ModalContext';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface TransferRequest {
  id: string;
  control_number: string | null;
  source_branch_id: string;
  target_branch_id: string;
  status: 'requested' | 'approved' | 'rejected' | 'pending_receipt_approval' | 'completed';
  remarks: string | null;
  created_at: string;
  requested_by?: string | null;
  approved_by?: string | null;
  requested_by_email?: string | null;
  approved_by_email?: string | null;
  source_branch?: { name: string };
  target_branch?: { name: string };
  receipt_requested_by?: string | null;
  receipt_approved_by?: string | null;
  receipt_requested_by_email?: string | null;
  receipt_approved_by_email?: string | null;
  receipt_remarks?: string | null;
}

interface TransferItem {
  id: string;
  item_id: string;
  quantity_base_unit: number;
  original_quantity_base_unit?: number | null;
  received_quantity_base_unit?: number | null;
  missing_reason?: string | null;
  packaging_unit?: string | null;
  package_count?: number | null;
  pieces_per_pack?: number | null;
  inventory_items?: {
    item_name: string;
    base_unit: string;
    conversion_factor?: number | null;
  };
  is_deleted?: boolean;
}

interface AddedTransferItem {
  item_id: string;
  qty: number;
  packaging_unit?: string;
  package_count?: number;
  pieces_per_pack?: number;
}

interface CatalogItem {
  id: string;
  item_name: string;
  base_unit: string;
  purchase_unit?: string | null;
  conversion_factor?: number | null;
  min_transfer_qty?: number | null;
  available_branches?: string[] | null;
  category: string;
}

export const Transfers: React.FC = () => {
  const { profile, branches, selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  
  const [transfers, setTransfers] = useState<TransferRequest[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  
  // Filter state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, startDate, endDate]);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferRequest | null>(null);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  
  // Request Form state
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [addedItems, setAddedItems] = useState<AddedTransferItem[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState<number | string>('');
  const [entryMode, setEntryMode] = useState<'base' | 'pack'>('base');
  const [packCount, setPackCount] = useState<number | string>('');
  const [packSize, setPackSize] = useState<number | string>('5');
  const [sourceInventory, setSourceInventory] = useState<Record<string, number>>({});
  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('All');
  const [itemPopoverOpen, setItemPopoverOpen] = useState(false);
  
  const [approving, setApproving] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [isProactive, setIsProactive] = useState(false);

  // Discrepancy inputs state
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [missingReasons, setMissingReasons] = useState<Record<string, string>>({});
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  const loadData = async () => {
    try {
      const { data: tranData, error: tranError } = await supabase
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
          receipt_requested_by,
          receipt_approved_by,
          receipt_remarks,
          source_branch:branches!transfer_requests_source_branch_id_fkey(name),
          target_branch:branches!transfer_requests_target_branch_id_fkey(name)
        `)
        .order('created_at', { ascending: false });
      if (tranError) throw tranError;

      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, email');

      const userMap: Record<string, string> = {};
      (profilesData || []).forEach((p: any) => {
        if (p.id && p.email) {
          userMap[p.id] = p.email;
        }
      });

      const mappedTransfers = ((tranData as any[]) || []).map(t => ({
        ...t,
        requested_by_email: t.requested_by ? (userMap[t.requested_by] || null) : null,
        approved_by_email: t.approved_by ? (userMap[t.approved_by] || null) : null,
        receipt_requested_by_email: t.receipt_requested_by ? (userMap[t.receipt_requested_by] || null) : null,
        receipt_approved_by_email: t.receipt_approved_by ? (userMap[t.receipt_approved_by] || null) : null,
      }));

      setTransfers(mappedTransfers);

      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, base_unit, purchase_unit, conversion_factor, min_transfer_qty, available_branches, category')
        .eq('status', 'active');
      if (catError) throw catError;
      setCatalog(catData || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const fetchSourceInventory = async (branchId: string) => {
    if (!branchId) {
      setSourceInventory({});
      return;
    }
    try {
      const { data, error } = await supabase.rpc('fn_get_branch_inventory', {
        p_branch_id: branchId
      });
      if (error) throw error;
      const invMap: Record<string, number> = {};
      if (data) {
        data.forEach((row: any) => {
          invMap[row.item_id] = Number(row.quantity);
        });
      }
      setSourceInventory(invMap);
    } catch (err) {
      console.error("Error fetching source inventory:", err);
    }
  };

  useEffect(() => {
    if (showCreateModal && sourceBranchId) {
      fetchSourceInventory(sourceBranchId);
      setAddedItems([]); // Reset items when source branch changes to prevent invalid stock transfer levels
      setCurrentSelectedItemId('');
      setCurrentQty('');
    } else {
      setSourceInventory({});
    }
  }, [sourceBranchId, showCreateModal]);

  const handleOpenCreateModal = (proactive: boolean = false) => {
    setIsProactive(proactive);
    const warehouse = branches.find(b => b.is_warehouse);
    setSourceBranchId(warehouse?.id || selectedBranch?.id || '');
    setTargetBranchId(proactive ? '' : selectedBranch?.id || '');
    setRemarks('');
    setAddedItems([]);
    setCurrentSelectedItemId('');
    setCurrentQty('');
    setPackCount('');
    setPackSize('5');
    setEntryMode('base');
    setItemSearchTerm('');
    setItemCategoryFilter('All');
    setItemPopoverOpen(false);
    setShowCreateModal(true);
  };

  const handleAddItemToTransfer = () => {
    if (!currentSelectedItemId) return;
    
    const selectedCatalogItem = catalog.find(c => c.id === currentSelectedItemId);
    let qtyToAdd = 0;
    let pkgUnit = 'pc';
    let pkgCount: number | undefined = undefined;
    let pcsPerPkg: number | undefined = undefined;
    const hasDefinedPackSize = Boolean(selectedCatalogItem?.conversion_factor && Number(selectedCatalogItem.conversion_factor) > 1);
    const effectivePackSize = hasDefinedPackSize ? Number(selectedCatalogItem?.conversion_factor) : Number(packSize);

    if (entryMode === 'pack') {
      const pCount = Number(packCount);
      const pSize = effectivePackSize;
      if (isNaN(pCount) || pCount <= 0 || isNaN(pSize) || pSize <= 0) {
        showError("Please enter a valid pack count.");
        return;
      }
      qtyToAdd = pCount * pSize;
      pkgUnit = 'pack';
      pkgCount = pCount;
      pcsPerPkg = pSize;
    } else {
      qtyToAdd = Number(currentQty);
      if (isNaN(qtyToAdd) || qtyToAdd <= 0) {
        showError("Please enter a valid quantity greater than zero.");
        return;
      }
    }

    const minQty = selectedCatalogItem?.min_transfer_qty && selectedCatalogItem.min_transfer_qty > 0 ? selectedCatalogItem.min_transfer_qty : null;
    if (minQty !== null && qtyToAdd < minQty) {
      showError(`Quantity for ${selectedCatalogItem?.item_name || 'item'} must be at least ${minQty} ${selectedCatalogItem?.base_unit || ''}.`);
      return;
    }

    const availableQty = sourceInventory[currentSelectedItemId] || 0;
    const exists = addedItems.find(i => i.item_id === currentSelectedItemId);
    if (exists) {
      showError("Item already added. Please modify it or delete first.");
      return;
    }

    if (isProactive && qtyToAdd > availableQty) {
      showError(`Cannot transfer exceeding available quantity of ${availableQty} in the source branch inventory.`);
      return;
    }

    setAddedItems([
      ...addedItems,
      {
        item_id: currentSelectedItemId,
        qty: qtyToAdd,
        packaging_unit: pkgUnit,
        package_count: pkgCount,
        pieces_per_pack: pcsPerPkg
      }
    ]);
    setItemSearchTerm('');
    setCurrentQty('');
    setPackCount('');
  };

  const handleRemoveItem = (index: number) => {
    setAddedItems(addedItems.filter((_, i) => i !== index));
  };

  const handleSaveTransferRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    if (sourceBranchId === targetBranchId) {
      showError("Source and Target branch cannot be the same");
      return;
    }

    if (addedItems.length === 0) {
      showError("Add at least one item to transfer");
      return;
    }

    // Final validation of added items against minimum quantity and source inventory balances
    for (const item of addedItems) {
      const info = catalog.find(c => c.id === item.item_id);
      const minQty = info?.min_transfer_qty && info.min_transfer_qty > 0 ? info.min_transfer_qty : null;
      if (minQty !== null && item.qty < minQty) {
        showError(`Quantity for ${info?.item_name || 'item'} must be at least ${minQty} ${info?.base_unit || ''}.`);
        return;
      }
      const availableQty = sourceInventory[item.item_id] || 0;
      if (isProactive && item.qty > availableQty) {
        showError(`Cannot transfer exceeding available quantity of ${availableQty} for ${info?.item_name || 'item'} in the source branch inventory.`);
        return;
      }
    }

    try {
      const itemsPayload = addedItems.map(item => ({
        item_id: item.item_id,
        quantity_base_unit: item.qty,
        packaging_unit: item.packaging_unit || 'pc',
        package_count: item.package_count || null,
        pieces_per_pack: item.pieces_per_pack || null
      }));

      if (isProactive) {
        const { error } = await supabase.rpc('fn_send_transfer', {
          p_source_branch_id: sourceBranchId,
          p_target_branch_id: targetBranchId,
          p_items: itemsPayload
        });

        if (error) throw error;
        showSuccess("Stock shipment sent and in transit successfully!");
      } else {
        const { error } = await supabase.rpc('fn_request_transfer', {
          p_source_branch_id: sourceBranchId,
          p_target_branch_id: targetBranchId,
          p_items: itemsPayload
        });

        if (error) throw error;
        showSuccess("Transfer request submitted successfully!");
      }

      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error submitting transfer');
    }
  };

  const handleViewTransfer = async (transfer: TransferRequest) => {
    setSelectedTransfer(transfer);
    try {
      let items: any[] = [];
      try {
        const { data, error } = await supabase
          .from('transfer_items')
          .select(`
            id,
            item_id,
            quantity_base_unit,
            original_quantity_base_unit,
            received_quantity_base_unit,
            missing_reason,
            packaging_unit,
            package_count,
            pieces_per_pack,
            inventory_items (
              item_name,
              base_unit,
              conversion_factor
            )
          `)
          .eq('transfer_id', transfer.id);
        
        if (error) throw error;
        items = data || [];
      } catch (colErr) {
        // Fallback for older schemas
        const { data, error } = await supabase
          .from('transfer_items')
          .select(`
            id,
            item_id,
            quantity_base_unit,
            received_quantity_base_unit,
            missing_reason,
            inventory_items (
              item_name,
              base_unit,
              conversion_factor
            )
          `)
          .eq('transfer_id', transfer.id);
        
        if (error) throw error;
        items = data || [];
      }

      // Fetch source branch inventory balances for live stock check during approval
      if (transfer.source_branch_id) {
        const { data: bData } = await supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .eq('branch_id', transfer.source_branch_id);
        if (bData) {
          const invMap: Record<string, number> = {};
          bData.forEach((b: any) => { invMap[b.item_id] = Number(b.quantity) || 0; });
          setSourceInventory(invMap);
        }
      }

      const formattedItems = items.map(it => {
        const catalogItem = (catalog || []).find((c: any) => c.id === it.item_id);
        const pcsPerPack = Number(it.pieces_per_pack) || Number(it.inventory_items?.conversion_factor) || Number(catalogItem?.conversion_factor) || 5;
        const rawPackageCount = it.package_count !== null && it.package_count !== undefined ? Number(it.package_count) : null;
        const derivedPackageCount = (rawPackageCount !== null && rawPackageCount > 0)
          ? rawPackageCount
          : (pcsPerPack > 0 ? Math.floor(Number(it.quantity_base_unit) / pcsPerPack) : 1);

        return {
          ...it,
          packaging_unit: it.packaging_unit || 'pack',
          pieces_per_pack: pcsPerPack,
          package_count: derivedPackageCount,
          original_quantity_base_unit: it.original_quantity_base_unit ?? it.quantity_base_unit,
          is_deleted: false
        };
      });
      setTransferItems(formattedItems);

      // Initialize discrepancy inputs state
      const rq: Record<string, number> = {};
      const mr: Record<string, string> = {};
      formattedItems.forEach(item => {
        rq[item.item_id] = item.received_quantity_base_unit !== null && item.received_quantity_base_unit !== undefined
          ? item.received_quantity_base_unit
          : item.quantity_base_unit;
        mr[item.item_id] = item.missing_reason || '';
      });
      setReceivedQuantities(rq);
      setMissingReasons(mr);
      setRejectRemarks('');

      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      showError("Error fetching transfer items");
    }
  };

  const getItemPcsPerPack = (item: any) => {
    const directPcs = Number(item.pieces_per_pack);
    if (directPcs > 0) return directPcs;
    const dbConv = Number(item.inventory_items?.conversion_factor);
    if (dbConv > 1) return dbConv;
    const catalogItem = catalog.find(c => c.id === item.item_id);
    const catConv = Number(catalogItem?.conversion_factor);
    if (catConv > 1) return catConv;
    if (item.packaging_unit === 'pack' || catalogItem?.purchase_unit === 'pack') {
      return dbConv > 0 ? dbConv : (catConv > 0 ? catConv : 5);
    }
    return 1;
  };

  const handleUpdateItemPackCount = (index: number, newPackCount: number) => {
    setTransferItems(prev => {
      const updated = [...prev];
      const item = updated[index];
      if (!item) return prev;
      const pcsPerPack = getItemPcsPerPack(item);
      const pCount = Math.max(0, newPackCount);
      updated[index] = {
        ...item,
        packaging_unit: pcsPerPack > 1 ? 'pack' : (item.packaging_unit || 'pc'),
        package_count: pCount,
        pieces_per_pack: pcsPerPack,
        quantity_base_unit: pcsPerPack > 1 ? pCount * pcsPerPack : pCount
      };
      return updated;
    });
  };

  const handleStepItemPackCount = (index: number, delta: number) => {
    setTransferItems(prev => {
      const updated = [...prev];
      const item = updated[index];
      if (!item) return prev;
      const pcsPerPack = getItemPcsPerPack(item);
      const currentPacks = (item.package_count !== undefined && item.package_count !== null)
        ? Number(item.package_count)
        : (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : Number(item.quantity_base_unit));
      const newPacks = Math.max(0, currentPacks + delta);
      updated[index] = {
        ...item,
        packaging_unit: pcsPerPack > 1 ? 'pack' : (item.packaging_unit || 'pc'),
        package_count: newPacks,
        pieces_per_pack: pcsPerPack,
        quantity_base_unit: pcsPerPack > 1 ? newPacks * pcsPerPack : newPacks
      };
      return updated;
    });
  };

  const handleUpdateItemDirectQty = (index: number, newQty: number) => {
    setTransferItems(prev => {
      const updated = [...prev];
      const item = updated[index];
      if (!item) return prev;
      const qty = Math.max(0, newQty);
      const pcsPerPack = getItemPcsPerPack(item);
      const newPackCount = pcsPerPack > 1 ? Math.floor(qty / pcsPerPack) : (item.package_count || 1);
      updated[index] = {
        ...item,
        quantity_base_unit: qty,
        package_count: newPackCount,
        pieces_per_pack: pcsPerPack
      };
      return updated;
    });
  };

  const handleToggleDeleteItem = (index: number) => {
    setTransferItems(prev => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = {
          ...updated[index],
          is_deleted: !updated[index].is_deleted
        };
      }
      return updated;
    });
  };

  const handleApproveTransfer = async (transferId: string) => {
    const activeItems = transferItems.filter(i => !i.is_deleted);
    if (activeItems.length === 0) {
      showError("Cannot approve a transfer with 0 items. Please reject the transfer request if you do not wish to dispatch any items.");
      return;
    }

    for (const item of activeItems) {
      if (isNaN(item.quantity_base_unit) || item.quantity_base_unit <= 0) {
        showError(`Please specify a valid quantity greater than 0 for ${item.inventory_items?.item_name || 'item'}.`);
        return;
      }
      const availStock = sourceInventory[item.item_id] ?? 0;
      if (item.quantity_base_unit > availStock) {
        showError(`Source branch has insufficient stock for ${item.inventory_items?.item_name || 'item'}. Available: ${availStock}, Approved: ${item.quantity_base_unit}`);
        return;
      }
    }

    const hasModifications = transferItems.some(item => 
      item.is_deleted || (item.original_quantity_base_unit && Number(item.original_quantity_base_unit) !== Number(item.quantity_base_unit))
    );

    const confirmMessage = hasModifications
      ? 'You have adjusted quantities or removed items for this shipment. Are you sure you want to approve and dispatch these items?'
      : 'Are you sure you want to approve and dispatch this transfer? Stock will be immediately deducted from the source branch and marked as in transit.';

    if (!await confirm('Approve & Dispatch Transfer', confirmMessage)) return;

    setApproving(true);
    try {
      // 1. Apply any deletions and quantity updates in transfer_items table
      for (const item of transferItems) {
        if (item.is_deleted) {
          const { error: delErr } = await supabase
            .from('transfer_items')
            .delete()
            .eq('id', item.id);
          if (delErr) throw delErr;
        } else {
          const { error: updateErr } = await supabase
            .from('transfer_items')
            .update({
              quantity_base_unit: item.quantity_base_unit,
              package_count: item.package_count ?? null,
              pieces_per_pack: item.pieces_per_pack ?? null,
              original_quantity_base_unit: item.original_quantity_base_unit || item.quantity_base_unit
            })
            .eq('id', item.id);
          if (updateErr) {
            // Fallback in case original_quantity_base_unit column is pending migration reload
            if (updateErr.message?.includes('original_quantity_base_unit') || (updateErr as any).code === '42703') {
              await supabase
                .from('transfer_items')
                .update({
                  quantity_base_unit: item.quantity_base_unit,
                  package_count: item.package_count ?? null,
                  pieces_per_pack: item.pieces_per_pack ?? null
                })
                .eq('id', item.id);
            } else {
              throw updateErr;
            }
          }
        }
      }

      // 2. Execute approve transfer deduction RPC
      const { error } = await supabase.rpc('fn_approve_transfer', {
        p_transfer_id: transferId
      });

      if (error) throw error;

      showSuccess("Transfer request approved and stock is now in transit!");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to approve transfer.');
    } finally {
      setApproving(false);
    }
  };

  const handleReceiveTransfer = async (transferId: string) => {
    if (!await confirm(
      'Confirm & Receive Items',
      'Confirm that you have received the exact items and quantities in this shipment?'
    )) return;

    setReceiving(true);
    try {
      const { error } = await supabase.rpc('fn_receive_transfer', {
        p_transfer_id: transferId
      });

      if (error) throw error;

      showSuccess("Stock shipment received and confirmed successfully!");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to receive stock.');
    } finally {
      setReceiving(false);
    }
  };

  const handleReceiveDiscrepancyTransfer = async (transferId: string) => {
    try {
      // Validate that all missing items have a reason specified
      const itemsPayload = transferItems.map(item => {
        const received = receivedQuantities[item.item_id] ?? item.quantity_base_unit;
        const reason = missingReasons[item.item_id] || '';
        
        if (received < 0) {
          throw new Error(`Arrived quantity for ${item.inventory_items?.item_name || 'item'} cannot be negative.`);
        }
        if (received > item.quantity_base_unit) {
          throw new Error(`Arrived quantity for ${item.inventory_items?.item_name || 'item'} cannot exceed the dispatched quantity (${item.quantity_base_unit}).`);
        }
        if (received < item.quantity_base_unit && !reason.trim()) {
          throw new Error(`A reason/note is required for the missing quantity of ${item.inventory_items?.item_name || 'item'}.`);
        }
        
        return {
          item_id: item.item_id,
          received_quantity_base_unit: received,
          missing_reason: received < item.quantity_base_unit ? reason.trim() : null
        };
      });

      if (!await confirm(
        'Submit Receipt for Admin Approval',
        'Are you sure you want to submit this receipt with discrepancy reports? Stock will NOT be added until an admin approves the discrepancy.'
      )) return;

      setSubmittingReceipt(true);
      const { error } = await supabase.rpc('fn_submit_transfer_receipt', {
        p_transfer_id: transferId,
        p_items: itemsPayload
      });

      if (error) throw error;

      showSuccess("Discrepancy receipt submitted. Awaiting admin approval.");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to submit receipt.');
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const handleApproveReceipt = async (transferId: string) => {
    if (!await confirm(
      'Approve Delivery Receipt',
      'Are you sure you want to approve this delivery receipt? The received quantities will be added to the target branch inventory and a stock receipt will be generated.'
    )) return;

    setSubmittingReceipt(true);
    try {
      const { error } = await supabase.rpc('fn_approve_transfer_receipt', {
        p_transfer_id: transferId
      });

      if (error) throw error;

      showSuccess("Delivery receipt approved and inventory updated!");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to approve receipt.');
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const handleRejectReceipt = async (transferId: string) => {
    if (!rejectRemarks.trim()) {
      showError("Please enter a reason/remarks for rejecting this receipt.");
      return;
    }

    if (!await confirm(
      'Reject Delivery Receipt',
      'Are you sure you want to reject this receipt? The transfer will be reset back to In Transit and discrepancy values will be cleared.'
    )) return;

    setSubmittingReceipt(true);
    try {
      const { error } = await supabase.rpc('fn_reject_transfer_receipt', {
        p_transfer_id: transferId,
        p_remarks: rejectRemarks.trim()
      });

      if (error) throw error;

      showSuccess("Delivery receipt rejected and reverted back to in-transit status.");
      setShowRejectDialog(false);
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to reject receipt.');
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const handleRejectTransfer = async (transferId: string) => {
    if (!await confirm('Reject Request', 'Are you sure you want to reject this request?')) return;

    try {
      const { error } = await supabase
        .from('transfer_requests')
        .update({ status: 'rejected', reviewed_by: profile?.id })
        .eq('id', transferId);

      if (error) throw error;

      showSuccess("Transfer request rejected successfully.");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to reject transfer.');
    }
  };

  const handlePrintReceipt = async (transfer: TransferRequest, items: TransferItem[]) => {
    try {
      const settings = await settingsService.getSettings();
      printTransferSlip(transfer, items, settings.transfer_slip);
    } catch (err) {
      console.error('Failed to print transfer receipt:', err);
      showError("Failed to load print templates.");
    }
  };

  const hasActionPermission = profile && (
    profile.role_name === 'super_admin' || 
    (profile.allowed_tabs && profile.allowed_tabs.includes('action_buttons'))
  );

  const handleDeleteTransfer = async (transfer: TransferRequest) => {
    const isCompletedOrApproved = ['completed', 'approved'].includes(transfer.status);
    const message = isCompletedOrApproved
      ? `Are you sure you want to delete transfer request ${transfer.control_number || transfer.id}? WARNING: This transfer is already ${transfer.status.toUpperCase()}. Deleting it will not reverse the stock movements that occurred.`
      : `Are you sure you want to delete transfer request ${transfer.control_number || transfer.id}?`;

    if (!await confirm('Delete Transfer Request', message)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('transfer_requests')
        .delete()
        .eq('id', transfer.id);

      if (error) throw error;

      showSuccess("Transfer request deleted successfully");
      loadData();
    } catch (err: any) {
      console.error('Error deleting transfer request:', err);
      showError(err.message || 'Error deleting transfer request');
    }
  };

  const canApprove = profile && (
    ['super_admin', 'inventory_manager', 'branch_manager'].includes(profile.role_name) ||
    profile.is_platform_admin ||
    (profile.allowed_tabs && profile.allowed_tabs.includes('transfers_dispatch'))
  );

  const filteredTransfers = transfers.filter(transfer => {
    let matchesDate = true;
    const tDate = new Date(transfer.created_at);
    const now = new Date();

    if (dateFilter === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      matchesDate = tDate >= todayStart;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchesDate = tDate >= weekAgo;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchesDate = tDate >= monthAgo;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && tDate >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && tDate <= end;
      }
    }
    return matchesDate;
  });

  const totalPages = Math.ceil(filteredTransfers.length / itemsPerPage);
  const paginatedTransfers = filteredTransfers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <ArrowRightLeft className="w-8 h-8 text-primary" />
            <span>Stock Transfers</span>
          </h2>
          <p className="text-muted-foreground">Request, send, and confirm inventory movements between locations.</p>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {(profile?.role_name === 'super_admin' || profile?.role_name === 'inventory_manager' || selectedBranch?.is_warehouse || (profile?.allowed_tabs && profile.allowed_tabs.includes('transfers_dispatch'))) && (
            <Button variant="default" onClick={() => handleOpenCreateModal(true)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Send Shipment
            </Button>
          )}

          <Button variant="secondary" onClick={() => handleOpenCreateModal(false)}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Request Transfer
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground font-medium">Filter by Date:</span>
          <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last 30 Days</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {dateFilter === 'custom' && (
        <Card className="bg-muted/30 mb-6">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-4 text-sm">
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <span className="text-muted-foreground">Start:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[150px] justify-start text-left font-normal h-9">
                    <Calendar className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent mode="single" selected={startDate} onSelect={setStartDate} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <span className="text-muted-foreground">End:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[150px] justify-start text-left font-normal h-9">
                    <Calendar className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent mode="single" selected={endDate} onSelect={setEndDate} />
                </PopoverContent>
              </Popover>
            </div>
            {(startDate || endDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStartDate(undefined);
                  setEndDate(undefined);
                }}
                className="text-muted-foreground"
              >
                Clear Custom
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="px-6 py-4">
          <CardTitle>Transfer History</CardTitle>
          <CardDescription>Log of all requested and completed branch transfers.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Control No / Date</TableHead>
                <TableHead>Source Branch</TableHead>
                <TableHead>Target Branch</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No stock transfers found for the selected dates.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTransfers.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="pl-6">
                    <div className="font-bold">{t.control_number || 'Pending'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{new Date(t.created_at).toLocaleDateString()}</div>
                  </TableCell>
                  <TableCell className="font-semibold">{t.source_branch?.name || 'Unknown'}</TableCell>
                  <TableCell className="font-semibold text-primary">{t.target_branch?.name || 'Unknown'}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">{t.remarks || 'No remarks'}</TableCell>
                  <TableCell>
                    <Badge variant={
                      t.status === 'completed' ? 'default' :
                      t.status === 'approved' ? 'default' :
                      t.status === 'rejected' ? 'destructive' : 'secondary'
                    } className="uppercase text-[10px]">
                      {t.status === 'approved' ? 'In Transit' : t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex justify-end space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewTransfer(t)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </Button>
                      {hasActionPermission && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteTransfer(t)}
                          title="Delete Transfer Request"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="py-4 border-t">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <PaginationItem key={i}>
                      <PaginationLink 
                        onClick={() => setCurrentPage(i + 1)}
                        isActive={currentPage === i + 1}
                        className="cursor-pointer"
                      >
                        {i + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CREATE MODAL */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b shrink-0">
            <DialogTitle>{isProactive ? 'Send Stock Shipment' : 'New Transfer Request'}</DialogTitle>
            <DialogDescription>
              {isProactive ? 'Ship inventory from your branch to another location.' : 'Request inventory from a warehouse or branch.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveTransferRequest} className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source Branch (From) *</Label>
                  <Select value={sourceBranchId} onValueChange={setSourceBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="-- Select Source --" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(b => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Target Branch (To) *</Label>
                  <Select value={targetBranchId} onValueChange={setTargetBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="-- Select Target --" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(b => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Remarks / Purpose</Label>
                <Input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Weekly restock"
                />
              </div>

              {/* Add Item Sub-Form */}
              <Card className="bg-muted/30 border border-border/70 shadow-xs">
                <CardContent className="p-4 space-y-4">
                  {/* Item Selector */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground">Select Item</Label>
                      {currentSelectedItemId && (() => {
                        const item = catalog.find(c => c.id === currentSelectedItemId);
                        const minQty = item?.min_transfer_qty && item.min_transfer_qty > 0 ? item.min_transfer_qty : null;
                        return (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              Available: <strong className="text-foreground">{sourceInventory[currentSelectedItemId] || 0} {item?.base_unit}</strong>
                            </span>
                            {minQty !== null && (
                              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 font-bold">
                                Min: {minQty} {item?.base_unit}
                              </Badge>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <Popover open={itemPopoverOpen} onOpenChange={setItemPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline" 
                          role="combobox" 
                          aria-expanded={itemPopoverOpen} 
                          className="w-full justify-between text-left font-normal bg-background h-10 border-input shadow-2xs"
                        >
                          {currentSelectedItemId ? (
                            (() => {
                              const item = catalog.find(c => c.id === currentSelectedItemId);
                              const qty = sourceInventory[currentSelectedItemId] || 0;
                              return item ? (
                                <div className="flex items-center justify-between w-full pr-2">
                                  <span className="font-medium text-foreground truncate">{item.item_name}</span>
                                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono shrink-0 ml-2">
                                    {qty} {item.base_unit}
                                  </span>
                                </div>
                              ) : "Select an item";
                            })()
                          ) : (
                            <span className="text-muted-foreground">Search and select item to transfer...</span>
                          )}
                          <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 shadow-lg" align="start">
                        <div className="flex flex-col h-[300px]">
                          <div className="flex flex-col gap-2 border-b px-3 py-2 sticky top-0 bg-background z-10">
                            <Select value={itemCategoryFilter} onValueChange={setItemCategoryFilter}>
                              <SelectTrigger className="h-8 w-full">
                                <SelectValue placeholder="Category" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="All">All Categories</SelectItem>
                                {Array.from(new Set(catalog.filter(c => !(branches.find(b => b.id === sourceBranchId)?.name?.toLowerCase().includes('main') && c.category?.toLowerCase().includes('portioned'))).map(c => c.category).filter(Boolean))).sort().map(cat => (
                                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center">
                              <MagnifyingGlassIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                              <Input
                                placeholder="Search catalog items..."
                                value={itemSearchTerm}
                                onChange={(e) => setItemSearchTerm(e.target.value)}
                                className="h-8 w-full bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 py-0 text-sm outline-none"
                              />
                            </div>
                          </div>
                          <div className="flex-1 overflow-y-auto p-1">
                            {(() => {
                              const isInitialState = itemSearchTerm.trim() === '' && itemCategoryFilter === 'All';
                              
                              if (isInitialState) {
                                return (
                                  <div className="py-6 text-center text-sm text-muted-foreground">
                                    Start typing or select a category to view items.
                                  </div>
                                );
                              }

                              const filtered = catalog.filter(item => {
                                if (branches.find(b => b.id === sourceBranchId)?.name?.toLowerCase().includes('main') && item.category?.toLowerCase().includes('portioned')) {
                                  return false;
                                }
                                
                                const qty = sourceInventory[item.id] || 0;
                                
                                const isAvailableToTarget = !item.available_branches || 
                                  item.available_branches.length === 0 || 
                                  (targetBranchId && item.available_branches.includes(targetBranchId));
                                  
                                const matchesCategory = itemCategoryFilter === 'All' || item.category === itemCategoryFilter;
                                const hasStockOrIsRequest = qty > 0 || !isProactive;
                                return hasStockOrIsRequest && isAvailableToTarget && matchesCategory && item.item_name.toLowerCase().includes(itemSearchTerm.toLowerCase());
                              });
                              if (filtered.length === 0) {
                                return (
                                  <div className="py-6 text-center text-sm text-muted-foreground">
                                    No items found.
                                  </div>
                                );
                              }
                              return filtered.map(item => {
                                const qty = sourceInventory[item.id] || 0;
                                const isSelected = currentSelectedItemId === item.id;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                      setCurrentSelectedItemId(item.id);
                                      setItemPopoverOpen(false);
                                      setItemSearchTerm('');
                                      if (item.conversion_factor && Number(item.conversion_factor) > 1) {
                                        setEntryMode('pack');
                                        setPackSize(Number(item.conversion_factor));
                                      }
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-sm text-sm transition-colors hover:bg-accent hover:text-accent-foreground flex items-center justify-between ${isSelected ? 'bg-accent/50 font-medium' : ''}`}
                                  >
                                    <span className="truncate">{item.item_name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0 pl-2">
                                      {item.conversion_factor && Number(item.conversion_factor) > 1 ? `${item.conversion_factor} ${item.base_unit}/pk | ` : ''}{qty} {item.base_unit}
                                    </span>
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Quantity & Packaging Mode Sub-Panel */}
                  <div className="p-3.5 bg-background border border-border/80 rounded-xl space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
                      <Label className="text-xs font-semibold text-foreground">Packaging & Quantity Format</Label>
                      <div className="inline-flex rounded-lg border bg-muted/60 p-0.5">
                        <button
                          type="button"
                          onClick={() => setEntryMode('base')}
                          className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                            entryMode === 'base'
                              ? 'bg-background text-foreground shadow-xs font-semibold'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          Direct ({catalog.find(c => c.id === currentSelectedItemId)?.base_unit || 'Base Units'})
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryMode('pack')}
                          className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                            entryMode === 'pack'
                              ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <span>By Pack (Packs × Pcs)</span>
                        </button>
                      </div>
                    </div>

                    {entryMode === 'pack' ? (() => {
                      const selectedCatalogItem = catalog.find(c => c.id === currentSelectedItemId);
                      const hasDefinedPackSize = Boolean(selectedCatalogItem?.conversion_factor && Number(selectedCatalogItem.conversion_factor) > 1);
                      const effectivePackSize = hasDefinedPackSize ? Number(selectedCatalogItem?.conversion_factor) : (Number(packSize) || 5);
                      const pieceUnit = (!selectedCatalogItem?.base_unit || selectedCatalogItem.base_unit.toLowerCase() === 'pack') ? 'pcs' : selectedCatalogItem.base_unit;
                      const pCount = Number(packCount) || 0;

                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-muted-foreground">Number of Packs / Bags</Label>
                              <Input
                                type="number"
                                min="1"
                                step="1"
                                value={packCount}
                                onChange={(e) => setPackCount(e.target.value === '' ? '' : Number(e.target.value))}
                                placeholder="e.g. 5"
                                className="bg-background h-9"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs font-medium text-muted-foreground">Pieces per Pack</Label>
                                {hasDefinedPackSize && (
                                  <span className="text-[10px] text-primary flex items-center gap-1 font-medium bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                                    <Lock className="h-3 w-3" /> Locked ({effectivePackSize} {pieceUnit}/pk)
                                  </span>
                                )}
                              </div>
                              <Input
                                type="number"
                                min="1"
                                step="any"
                                value={hasDefinedPackSize ? effectivePackSize : packSize}
                                readOnly={hasDefinedPackSize}
                                disabled={hasDefinedPackSize}
                                onChange={(e) => {
                                  if (!hasDefinedPackSize) {
                                    setPackSize(e.target.value === '' ? '' : Number(e.target.value));
                                  }
                                }}
                                placeholder="e.g. 5 or 10"
                                className={`h-9 ${hasDefinedPackSize ? 'bg-muted/70 text-foreground font-semibold cursor-not-allowed border-muted-foreground/30' : 'bg-background'}`}
                              />
                            </div>
                          </div>

                          {/* Live Conversion Banner */}
                          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                            <span className="text-foreground font-medium">
                              <span>Total Computed Quantity:</span>
                            </span>
                            <span className="font-bold text-primary font-mono text-sm">
                              {pCount > 0 && effectivePackSize > 0 
                                ? `${pCount} ${pCount === 1 ? 'pack' : 'packs'} × ${effectivePackSize} ${pieceUnit}/pack = ${pCount * effectivePackSize} ${pieceUnit} (${pCount} ${pCount === 1 ? 'pack' : 'packs'})`
                                : `0 ${pieceUnit}`}
                            </span>
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">
                          Enter Quantity ({catalog.find(c => c.id === currentSelectedItemId)?.base_unit || 'units'})
                        </Label>
                        <Input
                          type="number"
                          value={currentQty}
                          onChange={(e) => setCurrentQty(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="0"
                          className="bg-background h-9"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    {currentSelectedItemId && (() => {
                      const item = catalog.find(c => c.id === currentSelectedItemId);
                      const minQty = item?.min_transfer_qty && item.min_transfer_qty > 0 ? item.min_transfer_qty : null;
                      const hasDefinedPackSize = Boolean(item?.conversion_factor && Number(item.conversion_factor) > 1);
                      const effectivePackSize = hasDefinedPackSize ? Number(item?.conversion_factor) : (Number(packSize) || 5);
                      const calculatedQty = entryMode === 'pack' 
                        ? ((Number(packCount) || 0) * effectivePackSize)
                        : (Number(currentQty) || 0);
                      const isBelowMin = minQty !== null && calculatedQty > 0 && calculatedQty < minQty;
                      return isBelowMin ? (
                        <p className="text-xs text-destructive font-semibold">
                          Quantity must be at least {minQty} {item?.base_unit}
                        </p>
                      ) : <span />;
                    })()}
                    <Button 
                      type="button" 
                      onClick={handleAddItemToTransfer}
                      disabled={!currentSelectedItemId}
                      className="px-5 font-semibold shrink-0 cursor-pointer"
                    >
                      + Add Item
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Added Items List */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Items to Transfer ({addedItems.length})</h4>
                <div className="border rounded-md max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Packaging Details</TableHead>
                        <TableHead className="text-right">Min Required</TableHead>
                        <TableHead className="text-right">Total Quantity</TableHead>
                        <TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {addedItems.map((item, idx) => {
                        const info = catalog.find(c => c.id === item.item_id);
                        const minQty = info?.min_transfer_qty && info.min_transfer_qty > 0 ? info.min_transfer_qty : null;
                        const isBelowMin = minQty !== null && item.qty < minQty;
                        return (
                          <TableRow key={idx} className={isBelowMin ? 'bg-destructive/10' : ''}>
                            <TableCell className="font-medium">
                              {info?.item_name}
                              {isBelowMin && (
                                <span className="block text-[10px] text-destructive font-semibold">Below min requirement ({minQty} {info?.base_unit})!</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {item.package_count && item.pieces_per_pack ? (
                                <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/30 font-semibold">
                                  {item.package_count} packs × {item.pieces_per_pack} {info?.base_unit || 'pcs'}/pack
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground text-xs">{minQty ? `${minQty} ${info?.base_unit}` : '-'}</TableCell>
                            <TableCell className={`text-right font-bold ${isBelowMin ? 'text-destructive' : ''}`}>{item.qty} {info?.base_unit}</TableCell>
                            <TableCell className="text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => handleRemoveItem(idx)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>

            <DialogFooter className="p-6 pt-4 border-t shrink-0">
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {isProactive ? 'Send Shipment' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* VIEW MODAL */}
      <Dialog open={showViewModal} onOpenChange={setShowViewModal}>
        <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Transfer: {selectedTransfer?.control_number || 'Pending'}</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  ID: {selectedTransfer?.id}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mr-6"
                onClick={() => selectedTransfer && handlePrintReceipt(selectedTransfer, transferItems)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print PDF
              </Button>
            </div>
          </DialogHeader>

          {selectedTransfer && (
            <>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">From (Source)</span>
                    <span className="font-medium">{selectedTransfer.source_branch?.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">To (Target)</span>
                    <span className="font-medium text-primary">{selectedTransfer.target_branch?.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Requested Date</span>
                    <span className="font-medium">{new Date(selectedTransfer.created_at).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Status</span>
                    <Badge variant={
                      selectedTransfer.status === 'completed' ? 'default' :
                      selectedTransfer.status === 'approved' ? 'default' :
                      selectedTransfer.status === 'pending_receipt_approval' ? 'secondary' :
                      selectedTransfer.status === 'rejected' ? 'destructive' : 'secondary'
                    } className="uppercase mt-1 text-[10px]">
                      {selectedTransfer.status === 'approved' ? 'In Transit' : 
                       selectedTransfer.status === 'pending_receipt_approval' ? 'Pending Receipt Approval' : 
                       selectedTransfer.status}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Requested By</span>
                    <span className="font-medium text-foreground">{selectedTransfer.requested_by_email || 'Authorized Staff'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Approved & Dispatched By</span>
                    <span className="font-medium text-foreground">
                      {selectedTransfer.approved_by_email || (['approved', 'completed', 'pending_receipt_approval'].includes(selectedTransfer.status) ? 'Authorized Approver' : 'Pending Approval')}
                    </span>
                  </div>
                  {selectedTransfer.receipt_requested_by_email && (
                    <div>
                      <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Received/Checked By</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">{selectedTransfer.receipt_requested_by_email}</span>
                    </div>
                  )}
                  {selectedTransfer.receipt_approved_by_email && (
                    <div>
                      <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Receipt Approved By</span>
                      <span className="font-medium text-foreground">{selectedTransfer.receipt_approved_by_email}</span>
                    </div>
                  )}
                  <div className="col-span-2">
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Remarks</span>
                    <span className="font-medium">{selectedTransfer.remarks || 'No remarks'}</span>
                  </div>
                  {selectedTransfer.receipt_remarks && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold text-red-500">Receipt Rejection Remarks</span>
                      <span className="font-medium text-red-600 dark:text-red-400">{selectedTransfer.receipt_remarks}</span>
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-3">Transfer Items</h4>
                  <div className="border rounded-md overflow-x-auto">
                    <Table>
                      {(() => {
                        const isSuperAdmin = profile?.role_name === 'super_admin' || profile?.is_platform_admin;
                        const canReceive = profile && (
                          isSuperAdmin || (
                            profile.id !== selectedTransfer.approved_by && 
                            profile.branch_id !== selectedTransfer.source_branch_id && (
                              profile.role_name === 'inventory_manager' || 
                              profile.branch_id === selectedTransfer.target_branch_id ||
                              (profile.allowed_tabs && profile.allowed_tabs.includes('transfers_receive'))
                            )
                          )
                        );

                        if (selectedTransfer.status === 'approved' && canReceive) {
                          return (
                            <>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right">Sent Qty</TableHead>
                                  <TableHead className="text-right w-28">Arrived Qty</TableHead>
                                  <TableHead className="w-48">Discrepancy Note</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {transferItems.map((item, idx) => {
                                  const name = item.inventory_items?.item_name || 'Deleted Item';
                                  const unit = item.inventory_items?.base_unit || 'unit';
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const pCount = item.package_count || (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : null);
                                  const receivedVal = receivedQuantities[item.item_id] ?? item.quantity_base_unit;
                                  const isMissing = receivedVal < item.quantity_base_unit;

                                  return (
                                    <TableRow key={idx}>
                                      <TableCell className="font-medium">
                                        <div>{name}</div>
                                        {pcsPerPack > 1 && pCount ? (
                                          <div className="text-[11px] font-semibold text-primary">
                                            {pCount} packs × {pcsPerPack} {unit}/pack
                                          </div>
                                        ) : null}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold">
                                        {item.quantity_base_unit} {unit}
                                        {pcsPerPack > 1 && pCount && (
                                          <span className="block text-[10px] text-muted-foreground font-normal">
                                            ({pCount} {pCount === 1 ? 'pack' : 'packs'})
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <Input 
                                          type="number" 
                                          min={0} 
                                          max={item.quantity_base_unit} 
                                          step="any"
                                          value={receivedVal} 
                                          onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setReceivedQuantities(prev => ({ ...prev, [item.item_id]: val }));
                                          }} 
                                          className="w-20 text-right h-8" 
                                        />
                                      </TableCell>
                                      <TableCell>
                                        {isMissing ? (
                                          <Input 
                                            placeholder="Why is it missing?" 
                                            value={missingReasons[item.item_id] || ''} 
                                            onChange={(e) => {
                                              const val = e.target.value;
                                              setMissingReasons(prev => ({ ...prev, [item.item_id]: val }));
                                            }} 
                                            className="w-full text-xs h-8 border-red-300 focus-visible:ring-red-400" 
                                          />
                                        ) : (
                                          <span className="text-xs text-muted-foreground italic">-</span>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </>
                          );
                        } else if (selectedTransfer.status === 'pending_receipt_approval' || selectedTransfer.status === 'completed') {
                          return (
                            <>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right">Sent Qty</TableHead>
                                  <TableHead className="text-right">Arrived Qty</TableHead>
                                  <TableHead className="text-right">Missing Qty</TableHead>
                                  <TableHead>Reason for Discrepancy</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {transferItems.map((item, idx) => {
                                  const name = item.inventory_items?.item_name || 'Deleted Item';
                                  const unit = item.inventory_items?.base_unit || 'unit';
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const pCount = item.package_count || (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : null);
                                  const received = item.received_quantity_base_unit ?? item.quantity_base_unit;
                                  const missing = item.quantity_base_unit - received;

                                  return (
                                    <TableRow key={idx}>
                                      <TableCell className="font-medium">
                                        <div>{name}</div>
                                        {pcsPerPack > 1 && pCount ? (
                                          <div className="text-[11px] font-semibold text-primary">
                                            {pCount} packs × {pcsPerPack} {unit}/pack
                                          </div>
                                        ) : null}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold">{item.quantity_base_unit} {unit}</TableCell>
                                      <TableCell className="text-right font-semibold text-green-600">{received} {unit}</TableCell>
                                      <TableCell className="text-right font-semibold text-red-500">
                                        {missing > 0 ? `${missing} ${unit}` : '0'}
                                      </TableCell>
                                      <TableCell className="text-xs italic text-muted-foreground">
                                        {missing > 0 ? (item.missing_reason || 'No reason provided') : '-'}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </>
                          );
                        } else if (selectedTransfer.status === 'requested' && canApprove) {
                          return (
                            <>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right">Requested</TableHead>
                                  <TableHead className="text-right">Source Available</TableHead>
                                  <TableHead className="text-right w-64">Approve Qty</TableHead>
                                  <TableHead className="w-16 text-center">Action</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {transferItems.map((item, idx) => {
                                  const name = item.inventory_items?.item_name || 'Deleted Item';
                                  const unit = item.inventory_items?.base_unit || 'unit';
                                  const reqQty = item.original_quantity_base_unit ?? item.quantity_base_unit;
                                  const avail = sourceInventory[item.item_id] ?? 0;
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const isPack = pcsPerPack > 1 || Boolean(item.package_count && Number(item.package_count) > 0);
                                  const currentPacks = (item.package_count !== undefined && item.package_count !== null)
                                    ? Number(item.package_count)
                                    : (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : Number(item.quantity_base_unit));
                                  const reqPacks = pcsPerPack > 1 ? Math.floor(reqQty / pcsPerPack) : null;
                                  const availPacks = pcsPerPack > 1 ? Math.floor(avail / pcsPerPack) : null;
                                  const isModified = !item.is_deleted && Number(item.quantity_base_unit) !== Number(reqQty);
                                  const isOverStock = !item.is_deleted && item.quantity_base_unit > avail;

                                  if (item.is_deleted) {
                                    return (
                                      <TableRow key={idx} className="bg-destructive/10 opacity-75">
                                        <TableCell className="font-medium">
                                          <span className="line-through text-muted-foreground">{name}</span>
                                          <Badge variant="outline" className="ml-2 text-[10px] text-destructive border-destructive/30">
                                            Excluded from dispatch
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground line-through">{reqQty} {unit}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">{avail} {unit}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">-</TableCell>
                                        <TableCell className="text-center">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleToggleDeleteItem(idx)}
                                            className="h-7 text-xs px-2 cursor-pointer"
                                          >
                                            Undo
                                          </Button>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  }

                                  return (
                                    <TableRow key={idx} className={isOverStock ? 'bg-destructive/10' : ''}>
                                      <TableCell className="font-medium">
                                        <div>{name}</div>
                                        {isPack ? (
                                          <div className="text-[11px] font-semibold text-primary">
                                            Standard: {pcsPerPack} {unit}/pack
                                          </div>
                                        ) : null}
                                        {isModified && (
                                          <Badge variant="outline" className="mt-1 text-[10px] text-amber-500 border-amber-500/30 bg-amber-500/10">
                                            Modified from request
                                          </Badge>
                                        )}
                                        {isOverStock && (
                                          <div className="text-[10px] text-destructive font-semibold">
                                            Exceeds source stock ({avail} {unit} available)!
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-medium text-muted-foreground">
                                        <div>{reqQty} {unit}</div>
                                        {reqPacks !== null && (
                                          <span className="block text-[10px] text-muted-foreground font-normal">
                                            ({reqPacks} {reqPacks === 1 ? 'pack' : 'packs'} @ {pcsPerPack} {unit}/pk)
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-medium text-xs">
                                        <div className={avail < item.quantity_base_unit ? 'text-destructive font-bold' : 'text-muted-foreground'}>
                                          {avail} {unit}
                                        </div>
                                        {availPacks !== null && (
                                          <span className="block text-[10px] text-muted-foreground font-normal">
                                            ({availPacks} {availPacks === 1 ? 'pack' : 'packs'})
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {isPack ? (
                                          <div className="flex flex-col items-end gap-1.5 min-w-[210px]">
                                            {/* Pack Stepper Row */}
                                            <div className="flex items-center gap-1.5 justify-end">
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleStepItemPackCount(idx, -1)}
                                                disabled={currentPacks <= 0}
                                                className="h-7 px-2 text-xs font-bold text-destructive hover:bg-destructive/10 cursor-pointer"
                                                title="Deduct 1 pack"
                                              >
                                                -1 pk
                                              </Button>
                                              <Input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={currentPacks}
                                                onChange={(e) => handleUpdateItemPackCount(idx, Number(e.target.value))}
                                                className="w-16 text-center h-7 font-bold text-xs bg-background"
                                              />
                                              <span className="text-xs font-semibold text-muted-foreground">pk</span>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleStepItemPackCount(idx, 1)}
                                                className="h-7 px-2 text-xs font-bold text-primary hover:bg-primary/10 cursor-pointer"
                                                title="Add 1 pack"
                                              >
                                                +1 pk
                                              </Button>
                                            </div>

                                            {/* Base unit equivalent & direct input */}
                                            <div className="flex items-center gap-1.5 justify-end text-xs">
                                              <span className="text-muted-foreground text-[11px] font-mono">=</span>
                                              <Input
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={item.quantity_base_unit ?? 0}
                                                onChange={(e) => handleUpdateItemDirectQty(idx, Number(e.target.value))}
                                                className="w-20 text-right h-7 font-bold text-xs bg-background text-primary"
                                              />
                                              <span className="text-[11px] font-semibold text-muted-foreground">{unit}</span>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground font-mono">
                                              {currentPacks} pk × {pcsPerPack} {unit}/pk
                                            </span>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-1.5 justify-end">
                                            <Input
                                              type="number"
                                              min="0.01"
                                              step="any"
                                              value={item.quantity_base_unit || ''}
                                              onChange={(e) => handleUpdateItemDirectQty(idx, Number(e.target.value))}
                                              className="w-24 text-right h-8 font-semibold bg-background"
                                            />
                                            <span className="text-xs font-medium text-muted-foreground">{unit}</span>
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => handleToggleDeleteItem(idx)}
                                          className="h-8 w-8 text-destructive hover:bg-destructive/10 cursor-pointer"
                                          title="Remove item from this transfer"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </>
                          );
                        } else {
                          return (
                            <>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item Name</TableHead>
                                  <TableHead className="text-right pr-4">Quantity</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {transferItems.map((item, idx) => {
                                  const name = item.inventory_items?.item_name || 'Deleted Item';
                                  const unit = item.inventory_items?.base_unit || 'unit';
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const pCount = item.package_count || (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : null);
                                  const isModified = item.original_quantity_base_unit && Number(item.original_quantity_base_unit) !== Number(item.quantity_base_unit);
                                  return (
                                    <TableRow key={idx}>
                                      <TableCell className="font-medium">
                                        <div>{name}</div>
                                        {pcsPerPack > 1 && pCount ? (
                                          <div className="text-[11px] font-semibold text-primary">
                                            {pCount} packs × {pcsPerPack} {unit}/pack
                                          </div>
                                        ) : null}
                                        {isModified && (
                                          <Badge variant="outline" className="mt-1 text-[10px] text-amber-500 border-amber-500/30">
                                            Approved: {item.quantity_base_unit} {unit} (Requested: {item.original_quantity_base_unit} {unit})
                                          </Badge>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold pr-4">
                                        {item.quantity_base_unit} {unit}
                                        {pcsPerPack > 1 && pCount && (
                                          <span className="block text-[10px] text-muted-foreground font-normal">
                                            ({pCount} {pCount === 1 ? 'pack' : 'packs'})
                                          </span>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </>
                          );
                        }
                      })()}
                    </Table>
                  </div>

                  {selectedTransfer.status === 'requested' && canApprove && (
                    <div className="mt-2 p-2.5 bg-muted/40 border border-border/70 rounded-lg text-xs flex items-center justify-between">
                      <span className="text-muted-foreground">
                        You can adjust the quantity to dispatch or remove items before approving.
                      </span>
                      <span className="font-semibold text-primary font-mono text-[11px]">
                        {transferItems.filter(i => !i.is_deleted).length} active items
                      </span>
                    </div>
                  )}
                </div>

                {selectedTransfer.status === 'approved' && selectedTransfer.receipt_remarks && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-md text-center dark:bg-red-950/30 dark:border-red-900/50 dark:text-red-400 font-medium">
                    Previous delivery receipt was rejected by admin: "{selectedTransfer.receipt_remarks}"
                  </div>
                )}

                {selectedTransfer.status === 'approved' && (
                  <div className="text-sm text-yellow-600 bg-yellow-50 border border-yellow-200 p-3 rounded-md text-center dark:bg-yellow-950 dark:border-yellow-900/50 dark:text-yellow-500">
                    Stock is currently in transit. Please verify the physical delivery before confirming receipt.
                  </div>
                )}

                {selectedTransfer.status === 'pending_receipt_approval' && (
                  <div className="text-sm text-orange-600 bg-orange-50 border border-orange-200 p-3 rounded-md text-center dark:bg-orange-950/30 dark:border-orange-900/50 dark:text-orange-400 font-medium">
                    Awaiting admin approval for delivery receipt discrepancies.
                  </div>
                )}
              </div>

              <DialogFooter className="p-6 pt-4 border-t shrink-0 flex flex-col space-y-2 sm:space-y-0">
                {(() => {
                  const isSuperAdmin = profile?.role_name === 'super_admin' || profile?.is_platform_admin;
                  const canReceive = profile && (
                    isSuperAdmin || (
                      profile.id !== selectedTransfer.approved_by && 
                      profile.branch_id !== selectedTransfer.source_branch_id && (
                        profile.role_name === 'inventory_manager' || 
                        profile.branch_id === selectedTransfer.target_branch_id ||
                        (profile.allowed_tabs && profile.allowed_tabs.includes('transfers_receive'))
                      )
                    )
                  );

                  const hasDiscrepancy = selectedTransfer.status === 'approved' && transferItems.some(item => {
                    const received = receivedQuantities[item.item_id] ?? item.quantity_base_unit;
                    return received < item.quantity_base_unit;
                  });

                  if (selectedTransfer.status === 'requested' && canApprove) {
                    return (
                      <div className="flex justify-end space-x-2 w-full">
                        <Button variant="destructive" onClick={() => handleRejectTransfer(selectedTransfer.id)}>
                          Reject
                        </Button>
                        <Button disabled={approving} onClick={() => handleApproveTransfer(selectedTransfer.id)}>
                          {approving ? 'Dispatching...' : 'Approve & Dispatch'}
                        </Button>
                      </div>
                    );
                  } else if (selectedTransfer.status === 'approved' && canReceive) {
                    return (
                      <div className="flex justify-end space-x-2 w-full">
                        <Button variant="outline" onClick={() => setShowViewModal(false)}>
                          Close
                        </Button>
                        {hasDiscrepancy ? (
                          <Button 
                            className="bg-orange-500 hover:bg-orange-600 text-white"
                            disabled={submittingReceipt} 
                            onClick={() => handleReceiveDiscrepancyTransfer(selectedTransfer.id)}
                          >
                            {submittingReceipt ? 'Submitting...' : 'Submit Receipt for Admin Approval'}
                          </Button>
                        ) : (
                          <Button 
                            disabled={receiving} 
                            onClick={() => handleReceiveTransfer(selectedTransfer.id)}
                          >
                            {receiving ? 'Confirming...' : 'Confirm & Receive Items'}
                          </Button>
                        )}
                      </div>
                    );
                  } else if (selectedTransfer.status === 'pending_receipt_approval' && 
                             (profile?.role_name === 'super_admin' || profile?.is_platform_admin || profile?.role_name === 'inventory_manager' || (profile?.allowed_tabs && profile.allowed_tabs.includes('transfers_dispatch')))) {
                    return (
                      <div className="w-full space-y-4">
                        {!showRejectDialog ? (
                          <div className="flex justify-end space-x-2 w-full">
                            <Button variant="outline" onClick={() => setShowViewModal(false)}>
                              Close
                            </Button>
                            <Button variant="destructive" onClick={() => setShowRejectDialog(true)}>
                              Reject Receipt
                            </Button>
                            <Button 
                              disabled={submittingReceipt} 
                              onClick={() => handleApproveReceipt(selectedTransfer.id)}
                            >
                              {submittingReceipt ? 'Approving...' : 'Approve Delivery Receipt'}
                            </Button>
                          </div>
                        ) : (
                          <div className="w-full space-y-3 border-t pt-4 text-left">
                            <Label htmlFor="reject-remarks" className="text-xs font-semibold text-destructive uppercase tracking-wider block">
                              Reason for Rejection *
                            </Label>
                            <Input 
                              id="reject-remarks"
                              placeholder="Describe why you are rejecting this delivery receipt..." 
                              value={rejectRemarks} 
                              onChange={(e) => setRejectRemarks(e.target.value)} 
                              className="w-full"
                            />
                            <div className="flex justify-end space-x-2">
                              <Button variant="outline" size="sm" onClick={() => setShowRejectDialog(false)}>
                                Cancel Rejection
                              </Button>
                              <Button 
                                variant="destructive" 
                                size="sm" 
                                disabled={submittingReceipt} 
                                onClick={() => handleRejectReceipt(selectedTransfer.id)}
                              >
                                {submittingReceipt ? 'Rejecting...' : 'Confirm Reject Receipt'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  } else {
                    return (
                      <div className="flex justify-end w-full">
                        <Button variant="outline" onClick={() => setShowViewModal(false)}>
                          Close
                        </Button>
                      </div>
                    );
                  }
                })()}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
