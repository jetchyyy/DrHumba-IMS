import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { settingsService } from '../lib/settingsService';
import { printTransferSlip } from '../lib/printService';
import { EyeOpenIcon as Eye, ReloadIcon as RefreshCw, SymbolIcon as ArrowRightLeft, TrashIcon as Trash2, FileTextIcon as Printer, CaretSortIcon, MagnifyingGlassIcon, LockClosedIcon as Lock, PlusIcon as Plus } from '@radix-ui/react-icons';
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
import { DataTablePagination } from "./ui/DataTablePagination";
import { fetchPortionPackSizes, getPackSizeOptions, type PortionPackSizes } from '../lib/packSizes';
import { cleanQuantity, formatCleanQuantity } from '../lib/utils';

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
    status?: 'active' | 'inactive';
  };
  is_rejected?: boolean;
  is_deleted?: boolean;
  is_new?: boolean;
}

interface AddedTransferItem {
  item_id: string;
  qty: number;
  packaging_unit?: string;
  package_count?: number;
  pieces_per_pack?: number;
}

interface TransferDraft {
  id: string;
  draft_type: 'request' | 'send';
  source_branch_id: string;
  target_branch_id: string;
  items: Array<{
    item_id: string;
    quantity_base_unit: number;
    packaging_unit?: string | null;
    package_count?: number | null;
    pieces_per_pack?: number | null;
  }>;
  created_by: string | null;
  updated_at: string;
  source_branch?: { name: string };
  target_branch?: { name: string };
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
  status: 'active' | 'inactive';
}

const formatQuantity = (quantity: number | null | undefined) => formatCleanQuantity(quantity);

const pluralizeUnit = (unit: string, quantity: number) => {
  if (Math.abs(quantity) === 1 || unit.endsWith('s')) return unit;
  if (/(s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
};

/**
 * Inventory balances are stored in base units, but transfer staff work in the
 * catalog's packaging unit. Keep both values visible so the display is clear
 * without changing the quantity submitted to transfer RPCs.
 */
const formatAvailableQuantity = (quantity: number, item?: CatalogItem, showPacks = true) => {
  const baseQuantity = cleanQuantity(quantity);
  const baseUnit = item?.base_unit?.trim() || 'units';
  const packageUnit = item?.purchase_unit?.trim();
  const conversionFactor = Number(item?.conversion_factor);
  const baseDisplay = `${formatQuantity(baseQuantity)} ${baseUnit}`;

  if (
    !showPacks
    || !packageUnit
    || conversionFactor <= 1
    || packageUnit.toLowerCase() === baseUnit.toLowerCase()
  ) {
    return baseDisplay;
  }

  const packageQuantity = cleanQuantity(baseQuantity / conversionFactor);
  return `${formatQuantity(packageQuantity)} ${pluralizeUnit(packageUnit, packageQuantity)} (${baseDisplay})`;
};

const OTHER_PACK_SIZE = 'other';

/**
 * Pack size picker for portioned items: lists every size the item was packed in,
 * plus "Other" for a size not packed before.
 */
const PackSizeSelect: React.FC<{
  options: number[];
  value: number | string;
  onChange: (value: number | '') => void;
  unit: string;
  className?: string;
}> = ({ options, value, onChange, unit, className }) => {
  const [isOther, setIsOther] = useState(() => !options.includes(Number(value)));

  return (
    <div className="space-y-1.5">
      <Select
        value={isOther ? OTHER_PACK_SIZE : String(value)}
        onValueChange={(val) => {
          if (val === OTHER_PACK_SIZE) {
            setIsOther(true);
            onChange('');
          } else {
            setIsOther(false);
            onChange(Number(val));
          }
        }}
      >
        <SelectTrigger className={className}>
          <SelectValue placeholder="Choose pack size" />
        </SelectTrigger>
        <SelectContent>
          {options.map(size => (
            <SelectItem key={size} value={String(size)}>Pack of {formatQuantity(size)} {unit}</SelectItem>
          ))}
          <SelectItem value={OTHER_PACK_SIZE}>Other size…</SelectItem>
        </SelectContent>
      </Select>
      {isOther && (
        <Input
          type="number"
          min="1"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          placeholder={`${unit} per pack`}
          className={className}
        />
      )}
    </div>
  );
};

export const Transfers: React.FC = () => {
  const { profile, branches, selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  
  const [transfers, setTransfers] = useState<TransferRequest[]>([]);
  const [drafts, setDrafts] = useState<TransferDraft[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  
  // Filter state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TransferRequest['status']>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, startDate, endDate, statusFilter]);
  
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
  const [submitting, setSubmitting] = useState(false);
  // Draft currently open in the create modal (null for a brand-new transfer)
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  // Items to restore once the source-branch effect below has reset the form
  const pendingDraftItemsRef = useRef<AddedTransferItem[] | null>(null);

  // Discrepancy inputs state
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>({});
  const [missingReasons, setMissingReasons] = useState<Record<string, string>>({});
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);

  // Compact Add Item to Transfer dialog state
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [addModalItemId, setAddModalItemId] = useState('');
  const [addModalPackCount, setAddModalPackCount] = useState<number | ''>(1);
  const [addModalPackSize, setAddModalPackSize] = useState<number | ''>(5);
  const [addModalDirectQty, setAddModalDirectQty] = useState<number | ''>(1);
  const [addModalEntryMode, setAddModalEntryMode] = useState<'pack' | 'base'>('pack');
  const [addModalSearch, setAddModalSearch] = useState('');
  const [addModalCategory, setAddModalCategory] = useState('All');
  const [addModalPopoverOpen, setAddModalPopoverOpen] = useState(false);

  // Pack sizes each portioned item has been packed in (e.g. Calamares: 5 & 10 pcs)
  const [portionPackSizes, setPortionPackSizes] = useState<PortionPackSizes>({});

  // Portioned items pick a pack size per transfer; other items with a catalog
  // pack size keep it locked. Returns null when the size is not locked.
  const getLockedPackSize = (item?: CatalogItem | null): number | null => {
    if (!item || portionPackSizes[item.id]?.length) return null;
    const factor = Number(item.conversion_factor);
    if (factor > 1) return factor;
    // A packaging unit of its own with factor 1 (e.g. 1 pack = 1 kg) is still a
    // fixed catalog size; leaving it open let a stale or typed size slip in.
    const purchaseUnit = item.purchase_unit?.trim().toLowerCase();
    const hasOwnPackaging = Boolean(purchaseUnit) && purchaseUnit !== item.base_unit?.trim().toLowerCase();
    return factor > 0 && hasOwnPackaging ? factor : null;
  };

  const isPortionedPackItem = (item?: CatalogItem | null) => Boolean(item && portionPackSizes[item.id]?.length);

  const getDefaultPackSize = (item: CatalogItem): number | null => {
    const lockedSize = getLockedPackSize(item);
    if (lockedSize !== null) return lockedSize;
    const options = getPackSizeOptions(item, portionPackSizes);
    if (options.length === 0) return null;
    const factor = Number(item.conversion_factor);
    return factor > 1 ? factor : options[0];
  };

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

      const { data: draftData, error: draftError } = await supabase
        .from('transfer_drafts')
        .select(`
          id,
          draft_type,
          source_branch_id,
          target_branch_id,
          items,
          created_by,
          updated_at,
          source_branch:branches!transfer_drafts_source_branch_id_fkey(name),
          target_branch:branches!transfer_drafts_target_branch_id_fkey(name)
        `)
        .order('updated_at', { ascending: false });
      // Drafts are optional here: a failure must not block the transfer list or catalog
      if (draftError) console.error('Error loading transfer drafts:', draftError);
      setDrafts((draftData as any[]) || []);

      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, base_unit, purchase_unit, conversion_factor, min_transfer_qty, available_branches, category, status')
        .eq('status', 'active');
      if (catError) throw catError;
      setCatalog((catData as CatalogItem[]) || []);
      setPortionPackSizes(await fetchPortionPackSizes());
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
          invMap[row.item_id] = cleanQuantity(Number(row.quantity));
        });
      }
      setSourceInventory(invMap);
    } catch (err) {
      console.error("Error fetching source inventory:", err);
    }
  };

  useEffect(() => {
    if (showCreateModal) {
      // Re-fetch latest active catalog whenever create modal opens to prevent requesting stale/inactive items
      supabase
        .from('inventory_items')
        .select('id, item_name, base_unit, purchase_unit, conversion_factor, min_transfer_qty, available_branches, category, status')
        .eq('status', 'active')
        .then(({ data }) => {
          if (data) setCatalog(data as CatalogItem[]);
        });
    }

    if (showCreateModal && sourceBranchId) {
      fetchSourceInventory(sourceBranchId);
      // Reset items when source branch changes to prevent invalid stock transfer levels,
      // unless a draft was just opened and its items are waiting to be restored
      setAddedItems(pendingDraftItemsRef.current ?? []);
      pendingDraftItemsRef.current = null;
      setCurrentSelectedItemId('');
      setCurrentQty('');
    } else {
      setSourceInventory({});
    }
  }, [sourceBranchId, showCreateModal]);

  const handleOpenCreateModal = (proactive: boolean = false) => {
    setIsProactive(proactive);
    setEditingDraftId(null);
    pendingDraftItemsRef.current = null;
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
    if (!selectedCatalogItem || selectedCatalogItem.status !== 'active') {
      showError("This item is inactive or unavailable and cannot be transferred.");
      return;
    }

    if (sourceBranchId && selectedCatalogItem.available_branches && selectedCatalogItem.available_branches.length > 0) {
      if (!selectedCatalogItem.available_branches.includes(sourceBranchId)) {
        showError("This item is not available in the source branch.");
        return;
      }
    }

    if (targetBranchId && selectedCatalogItem.available_branches && selectedCatalogItem.available_branches.length > 0) {
      if (!selectedCatalogItem.available_branches.includes(targetBranchId)) {
        showError("This item is not available for the destination branch.");
        return;
      }
    }

    let qtyToAdd = 0;
    let pkgUnit = 'pc';
    let pkgCount: number | undefined = undefined;
    let pcsPerPkg: number | undefined = undefined;
    const hasDefinedPackSize = getLockedPackSize(selectedCatalogItem) !== null;
    const effectivePackSize = hasDefinedPackSize ? Number(selectedCatalogItem?.conversion_factor) : Number(packSize);

    if (entryMode === 'pack') {
      const pCount = Number(packCount);
      const pSize = effectivePackSize;
      if (isNaN(pCount) || pCount <= 0 || isNaN(pSize) || pSize <= 0) {
        showError("Please enter a valid package count.");
        return;
      }
      qtyToAdd = cleanQuantity(pCount * pSize);
      pkgUnit = selectedCatalogItem?.purchase_unit || 'pack';
      pkgCount = pCount;
      pcsPerPkg = pSize;
    } else {
      qtyToAdd = cleanQuantity(Number(currentQty));
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

    const availableQty = cleanQuantity(sourceInventory[currentSelectedItemId]);
    const exists = addedItems.find(i => i.item_id === currentSelectedItemId);
    if (exists) {
      showError("Item already added. Please modify it or delete first.");
      return;
    }

    if (isProactive && qtyToAdd > availableQty) {
      showError(`Cannot transfer exceeding available quantity of ${formatQuantity(availableQty)} in the source branch inventory.`);
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

  const buildItemsPayload = () => addedItems.map(item => ({
    item_id: item.item_id,
    quantity_base_unit: item.qty,
    packaging_unit: item.packaging_unit || 'pc',
    package_count: item.package_count || null,
    pieces_per_pack: item.pieces_per_pack || null
  }));

  // Saves the open form as a draft (insert or update) and returns its id
  const persistDraft = async (): Promise<string> => {
    const draftRow = {
      draft_type: isProactive ? 'send' : 'request',
      source_branch_id: sourceBranchId,
      target_branch_id: targetBranchId,
      items: buildItemsPayload(),
      updated_at: new Date().toISOString()
    };

    if (editingDraftId) {
      const { error } = await supabase.from('transfer_drafts').update(draftRow).eq('id', editingDraftId);
      if (error) throw error;
      return editingDraftId;
    }

    const { data, error } = await supabase.from('transfer_drafts').insert(draftRow).select('id').single();
    if (error) throw error;
    setEditingDraftId(data.id);
    return data.id;
  };

  const handleSaveDraft = async () => {
    if (!sourceBranchId || !targetBranchId) {
      showError("Select both the source and target branch before saving a draft");
      return;
    }
    if (sourceBranchId === targetBranchId) {
      showError("Source and Target branch cannot be the same");
      return;
    }

    setSubmitting(true);
    try {
      await persistDraft();
      showSuccess("Draft saved. You can finalize it later from the Drafts list.");
      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error saving draft');
    } finally {
      setSubmitting(false);
    }
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

    // Final validation of added items against active status, branch availability, minimum quantity, and source inventory balances
    for (const item of addedItems) {
      const info = catalog.find(c => c.id === item.item_id);
      if (!info || info.status !== 'active') {
        showError(`Item "${info?.item_name || 'selected item'}" is inactive or unavailable and cannot be requested.`);
        return;
      }

      if (sourceBranchId && info.available_branches && info.available_branches.length > 0) {
        if (!info.available_branches.includes(sourceBranchId)) {
          showError(`Item "${info.item_name}" is not available in the source branch.`);
          return;
        }
      }

      if (targetBranchId && info.available_branches && info.available_branches.length > 0) {
        if (!info.available_branches.includes(targetBranchId)) {
          showError(`Item "${info.item_name}" is not available for the destination branch.`);
          return;
        }
      }

      const minQty = info.min_transfer_qty && info.min_transfer_qty > 0 ? info.min_transfer_qty : null;
      if (minQty !== null && item.qty < minQty) {
        showError(`Quantity for ${info.item_name} must be at least ${minQty} ${info.base_unit || ''}.`);
        return;
      }
      const availableQty = cleanQuantity(sourceInventory[item.item_id]);
      if (isProactive && item.qty > availableQty) {
        showError(`Cannot transfer exceeding available quantity of ${formatQuantity(availableQty)} for ${info.item_name} in the source branch inventory.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      if (editingDraftId) {
        // Save the latest edits first, then finalize the draft in one server call
        const draftId = await persistDraft();
        const { error } = await supabase.rpc('fn_submit_transfer_draft', { p_draft_id: draftId });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc(isProactive ? 'fn_send_transfer' : 'fn_request_transfer', {
          p_source_branch_id: sourceBranchId,
          p_target_branch_id: targetBranchId,
          p_items: buildItemsPayload()
        });
        if (error) throw error;
      }

      showSuccess(isProactive ? "Stock shipment sent and in transit successfully!" : "Transfer request submitted successfully!");
      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error submitting transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDraft = (draft: TransferDraft) => {
    setIsProactive(draft.draft_type === 'send');
    setEditingDraftId(draft.id);

    // Validate that items in draft are still active in catalog
    const validItems: AddedTransferItem[] = [];
    const inactiveFound: string[] = [];

    (draft.items || []).forEach(item => {
      const cat = catalog.find(c => c.id === item.item_id && c.status === 'active');
      if (!cat) {
        inactiveFound.push(item.item_id);
      } else {
        validItems.push({
          item_id: item.item_id,
          qty: cleanQuantity(Number(item.quantity_base_unit)),
          packaging_unit: item.packaging_unit || 'pc',
          package_count: item.package_count ?? undefined,
          pieces_per_pack: item.pieces_per_pack ?? undefined
        });
      }
    });

    if (inactiveFound.length > 0) {
      showError("Some items previously saved in this draft are inactive or unavailable and were removed.");
    }

    pendingDraftItemsRef.current = validItems;
    setSourceBranchId(draft.source_branch_id);
    setTargetBranchId(draft.target_branch_id);
    setRemarks('');
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

  const handleSubmitDraft = async (draft: TransferDraft) => {
    const hasInactive = (draft.items || []).some(it => !catalog.some(c => c.id === it.item_id && c.status === 'active'));
    if (hasInactive) {
      showError("This draft contains inactive or unavailable items. Please edit the draft to remove them before submitting.");
      return;
    }

    const isSend = draft.draft_type === 'send';
    const route = `${draft.source_branch?.name || 'source'} → ${draft.target_branch?.name || 'target'}`;
    const confirmed = await confirm(
      isSend ? 'Send Shipment' : 'Submit Request',
      isSend
        ? `Send this shipment now (${route})? Stock will be deducted from the source branch.`
        : `Submit this transfer request now (${route})?`
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase.rpc('fn_submit_transfer_draft', { p_draft_id: draft.id });
      if (error) throw error;
      showSuccess(isSend ? "Stock shipment sent and in transit successfully!" : "Transfer request submitted successfully!");
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error submitting draft');
    }
  };

  const handleDeleteDraft = async (draft: TransferDraft) => {
    if (!await confirm('Delete Draft', 'Delete this draft? This cannot be undone.')) return;

    try {
      const { error } = await supabase.from('transfer_drafts').delete().eq('id', draft.id);
      if (error) throw error;
      showSuccess("Draft deleted");
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error deleting draft');
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
            is_rejected,
            inventory_items (
              item_name,
              base_unit,
              conversion_factor,
              status
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
              conversion_factor,
              status
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
          bData.forEach((b: any) => { invMap[b.item_id] = cleanQuantity(Number(b.quantity)); });
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

        const isItemRejected = Boolean(it.is_rejected) || (Number(it.quantity_base_unit) === 0 && Number(it.original_quantity_base_unit) > 0);

        return {
          ...it,
          packaging_unit: it.packaging_unit || 'pack',
          pieces_per_pack: pcsPerPack,
          package_count: derivedPackageCount,
          original_quantity_base_unit: it.original_quantity_base_unit ?? it.quantity_base_unit,
          is_rejected: isItemRejected,
          is_deleted: isItemRejected
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

  const handleOpenAddItemModal = () => {
    setAddModalItemId('');
    setAddModalPackCount(1);
    setAddModalPackSize(5);
    setAddModalDirectQty(1);
    setAddModalEntryMode('pack');
    setAddModalSearch('');
    setAddModalCategory('All');
    setAddModalPopoverOpen(false);
    setShowAddItemModal(true);
  };

  const handleConfirmAddItem = () => {
    if (!selectedTransfer) return;
    const item = catalog.find(c => c.id === addModalItemId && c.status === 'active');
    if (!item) {
      showError("Please select a valid active item to add.");
      return;
    }

    if (selectedTransfer.source_branch_id && item.available_branches && item.available_branches.length > 0) {
      if (!item.available_branches.includes(selectedTransfer.source_branch_id)) {
        showError("This item is not available in the source branch.");
        return;
      }
    }

    if (selectedTransfer.target_branch_id && item.available_branches && item.available_branches.length > 0) {
      if (!item.available_branches.includes(selectedTransfer.target_branch_id)) {
        showError("This item is not available for the destination branch.");
        return;
      }
    }

    const hasDefinedPackSize = getLockedPackSize(item) !== null;
    const effectivePackSize = hasDefinedPackSize ? Number(item.conversion_factor) : (Number(addModalPackSize) || 5);
    const isPackMode = addModalEntryMode === 'pack';
    const pCount = Number(addModalPackCount) || 0;
    const dQty = Number(addModalDirectQty) || 0;

    const effectiveQty = cleanQuantity(isPackMode ? (pCount * effectivePackSize) : dQty);

    if (isNaN(effectiveQty) || effectiveQty <= 0) {
      showError("Please enter a valid quantity greater than 0.");
      return;
    }

    const minQty = item.min_transfer_qty && item.min_transfer_qty > 0 ? item.min_transfer_qty : null;
    if (minQty && effectiveQty < minQty) {
      showError(`Quantity for ${item.item_name} must be at least ${minQty} ${item.base_unit || ''}.`);
      return;
    }

    const avail = cleanQuantity(sourceInventory[item.id]);

    // Add to local transfer items state (Draft in-memory, zero DB write until approve)
    const newItem: TransferItem = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      item_id: item.id,
      quantity_base_unit: effectiveQty,
      original_quantity_base_unit: 0, // 0 indicates item added by approver
      packaging_unit: isPackMode ? (item.purchase_unit || 'pack') : (item.base_unit || 'pc'),
      package_count: isPackMode ? pCount : (effectivePackSize > 1 ? Math.floor(effectiveQty / effectivePackSize) : null),
      pieces_per_pack: effectivePackSize,
      is_new: true,
      is_deleted: false,
      inventory_items: {
        item_name: item.item_name,
        base_unit: item.base_unit,
        conversion_factor: item.conversion_factor,
        status: item.status
      }
    };

    setTransferItems(prev => [...prev, newItem]);
    setShowAddItemModal(false);
    if (effectiveQty > avail) {
      showSuccess(`Added ${item.item_name} to shipment (Note: exceeds available source stock of ${formatQuantity(avail)} ${item.base_unit || 'units'}).`);
    } else {
      showSuccess(`Added ${item.item_name} to transfer shipment.`);
    }
  };

  const handleToggleDeleteItem = (index: number) => {
    setTransferItems(prev => {
      const item = prev[index];
      if (!item) return prev;
      if (item.is_new) {
        // Newly added item in memory: remove completely from list
        return prev.filter((_, i) => i !== index);
      }
      const updated = [...prev];
      updated[index] = {
        ...item,
        is_deleted: !item.is_deleted
      };
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
      if (item.inventory_items?.status === 'inactive') {
        showError(`Cannot approve transfer: "${item.inventory_items?.item_name || 'Item'}" is inactive. Please exclude or reject this item before approving.`);
        return;
      }
      if (isNaN(item.quantity_base_unit) || item.quantity_base_unit <= 0) {
        showError(`Please specify a valid quantity greater than 0 for ${item.inventory_items?.item_name || 'item'}.`);
        return;
      }
      const availStock = cleanQuantity(sourceInventory[item.item_id]);
      if (cleanQuantity(item.quantity_base_unit) > availStock) {
        showError(`Source branch has insufficient stock for ${item.inventory_items?.item_name || 'item'}. Available: ${formatQuantity(availStock)}, Approved: ${formatQuantity(item.quantity_base_unit)}`);
        return;
      }
    }

    const hasModifications = transferItems.some(item => 
      item.is_new || item.is_deleted || (item.original_quantity_base_unit !== undefined && item.original_quantity_base_unit !== null && Number(item.original_quantity_base_unit) !== Number(item.quantity_base_unit))
    );

    const confirmMessage = hasModifications
      ? 'You have adjusted quantities, added, or removed items for this shipment. Are you sure you want to approve and dispatch these items?'
      : 'Are you sure you want to approve and dispatch this transfer? Stock will be immediately deducted from the source branch and marked as in transit.';

    if (!await confirm('Approve & Dispatch Transfer', confirmMessage)) return;

    setApproving(true);
    try {
      // 1. Apply any rejections/exclusions, additions (for newly added items), and quantity updates in transfer_items table
      for (const item of transferItems) {
        if (item.is_deleted) {
          if (!item.is_new) {
            // Keep the original positive quantity for the table constraint and audit trail.
            // The is_rejected flag is what excludes this line from dispatch, receipt, and printing.
            const origQty = item.original_quantity_base_unit !== undefined && item.original_quantity_base_unit !== null 
              ? item.original_quantity_base_unit 
              : item.quantity_base_unit;

            const updatePayload: any = {
              is_rejected: true,
              original_quantity_base_unit: origQty
            };

            const { error: rejErr } = await supabase
              .from('transfer_items')
              .update(updatePayload)
              .eq('id', item.id);

            if (rejErr) throw rejErr;
          }
        } else if (item.is_new) {
          // Newly added item by approver: insert with original_quantity_base_unit = 0
          const insertPayload: any = {
            transfer_id: transferId,
            item_id: item.item_id,
            quantity_base_unit: item.quantity_base_unit,
            original_quantity_base_unit: 0,
            packaging_unit: item.packaging_unit || 'pc',
            package_count: item.package_count ?? null,
            pieces_per_pack: item.pieces_per_pack ?? null,
            is_rejected: false
          };
          if ((selectedTransfer as any)?.tenant_id) {
            insertPayload.tenant_id = (selectedTransfer as any).tenant_id;
          }

          const { error: insErr } = await supabase
            .from('transfer_items')
            .insert(insertPayload);

          if (insErr) {
            // Fallback in case columns are pending migration reload
            if (insErr.message?.includes('is_rejected') || insErr.message?.includes('original_quantity_base_unit') || (insErr as any).code === '42703') {
              delete insertPayload.is_rejected;
              delete insertPayload.original_quantity_base_unit;
              const { error: insFallbackErr } = await supabase
                .from('transfer_items')
                .insert(insertPayload);
              if (insFallbackErr) throw insFallbackErr;
            } else {
              throw insErr;
            }
          }
        } else {
          // Existing item updated and approved
          const updatePayload: any = {
            quantity_base_unit: item.quantity_base_unit,
            package_count: item.package_count ?? null,
            pieces_per_pack: item.pieces_per_pack ?? null,
            is_rejected: false,
            original_quantity_base_unit: item.original_quantity_base_unit !== undefined && item.original_quantity_base_unit !== null ? item.original_quantity_base_unit : item.quantity_base_unit
          };
          const { error: updateErr } = await supabase
            .from('transfer_items')
            .update(updatePayload)
            .eq('id', item.id);
          if (updateErr) {
            // Fallback in case columns are pending migration reload
            if (updateErr.message?.includes('is_rejected') || updateErr.message?.includes('original_quantity_base_unit') || (updateErr as any).code === '42703') {
              delete updatePayload.is_rejected;
              delete updatePayload.original_quantity_base_unit;
              await supabase
                .from('transfer_items')
                .update(updatePayload)
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
      // Validate that all missing items have a reason specified (excluding unapproved/rejected items)
      const activeTransferItems = transferItems.filter(item => !item.is_rejected && Number(item.quantity_base_unit) > 0);
      const itemsPayload = activeTransferItems.map(item => {
        const received = receivedQuantities[item.item_id] ?? item.quantity_base_unit;
        const reason = missingReasons[item.item_id] || '';
        
        if (received < 0) {
          throw new Error(`Arrived quantity for ${item.inventory_items?.item_name || 'item'} cannot be negative.`);
        }
        if (received !== Number(item.quantity_base_unit) && !reason.trim()) {
          const kind = received < item.quantity_base_unit ? 'missing' : 'extra';
          throw new Error(`A reason/note is required for the ${kind} quantity of ${item.inventory_items?.item_name || 'item'}.`);
        }

        return {
          item_id: item.item_id,
          received_quantity_base_unit: received,
          missing_reason: received !== Number(item.quantity_base_unit) ? reason.trim() : null
        };
      });

      if (!await confirm(
        'Submit Receipt for Admin Approval',
        'Are you sure you want to submit this receipt with short/over quantities? Stock will NOT move until an admin approves. The approved quantities will be deducted from the source branch and added to your branch.'
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
    const activeItems = transferItems.filter(item => !item.is_rejected && Number(item.quantity_base_unit) > 0);
    const approvedItems = activeItems.map(item => ({
      item_id: item.item_id,
      approved_quantity_base_unit: receivedQuantities[item.item_id] ?? item.received_quantity_base_unit ?? item.quantity_base_unit
    }));

    const invalid = approvedItems.find(item => !(item.approved_quantity_base_unit >= 0));
    if (invalid) {
      showError('Approved quantities must be zero or more.');
      return;
    }

    if (!await confirm(
      'Approve Delivery Receipt',
      'Are you sure you want to approve this delivery receipt? The approved quantities will be deducted from the source branch and added to the target branch, and a stock receipt will be generated.'
    )) return;

    setSubmittingReceipt(true);
    try {
      const { error } = await supabase.rpc('fn_approve_transfer_receipt', {
        p_transfer_id: transferId,
        p_items: approvedItems
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

  // Matches fn_approve_transfer_receipt: only these roles can settle short/over receipts
  const canApproveReceipt = Boolean(profile && (
    ['super_admin', 'inventory_manager'].includes(profile.role_name) ||
    profile.is_platform_admin
  ));

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

    const matchesStatus = statusFilter === 'all' || transfer.status === statusFilter;

    return matchesDate && matchesStatus;
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

        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground font-medium">Filter by Status:</span>
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="requested">Requested</SelectItem>
              <SelectItem value="approved">In Transit (Approved)</SelectItem>
              <SelectItem value="pending_receipt_approval">Pending Receipt Approval</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
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

      {drafts.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="px-6 py-4">
            <CardTitle>Drafts</CardTitle>
            <CardDescription>Saved requests and shipments that have not been submitted yet. No stock moves until you submit.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Type / Last Saved</TableHead>
                  <TableHead>Source Branch</TableHead>
                  <TableHead>Target Branch</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="pl-6">
                      <div className="font-bold">{d.draft_type === 'send' ? 'Shipment' : 'Request'}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{new Date(d.updated_at).toLocaleString()}</div>
                    </TableCell>
                    <TableCell className="font-semibold">{d.source_branch?.name || 'Unknown'}</TableCell>
                    <TableCell className="font-semibold text-primary">{d.target_branch?.name || 'Unknown'}</TableCell>
                    <TableCell className="text-muted-foreground">{d.items?.length || 0}</TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => handleOpenDraft(d)}>
                          <Eye className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button variant="default" size="sm" onClick={() => handleSubmitDraft(d)} disabled={!d.items?.length}>
                          {d.draft_type === 'send' ? 'Send' : 'Submit'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteDraft(d)}
                          title="Delete Draft"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                    No stock transfers found matching the selected filters.
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
                      {t.status === 'approved' ? 'In Transit' :
                       t.status === 'pending_receipt_approval' ? 'Pending Receipt Approval' :
                       t.status}
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
          <div className="border-t">
            <DataTablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredTransfers.length}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={setItemsPerPage}
              showPageSizeSelector={true}
              pageSizeOptions={[10, 20, 50, 100]}
            />
          </div>
        </CardContent>
      </Card>

      {/* CREATE MODAL */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 pb-4 border-b shrink-0">
            <DialogTitle>
              {isProactive ? 'Send Stock Shipment' : 'New Transfer Request'}
              {editingDraftId && <Badge variant="outline" className="ml-2 uppercase text-[10px] align-middle">Draft</Badge>}
            </DialogTitle>
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
                              Available: <strong className="text-foreground">{formatAvailableQuantity(cleanQuantity(sourceInventory[currentSelectedItemId]), item, !isPortionedPackItem(item))}</strong>
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
                              const qty = cleanQuantity(sourceInventory[currentSelectedItemId]);
                              return item ? (
                                <div className="flex items-center justify-between w-full pr-2">
                                  <span className="font-medium text-foreground truncate">{item.item_name}</span>
                                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono shrink-0 ml-2">
                                    {formatAvailableQuantity(qty, item, !isPortionedPackItem(item))}
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
                                {Array.from(new Set(catalog.filter(c => c.status === 'active' && !(branches.find(b => b.id === sourceBranchId)?.name?.toLowerCase().includes('main') && c.category?.toLowerCase().includes('portioned'))).map(c => c.category).filter(Boolean))).sort().map(cat => (
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
                                if (item.status !== 'active') return false;

                                if (branches.find(b => b.id === sourceBranchId)?.name?.toLowerCase().includes('main') && item.category?.toLowerCase().includes('portioned')) {
                                  return false;
                                }
                                
                                const qty = cleanQuantity(sourceInventory[item.id]);
                                
                                const isAvailableToSource = !item.available_branches || 
                                  item.available_branches.length === 0 || 
                                  Boolean(sourceBranchId && item.available_branches.includes(sourceBranchId));

                                const isAvailableToTarget = !item.available_branches || 
                                  item.available_branches.length === 0 || 
                                  Boolean(targetBranchId && item.available_branches.includes(targetBranchId));
                                  
                                const matchesCategory = itemCategoryFilter === 'All' || item.category === itemCategoryFilter;
                                const hasStockOrIsRequest = qty > 0 || !isProactive;
                                return hasStockOrIsRequest && isAvailableToSource && isAvailableToTarget && matchesCategory && item.item_name.toLowerCase().includes(itemSearchTerm.toLowerCase());
                              });
                              if (filtered.length === 0) {
                                return (
                                  <div className="py-6 text-center text-sm text-muted-foreground">
                                    No items found.
                                  </div>
                                );
                              }
                              return filtered.map(item => {
                                const qty = cleanQuantity(sourceInventory[item.id]);
                                const isSelected = currentSelectedItemId === item.id;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                      setCurrentSelectedItemId(item.id);
                                      setItemPopoverOpen(false);
                                      setItemSearchTerm('');
                                      const defaultPackSize = getDefaultPackSize(item);
                                      if (defaultPackSize !== null) {
                                        setEntryMode('pack');
                                        setPackSize(defaultPackSize);
                                      } else {
                                        // Don't carry the previous item's pack size over
                                        setEntryMode('base');
                                        setPackSize('5');
                                      }
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-sm text-sm transition-colors hover:bg-accent hover:text-accent-foreground flex items-center justify-between ${isSelected ? 'bg-accent/50 font-medium' : ''}`}
                                  >
                                    <span className="truncate">{item.item_name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0 pl-2">
                                      {formatAvailableQuantity(qty, item, !isPortionedPackItem(item))}
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
                    {(() => {
                      const selectedCatalogItem = catalog.find(c => c.id === currentSelectedItemId);
                      const baseU = selectedCatalogItem?.base_unit || 'units';
                      const pkgU = selectedCatalogItem?.purchase_unit || 'pack';
                      const hasDefinedPackSize = getLockedPackSize(selectedCatalogItem) !== null;
                      const effectivePackSize = hasDefinedPackSize ? Number(selectedCatalogItem?.conversion_factor) : (Number(packSize) || 5);
                      const pCount = Number(packCount) || 0;

                      return (
                        <>
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
                                Direct ({baseU})
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
                                <span>By {pkgU.charAt(0).toUpperCase() + pkgU.slice(1)} ({pkgU} × {baseU})</span>
                              </button>
                            </div>
                          </div>

                          {entryMode === 'pack' ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <Label className="text-xs font-medium text-muted-foreground">Number of {pkgU.charAt(0).toUpperCase() + pkgU.slice(1)}s</Label>
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
                                    <Label className="text-xs font-medium text-muted-foreground">Base {baseU} per {pkgU}</Label>
                                    {hasDefinedPackSize && (
                                      <span className="text-[10px] text-primary flex items-center gap-1 font-medium bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                                        <Lock className="h-3 w-3" /> Locked ({effectivePackSize} {baseU}/{pkgU})
                                      </span>
                                    )}
                                  </div>
                                  {isPortionedPackItem(selectedCatalogItem) ? (
                                    <PackSizeSelect
                                      key={selectedCatalogItem?.id}
                                      options={getPackSizeOptions(selectedCatalogItem, portionPackSizes)}
                                      value={packSize}
                                      onChange={setPackSize}
                                      unit={baseU}
                                      className="h-9 bg-background"
                                    />
                                  ) : (
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
                                  )}
                                </div>
                              </div>

                              {/* Live Conversion Banner */}
                              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                                <span className="text-foreground font-medium">
                                  <span>Total Computed Quantity:</span>
                                </span>
                                <span className="font-bold text-primary font-mono text-sm">
                                  {pCount > 0 && effectivePackSize > 0 
                                    ? `${pCount} ${pkgU}${pCount === 1 ? '' : 's'} × ${effectivePackSize} ${baseU}/${pkgU} = ${pCount * effectivePackSize} ${baseU}`
                                    : `0 ${baseU}`}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium text-muted-foreground">
                                Enter Quantity ({baseU})
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
                        </>
                      );
                    })()}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    {currentSelectedItemId && (() => {
                      const item = catalog.find(c => c.id === currentSelectedItemId);
                      const minQty = item?.min_transfer_qty && item.min_transfer_qty > 0 ? item.min_transfer_qty : null;
                      const hasDefinedPackSize = getLockedPackSize(item) !== null;
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
                              {item.package_count && item.pieces_per_pack ? (() => {
                                const pkgU = item.packaging_unit || info?.purchase_unit || 'pack';
                                return (
                                  <Badge variant="outline" className="text-[11px] bg-primary/10 text-primary border-primary/30 font-semibold font-mono">
                                    {item.package_count} {pkgU}{item.package_count === 1 ? '' : 's'} × {item.pieces_per_pack} {info?.base_unit || 'pcs'}/{pkgU}
                                  </Badge>
                                );
                              })() : (
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
              <Button type="button" variant="secondary" onClick={handleSaveDraft} disabled={submitting}>
                {editingDraftId ? 'Update Draft' : 'Save as Draft'}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : isProactive ? 'Send Shipment' : 'Submit Request'}
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
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">Transfer Items</h4>
                    {selectedTransfer.status === 'requested' && canApprove && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleOpenAddItemModal}
                        className="h-8 gap-1.5 text-xs font-semibold text-primary border-primary/30 hover:bg-primary/10 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Item
                      </Button>
                    )}
                  </div>
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
                          // In the receiving confirmation modal, display active dispatched items for receipt entry, plus any rejected items at the bottom as reference
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
                                  const pkgUnit = item.packaging_unit || (item.inventory_items as any)?.purchase_unit || 'pack';
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const pCount = item.package_count || (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : null);
                                  const receivedVal = receivedQuantities[item.item_id] ?? item.quantity_base_unit;
                                  const isShort = receivedVal < item.quantity_base_unit;
                                  const isOver = receivedVal > item.quantity_base_unit;
                                  const isRejected = Boolean(item.is_rejected) || (Number(item.quantity_base_unit) === 0 && Number(item.original_quantity_base_unit) > 0);

                                  if (isRejected) {
                                    return (
                                      <TableRow key={idx} className="bg-destructive/5 opacity-75">
                                        <TableCell className="font-medium">
                                          <div className="line-through text-muted-foreground">{name}</div>
                                          <Badge variant="outline" className="mt-1 text-[10px] text-destructive border-destructive/30 bg-destructive/10">
                                            Not Approved at Dispatch
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground line-through">
                                          0 {unit}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">-</TableCell>
                                        <TableCell className="text-xs text-muted-foreground italic">
                                          Excluded by approver
                                        </TableCell>
                                      </TableRow>
                                    );
                                  }

                                  return (
                                    <TableRow key={idx}>
                                      <TableCell className="font-medium">
                                        <div>{name}</div>
                                        {pcsPerPack > 1 && pCount ? (
                                          <div className="text-[11px] font-semibold text-primary">
                                            {pCount} {pCount === 1 ? pkgUnit : `${pkgUnit}s`} × {pcsPerPack} {unit}/{pkgUnit}
                                          </div>
                                        ) : null}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold">
                                        {item.quantity_base_unit} {unit}
                                        {pcsPerPack > 1 && pCount && (
                                          <span className="block text-[10px] text-muted-foreground font-normal">
                                            ({pCount} {pCount === 1 ? pkgUnit : `${pkgUnit}s`})
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <Input 
                                          type="number" 
                                          min={0}
                                          step="any"
                                          value={receivedVal}
                                          onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setReceivedQuantities(prev => ({ ...prev, [item.item_id]: val }));
                                          }}
                                          className="w-20 text-right h-8"
                                        />
                                        {(isShort || isOver) && (
                                          <span className={`block text-[10px] font-semibold mt-1 ${isShort ? 'text-red-500' : 'text-amber-600'}`}>
                                            {isShort ? 'Short' : 'Over'} {Math.abs(receivedVal - item.quantity_base_unit)} {unit}
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell>
                                        {isShort || isOver ? (
                                          <Input
                                            placeholder={isShort ? 'Why is it missing?' : 'Why is there extra?'}
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
                                  <TableHead className="text-right">
                                    {selectedTransfer.status === 'pending_receipt_approval' && canApproveReceipt ? 'Approve Qty' : 'Arrived Qty'}
                                  </TableHead>
                                  <TableHead className="text-right">Short / Over</TableHead>
                                  <TableHead>Reason for Discrepancy</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {transferItems.map((item, idx) => {
                                  const name = item.inventory_items?.item_name || 'Deleted Item';
                                  const unit = item.inventory_items?.base_unit || 'unit';
                                  const pkgUnit = item.packaging_unit || (item.inventory_items as any)?.purchase_unit || 'pack';
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const pCount = item.package_count || (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : null);
                                  const declared = cleanQuantity(item.received_quantity_base_unit ?? item.quantity_base_unit);
                                  const isEditable = selectedTransfer.status === 'pending_receipt_approval' && canApproveReceipt;
                                  const received = cleanQuantity(isEditable ? (receivedQuantities[item.item_id] ?? declared) : declared);
                                  const difference = cleanQuantity(received - item.quantity_base_unit);
                                  const isRejected = Boolean(item.is_rejected) || (Number(item.quantity_base_unit) === 0 && Number(item.original_quantity_base_unit) > 0);

                                  if (isRejected) {
                                    return (
                                      <TableRow key={idx} className="bg-destructive/5 opacity-75">
                                        <TableCell className="font-medium">
                                          <div className="line-through text-muted-foreground">{name}</div>
                                          <Badge variant="outline" className="mt-1 text-[10px] text-destructive border-destructive/30 bg-destructive/10">
                                            Not Approved / Excluded (Requested: {formatQuantity(item.original_quantity_base_unit || 0)} {unit})
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground line-through">0 {unit}</TableCell>
                                        <TableCell className="text-right text-muted-foreground line-through">0 {unit}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">-</TableCell>
                                        <TableCell className="text-xs italic text-muted-foreground">
                                          Disapproved by approver
                                        </TableCell>
                                      </TableRow>
                                    );
                                  }

                                  return (
                                    <TableRow key={idx}>
                                      <TableCell className="font-medium">
                                        <div>{name}</div>
                                        {pcsPerPack > 1 && pCount ? (
                                          <div className="text-[11px] font-semibold text-primary">
                                            {pCount} {pCount === 1 ? pkgUnit : `${pkgUnit}s`} × {pcsPerPack} {unit}/{pkgUnit}
                                          </div>
                                        ) : null}
                                      </TableCell>
                                      <TableCell className="text-right font-semibold">{formatQuantity(item.quantity_base_unit)} {unit}</TableCell>
                                      <TableCell className="text-right font-semibold text-green-600">
                                        {isEditable ? (
                                          <div className="flex flex-col items-end">
                                            <Input
                                              type="number"
                                              min={0}
                                              step="any"
                                              value={received}
                                              onChange={(e) => {
                                                const val = cleanQuantity(Number(e.target.value));
                                                setReceivedQuantities(prev => ({ ...prev, [item.item_id]: val }));
                                              }}
                                              className="w-20 text-right h-8"
                                            />
                                            {received !== declared && (
                                              <span className="text-[10px] text-muted-foreground font-normal mt-1">
                                                Declared: {formatQuantity(declared)} {unit}
                                              </span>
                                            )}
                                          </div>
                                        ) : (
                                          <>{formatQuantity(received)} {unit}</>
                                        )}
                                      </TableCell>
                                      <TableCell className={`text-right font-semibold ${difference < 0 ? 'text-red-500' : difference > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                        {difference < 0 ? `Short ${formatQuantity(Math.abs(difference))} ${unit}` : difference > 0 ? `Over ${formatQuantity(difference)} ${unit}` : '0'}
                                      </TableCell>
                                      <TableCell className="text-xs italic text-muted-foreground">
                                        {declared !== Number(item.quantity_base_unit) ? (item.missing_reason || 'No reason provided') : '-'}
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
                                  const isInactive = item.inventory_items?.status === 'inactive';
                                  const unit = item.inventory_items?.base_unit || 'unit';
                                  const reqQty = cleanQuantity(item.original_quantity_base_unit ?? item.quantity_base_unit);
                                  const avail = cleanQuantity(sourceInventory[item.item_id]);
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const pkgUnit = item.packaging_unit || (catalog.find(c => c.id === item.item_id)?.purchase_unit) || 'pack';
                                  const isPack = pcsPerPack > 1 || Boolean(item.package_count && Number(item.package_count) > 0);
                                  const currentPacks = (item.package_count !== undefined && item.package_count !== null)
                                    ? Number(item.package_count)
                                    : (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : Number(item.quantity_base_unit));
                                  const reqPacks = pcsPerPack > 1 ? Math.floor(reqQty / pcsPerPack) : null;
                                  const availPacks = pcsPerPack > 1 ? Math.floor(avail / pcsPerPack) : null;
                                  const isAddedByApprover = Boolean(item.is_new) || (item.original_quantity_base_unit !== null && item.original_quantity_base_unit !== undefined && Number(item.original_quantity_base_unit) === 0);
                                  const isModified = !isAddedByApprover && !item.is_deleted && Number(item.quantity_base_unit) !== Number(reqQty);
                                  const isOverStock = !item.is_deleted && cleanQuantity(item.quantity_base_unit) > avail;

                                  if (item.is_deleted) {
                                    return (
                                      <TableRow key={idx} className="bg-destructive/10 opacity-75">
                                        <TableCell className="font-medium">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="line-through text-muted-foreground">{name}</span>
                                            <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30 bg-destructive/10">
                                              Not Approved (Crashout)
                                            </Badge>
                                            {isInactive && (
                                              <Badge variant="secondary" className="text-[10px] text-destructive bg-destructive/10 border-destructive/20 font-bold uppercase">
                                                Inactive
                                              </Badge>
                                            )}
                                          </div>
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground line-through">
                                          {isAddedByApprover ? `0 ${unit}` : `${formatQuantity(reqQty)} ${unit}`}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">{formatQuantity(avail)} {unit}</TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                          <span className="text-xs line-through text-destructive">0 {unit}</span>
                                        </TableCell>
                                        <TableCell className="text-center">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleToggleDeleteItem(idx)}
                                            className="h-7 text-xs px-2 cursor-pointer"
                                            title="Restore item to transfer"
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
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span>{name}</span>
                                          {isInactive && (
                                            <Badge variant="destructive" className="text-[10px] uppercase font-bold">
                                              Inactive Item
                                            </Badge>
                                          )}
                                        </div>
                                        {isPack ? (
                                          <div className="text-[11px] font-semibold text-primary font-mono">
                                            Standard: {pcsPerPack} {unit}/{pkgUnit}
                                          </div>
                                        ) : null}
                                        {isAddedByApprover && (
                                          <Badge variant="outline" className="mt-1 text-[10px] text-purple-600 border-purple-300 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300">
                                            Added by Approver
                                          </Badge>
                                        )}
                                        {isModified && (
                                          <Badge variant="outline" className="mt-1 text-[10px] text-amber-500 border-amber-500/30 bg-amber-500/10">
                                            Modified from request
                                          </Badge>
                                        )}
                                        {isOverStock && (
                                          <div className="text-[10px] text-destructive font-semibold">
                                            Exceeds source stock ({formatQuantity(avail)} {unit} available)!
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-medium text-muted-foreground">
                                        {isAddedByApprover ? (
                                          <span className="text-xs italic text-muted-foreground">0 {unit} (None)</span>
                                        ) : (
                                          <>
                                            <div>{formatQuantity(reqQty)} {unit}</div>
                                            {reqPacks !== null && (
                                              <span className="block text-[10px] text-muted-foreground font-normal font-mono">
                                                ({reqPacks} {pkgUnit}{reqPacks === 1 ? '' : 's'} @ {pcsPerPack} {unit}/{pkgUnit})
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right font-medium text-xs">
                                        <div className={avail < item.quantity_base_unit ? 'text-destructive font-bold' : 'text-muted-foreground'}>
                                          {formatQuantity(avail)} {unit}
                                        </div>
                                        {availPacks !== null && (
                                          <span className="block text-[10px] text-muted-foreground font-normal font-mono">
                                            ({availPacks} {pkgUnit}{availPacks === 1 ? '' : 's'})
                                          </span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {isPack ? (
                                          <div className="flex flex-col items-end gap-1.5 min-w-[210px]">
                                            {/* Packaging Stepper Row */}
                                            <div className="flex items-center gap-1.5 justify-end">
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleStepItemPackCount(idx, -1)}
                                                disabled={currentPacks <= 0}
                                                className="h-7 px-2 text-xs font-bold text-destructive hover:bg-destructive/10 cursor-pointer"
                                                title={`Deduct 1 ${pkgUnit}`}
                                              >
                                                -1 {pkgUnit.slice(0, 3)}
                                              </Button>
                                              <Input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={currentPacks}
                                                onChange={(e) => handleUpdateItemPackCount(idx, Number(e.target.value))}
                                                className="w-16 text-center h-7 font-bold text-xs bg-background"
                                              />
                                              <span className="text-xs font-semibold text-muted-foreground">{pkgUnit.slice(0, 3)}</span>
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleStepItemPackCount(idx, 1)}
                                                className="h-7 px-2 text-xs font-bold text-primary hover:bg-primary/10 cursor-pointer"
                                                title={`Add 1 ${pkgUnit}`}
                                              >
                                                +1 {pkgUnit.slice(0, 3)}
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
                                              {currentPacks} {pkgUnit}{currentPacks === 1 ? '' : 's'} × {pcsPerPack} {unit}/{pkgUnit}
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
                                          title="Remove / Disapprove item from this transfer"
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
                                  const pkgUnit = item.packaging_unit || (item.inventory_items as any)?.purchase_unit || 'pack';
                                  const pcsPerPack = getItemPcsPerPack(item);
                                  const pCount = item.package_count || (pcsPerPack > 1 ? Math.floor(Number(item.quantity_base_unit) / pcsPerPack) : null);
                                  const isRejected = Boolean(item.is_rejected) || (Number(item.quantity_base_unit) === 0 && Number(item.original_quantity_base_unit) > 0);
                                  const isAddedByApprover = !isRejected && item.original_quantity_base_unit !== null && item.original_quantity_base_unit !== undefined && Number(item.original_quantity_base_unit) === 0;
                                  const isModified = !isRejected && !isAddedByApprover && item.original_quantity_base_unit && Number(item.original_quantity_base_unit) !== Number(item.quantity_base_unit);

                                  if (isRejected) {
                                    return (
                                      <TableRow key={idx} className="bg-destructive/5 opacity-75">
                                        <TableCell className="font-medium">
                                          <div className="line-through text-muted-foreground">{name}</div>
                                          <Badge variant="outline" className="mt-1 text-[10px] text-destructive border-destructive/30 bg-destructive/10">
                                            Not Approved (Requested: {item.original_quantity_base_unit || 0} {unit})
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-semibold pr-4">
                                          <span className="line-through text-muted-foreground">0 {unit}</span>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  }

                                  return (
                                    <TableRow key={idx}>
                                      <TableCell className="font-medium">
                                        <div>{name}</div>
                                        {pcsPerPack > 1 && pCount ? (
                                          <div className="text-[11px] font-semibold text-primary">
                                            {pCount} {pCount === 1 ? pkgUnit : `${pkgUnit}s`} × {pcsPerPack} {unit}/{pkgUnit}
                                          </div>
                                        ) : null}
                                        {isAddedByApprover && (
                                          <Badge variant="outline" className="mt-1 text-[10px] text-purple-600 border-purple-300 dark:text-purple-400 dark:border-purple-800">
                                            Added at Dispatch: {item.quantity_base_unit} {unit}
                                          </Badge>
                                        )}
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
                                            ({pCount} {pCount === 1 ? pkgUnit : `${pkgUnit}s`})
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
                        You can adjust the quantity to dispatch, add items, or remove items before approving.
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
                    const isRejected = Boolean(item.is_rejected) || Number(item.quantity_base_unit) === 0;
                    if (isRejected) return false;
                    const received = receivedQuantities[item.item_id] ?? item.quantity_base_unit;
                    return received !== Number(item.quantity_base_unit);
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

      {/* Compact Add Item to Transfer Modal */}
      <Dialog open={showAddItemModal} onOpenChange={setShowAddItemModal}>
        <DialogContent className="max-w-xl p-0 overflow-hidden">
          <DialogHeader className="p-5 pb-3 border-b shrink-0">
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              Add Item to Shipment
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select an item from {selectedTransfer?.source_branch?.name || 'source branch'} to include in this shipment before dispatching.
            </DialogDescription>
          </DialogHeader>

          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            <Card className="bg-muted/30 border border-border/70 shadow-xs">
              <CardContent className="p-4 space-y-4">
                {/* Item Selector */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-foreground">Select Item</Label>
                    {addModalItemId && (() => {
                      const item = catalog.find(c => c.id === addModalItemId);
                      const minQty = item?.min_transfer_qty && item.min_transfer_qty > 0 ? item.min_transfer_qty : null;
                      return (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            Available: <strong className="text-foreground">{formatAvailableQuantity(cleanQuantity(sourceInventory[addModalItemId]), item, !isPortionedPackItem(item))}</strong>
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
                  <Popover open={addModalPopoverOpen} onOpenChange={setAddModalPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button 
                        variant="outline" 
                        role="combobox" 
                        aria-expanded={addModalPopoverOpen} 
                        className="w-full justify-between text-left font-normal bg-background h-10 border-input shadow-2xs"
                      >
                        {addModalItemId ? (
                          (() => {
                            const item = catalog.find(c => c.id === addModalItemId);
                            const qty = cleanQuantity(sourceInventory[addModalItemId]);
                            return item ? (
                              <div className="flex items-center justify-between w-full pr-2">
                                <span className="font-medium text-foreground truncate">{item.item_name}</span>
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono shrink-0 ml-2">
                                  {formatAvailableQuantity(qty, item, !isPortionedPackItem(item))}
                                </span>
                              </div>
                            ) : "Select an item";
                          })()
                        ) : (
                          <span className="text-muted-foreground">Search and select item to add...</span>
                        )}
                        <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 shadow-lg" align="start">
                      <div className="flex flex-col h-[300px]">
                        <div className="flex flex-col gap-2 border-b px-3 py-2 sticky top-0 bg-background z-10">
                          <Select value={addModalCategory} onValueChange={setAddModalCategory}>
                            <SelectTrigger className="h-8 w-full">
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="All">All Categories</SelectItem>
                              {Array.from(new Set(catalog.filter(c => c.status === 'active' && !(branches.find(b => b.id === selectedTransfer?.source_branch_id)?.name?.toLowerCase().includes('main') && c.category?.toLowerCase().includes('portioned'))).map(c => c.category).filter(Boolean))).sort().map(cat => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center">
                            <MagnifyingGlassIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                            <Input
                              placeholder="Search catalog items..."
                              value={addModalSearch}
                              onChange={(e) => setAddModalSearch(e.target.value)}
                              className="h-8 w-full bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 py-0 text-sm outline-none"
                            />
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-1">
                          {(() => {
                            const filtered = catalog.filter(item => {
                              if (item.status !== 'active') return false;

                              // Must not already be active in transferItems
                              const exists = transferItems.some(ti => !ti.is_deleted && ti.item_id === item.id);
                              if (exists) return false;

                              if (branches.find(b => b.id === selectedTransfer?.source_branch_id)?.name?.toLowerCase().includes('main') && item.category?.toLowerCase().includes('portioned')) {
                                return false;
                              }
                              
                              const isAvailableToSource = !item.available_branches || 
                                item.available_branches.length === 0 || 
                                Boolean(selectedTransfer?.source_branch_id && item.available_branches.includes(selectedTransfer.source_branch_id));

                              const isAvailableToTarget = !item.available_branches || 
                                item.available_branches.length === 0 || 
                                Boolean(selectedTransfer?.target_branch_id && item.available_branches.includes(selectedTransfer.target_branch_id));
                                
                              const matchesCategory = addModalCategory === 'All' || item.category === addModalCategory;
                              const matchesSearch = !addModalSearch.trim() || item.item_name.toLowerCase().includes(addModalSearch.toLowerCase());
                              return isAvailableToSource && isAvailableToTarget && matchesCategory && matchesSearch;
                            });

                            if (filtered.length === 0) {
                              return (
                                <div className="py-6 text-center text-sm text-muted-foreground">
                                  No items found.
                                </div>
                              );
                            }
                            return filtered.map(item => {
                              const qty = cleanQuantity(sourceInventory[item.id]);
                              const isSelected = addModalItemId === item.id;
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => {
                                    setAddModalItemId(item.id);
                                    setAddModalPopoverOpen(false);
                                    setAddModalSearch('');
                                    const defaultPackSize = getDefaultPackSize(item);
                                    if (defaultPackSize !== null) {
                                      setAddModalEntryMode('pack');
                                      setAddModalPackSize(defaultPackSize);
                                    } else {
                                      setAddModalEntryMode('base');
                                      setAddModalPackSize(5);
                                    }
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded-sm text-sm transition-colors hover:bg-accent hover:text-accent-foreground flex items-center justify-between ${isSelected ? 'bg-accent/50 font-medium' : ''}`}
                                >
                                  <span className="truncate">{item.item_name}</span>
                                  <span className="text-xs text-muted-foreground shrink-0 pl-2">
                                    {formatAvailableQuantity(qty, item, !isPortionedPackItem(item))}
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
                  {(() => {
                    const selectedCatalogItem = catalog.find(c => c.id === addModalItemId);
                    const baseU = selectedCatalogItem?.base_unit || 'units';
                    const pkgU = selectedCatalogItem?.purchase_unit || 'pack';
                    const hasDefinedPackSize = getLockedPackSize(selectedCatalogItem) !== null;
                    const effectivePackSize = hasDefinedPackSize ? Number(selectedCatalogItem?.conversion_factor) : (Number(addModalPackSize) || 5);
                    const pCount = Number(addModalPackCount) || 0;

                    return (
                      <>
                        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
                          <Label className="text-xs font-semibold text-foreground">Packaging & Quantity Format</Label>
                          <div className="inline-flex rounded-lg border bg-muted/60 p-0.5">
                            <button
                              type="button"
                              onClick={() => setAddModalEntryMode('base')}
                              className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer ${
                                addModalEntryMode === 'base'
                                  ? 'bg-background text-foreground shadow-xs font-semibold'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              Direct ({baseU})
                            </button>
                            <button
                              type="button"
                              onClick={() => setAddModalEntryMode('pack')}
                              className={`px-3 py-1 text-xs rounded-md font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                                addModalEntryMode === 'pack'
                                  ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              <span>By {pkgU.charAt(0).toUpperCase() + pkgU.slice(1)} ({pkgU} × {baseU})</span>
                            </button>
                          </div>
                        </div>

                        {addModalEntryMode === 'pack' ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label className="text-xs font-medium text-muted-foreground">Number of {pkgU.charAt(0).toUpperCase() + pkgU.slice(1)}s</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={addModalPackCount}
                                  onChange={(e) => setAddModalPackCount(e.target.value === '' ? '' : Number(e.target.value))}
                                  placeholder="e.g. 5"
                                  className="bg-background h-9"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-medium text-muted-foreground">Base {baseU} per {pkgU}</Label>
                                  {hasDefinedPackSize && (
                                    <span className="text-[10px] text-primary flex items-center gap-1 font-medium bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                                      <Lock className="h-3 w-3" /> Locked ({effectivePackSize} {baseU}/{pkgU})
                                    </span>
                                  )}
                                </div>
                                {isPortionedPackItem(selectedCatalogItem) ? (
                                  <PackSizeSelect
                                    key={selectedCatalogItem?.id}
                                    options={getPackSizeOptions(selectedCatalogItem, portionPackSizes)}
                                    value={addModalPackSize}
                                    onChange={setAddModalPackSize}
                                    unit={baseU}
                                    className="h-9 bg-background"
                                  />
                                ) : (
                                  <Input
                                    type="number"
                                    min="1"
                                    step="any"
                                    value={hasDefinedPackSize ? effectivePackSize : addModalPackSize}
                                    readOnly={hasDefinedPackSize}
                                    disabled={hasDefinedPackSize}
                                    onChange={(e) => {
                                      if (!hasDefinedPackSize) {
                                        setAddModalPackSize(e.target.value === '' ? '' : Number(e.target.value));
                                      }
                                    }}
                                    placeholder="e.g. 5 or 10"
                                    className={`h-9 ${hasDefinedPackSize ? 'bg-muted/70 text-foreground font-semibold cursor-not-allowed border-muted-foreground/30' : 'bg-background'}`}
                                  />
                                )}
                              </div>
                            </div>

                            {/* Live Conversion Banner */}
                            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                              <span className="text-foreground font-medium">
                                <span>Total Computed Quantity:</span>
                              </span>
                              <span className="font-bold text-primary font-mono text-sm">
                                {pCount > 0 && effectivePackSize > 0 
                                  ? `${pCount} ${pkgU}${pCount === 1 ? '' : 's'} × ${effectivePackSize} ${baseU}/${pkgU} = ${pCount * effectivePackSize} ${baseU}`
                                  : `0 ${baseU}`}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-muted-foreground">
                              Enter Quantity ({baseU})
                            </Label>
                            <Input
                              type="number"
                              min="0.01"
                              step="any"
                              value={addModalDirectQty}
                              onChange={(e) => setAddModalDirectQty(e.target.value === '' ? '' : Number(e.target.value))}
                              placeholder="0"
                              className="bg-background h-9"
                            />
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Validation warnings */}
                {addModalItemId && (() => {
                  const item = catalog.find(c => c.id === addModalItemId);
                  const minQty = item?.min_transfer_qty && item.min_transfer_qty > 0 ? item.min_transfer_qty : null;
                  const hasDefinedPackSize = getLockedPackSize(item) !== null;
                  const effectivePackSize = hasDefinedPackSize ? Number(item?.conversion_factor) : (Number(addModalPackSize) || 5);
                  const calculatedQty = addModalEntryMode === 'pack' 
                    ? ((Number(addModalPackCount) || 0) * effectivePackSize)
                    : (Number(addModalDirectQty) || 0);
                  const isBelowMin = minQty !== null && calculatedQty > 0 && calculatedQty < minQty;
                  const avail = cleanQuantity(sourceInventory[item?.id || '']);
                  const isOverAvail = calculatedQty > avail;

                  return (
                    <div className="space-y-1.5">
                      {isBelowMin && (
                        <p className="text-xs text-destructive font-semibold">
                          Quantity must be at least {minQty} {item?.base_unit}
                        </p>
                      )}
                      {isOverAvail && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                          Note: Quantity exceeds current source inventory ({formatQuantity(avail)} {item?.base_unit || 'units'} available).
                        </p>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          <DialogFooter className="p-4 pt-3 border-t shrink-0 flex justify-end gap-2 bg-muted/20">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAddItemModal(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!addModalItemId || (addModalEntryMode === 'pack' ? (Number(addModalPackCount) <= 0) : (Number(addModalDirectQty) <= 0))}
              onClick={handleConfirmAddItem}
              className="cursor-pointer"
            >
              + Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
