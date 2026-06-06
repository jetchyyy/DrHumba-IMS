import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { settingsService } from '../lib/settingsService';
import { printTransferSlip } from '../lib/printService';
import { EyeOpenIcon as Eye, ReloadIcon as RefreshCw, SymbolIcon as ArrowRightLeft, TrashIcon as Trash2, FileTextIcon as Printer } from '@radix-ui/react-icons';
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
  status: 'requested' | 'approved' | 'rejected' | 'completed';
  remarks: string | null;
  created_at: string;
  requested_by?: string | null;
  approved_by?: string | null;
  source_branch?: { name: string };
  target_branch?: { name: string };
}

interface TransferItem {
  id: string;
  item_id: string;
  quantity_base_unit: number;
  inventory_items?: {
    item_name: string;
    base_unit: string;
  };
}

interface CatalogItem {
  id: string;
  item_name: string;
  base_unit: string;
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
  const [addedItems, setAddedItems] = useState<{ item_id: string; qty: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(50);
  
  const [approving, setApproving] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [isProactive, setIsProactive] = useState(false);

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
          source_branch:branches!transfer_requests_source_branch_id_fkey(name),
          target_branch:branches!transfer_requests_target_branch_id_fkey(name)
        `)
        .order('created_at', { ascending: false });
      if (tranError) throw tranError;
      setTransfers((tranData as any[]) || []);

      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, base_unit')
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

  const handleOpenCreateModal = (proactive: boolean = false) => {
    setIsProactive(proactive);
    const warehouse = branches.find(b => b.is_warehouse);
    setSourceBranchId(warehouse?.id || selectedBranch?.id || '');
    setTargetBranchId(proactive ? '' : selectedBranch?.id || '');
    setRemarks('');
    setAddedItems([]);
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(100);
    }
    setShowCreateModal(true);
  };

  const handleAddItemToTransfer = () => {
    if (!currentSelectedItemId) return;
    
    const exists = addedItems.find(i => i.item_id === currentSelectedItemId);
    if (exists) {
      showError("Item already added. Please modify it or delete first.");
      return;
    }

    setAddedItems([
      ...addedItems,
      {
        item_id: currentSelectedItemId,
        qty: Number(currentQty)
      }
    ]);
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

    try {
      const itemsPayload = addedItems.map(item => ({
        item_id: item.item_id,
        quantity_base_unit: item.qty
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
      const { data, error } = await supabase
        .from('transfer_items')
        .select(`
          id,
          item_id,
          quantity_base_unit,
          inventory_items (
            item_name,
            base_unit
          )
        `)
        .eq('transfer_id', transfer.id);
      
      if (error) throw error;
      setTransferItems(data as any[] || []);
      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      showError("Error fetching transfer items");
    }
  };

  const handleApproveTransfer = async (transferId: string) => {
    if (!await confirm(
      'Approve & Dispatch Transfer',
      'Are you sure you want to approve and dispatch this transfer? Stock will be immediately deducted from the source branch and marked as in transit.'
    )) return;

    setApproving(true);
    try {
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

  const canApprove = profile && ['super_admin', 'inventory_manager', 'branch_manager'].includes(profile.role_name);

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
          <h2 className="text-3xl font-bold tracking-tight">Stock Transfers</h2>
          <p className="text-muted-foreground">Request, send, and confirm inventory movements between locations.</p>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {(profile?.role_name === 'super_admin' || profile?.role_name === 'inventory_manager' || selectedBranch?.is_warehouse) && (
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
                    <Button variant="ghost" size="sm" onClick={() => handleViewTransfer(t)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isProactive ? 'Send Stock Shipment' : 'New Transfer Request'}</DialogTitle>
            <DialogDescription>
              {isProactive ? 'Ship inventory from your branch to another location.' : 'Request inventory from a warehouse or branch.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveTransferRequest} className="space-y-6 pt-4">
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
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="md:col-span-2 space-y-2">
                    <Label>Select Item</Label>
                    <Select value={currentSelectedItemId} onValueChange={setCurrentSelectedItemId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an item" />
                      </SelectTrigger>
                      <SelectContent>
                        {catalog.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.item_name} ({item.base_unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Qty</Label>
                    <Input
                      type="number"
                      value={currentQty}
                      onChange={(e) => setCurrentQty(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="secondary" onClick={handleAddItemToTransfer}>
                    Add Item
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Added Items List */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Items to Transfer ({addedItems.length})</h4>
              <div className="border rounded-md max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addedItems.map((item, idx) => {
                      const info = catalog.find(c => c.id === item.item_id);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{info?.item_name}</TableCell>
                          <TableCell className="text-right font-bold">{item.qty} {info?.base_unit}</TableCell>
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

            <DialogFooter>
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
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
            <div className="space-y-6 pt-4">
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
                    selectedTransfer.status === 'rejected' ? 'destructive' : 'secondary'
                  } className="uppercase mt-1 text-[10px]">
                    {selectedTransfer.status === 'approved' ? 'In Transit' : selectedTransfer.status}
                  </Badge>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Remarks</span>
                  <span className="font-medium">{selectedTransfer.remarks || 'No remarks'}</span>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3">Requested Items</h4>
                <div className="border rounded-md">
                  <Table>
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
                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{name}</TableCell>
                            <TableCell className="text-right font-semibold pr-4">{item.quantity_base_unit} {unit}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {selectedTransfer.status === 'approved' && (
                <div className="text-sm text-yellow-600 bg-yellow-50 border border-yellow-200 p-3 rounded-md text-center dark:bg-yellow-950 dark:border-yellow-900/50 dark:text-yellow-500">
                  🚚 Stock is currently in transit. Please verify the physical delivery before confirming receipt.
                </div>
              )}

              <DialogFooter className="flex space-x-2 sm:space-x-0">
                {selectedTransfer.status === 'requested' && canApprove ? (
                  <>
                    <Button variant="destructive" onClick={() => handleRejectTransfer(selectedTransfer.id)}>
                      Reject
                    </Button>
                    <Button disabled={approving} onClick={() => handleApproveTransfer(selectedTransfer.id)}>
                      {approving ? 'Dispatching...' : 'Approve & Dispatch'}
                    </Button>
                  </>
                ) : selectedTransfer.status === 'approved' && 
                    profile?.id !== selectedTransfer.approved_by && 
                    profile?.id !== selectedTransfer.requested_by && 
                    profile?.branch_id !== selectedTransfer.source_branch_id && (
                      profile?.role_name === 'super_admin' || 
                      profile?.role_name === 'inventory_manager' || 
                      profile?.branch_id === selectedTransfer.target_branch_id
                    ) ? (
                  <>
                    <Button variant="outline" onClick={() => setShowViewModal(false)}>
                      Close
                    </Button>
                    <Button disabled={receiving} onClick={() => handleReceiveTransfer(selectedTransfer.id)}>
                      {receiving ? 'Confirming...' : 'Confirm & Receive Items'}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setShowViewModal(false)}>
                    Close
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
