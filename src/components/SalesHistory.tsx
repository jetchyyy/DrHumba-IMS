import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { CountdownTimerIcon as History, MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, CalendarIcon as Calendar, BackpackIcon as ShoppingBag, ValueIcon as DollarSign, EyeOpenIcon as Eye, ActivityLogIcon as TrendingUp, FileTextIcon as Printer } from '@radix-ui/react-icons';
import { settingsService, DEFAULT_SALES_INVOICE_TEMPLATE } from '../lib/settingsService';
import { printThermalInvoice } from '../lib/printService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
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

interface SaleItem {
  id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  item_name: string;
  sku: string;
}

interface SaleRecord {
  id: string;
  control_number: string | null;
  branch_id: string;
  cashier_id: string;
  total_amount: number;
  status: 'completed' | 'refunded';
  payment_method: string | null;
  amount_tendered: number | null;
  change_given: number | null;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  branch_name: string;
  cashier_email: string;
  items: SaleItem[];
}

const PAYMENT_LABELS: Record<string, string> = {
  cash:  'Cash',
  card:  'Card',
  gcash: 'GCash',
  maya:  'Maya',
  other: 'Other',
};

const formatPHP = (amount: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(amount);

export const SalesHistory: React.FC = () => {
  const { profile, branches } = useAuth();
  const { showSuccess, showError } = useModal();
  
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('All');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedBranchId, dateFilter, startDate, endDate]);
  
  // UI States
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null);

  // Void / Refund dialog
  const [voidTarget, setVoidTarget] = useState<SaleRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const canVoid = ['super_admin', 'branch_manager'].includes(profile?.role_name || '');

  const isAdminRole = ['super_admin', 'inventory_manager', 'auditor'].includes(profile?.role_name || '');

  const loadSalesData = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      let query = supabase
        .from('sales')
        .select(`
          id,
          control_number,
          branch_id,
          cashier_id,
          total_amount,
          status,
          payment_method,
          amount_tendered,
          change_given,
          void_reason,
          voided_at,
          created_at,
          branches (name),
          sale_items (
            id,
            quantity,
            unit_price,
            subtotal,
            menu_items (name, sku)
          )
        `);

      if (!isAdminRole && profile.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      }

      const { data: salesData, error: salesError } = await query.order('created_at', { ascending: false });
      if (salesError) throw salesError;

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email');
      if (profilesError) throw profilesError;

      const mappedSales: SaleRecord[] = (salesData || []).map((sale: any) => {
        const cashierProfile = (profilesData || []).find(p => p.id === sale.cashier_id);
        return {
          id: sale.id,
          control_number: sale.control_number || null,
          branch_id: sale.branch_id,
          cashier_id: sale.cashier_id,
          total_amount: Number(sale.total_amount),
          status: sale.status,
          payment_method: sale.payment_method || null,
          amount_tendered: sale.amount_tendered != null ? Number(sale.amount_tendered) : null,
          change_given: sale.change_given != null ? Number(sale.change_given) : null,
          void_reason: sale.void_reason || null,
          voided_at: sale.voided_at || null,
          created_at: sale.created_at,
          branch_name: sale.branches?.name || 'Unknown Branch',
          cashier_email: cashierProfile?.email || 'System / Cashier',
          items: (sale.sale_items || []).map((si: any) => ({
            id: si.id,
            quantity: Number(si.quantity),
            unit_price: Number(si.unit_price),
            subtotal: Number(si.subtotal),
            item_name: si.menu_items?.name || 'Unknown Dish',
            sku: si.menu_items?.sku || ''
          }))
        };
      });

      setSales(mappedSales);
    } catch (err) {
      console.error('Error fetching sales history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSalesData();
    if (!isAdminRole && profile?.branch_id) {
      setSelectedBranchId(profile.branch_id);
    } else {
      setSelectedBranchId('All');
    }
  }, [profile]);

  const openSheet = (sale: SaleRecord) => {
    setSelectedSale(sale);
  };

  const openVoidDialog = (sale: SaleRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setVoidReason('');
    setVoidTarget(sale);
  };

  const handleVoidSale = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setVoiding(true);
    try {
      const { error } = await supabase.rpc('fn_void_sale', {
        p_sale_id:    voidTarget.id,
        p_void_reason: voidReason.trim(),
      });
      if (error) throw error;
      showSuccess(`Invoice ${voidTarget.id.slice(0, 8)}… has been refunded and stock restored.`);
      setVoidTarget(null);
      loadSalesData();
    } catch (err: any) {
      showError(err.message || 'Could not void sale.');
    } finally {
      setVoiding(false);
    }
  };

  const filteredSales = sales.filter(sale => {
    const matchesSearch = 
      sale.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sale.cashier_email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBranch = selectedBranchId === 'All' || sale.branch_id === selectedBranchId;

    let matchesDate = true;
    const saleDate = new Date(sale.created_at);
    const now = new Date();

    if (dateFilter === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      matchesDate = saleDate >= todayStart;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchesDate = saleDate >= weekAgo;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchesDate = saleDate >= monthAgo;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && saleDate >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && saleDate <= end;
      }
    }

    return matchesSearch && matchesBranch && matchesDate;
  });

  const totalPages = Math.ceil(filteredSales.length / itemsPerPage);
  const paginatedSales = filteredSales.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handlePrintReceipt = (sale: SaleRecord) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showError("Please allow popups to generate the receipt.");
      return;
    }

    const itemsHtml = sale.items.map(item => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px; font-weight: 500;">
          ${item.item_name}
          <div style="font-size: 10px; color: #64748b; font-family: monospace;">SKU: ${item.sku}</div>
        </td>
        <td style="padding: 12px; text-align: center;">${item.quantity}</td>
        <td style="padding: 12px; text-align: right;">₱${item.unit_price.toFixed(2)}</td>
        <td style="padding: 12px; text-align: right; font-weight: 700;">₱${item.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');

    const html = `
      <html>
        <head>
          <title>Invoice - ${sale.control_number || sale.id}</title>
          <style>
            body { font-family: 'Inter', sans-serif; color: #1e293b; padding: 40px; }
            .receipt-container { max-width: 800px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
            .brand { font-size: 24px; font-weight: 800; color: #4f46e5; }
            .title { font-size: 14px; font-weight: 700; text-transform: uppercase; color: #64748b; }
            .details-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 24px; margin-bottom: 40px; }
            .info-block h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; }
            .info-block p { font-size: 14px; font-weight: 600; margin: 0; color: #0f172a; }
            .branches-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 40px; }
            .branches-box h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; }
            .branches-box p { font-size: 14px; font-weight: 600; margin: 0; color: #0f172a; }
            .items-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .items-table th { background-color: #f1f5f9; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; padding: 12px; text-align: left; border-bottom: 1px solid #cbd5e1; }
            .payment-summary { width: 300px; margin-left: auto; margin-bottom: 50px; font-size: 14px; line-height: 2; }
            .payment-row { display: flex; justify-content: space-between; }
            .total-row { font-size: 16px; font-weight: 800; border-top: 2px solid #cbd5e1; padding-top: 10px; margin-top: 5px; color: #4f46e5; }
            .signatures { display: flex; justify-content: space-between; margin-top: 80px; }
            .sig-box { width: 45%; border-top: 1px dashed #cbd5e1; padding-top: 15px; text-align: center; }
            .print-btn { background-color: #4f46e5; color: white; border: none; padding: 10px 20px; font-size: 14px; border-radius: 6px; cursor: pointer; margin-bottom: 20px; }
            @media print { .print-btn { display: none; } body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <button class="print-btn" onclick="window.print()">Print PDF</button>
            <div class="header">
              <div><div class="brand">SYSTEM</div><div style="font-size: 12px; color: #64748b;">Sales & Billing Management</div></div>
              <div style="text-align: right;"><div class="title">Sales Invoice</div><div style="font-size: 12px; color: #64748b;">Status: ${sale.status.toUpperCase()}</div></div>
            </div>
            <div class="details-grid">
              <div class="info-block"><h3>Control Number</h3><p>${sale.control_number || 'PENDING'}</p></div>
              <div class="info-block" style="text-align: right;"><h3>Issue Date</h3><p>${new Date(sale.created_at).toLocaleString()}</p></div>
            </div>
            <div class="branches-box" style="display: grid; grid-template-cols: 1fr 1fr; gap: 20px;">
              <div><h3>Branch Context</h3><p>${sale.branch_name}</p></div>
              <div><h3>Cashier Register</h3><p>${sale.cashier_email}</p></div>
            </div>
            <table class="items-table">
              <thead>
                <tr>
                  <th>Dish / Menu Item</th>
                  <th style="text-align: center;">Qty</th>
                  <th style="text-align: right;">Unit Price</th>
                  <th style="text-align: right;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
            <div class="payment-summary">
              <div class="payment-row">
                <span>Subtotal:</span>
                <span>₱${sale.total_amount.toFixed(2)}</span>
              </div>
              <div class="payment-row">
                <span>Payment Method:</span>
                <span style="text-transform: capitalize;">${sale.payment_method || '—'}</span>
              </div>
              ${sale.amount_tendered !== null ? `
              <div class="payment-row">
                <span>Amount Tendered:</span>
                <span>₱${sale.amount_tendered.toFixed(2)}</span>
              </div>
              ` : ''}
              ${sale.change_given !== null && sale.change_given > 0 ? `
              <div class="payment-row" style="color: #10b981; font-weight: 600;">
                <span>Change Given:</span>
                <span>₱${sale.change_given.toFixed(2)}</span>
              </div>
              ` : ''}
              <div class="payment-row total-row">
                <span>Total Amount:</span>
                <span>₱${sale.total_amount.toFixed(2)}</span>
              </div>
            </div>
            <div class="signatures">
              <div class="sig-box"><div style="font-size: 12px; font-weight: 700;">Cashier Signature</div><div style="margin-top: 40px; font-size: 11px;">Name: ______________________</div></div>
              <div class="sig-box"><div style="font-size: 12px; font-weight: 700;">Customer Acknowledgment</div><div style="margin-top: 40px; font-size: 11px;">Name/Signature: ______________________</div></div>
            </div>
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handlePrintThermalReceipt = async (sale: SaleRecord) => {
    try {
      const settings = await settingsService.getSettings();
      printThermalInvoice(sale, settings.sales_invoice);
    } catch (err) {
      console.error('Failed to print thermal receipt:', err);
      printThermalInvoice(sale, DEFAULT_SALES_INVOICE_TEMPLATE);
    }
  };

  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalTransactions = filteredSales.length;
  const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <History className="w-8 h-8 text-primary" />
            <span>Sales History Log</span>
          </h2>
          <p className="text-muted-foreground mt-1">
            {isAdminRole 
              ? 'Consolidated sales, cashier registers, and ingredient deductions across all corporate branches.'
              : `Sales transaction log for your assigned location context.`
            }
          </p>
        </div>

        <Button onClick={loadSalesData} disabled={loading} variant="outline" size="icon">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Total Sales Revenue</span>
              <span className="text-2xl font-bold">{formatPHP(totalRevenue)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-primary/10 rounded-lg text-primary border border-primary/20">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Transactions Logged</span>
              <span className="text-2xl font-bold">{totalTransactions} Orders</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-amber-500/10 rounded-lg text-amber-500 border border-amber-500/20">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Average Ticket Size</span>
              <span className="text-2xl font-bold">{formatPHP(avgOrderValue)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Query Bars */}
      <div className="space-y-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="relative w-full lg:w-96">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Invoice UUID or cashier email..."
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-start lg:justify-end">
            {isAdminRole ? (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground font-medium">Branch:</span>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Branches</SelectItem>
                    {branches.map(br => (
                      <SelectItem key={br.id} value={br.id}>{br.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              profile?.branch_id && (
                <div className="text-xs text-muted-foreground bg-muted/50 border px-3 py-2 rounded-lg font-medium">
                  Branch Locked: <span className="text-foreground font-bold">{sales[0]?.branch_name || 'My Branch'}</span>
                </div>
              )
            )}

            <div className="flex items-center space-x-2">
              <span className="text-xs text-muted-foreground font-medium">Date Scope:</span>
              <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
                <SelectTrigger className="w-[140px]">
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
                      {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
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
                      {endDate ? format(endDate, 'PPP') : <span>Pick a date</span>}
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

      {/* Main Transactions List */}
      <Card>
        <CardHeader className="px-6 py-4">
          <CardTitle>Transactions Ledger</CardTitle>
          <CardDescription>View all historical sales.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Control No / ID</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Cashier Register</TableHead>
                <TableHead className="text-right">Revenue Value</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right pr-6">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                    Fetching sales transaction ledger...
                  </TableCell>
                </TableRow>
              ) : filteredSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No sales history transactions found matching filter criteria.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedSales.map(sale => {
                  const dateStr = new Date(sale.created_at).toLocaleString();
                  return (
                    <React.Fragment key={sale.id}>
                      <TableRow 
                        onClick={() => openSheet(sale)}
                        className="cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <TableCell className="font-medium text-muted-foreground">{dateStr}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="font-bold">{sale.control_number || 'Pending'}</div>
                          <div className="text-[10px] text-muted-foreground">{sale.id.slice(0, 8)}...</div>
                        </TableCell>
                        <TableCell className="font-bold">{sale.branch_name}</TableCell>
                        <TableCell className="text-muted-foreground font-mono">{sale.cashier_email}</TableCell>
                        <TableCell className="text-right font-black text-emerald-500">
                          {formatPHP(sale.total_amount)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={
                            sale.status === 'completed' ? 'default' : 'destructive'
                          } className="uppercase text-[9px]">
                            {sale.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePrintThermalReceipt(sale);
                              }}
                              title="Print Thermal Invoice"
                            >
                              <Printer className="w-4 h-4 text-emerald-500" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8" onClick={(e) => { e.stopPropagation(); openSheet(sale); }}>
                              <Eye className="w-4 h-4 mr-1" />
                              View
                            </Button>
                            {canVoid && sale.status === 'completed' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={(e) => openVoidDialog(sale, e)}
                              >
                                Void
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
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

      {/* Void / Refund Dialog */}
      <Dialog open={!!voidTarget} onOpenChange={(v) => { if (!v && !voiding) setVoidTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Void Sale</DialogTitle>
            <DialogDescription className="text-xs">
              This will mark the sale as <strong>refunded</strong> and restore all ingredient stocks to branch inventory.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {voidTarget && (
            <div className="space-y-4 py-2">
              <div className="bg-muted/40 border rounded-lg px-4 py-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice</span>
                  <span className="font-mono font-bold">{voidTarget.id.slice(0, 12)}…</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-destructive">{formatPHP(voidTarget.total_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Branch</span>
                  <span className="font-bold">{voidTarget.branch_name}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Void Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  placeholder="e.g. Customer cancelled order, Wrong item charged…"
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  rows={3}
                  className="resize-none text-sm"
                  autoFocus
                />
                <p className="text-[10px] text-muted-foreground">Minimum 5 characters required.</p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setVoidTarget(null)} disabled={voiding}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoidSale}
              disabled={voiding || voidReason.trim().length < 5}
            >
              {voiding ? 'Voiding…' : 'Confirm Void & Refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Invoice Details Drawer */}
      <Sheet open={!!selectedSale} onOpenChange={(open) => { if (!open) setSelectedSale(null); }}>
        <SheetContent side="right" className="w-[90vw] sm:w-[540px] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-xl font-bold flex items-center justify-between">
              <span>Invoice Details</span>
              <Badge variant={selectedSale?.status === 'completed' ? 'default' : 'destructive'} className="uppercase">
                {selectedSale?.status}
              </Badge>
            </SheetTitle>
            <SheetDescription className="font-mono text-xs text-muted-foreground flex flex-col gap-1">
              <span>ID: {selectedSale?.id}</span>
              <span>Control No: {selectedSale?.control_number || 'Pending'}</span>
            </SheetDescription>
          </SheetHeader>

          {selectedSale && (
            <div className="space-y-6">
              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => handlePrintReceipt(selectedSale)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-450 border-emerald-550/25"
                  onClick={() => handlePrintThermalReceipt(selectedSale)}
                >
                  <Printer className="mr-2 h-4 w-4 text-emerald-600" />
                  Print Thermal
                </Button>
              </div>

              {/* Payment Summary */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-muted/50 rounded-lg px-3 py-2 border">
                  <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Payment Method</p>
                  <p className="font-bold">{PAYMENT_LABELS[selectedSale.payment_method || ''] || selectedSale.payment_method || '—'}</p>
                </div>
                {selectedSale.amount_tendered != null && (
                  <div className="bg-muted/50 rounded-lg px-3 py-2 border">
                    <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Tendered</p>
                    <p className="font-bold">{formatPHP(selectedSale.amount_tendered)}</p>
                  </div>
                )}
                {selectedSale.change_given != null && selectedSale.change_given > 0 && (
                  <div className="bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                    <p className="uppercase tracking-wider text-[10px] mb-0.5">Change Given</p>
                    <p className="font-bold">{formatPHP(selectedSale.change_given)}</p>
                  </div>
                )}
                {selectedSale.status === 'refunded' && selectedSale.void_reason && (
                  <div className="bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/30 text-destructive col-span-2">
                    <p className="uppercase tracking-wider text-[10px] mb-0.5">Void Reason</p>
                    <p className="font-bold">{selectedSale.void_reason}</p>
                  </div>
                )}
              </div>

              {/* Items List */}
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider mb-3 text-muted-foreground">Order Items</h4>
                <div className="border rounded-lg overflow-hidden bg-background/50">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead>Item</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedSale.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="font-bold text-xs">{item.item_name}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{item.sku}</div>
                          </TableCell>
                          <TableCell className="text-center font-bold text-xs">{item.quantity}</TableCell>
                          <TableCell className="text-right text-muted-foreground text-xs">{formatPHP(item.unit_price)}</TableCell>
                          <TableCell className="text-right font-bold text-xs">{formatPHP(item.subtotal)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={3} className="text-right font-bold">Total Amount:</TableCell>
                        <TableCell className="text-right text-emerald-500 font-black text-sm">
                          {formatPHP(selectedSale.total_amount)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};
