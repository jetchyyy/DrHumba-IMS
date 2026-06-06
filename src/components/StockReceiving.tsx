import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { settingsService } from '../lib/settingsService';
import { printStockInReceipt } from '../lib/printService';
import { PlusIcon as Plus, TrashIcon as Trash2, EyeOpenIcon as Eye, ClipboardIcon as ClipboardCheck, ReloadIcon as RefreshCw, FileTextIcon as Printer, FilePlusIcon as FilePlus } from '@radix-ui/react-icons';
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

interface Receipt {
  id: string;
  control_number: string | null;
  supplier: string;
  invoice_no: string | null;
  date_received: string;
  status: 'draft' | 'completed';
  created_at: string;
}

interface ReceiptItem {
  id: string;
  item_id: string;
  quantity_purchased: number;
  cost_per_purchase_unit: number;
  inventory_items?: {
    item_name: string;
    purchase_unit: string;
  };
}

interface CatalogItem {
  id: string;
  item_name: string;
  purchase_unit: string;
  conversion_factor: number;
}

export const StockReceiving: React.FC = () => {
  const { selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  
  const [receipts, setReceipts] = useState<Receipt[]>([]);
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
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  
  // Create Receipt Form state
  const [supplier, setSupplier] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dateReceived, setDateReceived] = useState(new Date().toISOString().split('T')[0]);
  const [addedItems, setAddedItems] = useState<{ item_id: string; qty: number; cost: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(1);
  const [currentCost, setCurrentCost] = useState(10);
  
  const [processingReceiptId, setProcessingReceiptId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const { data: recData, error: recError } = await supabase
        .from('stock_receipts')
        .select('*')
        .order('created_at', { ascending: false });
      if (recError) throw recError;
      setReceipts(recData || []);

      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, purchase_unit, conversion_factor')
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

  const handleOpenCreateModal = () => {
    setSupplier('');
    setInvoiceNo('');
    setDateReceived(new Date().toISOString().split('T')[0]);
    setAddedItems([]);
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(10);
      setCurrentCost(15);
    }
    setShowCreateModal(true);
  };

  const handleAddItemToReceiptForm = () => {
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
        qty: Number(currentQty),
        cost: Number(currentCost)
      }
    ]);
  };

  const handleRemoveItemFromReceiptForm = (index: number) => {
    setAddedItems(addedItems.filter((_, i) => i !== index));
  };

  const handleSaveReceipt = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!supplier.trim()) {
      showError("Supplier is required");
      return;
    }

    if (addedItems.length === 0) {
      showError("Add at least one item");
      return;
    }

    if (!selectedBranch) {
      showError("No branch context selected");
      return;
    }

    try {
      const { data: receiptData, error: receiptError } = await supabase
        .from('stock_receipts')
        .insert({
          supplier: supplier.trim(),
          invoice_no: invoiceNo.trim() || null,
          date_received: dateReceived,
          branch_id: selectedBranch.id,
          status: 'draft'
        })
        .select()
        .single();

      if (receiptError) throw receiptError;

      const itemsPayload = addedItems.map(item => ({
        receipt_id: receiptData.id,
        item_id: item.item_id,
        quantity_purchased: item.qty,
        cost_per_purchase_unit: item.cost
      }));

      const { error: itemsError } = await supabase
        .from('stock_receipt_items')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      showSuccess("Receipt draft created!");
      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error creating receipt');
    }
  };

  const handleViewReceipt = async (receipt: Receipt) => {
    setSelectedReceipt(receipt);
    try {
      const { data, error } = await supabase
        .from('stock_receipt_items')
        .select(`
          id,
          item_id,
          quantity_purchased,
          cost_per_purchase_unit,
          inventory_items (
            item_name,
            purchase_unit
          )
        `)
        .eq('receipt_id', receipt.id);
      
      if (error) throw error;
      setReceiptItems(data as any[] || []);
      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      showError("Error fetching receipt items");
    }
  };

  const handleProcessReceipt = async (receiptId: string) => {
    if (!await confirm(
      'Finalize Stock Receipt',
      'Are you sure you want to finalize this stock receipt? This will update the branch inventory balances and write the movement ledger.'
    )) return;

    setProcessingReceiptId(receiptId);
    try {
      const { error } = await supabase.rpc('fn_receive_stock', {
        p_receipt_id: receiptId
      });

      if (error) throw error;

      showSuccess("Stock receipt successfully processed and ledger written.");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to complete receipt.');
    } finally {
      setProcessingReceiptId(null);
    }
  };

  const handlePrintReceipt = async (receipt: Receipt, items: ReceiptItem[]) => {
    try {
      const settings = await settingsService.getSettings();
      printStockInReceipt(receipt, items, settings.transfer_slip);
    } catch (err) {
      console.error('Failed to print stock receipt:', err);
      showError("Failed to load print templates.");
    }
  };

  const filteredReceipts = receipts.filter(receipt => {
    let matchesDate = true;
    const recDate = new Date(receipt.date_received);
    const now = new Date();

    if (dateFilter === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      matchesDate = recDate >= todayStart;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchesDate = recDate >= weekAgo;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchesDate = recDate >= monthAgo;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && recDate >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && recDate <= end;
      }
    }
    return matchesDate;
  });

  const totalPages = Math.ceil(filteredReceipts.length / itemsPerPage);
  const paginatedReceipts = filteredReceipts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <FilePlus className="w-8 h-8 text-primary" />
            <span>Stock Receiving</span>
          </h2>
          <p className="text-muted-foreground">Receive inventory shipments from suppliers and process unit conversions.</p>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          <Button onClick={handleOpenCreateModal}>
            <Plus className="mr-2 h-4 w-4" />
            Receive Stock
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
          <CardTitle>Delivery Receipts</CardTitle>
          <CardDescription>View and manage all stock deliveries to this branch.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Control No / Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Invoice No.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReceipts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No delivery receipts found for the selected dates.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedReceipts.map(rec => (
                <TableRow key={rec.id}>
                  <TableCell className="pl-6">
                    <div className="font-bold">{rec.control_number || 'Pending'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{rec.date_received}</div>
                  </TableCell>
                  <TableCell className="font-bold">{rec.supplier}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{rec.invoice_no || 'N/A'}</TableCell>
                  <TableCell>
                    <Badge variant={rec.status === 'completed' ? 'default' : 'secondary'} className="uppercase text-[10px]">
                      {rec.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button variant="ghost" size="sm" onClick={() => handleViewReceipt(rec)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View & Manage
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
            <DialogTitle>New Stock Delivery Draft</DialogTitle>
            <DialogDescription>
              Create a draft invoice for items received from a supplier.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveReceipt} className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Supplier Name *</Label>
                <Input
                  required
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="e.g. Sysco Foods"
                />
              </div>
              <div className="space-y-2">
                <Label>Invoice / Receipt No.</Label>
                <Input
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="e.g. INV-99384"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Date Received *</Label>
                <Input
                  type="date"
                  required
                  value={dateReceived}
                  onChange={(e) => setDateReceived(e.target.value)}
                />
              </div>
            </div>

            {/* Add Item Sub-Form */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <div className="md:col-span-2 space-y-2">
                    <Label>Select Item</Label>
                    <Select value={currentSelectedItemId} onValueChange={setCurrentSelectedItemId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an item" />
                      </SelectTrigger>
                      <SelectContent>
                        {catalog.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.item_name} ({item.purchase_unit})
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
                  <div className="space-y-2">
                    <Label>Unit Cost (₱)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={currentCost}
                      onChange={(e) => setCurrentCost(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="secondary" onClick={handleAddItemToReceiptForm}>
                    <Plus className="mr-2 h-4 w-4" /> Add Item to Invoice
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Added Items List */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Invoice Summary ({addedItems.length} items)</h4>
              <div className="border rounded-md max-h-48 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addedItems.map((item, idx) => {
                      const info = catalog.find(c => c.id === item.item_id);
                      const sub = item.qty * item.cost;
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{info?.item_name}</TableCell>
                          <TableCell className="text-right">{item.qty} {info?.purchase_unit}</TableCell>
                          <TableCell className="text-right">₱{item.cost.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-semibold">₱{sub.toFixed(2)}</TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleRemoveItemFromReceiptForm(idx)}
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
                Discard Draft
              </Button>
              <Button type="submit">
                Save Draft Invoice
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
                <DialogTitle>Stock In: {selectedReceipt?.control_number || 'Pending'}</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  ID: {selectedReceipt?.id}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mr-6"
                onClick={() => selectedReceipt && handlePrintReceipt(selectedReceipt, receiptItems)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print PDF
              </Button>
            </div>
          </DialogHeader>

          {selectedReceipt && (
            <div className="space-y-6 pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Supplier</span>
                  <span className="font-medium">{selectedReceipt.supplier}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Invoice Number</span>
                  <span className="font-mono font-medium">{selectedReceipt.invoice_no || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Delivery Date</span>
                  <span className="font-medium">{selectedReceipt.date_received}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Status</span>
                  <Badge variant={selectedReceipt.status === 'completed' ? 'default' : 'secondary'} className="uppercase mt-1 text-[10px]">
                    {selectedReceipt.status}
                  </Badge>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3">Delivered Items</h4>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit Cost</TableHead>
                        <TableHead className="text-right pr-4">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {receiptItems.map((item, idx) => {
                        const name = item.inventory_items?.item_name || 'Deleted Item';
                        const unit = item.inventory_items?.purchase_unit || 'unit';
                        const sub = item.quantity_purchased * item.cost_per_purchase_unit;
                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{name}</TableCell>
                            <TableCell className="text-right">{item.quantity_purchased} {unit}</TableCell>
                            <TableCell className="text-right">₱{item.cost_per_purchase_unit.toFixed(2)}</TableCell>
                            <TableCell className="text-right font-semibold pr-4">₱{sub.toFixed(2)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowViewModal(false)}>
                  Close
                </Button>
                {selectedReceipt.status === 'draft' && (
                  <Button
                    onClick={() => handleProcessReceipt(selectedReceipt.id)}
                    disabled={processingReceiptId === selectedReceipt.id}
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    {processingReceiptId === selectedReceipt.id ? 'Processing...' : 'Complete & Process Stock'}
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
