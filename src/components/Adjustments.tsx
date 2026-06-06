import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { settingsService } from '../lib/settingsService';
import { printAdjustmentSlip } from '../lib/printService';
import { PlusIcon as Plus, EyeOpenIcon as Eye, ReloadIcon as RefreshCw, TrashIcon as Trash2, FileTextIcon as Printer, ClipboardIcon as ClipboardList } from '@radix-ui/react-icons';
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

interface Adjustment {
  id: string;
  control_number: string | null;
  branch_id: string;
  reason: 'damage' | 'spoilage' | 'expired' | 'lost' | 'manual_correction';
  remarks: string | null;
  photo_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  branches?: { name: string };
}

interface AdjustmentItem {
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

export const Adjustments: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
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
  const [selectedAdjustment, setSelectedAdjustment] = useState<Adjustment | null>(null);
  const [adjustmentItems, setAdjustmentItems] = useState<AdjustmentItem[]>([]);
  
  // Create Form state
  const [reason, setReason] = useState<'damage' | 'spoilage' | 'expired' | 'lost' | 'manual_correction'>('spoilage');
  const [remarks, setRemarks] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [addedItems, setAddedItems] = useState<{ item_id: string; qty: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(-10); // Default to negative deduction
  
  const [processing, setProcessing] = useState(false);

  const loadData = async () => {
    try {
      const { data: adjData, error: adjError } = await supabase
        .from('stock_adjustments')
        .select(`
          id,
          control_number,
          branch_id,
          reason,
          remarks,
          photo_url,
          status,
          created_at,
          branches (name)
        `)
        .order('created_at', { ascending: false });
      if (adjError) throw adjError;
      setAdjustments((adjData as any[]) || []);

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
  }, [selectedBranch]);

  const handleOpenCreateModal = () => {
    setReason('spoilage');
    setRemarks('');
    setPhotoUrl('');
    setAddedItems([]);
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(-10);
    }
    setShowCreateModal(true);
  };

  const handleAddItem = () => {
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

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (addedItems.length === 0) {
      showError("Add at least one item to adjust");
      return;
    }

    if (!selectedBranch) {
      showError("No branch context selected");
      return;
    }

    try {
      const { data: adjData, error: adjError } = await supabase
        .from('stock_adjustments')
        .insert({
          branch_id: selectedBranch.id,
          reason,
          remarks: remarks.trim() || null,
          photo_url: photoUrl.trim() || null,
          status: 'pending'
        })
        .select()
        .single();

      if (adjError) throw adjError;

      const itemsPayload = addedItems.map(item => ({
        adjustment_id: adjData.id,
        item_id: item.item_id,
        quantity_base_unit: item.qty
      }));

      const { error: itemsError } = await supabase
        .from('stock_adjustment_items')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      await supabase
        .from('notifications')
        .insert({
          branch_id: selectedBranch.id,
          type: 'adjustment_pending',
          message: `New adjustment (${reason}) pending approval at ${selectedBranch.name}`
        });

      showSuccess("Adjustment logged and pending approval!");
      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error logging adjustment');
    }
  };

  const handleViewAdjustment = async (adj: Adjustment) => {
    setSelectedAdjustment(adj);
    try {
      const { data, error } = await supabase
        .from('stock_adjustment_items')
        .select(`
          id,
          item_id,
          quantity_base_unit,
          inventory_items (
            item_name,
            base_unit
          )
        `)
        .eq('adjustment_id', adj.id);
      
      if (error) throw error;
      setAdjustmentItems(data as any[] || []);
      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      showError("Error fetching adjustment items");
    }
  };

  const handleApproveAdjustment = async (adjustmentId: string) => {
    if (!await confirm(
      'Approve Stock Adjustment',
      'Are you sure you want to approve this stock adjustment? Balance corrections will be instantly applied and movement ledgers committed.'
    )) return;

    setProcessing(true);
    try {
      const { error } = await supabase.rpc('fn_process_adjustment', {
        p_adjustment_id: adjustmentId
      });

      if (error) throw error;

      showSuccess("Adjustment approved and inventory records updated!");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to approve adjustment.');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAdjustment = async (adjustmentId: string) => {
    if (!await confirm('Reject Adjustment Request', 'Are you sure you want to reject this request?')) return;

    try {
      const { error } = await supabase
        .from('stock_adjustments')
        .update({ status: 'rejected', approved_by: profile?.id })
        .eq('id', adjustmentId);

      if (error) throw error;

      showSuccess("Adjustment request rejected successfully.");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to reject adjustment.');
    }
  };

  const canApprove = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  const handlePrintReceipt = async (adjustment: Adjustment, items: AdjustmentItem[]) => {
    try {
      const settings = await settingsService.getSettings();
      printAdjustmentSlip(adjustment, items, settings.transfer_slip);
    } catch (err) {
      console.error('Failed to print adjustment receipt:', err);
      showError("Failed to load print templates.");
    }
  };

  const filteredAdjustments = adjustments.filter(adj => {
    let matchesDate = true;
    const aDate = new Date(adj.created_at);
    const now = new Date();

    if (dateFilter === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      matchesDate = aDate >= todayStart;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchesDate = aDate >= weekAgo;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchesDate = aDate >= monthAgo;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && aDate >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && aDate <= end;
      }
    }
    return matchesDate;
  });

  const totalPages = Math.ceil(filteredAdjustments.length / itemsPerPage);
  const paginatedAdjustments = filteredAdjustments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <ClipboardList className="w-8 h-8 text-primary" />
            <span>Stock Adjustments</span>
          </h2>
          <p className="text-muted-foreground">Log damages, spoilage, or manual inventory count corrections.</p>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          <Button onClick={handleOpenCreateModal}>
            <Plus className="mr-2 h-4 w-4" />
            Create Adjustment Log
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
          <CardTitle>Adjustment Logs</CardTitle>
          <CardDescription>View all pending and processed inventory corrections.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Control No / Date</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAdjustments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No adjustments found for the selected dates.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedAdjustments.map(adj => (
                <TableRow key={adj.id}>
                  <TableCell className="pl-6">
                    <div className="font-bold">{adj.control_number || 'Pending'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{new Date(adj.created_at).toLocaleDateString()}</div>
                  </TableCell>
                  <TableCell>{adj.branches?.name || 'Unknown'}</TableCell>
                  <TableCell className="capitalize">
                    {adj.reason.replace('_', ' ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">{adj.remarks || 'No remarks'}</TableCell>
                  <TableCell>
                    <Badge variant={
                      adj.status === 'approved' ? 'default' :
                      adj.status === 'rejected' ? 'destructive' : 'secondary'
                    } className="uppercase text-[10px]">
                      {adj.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button variant="ghost" size="sm" onClick={() => handleViewAdjustment(adj)}>
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
            <DialogTitle>Log Stock Adjustment</DialogTitle>
            <DialogDescription>
              Submit an inventory count correction. Requires manager approval.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveAdjustment} className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Adjustment Reason *</Label>
                <Select value={reason} onValueChange={(v: any) => setReason(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spoilage">Spoilage</SelectItem>
                    <SelectItem value="damage">Damage / Spill</SelectItem>
                    <SelectItem value="expired">Expired Goods</SelectItem>
                    <SelectItem value="lost">Lost / Theft</SelectItem>
                    <SelectItem value="manual_correction">Manual Count Correction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Photo Attachment URL (Optional)</Label>
                <Input
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                  placeholder="https://example.com/spoilage.jpg"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remarks / Explanation *</Label>
              <Input
                required
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Freezers went down overnight"
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
                    <Label>Qty (Negative to deduct)</Label>
                    <Input
                      type="number"
                      value={currentQty}
                      onChange={(e) => setCurrentQty(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="secondary" onClick={handleAddItem}>
                    Add Item
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Added Items List */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Adjustments List ({addedItems.length})</h4>
              <div className="border rounded-md max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead className="text-right">Adjustment Amount</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addedItems.map((item, idx) => {
                      const info = catalog.find(c => c.id === item.item_id);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{info?.item_name}</TableCell>
                          <TableCell className={`text-right font-bold ${item.qty < 0 ? 'text-destructive' : 'text-primary'}`}>
                            {item.qty > 0 ? `+${item.qty}` : item.qty} {info?.base_unit}
                          </TableCell>
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
                Submit for Approval
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
                <DialogTitle>
                  {selectedAdjustment && ['spoilage', 'damage', 'expired'].includes(selectedAdjustment.reason) ? 'Food Waste: ' : 'Adjustment: '}
                  {selectedAdjustment?.control_number || 'Pending'}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  ID: {selectedAdjustment?.id}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mr-6"
                onClick={() => selectedAdjustment && handlePrintReceipt(selectedAdjustment, adjustmentItems)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print PDF
              </Button>
            </div>
          </DialogHeader>

          {selectedAdjustment && (
            <div className="space-y-6 pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Branch Location</span>
                  <span className="font-medium">{selectedAdjustment.branches?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Reason</span>
                  <span className="font-medium capitalize">{selectedAdjustment.reason.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Created Date</span>
                  <span className="font-medium">{new Date(selectedAdjustment.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Status</span>
                  <Badge variant={
                    selectedAdjustment.status === 'approved' ? 'default' :
                    selectedAdjustment.status === 'rejected' ? 'destructive' : 'secondary'
                  } className="uppercase mt-1 text-[10px]">
                    {selectedAdjustment.status}
                  </Badge>
                </div>
                {selectedAdjustment.photo_url && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold mb-1">Attachment Photo</span>
                    <a href={selectedAdjustment.photo_url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">
                      {selectedAdjustment.photo_url}
                    </a>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Remarks</span>
                  <span className="font-medium">{selectedAdjustment.remarks || 'No remarks'}</span>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3">Adjusted Items</h4>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right pr-4">Adjustment Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adjustmentItems.map((item, idx) => {
                        const name = item.inventory_items?.item_name || 'Deleted Item';
                        const unit = item.inventory_items?.base_unit || 'unit';
                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{name}</TableCell>
                            <TableCell className={`text-right font-bold pr-4 ${item.quantity_base_unit < 0 ? 'text-destructive' : 'text-primary'}`}>
                              {item.quantity_base_unit > 0 ? `+${item.quantity_base_unit}` : item.quantity_base_unit} {unit}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <DialogFooter className="flex space-x-2 sm:space-x-0">
                {selectedAdjustment.status === 'pending' && canApprove ? (
                  <>
                    <Button variant="destructive" onClick={() => handleRejectAdjustment(selectedAdjustment.id)}>
                      Reject Adjustment
                    </Button>
                    <Button disabled={processing} onClick={() => handleApproveAdjustment(selectedAdjustment.id)}>
                      {processing ? 'Processing...' : 'Approve & Apply'}
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
