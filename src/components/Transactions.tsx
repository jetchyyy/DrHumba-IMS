import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { settingsService } from '../lib/settingsService';
import type { SalesInvoiceTemplate } from '../lib/settingsService';
import {
  printTransferSlip,
  printThermalInvoice,
  printStockInReceipt,
  printAdjustmentSlip
} from '../lib/printService';
import {
  EyeOpenIcon as Eye,
  ReloadIcon as RefreshCw,
  MagnifyingGlassIcon as Search,
  CalendarIcon as Calendar,
  FileTextIcon as Printer,
  FileTextIcon as FileText
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
import { Calendar as CalendarComponent } from './ui/calendar';
import { format } from 'date-fns';
import { useModal } from '../contexts/ModalContext';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface UnifiedTransaction {
  id: string;
  control_number: string;
  type: 'stock_in' | 'adjustment' | 'waste' | 'transfer' | 'invoice';
  date: string;
  branch_name: string;
  details_summary: string;
  status: string;
  total_amount?: number;
  raw_data: any;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  stock_in: { label: 'Stock In', color: 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20' },
  adjustment: { label: 'Adjustment', color: 'bg-blue-500/10 text-blue-500 border border-blue-500/20' },
  waste: { label: 'Waste for Food', color: 'bg-amber-500/10 text-amber-500 border border-amber-500/20' },
  transfer: { label: 'Transfer', color: 'bg-purple-500/10 text-purple-500 border border-purple-500/20' },
  invoice: { label: 'Invoice (Sales)', color: 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' },
};

const formatPHP = (amount: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(amount);

export const Transactions: React.FC = () => {
  const { profile, branches, selectedBranch } = useAuth();
  const { showError } = useModal();

  const [transactions, setTransactions] = useState<UnifiedTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState<string>('All');
  const [selectedBranchId, setSelectedBranchId] = useState<string>('All');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedType, selectedBranchId, dateFilter, startDate, endDate]);

  // Detail Modal State
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<UnifiedTransaction | null>(null);
  const [detailItems, setDetailItems] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Thermal Print Preview Modal State
  const [showThermalPreview, setShowThermalPreview] = useState(false);
  const [previewSale, setPreviewSale] = useState<any | null>(null);
  const [salesInvoiceTemplate, setSalesInvoiceTemplate] = useState<SalesInvoiceTemplate | null>(null);

  const isAdminRole = profile && ['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name);

  const loadTransactions = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      // 1. Fetch Stock Receipts (Stock In)
      let receiptsQuery = supabase
        .from('stock_receipts')
        .select(`
          id, control_number, supplier, invoice_no, date_received, status, created_at, branch_id, branches (name)
        `);
      if (!isAdminRole && profile.branch_id) {
        receiptsQuery = receiptsQuery.eq('branch_id', profile.branch_id);
      }
      const { data: recData, error: recError } = await receiptsQuery;
      if (recError) console.error('Error fetching receipts:', recError);

      // 2. Fetch Stock Adjustments
      let adjQuery = supabase
        .from('stock_adjustments')
        .select(`
          id, control_number, branch_id, reason, remarks, photo_url, status, created_at, branches (name)
        `);
      if (!isAdminRole && profile.branch_id) {
        adjQuery = adjQuery.eq('branch_id', profile.branch_id);
      }
      const { data: adjData, error: adjError } = await adjQuery;
      if (adjError) console.error('Error fetching adjustments:', adjError);

      // 3. Fetch Transfers
      let transQuery = supabase
        .from('transfer_requests')
        .select(`
          id, control_number, source_branch_id, target_branch_id, status, remarks, created_at,
          source_branch:branches!transfer_requests_source_branch_id_fkey(name),
          target_branch:branches!transfer_requests_target_branch_id_fkey(name)
        `);
      if (!isAdminRole && profile.branch_id) {
        transQuery = transQuery.or(`source_branch_id.eq.${profile.branch_id},target_branch_id.eq.${profile.branch_id}`);
      }
      const { data: transData, error: transError } = await transQuery;
      if (transError) console.error('Error fetching transfers:', transError);

      // 4. Fetch Sales (Invoices)
      let salesQuery = supabase
        .from('sales')
        .select(`
          id, control_number, branch_id, cashier_id, total_amount, status, payment_method, amount_tendered, change_given, void_reason, created_at, branches (name)
        `);
      if (!isAdminRole && profile.branch_id) {
        salesQuery = salesQuery.eq('branch_id', profile.branch_id);
      }
      const { data: salesData, error: salesError } = await salesQuery;
      if (salesError) console.error('Error fetching sales:', salesError);

      // Map profiles for cashier emails
      const { data: profilesData } = await supabase.from('profiles').select('id, email');

      const unifiedList: UnifiedTransaction[] = [];

      // Map Stock In
      (recData || []).forEach((r: any) => {
        unifiedList.push({
          id: r.id,
          control_number: r.control_number || 'Pending',
          type: 'stock_in',
          date: r.created_at,
          branch_name: r.branches?.name || 'Unknown',
          details_summary: `Supplier: ${r.supplier} | Invoice: ${r.invoice_no || 'N/A'}`,
          status: r.status,
          raw_data: r
        });
      });

      // Map Adjustments / Waste
      (adjData || []).forEach((a: any) => {
        const isWaste = ['spoilage', 'damage', 'expired'].includes(a.reason);
        unifiedList.push({
          id: a.id,
          control_number: a.control_number || 'Pending',
          type: isWaste ? 'waste' : 'adjustment',
          date: a.created_at,
          branch_name: a.branches?.name || 'Unknown',
          details_summary: `Reason: ${a.reason.replace('_', ' ')} | ${a.remarks || 'No remarks'}`,
          status: a.status,
          raw_data: a
        });
      });

      // Map Transfers
      (transData || []).forEach((t: any) => {
        unifiedList.push({
          id: t.id,
          control_number: t.control_number || 'Pending',
          type: 'transfer',
          date: t.created_at,
          branch_name: `${t.source_branch?.name || 'Warehouse'} ➔ ${t.target_branch?.name || 'Branch'}`,
          details_summary: t.remarks || 'No remarks',
          status: t.status,
          raw_data: t
        });
      });

      // Map Invoices
      (salesData || []).forEach((s: any) => {
        const cashier = (profilesData || []).find((p: any) => p.id === s.cashier_id);
        unifiedList.push({
          id: s.id,
          control_number: s.control_number || 'Pending',
          type: 'invoice',
          date: s.created_at,
          branch_name: s.branches?.name || 'Unknown',
          details_summary: `Cashier: ${cashier?.email || 'System / Cashier'}`,
          status: s.status,
          total_amount: Number(s.total_amount),
          raw_data: { ...s, cashier_email: cashier?.email || 'System' }
        });
      });

      // Sort chronological descending
      unifiedList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTransactions(unifiedList);
    } catch (err) {
      console.error(err);
      showError("Could not load transaction documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    if (!isAdminRole && profile?.branch_id) {
      setSelectedBranchId(profile.branch_id);
    } else {
      setSelectedBranchId('All');
    }
  }, [profile, selectedBranch]);

  const handleViewDetails = async (tx: UnifiedTransaction) => {
    setSelectedTx(tx);
    setDetailItems([]);
    setLoadingDetails(true);
    setShowViewModal(true);

    try {
      if (tx.type === 'stock_in') {
        const { data, error } = await supabase
          .from('stock_receipt_items')
          .select(`
            id, quantity_purchased, cost_per_purchase_unit,
            inventory_items (item_name, purchase_unit)
          `)
          .eq('receipt_id', tx.id);
        if (error) throw error;
        setDetailItems(data || []);
      } else if (tx.type === 'adjustment' || tx.type === 'waste') {
        const { data, error } = await supabase
          .from('stock_adjustment_items')
          .select(`
            id, quantity_base_unit,
            inventory_items (item_name, base_unit)
          `)
          .eq('adjustment_id', tx.id);
        if (error) throw error;
        setDetailItems(data || []);
      } else if (tx.type === 'transfer') {
        const { data, error } = await supabase
          .from('transfer_items')
          .select(`
            id, quantity_base_unit,
            inventory_items (item_name, base_unit)
          `)
          .eq('transfer_id', tx.id);
        if (error) throw error;
        setDetailItems(data || []);
      } else if (tx.type === 'invoice') {
        const { data, error } = await supabase
          .from('sale_items')
          .select(`
            id, quantity, unit_price, subtotal,
            menu_items (name, sku)
          `)
          .eq('sale_id', tx.id);
        if (error) throw error;
        setDetailItems(data || []);
      }
    } catch (err) {
      console.error(err);
      showError("Error fetching transaction line items.");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handlePrintPDF = async (tx: UnifiedTransaction, items: any[]) => {
    try {
      const settings = await settingsService.getSettings();

      if (tx.type === 'invoice') {
        const mappedSale = {
          ...tx.raw_data,
          branch_name: tx.branch_name,
          items: items.map(item => ({
            item_name: item.menu_items?.name || 'Dish',
            quantity: item.quantity,
            unit_price: Number(item.unit_price),
            subtotal: Number(item.subtotal),
          }))
        };
        setPreviewSale(mappedSale);
        setSalesInvoiceTemplate(settings.sales_invoice);
        setShowThermalPreview(true);
      } else if (tx.type === 'stock_in') {
        printStockInReceipt(tx.raw_data, items, settings.transfer_slip);
      } else if (tx.type === 'adjustment' || tx.type === 'waste') {
        printAdjustmentSlip(tx.raw_data, items, settings.transfer_slip);
      } else if (tx.type === 'transfer') {
        printTransferSlip(tx.raw_data, items, settings.transfer_slip);
      }
    } catch (err) {
      console.error('Failed to print PDF:', err);
      showError("Failed to load print templates.");
    }
  };

  // Filter evaluation logic
  const filteredTransactions = transactions.filter(tx => {
    // 1. Filter by Search (Control Number or ID)
    const matchesSearch =
      tx.control_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.id.toLowerCase().includes(searchTerm.toLowerCase());

    // 2. Filter by Type
    const matchesType = selectedType === 'All' || tx.type === selectedType;

    // 3. Filter by Branch
    let matchesBranch = true;
    if (selectedBranchId !== 'All') {
      if (tx.type === 'transfer') {
        matchesBranch = tx.raw_data.source_branch_id === selectedBranchId || tx.raw_data.target_branch_id === selectedBranchId;
      } else {
        matchesBranch = tx.raw_data.branch_id === selectedBranchId;
      }
    }

    // 4. Filter by Date Range
    let matchesDate = true;
    const txDate = new Date(tx.date);
    const now = new Date();

    if (dateFilter === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      matchesDate = txDate >= todayStart;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchesDate = txDate >= weekAgo;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchesDate = txDate >= monthAgo;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && txDate >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && txDate <= end;
      }
    }

    return matchesSearch && matchesType && matchesBranch && matchesDate;
  });

  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const paginatedTransactions = filteredTransactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <FileText className="w-8 h-8 text-primary" />
            <span>Transactions Directory</span>
          </h2>
          <p className="text-muted-foreground">Consolidated ledger of Stock Receipts, Adjustments, Waste Logs, Transfers, and Invoices.</p>
        </div>

        <Button onClick={loadTransactions} disabled={loading} variant="outline" size="icon">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Filters Section */}
      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          {/* Search bar */}
          <div className="space-y-2 col-span-1 md:col-span-1">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Search Control No</Label>
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
              <Input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="e.g. STK-2026-..."
                className="pl-9"
              />
            </div>
          </div>

          {/* Transaction Type Filter */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Transaction Type</Label>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger>
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Transactions</SelectItem>
                <SelectItem value="stock_in">Stock In</SelectItem>
                <SelectItem value="adjustment">Adjustments</SelectItem>
                <SelectItem value="waste">Waste for Food</SelectItem>
                <SelectItem value="transfer">Transfers</SelectItem>
                <SelectItem value="invoice">Invoices (Sales)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Branch context selector (Auditors / Admins) */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Branch Location</Label>
            {isAdminRole ? (
              <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Branches</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-sm font-semibold bg-muted/40 border rounded-lg h-9 px-3 py-2 leading-none flex items-center">
                {branches.find(b => b.id === selectedBranchId)?.name || 'My Branch Context'}
              </div>
            )}
          </div>

          {/* Date scope selector */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Date Scope</Label>
            <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
              <SelectTrigger>
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
          <Card className="bg-muted/30">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-4 text-sm">
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-muted-foreground">Start:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[130px] justify-start text-left font-normal h-8">
                      <Calendar className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, 'PPP') : <span>Pick date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-muted-foreground">End:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[130px] justify-start text-left font-normal h-8">
                      <Calendar className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, 'PPP') : <span>Pick date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <CalendarComponent
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                    />
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
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 sm:ml-auto h-8"
                >
                  Clear Range
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Main transactions list */}
      <Card>
        <CardHeader className="px-6 py-4">
          <CardTitle>Documents Ledger</CardTitle>
          <CardDescription>View, examine, and print records of branch logistics and billing events.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Control No / Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Branch / Location</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="text-right">Transaction Total</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                    Fetching unified documents...
                  </TableCell>
                </TableRow>
              ) : filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No transaction documents found matching filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTransactions.map(tx => {
                  const dateStr = new Date(tx.date).toLocaleString();
                  const typeInfo = TYPE_LABELS[tx.type] || { label: tx.type, color: '' };
                  const isSales = tx.type === 'invoice';
                  return (
                    <TableRow key={`${tx.type}-${tx.id}`} className="hover:bg-muted/30">
                      <TableCell className="pl-6">
                        <div className="font-bold">{tx.control_number}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{dateStr}</div>
                      </TableCell>
                      <TableCell>
                        <Badge className={`uppercase text-[9px] font-bold ${typeInfo.color}`}>
                          {typeInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold">{tx.branch_name}</TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">{tx.details_summary}</TableCell>
                      <TableCell className="text-right font-bold">
                        {isSales && tx.total_amount !== undefined ? (
                          <span className="text-emerald-500 font-extrabold">{formatPHP(tx.total_amount)}</span>
                        ) : tx.type === 'stock_in' ? (
                          <span className="text-muted-foreground text-xs">Line-item Cost</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            tx.status === 'completed' || tx.status === 'approved' ? 'default' :
                              tx.status === 'rejected' || tx.status === 'refunded' ? 'destructive' : 'secondary'
                          }
                          className="uppercase text-[9px]"
                        >
                          {tx.status === 'approved' ? 'In Transit' : tx.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleViewDetails(tx)}>
                            <Eye className="w-4 h-4 mr-1" />
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="py-4 border-t px-2">
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

      {/* VIEW MODAL */}
      <Dialog open={showViewModal} onOpenChange={setShowViewModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Badge className={`text-[10px] font-black uppercase ${selectedTx ? TYPE_LABELS[selectedTx.type]?.color : ''}`}>
                    {selectedTx ? TYPE_LABELS[selectedTx.type]?.label : ''}
                  </Badge>
                  <span>{selectedTx?.control_number}</span>
                </DialogTitle>
                <DialogDescription className="font-mono text-xs mt-1">
                  ID: {selectedTx?.id}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mr-6"
                onClick={() => selectedTx && handlePrintPDF(selectedTx, detailItems)}
                disabled={loadingDetails}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print PDF
              </Button>
            </div>
          </DialogHeader>

          {selectedTx && (
            <div className="space-y-6 pt-4">
              {/* Context Summary Cards */}
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Location / Scope</span>
                  <span className="font-medium">{selectedTx.branch_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Transaction Date</span>
                  <span className="font-medium">{new Date(selectedTx.date).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Summary Details</span>
                  <span className="font-medium text-primary">{selectedTx.details_summary}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Document Status</span>
                  <Badge
                    variant={
                      selectedTx.status === 'completed' || selectedTx.status === 'approved' ? 'default' :
                        selectedTx.status === 'rejected' || selectedTx.status === 'refunded' ? 'destructive' : 'secondary'
                    }
                    className="uppercase mt-1 text-[10px]"
                  >
                    {selectedTx.status === 'approved' ? 'In Transit' : selectedTx.status}
                  </Badge>
                </div>
              </div>

              {/* Items Breakdown Table */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Line Items Breakdown</h4>
                <div className="border rounded-md max-h-60 overflow-y-auto bg-background/50">
                  <Table>
                    <TableHeader className="bg-muted/40 sticky top-0 z-10">
                      <TableRow>
                        {selectedTx.type === 'invoice' ? (
                          <>
                            <TableHead className="pl-4">Dish / Menu Item</TableHead>
                            <TableHead>SKU</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-center">Qty</TableHead>
                            <TableHead className="text-right pr-4">Subtotal</TableHead>
                          </>
                        ) : selectedTx.type === 'stock_in' ? (
                          <>
                            <TableHead className="pl-4">Item Name</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                            <TableHead className="text-right">Unit Cost</TableHead>
                            <TableHead className="text-right pr-4">Subtotal</TableHead>
                          </>
                        ) : (
                          <>
                            <TableHead className="pl-4">Item Name</TableHead>
                            <TableHead className="text-right pr-4">Quantity</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingDetails ? (
                        <TableRow>
                          <TableCell colSpan={selectedTx.type === 'invoice' || selectedTx.type === 'stock_in' ? 5 : 2} className="h-24 text-center">
                            <RefreshCw className="w-5 h-5 animate-spin mx-auto text-primary" />
                          </TableCell>
                        </TableRow>
                      ) : detailItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={selectedTx.type === 'invoice' || selectedTx.type === 'stock_in' ? 5 : 2} className="h-24 text-center text-muted-foreground">
                            No items found in this transaction record.
                          </TableCell>
                        </TableRow>
                      ) : (
                        detailItems.map((item, idx) => {
                          if (selectedTx.type === 'invoice') {
                            return (
                              <TableRow key={idx}>
                                <TableCell className="pl-4 font-bold">{item.menu_items?.name}</TableCell>
                                <TableCell className="font-mono text-[10px] text-muted-foreground">{item.menu_items?.sku}</TableCell>
                                <TableCell className="text-right">{formatPHP(item.unit_price)}</TableCell>
                                <TableCell className="text-center font-bold">{item.quantity}</TableCell>
                                <TableCell className="text-right font-bold pr-4 text-emerald-500">{formatPHP(item.subtotal)}</TableCell>
                              </TableRow>
                            );
                          } else if (selectedTx.type === 'stock_in') {
                            const sub = item.quantity_purchased * item.cost_per_purchase_unit;
                            return (
                              <TableRow key={idx}>
                                <TableCell className="pl-4 font-bold">{item.inventory_items?.item_name}</TableCell>
                                <TableCell className="text-right">{item.quantity_purchased} {item.inventory_items?.purchase_unit}</TableCell>
                                <TableCell className="text-right">{formatPHP(item.cost_per_purchase_unit)}</TableCell>
                                <TableCell className="text-right font-bold pr-4">{formatPHP(sub)}</TableCell>
                              </TableRow>
                            );
                          } else {
                            // adjustment, waste, transfer
                            const qty = item.quantity_base_unit;
                            const isNeg = qty < 0;
                            return (
                              <TableRow key={idx}>
                                <TableCell className="pl-4 font-semibold">{item.inventory_items?.item_name}</TableCell>
                                <TableCell className={`text-right font-bold pr-4 ${isNeg && selectedTx.type !== 'transfer' ? 'text-destructive' : 'text-foreground'}`}>
                                  {qty > 0 && selectedTx.type !== 'transfer' ? `+${qty}` : qty} {item.inventory_items?.base_unit || 'units'}
                                </TableCell>
                              </TableRow>
                            );
                          }
                        })
                      )}

                      {/* Total row for invoice */}
                      {!loadingDetails && selectedTx.type === 'invoice' && (
                        <TableRow className="bg-muted/30 font-bold border-t">
                          <TableCell colSpan={4} className="pl-4 text-right">Invoice Total:</TableCell>
                          <TableCell className="text-right text-emerald-500 pr-4 text-sm font-black">
                            {formatPHP(selectedTx.total_amount || 0)}
                          </TableCell>
                        </TableRow>
                      )}

                      {/* Total row for stock_in */}
                      {!loadingDetails && selectedTx.type === 'stock_in' && (
                        <TableRow className="bg-muted/30 font-bold border-t">
                          <TableCell colSpan={3} className="pl-4 text-right">Received Total:</TableCell>
                          <TableCell className="text-right text-indigo-500 pr-4 text-sm font-black">
                            {formatPHP(detailItems.reduce((sum, item) => sum + (item.quantity_purchased * item.cost_per_purchase_unit), 0))}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowViewModal(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* THERMAL RECEIPT PREVIEW DIALOG */}
      <Dialog open={showThermalPreview} onOpenChange={setShowThermalPreview}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle>Thermal Receipt Preview</DialogTitle>
            <DialogDescription>
              Review layout scaling and merchant info prior to printing.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto my-4 border p-4 bg-white text-black font-mono text-xs rounded-md shadow-inner flex justify-center">
            {previewSale && salesInvoiceTemplate && (
              <div
                className="receipt-paper select-none"
                style={{
                  width: salesInvoiceTemplate.paper_width === '58mm' ? '240px' : '320px',
                  fontSize: salesInvoiceTemplate.font_size === 'small' ? '11px' : salesInvoiceTemplate.font_size === 'large' ? '14px' : '12px',
                  fontFamily: 'monospace',
                  lineHeight: '1.4'
                }}
              >
                {salesInvoiceTemplate.logo_url && (
                  <div className="flex justify-center mb-2">
                    <img src={salesInvoiceTemplate.logo_url} className="max-h-12 max-w-[80%] object-contain" alt="Logo" />
                  </div>
                )}

                <div className="text-center font-bold uppercase text-[1.1em]">
                  {salesInvoiceTemplate.merchant_name || 'Dr. Humba'}
                </div>
                <div className="text-center text-[0.9em] mt-0.5">
                  {salesInvoiceTemplate.merchant_address || '123 Main St, Metro Manila'}
                </div>
                <div className="text-center text-[0.9em]">
                  {salesInvoiceTemplate.merchant_contact || '+63 912 345 6789'}
                </div>
                <div className="text-center text-[0.9em] mb-1">
                  {salesInvoiceTemplate.merchant_tin || 'TIN: 000-123-456-000'}
                </div>

                <div className="border-t border-dashed border-black my-2" />

                <div className="text-center font-bold text-[1.1em] tracking-wider my-1">
                  {salesInvoiceTemplate.header_text || 'SALES INVOICE'}
                </div>

                <div className="border-t border-dashed border-black my-2" />

                <div className="space-y-0.5 text-[0.95em]">
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{new Date(previewSale.created_at || new Date()).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Invoice No:</span>
                    <span>{previewSale.control_number || (previewSale.id?.substring(0, 8) + '...')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Branch:</span>
                    <span>{previewSale.branch_name || 'Main Branch'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cashier:</span>
                    <span className="truncate max-w-[150px]">
                      {previewSale.cashier_email?.split('@')[0] || 'Staff'}
                    </span>
                  </div>
                </div>

                <div className="border-t border-dashed border-black my-2" />

                {/* Items List */}
                <div className="space-y-2 my-1">
                  {previewSale.items.map((item: any, idx: number) => (
                    <div key={idx}>
                      <div className="font-bold uppercase">{item.item_name}</div>
                      <div className="flex justify-between pl-2">
                        <span>{item.quantity} x ₱{Number(item.unit_price).toFixed(2)}</span>
                        <span>₱{Number(item.subtotal).toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-dashed border-black my-2" />

                <div className="flex justify-between font-bold text-[1.1em] my-1">
                  <span>TOTAL VALUE:</span>
                  <span>₱{Number(previewSale.total_amount).toFixed(2)}</span>
                </div>

                <div className="border-t border-dashed border-black my-2" />

                <div className="text-center text-[0.9em] whitespace-pre-line my-3">
                  {salesInvoiceTemplate.footer_text || 'Thank you for dining with us!\nCome back again!'}
                </div>

                <div className="text-center text-[9px] text-gray-500 mt-4">
                  Dr. Humba
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowThermalPreview(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (previewSale && salesInvoiceTemplate) {
                  printThermalInvoice(previewSale, salesInvoiceTemplate);
                  setShowThermalPreview(false);
                }
              }}
            >
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
