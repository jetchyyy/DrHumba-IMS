import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useBusinessVocab } from '../hooks/useBusinessVocab';
import { useTenant } from '../contexts/TenantContext';
import { CountdownTimerIcon as History, MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, CalendarIcon as Calendar, BackpackIcon as ShoppingBag, ValueIcon as DollarSign, EyeOpenIcon as Eye, ActivityLogIcon as TrendingUp, FileTextIcon as Printer, FileTextIcon as FileIcon } from '@radix-ui/react-icons';
import { settingsService, DEFAULT_SALES_INVOICE_TEMPLATE, DEFAULT_TRANSFER_SLIP_TEMPLATE } from '../lib/settingsService';
import { printThermalInvoice, printEndOfDayReport, printEndOfDayPDFReport } from '../lib/printService';
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
  sale_category: string | null;
  reference_number: string | null;
  amount_tendered: number | null;
  change_given: number | null;
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
  branch_name: string;
  cashier_email: string;
  items: SaleItem[];
  sub_store_id?: string | null;
  sub_store_name?: string | null;
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
  const vocab = useBusinessVocab();
  const { tenant } = useTenant();
  const isRestaurant = tenant?.is_restaurant ?? true;
  
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('All');
  const [selectedSubStoreId, setSelectedSubStoreId] = useState('All');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [saleCategoryFilter, setSaleCategoryFilter] = useState<string>('all');

  useEffect(() => {
    setSelectedSubStoreId('All');
  }, [selectedBranchId]);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedBranchId, selectedSubStoreId, dateFilter, startDate, endDate, saleCategoryFilter]);

  const getCategoryBadge = (category: string | null) => {
    const cat = (category || vocab.defaultSaleCategory).toLowerCase();
    if (cat === 'dine in' || cat === 'walk-in') {
      return <Badge className="bg-blue-500/10 text-blue-500 border border-blue-500/20 hover:bg-blue-500/20 text-[10px] font-bold uppercase">{category || vocab.defaultSaleCategory}</Badge>;
    }
    if (cat === 'grab' || cat === 'appointment' || cat === 'online order') {
      return <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20 text-[10px] font-bold uppercase">{category || 'Online'}</Badge>;
    }
    if (cat === 'foodpanda' || cat === 'take out' || cat === 'delivery' || cat === 'pick-up') {
      return <Badge className="bg-pink-500/10 text-pink-500 border border-pink-500/20 hover:bg-pink-500/20 text-[10px] font-bold uppercase">{category || 'Delivery'}</Badge>;
    }
    return <Badge className="bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20 text-[10px] font-bold uppercase capitalize">{category || 'Other'}</Badge>;
  };
  
  // UI States
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null);

  // Void / Refund dialog
  const [voidTarget, setVoidTarget] = useState<SaleRecord | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const canVoid = ['super_admin', 'branch_manager'].includes(profile?.role_name || '');

  const isAdminRole = ['super_admin', 'inventory_manager', 'auditor'].includes(profile?.role_name || '');

  // Z-Report / End of Day States
  const [showEODModal, setShowEODModal] = useState(false);
  const [eodDate, setEodDate] = useState<Date>(new Date());
  const [eodBranchId, setEodBranchId] = useState<string>('');
  const [eodStartTime, setEodStartTime] = useState<string>('00:00');
  const [eodEndTime, setEodEndTime] = useState<string>('23:59');
  const [eodCashierId, setEodCashierId] = useState<string>('All');
  const [openingCash, setOpeningCash] = useState<number>(10000);
  const [actualCash, setActualCash] = useState<number>(10000);
  const [profilesList, setProfilesList] = useState<{ id: string; email: string; branch_id: string | null }[]>([]);

  // Initialize eodBranchId and eodCashierId when profile or branches load
  useEffect(() => {
    if (profile) {
      if (!isAdminRole && profile.branch_id) {
        setEodBranchId(profile.branch_id);
      } else if (branches && branches.length > 0) {
        setEodBranchId(branches[0].id);
      }

      if (!isAdminRole) {
        setEodCashierId(profile.id);
      } else {
        setEodCashierId('All');
      }
    }
  }, [profile, branches, isAdminRole]);

  // Auto-fill time fields based on selected cashier and date transactions
  useEffect(() => {
    if (!showEODModal || !eodDate || !eodBranchId) return;

    const startOfDay = new Date(eodDate.getFullYear(), eodDate.getMonth(), eodDate.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(eodDate.getFullYear(), eodDate.getMonth(), eodDate.getDate(), 23, 59, 59, 999);

    const matches = sales.filter(s => {
      const saleDate = new Date(s.created_at);
      const matchesBranch = s.branch_id === eodBranchId;
      const matchesCashier = eodCashierId === 'All' || s.cashier_id === eodCashierId;
      const matchesDate = saleDate >= startOfDay && saleDate <= endOfDay;
      return matchesBranch && matchesCashier && matchesDate;
    });

    if (matches.length > 0) {
      const sorted = [...matches].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const earliest = new Date(sorted[0].created_at);
      const latest = new Date(sorted[sorted.length - 1].created_at);

      const formatTime = (d: Date) => {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      };

      setEodStartTime(formatTime(earliest));
      setEodEndTime(formatTime(latest));
    } else {
      setEodStartTime('00:00');
      setEodEndTime('23:59');
    }
  }, [eodDate, eodBranchId, eodCashierId, sales, showEODModal]);

  // Aggregate stats dynamically for the selected branch, cashier, and date/time range
  const eodReportData = useMemo(() => {
    if (!eodBranchId || !eodDate) return null;

    const startParts = eodStartTime.split(':');
    const startHour = parseInt(startParts[0], 10) || 0;
    const startMin = parseInt(startParts[1], 10) || 0;

    const endParts = eodEndTime.split(':');
    const endHour = parseInt(endParts[0], 10) || 0;
    const endMin = parseInt(endParts[1], 10) || 0;

    const startTimestamp = new Date(eodDate.getFullYear(), eodDate.getMonth(), eodDate.getDate(), startHour, startMin, 0, 0);
    const endTimestamp = new Date(eodDate.getFullYear(), eodDate.getMonth(), eodDate.getDate(), endHour, endMin, 59, 999);

    const daySales = sales.filter(s => {
      const saleDate = new Date(s.created_at);
      const matchesBranch = s.branch_id === eodBranchId;
      const matchesCashier = eodCashierId === 'All' || s.cashier_id === eodCashierId;
      const matchesDate = saleDate >= startTimestamp && saleDate <= endTimestamp;
      return matchesBranch && matchesCashier && matchesDate;
    });

    const initStats = () => ({ salesQty: 0, salesAmt: 0, refundsQty: 0, refundsAmt: 0, netQty: 0, netAmt: 0 });
    const cashSummary = initStats();
    const cardSummary = initStats();
    const gcashSummary = initStats();
    const mayaSummary = initStats();
    const otherSummary = initStats();
    const salesSummary = initStats();

    let cancelledCount = 0;
    let cancelledAmount = 0;
    let earliestTime: Date | null = null;
    let latestTime: Date | null = null;

    daySales.forEach(s => {
      const saleDate = new Date(s.created_at);
      if (!earliestTime || saleDate < earliestTime) earliestTime = saleDate;
      if (!latestTime || saleDate > latestTime) latestTime = saleDate;

      const isCompleted = s.status === 'completed';
      const isRefunded = s.status === 'refunded';
      const amt = Number(s.total_amount);

      if (isRefunded) {
        cancelledCount += 1;
        cancelledAmount += amt;
      }

      const updateStat = (stat: any) => {
        if (isCompleted) {
          stat.salesQty += 1;
          stat.salesAmt += amt;
        } else if (isRefunded) {
          stat.refundsQty += 1;
          stat.refundsAmt += amt;
        }
        stat.netQty = stat.salesQty - stat.refundsQty;
        stat.netAmt = stat.salesAmt - stat.refundsAmt;
      };

      const method = (s.payment_method || 'cash').toLowerCase();
      if (method === 'cash') updateStat(cashSummary);
      else if (method === 'card') updateStat(cardSummary);
      else if (method === 'gcash') updateStat(gcashSummary);
      else if (method === 'maya') updateStat(mayaSummary);
      else updateStat(otherSummary);

      updateStat(salesSummary);
    });

    const netSalesTotal = salesSummary.netAmt;
    const vatAmount = netSalesTotal * 0.12 / 1.12;

    const cashSales = cashSummary.salesAmt;
    const cashRefunds = cashSummary.refundsAmt;
    const expectedDrawer = Number(openingCash) + cashSales - cashRefunds;
    const overShort = Number(actualCash) - expectedDrawer;

    const selectedBranch = branches.find(b => b.id === eodBranchId);
    const branchName = selectedBranch?.name || 'Unknown Branch';
    const branchLocation = selectedBranch?.location || '';
    
    // Determine cashier manager name
    let managerName = 'All Cashiers';
    if (eodCashierId !== 'All') {
      const chosen = profilesList.find(p => p.id === eodCashierId);
      managerName = chosen?.email || profile?.email || 'System Manager';
    }
    
    const register = '1';

    const formatDateStr = (d: Date | null) => d ? d.toLocaleString('en-PH', { hour12: false }) : 'N/A';

    // Generate Z-Report control number dynamically
    const branchInitials = branchName
      .split(' ')
      .map(w => w[0])
      .join('')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase() || branchName.substring(0, 3).toUpperCase();
    const cashierPrefix = eodCashierId === 'All' 
      ? 'ALL' 
      : (managerName.split('@')[0].replace(/[^A-Za-z0-9]/g, '').substring(0, 8).toUpperCase() || 'CASHIER');
    const dateFormatted = format(eodDate, 'yyyyMMdd');
    const controlNumber = `Z-${dateFormatted}-${branchInitials}-${cashierPrefix}`;

    return {
      controlNumber,
      branchName,
      branchLocation,
      shiftOpenTime: earliestTime ? formatDateStr(earliestTime) : startTimestamp.toLocaleString('en-PH', { hour12: false }),
      shiftCloseTime: latestTime ? formatDateStr(latestTime) : endTimestamp.toLocaleString('en-PH', { hour12: false }),
      register,
      reportDate: new Date().toLocaleString('en-PH', { hour12: false }),
      managerName,
      cashSummary,
      cardSummary,
      gcashSummary,
      mayaSummary,
      otherSummary,
      salesSummary,
      cancelledCount,
      cancelledAmount,
      vatAmount,
      openingCash: Number(openingCash),
      cashSales,
      cashRefunds,
      expectedDrawer,
      actualDrawer: Number(actualCash),
      overShort
    };
  }, [sales, eodBranchId, eodDate, eodStartTime, eodEndTime, eodCashierId, openingCash, actualCash, branches, profile, profilesList]);

  // Set default actual cash counted drawer value when expected drawer changes
  const expectedVal = eodReportData?.expectedDrawer || 10000;
  useEffect(() => {
    setActualCash(expectedVal);
  }, [expectedVal, showEODModal]);

  const handlePrintEOD = async () => {
    if (!eodReportData) return;
    try {
      const settings = await settingsService.getSettings();
      printEndOfDayReport(eodReportData, settings.sales_invoice);
    } catch (err) {
      console.error('Failed to load EOD template:', err);
      printEndOfDayReport(eodReportData, DEFAULT_SALES_INVOICE_TEMPLATE);
    }
  };

  const handlePrintEODPDF = async () => {
    if (!eodReportData) return;
    try {
      const settings = await settingsService.getSettings();
      printEndOfDayPDFReport(eodReportData, settings.transfer_slip);
    } catch (err) {
      console.error('Failed to load EOD PDF template:', err);
      printEndOfDayPDFReport(eodReportData, DEFAULT_TRANSFER_SLIP_TEMPLATE);
    }
  };

  const eligibleCashiers = profilesList;

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
          sub_store_id,
          cashier_id,
          total_amount,
          status,
          payment_method,
          sale_category,
          reference_number,
          amount_tendered,
          change_given,
          void_reason,
          voided_at,
          created_at,
          branches:branches!branch_id (name),
          sub_stores:branches!sub_store_id (name),
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
        .select('id, email, branch_id');
      if (profilesError) throw profilesError;
      setProfilesList(profilesData || []);

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
          sale_category: sale.sale_category || null,
          reference_number: sale.reference_number || null,
          amount_tendered: sale.amount_tendered != null ? Number(sale.amount_tendered) : null,
          change_given: sale.change_given != null ? Number(sale.change_given) : null,
          void_reason: sale.void_reason || null,
          voided_at: sale.voided_at || null,
          created_at: sale.created_at,
          branch_name: sale.branches?.name || 'Unknown Branch',
          cashier_email: cashierProfile?.email || 'System / Cashier',
          sub_store_id: sale.sub_store_id || null,
          sub_store_name: sale.sub_stores?.name || null,
          items: (sale.sale_items || []).map((si: any) => ({
            id: si.id,
            quantity: Number(si.quantity),
            unit_price: Number(si.unit_price),
            subtotal: Number(si.subtotal),
            item_name: si.menu_items?.name || ('Unknown ' + (vocab.itemUnit.charAt(0).toUpperCase() + vocab.itemUnit.slice(1))),
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
    const matchesSubStore = selectedSubStoreId === 'All' || 
      (selectedSubStoreId === 'parent' && !sale.sub_store_id) || 
      sale.sub_store_id === selectedSubStoreId;

    const normalizedCategory = (sale.sale_category || vocab.defaultSaleCategory).toLowerCase();
    const defaultCategories = vocab.saleCategories.map(c => c.value.toLowerCase()).filter(c => c !== 'other');
    let matchesSaleCategory = false;
    if (saleCategoryFilter === 'all') {
      matchesSaleCategory = true;
    } else if (saleCategoryFilter === 'other') {
      matchesSaleCategory = !defaultCategories.includes(normalizedCategory);
    } else {
      matchesSaleCategory = normalizedCategory === saleCategoryFilter;
    }

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

    return matchesSearch && matchesBranch && matchesSubStore && matchesDate && matchesSaleCategory;
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
            <div class="branches-box" style="display: grid; grid-template-cols: 1fr 1fr 1fr; gap: 20px;">
              <div><h3>Branch Context</h3><p>${sale.branch_name}</p></div>
              <div><h3>Cashier Register</h3><p>${sale.cashier_email}</p></div>
              <div><h3>Sale Type</h3><p style="text-transform: capitalize;">${sale.sale_category || vocab.defaultSaleCategory}</p></div>
            </div>
            <table class="items-table">
              <thead>
                <tr>
                  <th>${isRestaurant ? "Dish / Menu Item" : "Product / Service"}</th>
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

        <div className="flex items-center space-x-2">
          <Button onClick={() => setShowEODModal(true)} className="bg-primary hover:bg-primary/90 text-white font-bold flex items-center">
            <FileIcon className="w-4 h-4 mr-2" />
            End of Day Report
          </Button>
          <Button onClick={loadSalesData} disabled={loading} variant="outline" size="icon">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
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
                    {branches.filter(br => !br.parent_id).map(br => (
                      <SelectItem key={br.id} value={br.id}>{br.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              profile?.branch_id && (
                <div className="text-xs text-muted-foreground bg-muted/50 border px-3 py-2 rounded-lg font-medium">
                  Branch Locked: <span className="text-foreground font-bold">{branches.find(b => b.id === (branches.find(x => x.id === profile.branch_id)?.parent_id || profile.branch_id))?.name || 'My Branch'}</span>
                </div>
              )
            )}

            {/* Sub-Store Filter */}
            {((isAdminRole && selectedBranchId !== 'All') || (!isAdminRole && profile?.branch_id)) && (() => {
              const currentParentId = isAdminRole ? selectedBranchId : (branches.find(b => b.id === profile?.branch_id)?.parent_id || profile?.branch_id);
              const subStores = branches.filter(b => b.parent_id === currentParentId);
              if (subStores.length === 0) return null;
              return (
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-muted-foreground font-medium">Store:</span>
                  <Select value={selectedSubStoreId} onValueChange={setSelectedSubStoreId}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="All Sub-Stores" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Sub-Stores</SelectItem>
                      <SelectItem value="parent">Parent Store Only</SelectItem>
                      {subStores.map(ss => (
                        <SelectItem key={ss.id} value={ss.id}>{ss.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })()}

            <div className="flex items-center space-x-2">
              <span className="text-xs text-muted-foreground font-medium">Sale Type:</span>
              <Select value={saleCategoryFilter} onValueChange={setSaleCategoryFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Sale Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {vocab.saleCategories.map(cat => (
                    <SelectItem key={cat.value} value={cat.value.toLowerCase()}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                <TableHead>Sale Type</TableHead>
                <TableHead>Cashier Register</TableHead>
                <TableHead className="text-right">Revenue Value</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right pr-6">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                    Fetching sales transaction ledger...
                  </TableCell>
                </TableRow>
              ) : filteredSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
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
                        <TableCell className="font-bold">
                          <div>{sale.branch_name}</div>
                          {sale.sub_store_name && (
                            <span className="text-[10px] text-indigo-500 font-medium bg-indigo-500/5 px-1.5 py-0.5 rounded border border-indigo-500/10 block mt-1 w-max">
                              Store: {sale.sub_store_name}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {getCategoryBadge(sale.sale_category)}
                        </TableCell>
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

              {/* Sale Context Summary */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-muted/50 rounded-lg px-3 py-2 border">
                  <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Sale Category</p>
                  <p className="font-bold capitalize">{selectedSale.sale_category || 'Dine in'}</p>
                </div>
                {selectedSale.reference_number && (
                  <div className="bg-muted/50 rounded-lg px-3 py-2 border">
                    <p className="text-muted-foreground uppercase tracking-wider text-[10px] mb-0.5">Reference No</p>
                    <p className="font-bold font-mono">{selectedSale.reference_number}</p>
                  </div>
                )}
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

      {/* End of Day Z-Report Modal */}
      <Dialog open={showEODModal} onOpenChange={setShowEODModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2 text-xl font-bold">
              <Printer className="w-5 h-5 text-primary" />
              <span>Generate Z Sales Shift Report</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Perform end-of-day cash counting and print the shift sales report.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
            {/* Left Column: Configuration inputs */}
            <div className="space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Report Configurations</h3>
              
              {/* Branch Selector */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Branch Location
                </Label>
                {isAdminRole ? (
                  <Select value={eodBranchId} onValueChange={setEodBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map(br => (
                        <SelectItem key={br.id} value={br.id}>{br.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="bg-muted p-2 rounded text-sm font-bold border">
                    {branches.find(b => b.id === eodBranchId)?.name || 'My Branch'}
                  </div>
                )}
              </div>

              {/* Cashier Selector */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Cashier Register Shift
                </Label>
                {isAdminRole ? (
                  <Select value={eodCashierId} onValueChange={setEodCashierId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Cashier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Cashiers (Consolidated)</SelectItem>
                      {eligibleCashiers.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="bg-muted p-2 rounded text-sm font-bold border">
                    {profile?.email || 'Logged Cashier'}
                  </div>
                )}
              </div>

              {/* Date Selector */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block">
                  Report Date
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal h-10">
                      <Calendar className="mr-2 h-4 w-4" />
                      {eodDate ? format(eodDate, 'PPP') : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <CalendarComponent
                      mode="single"
                      selected={eodDate}
                      onSelect={(d) => d && setEodDate(d)}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Shift Hours Time Inputs */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Shift Start Time
                  </Label>
                  <Input
                    type="time"
                    value={eodStartTime}
                    onChange={(e) => setEodStartTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Shift End Time
                  </Label>
                  <Input
                    type="time"
                    value={eodEndTime}
                    onChange={(e) => setEodEndTime(e.target.value)}
                  />
                </div>
              </div>

              {/* Opening Cash Input */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Opening Cash Drawer (₱)
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(Number(e.target.value) || 0)}
                  placeholder="e.g. 10000.00"
                />
              </div>

              {/* Actual Drawer Cash Count Input */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Actual Cash Counted (₱)
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={actualCash}
                  onChange={(e) => setActualCash(Number(e.target.value) || 0)}
                  placeholder="Enter counted cash in drawer"
                />
              </div>

              {/* Live Status Indicators */}
              {eodReportData && (
                <div className="p-4 rounded-lg bg-muted/40 border space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Expected Drawer Cash:</span>
                    <span className="font-bold text-foreground">{formatPHP(eodReportData.expectedDrawer)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Actual Drawer Cash:</span>
                    <span className="font-bold text-foreground">{formatPHP(eodReportData.actualDrawer)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 mt-1">
                    <span className="text-muted-foreground font-bold">Over/Short:</span>
                    <span className={`font-black ${eodReportData.overShort < 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                      {eodReportData.overShort > 0 ? '+' : ''}{formatPHP(eodReportData.overShort)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Thermal Z-Report Preview */}
            <div className="space-y-2 flex flex-col h-full">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Report Receipt Preview
              </Label>
              {eodReportData ? (
                <div className="border border-border/80 rounded-lg bg-background p-4 shadow-inner max-h-[380px] overflow-y-auto font-mono text-[10px] space-y-4 leading-relaxed w-full">
                  <div className="text-center font-bold text-xs uppercase mb-1">
                    {eodReportData.branchName}
                  </div>
                  {eodReportData.branchLocation && (
                    <div className="text-center text-[9px] text-muted-foreground mb-2">
                      {eodReportData.branchLocation}
                    </div>
                  )}
                  <div className="text-center font-bold border border-foreground/60 py-1 uppercase text-xs">
                    Z Sales Shift Report
                  </div>
                  
                  <div className="space-y-0.5 text-[9px]">
                    <div className="flex justify-between font-bold text-primary mb-1">
                      <span>Control No:</span>
                      <span className="font-mono">{eodReportData.controlNumber}</span>
                    </div>
                    <div className="flex justify-between"><span>Shift Open Time:</span><span>{eodReportData.shiftOpenTime}</span></div>
                    <div className="flex justify-between"><span>Shift Close Time:</span><span>{eodReportData.shiftCloseTime}</span></div>
                    <div className="flex justify-between"><span>Register:</span><span>{eodReportData.register}</span></div>
                    <div className="flex justify-between"><span>Report Date:</span><span>{eodReportData.reportDate}</span></div>
                    <div className="flex justify-between"><span>Manager:</span><span>{eodReportData.managerName}</span></div>
                  </div>

                  <div className="border-t border-dashed my-2"></div>

                  {/* Cash Summary Table */}
                  <div className="space-y-1">
                    <div className="font-bold text-[9px] uppercase">Cash Summary</div>
                    <div className="border-t border-dashed my-1"></div>
                    <div className="grid grid-cols-4 font-bold border-b border-dashed pb-0.5 mb-1 text-[8px]">
                      <span>Category</span><span className="text-center">Sign</span><span className="text-center">Qty</span><span className="text-right">Amount</span>
                    </div>
                    <div className="grid grid-cols-4"><span>Sales</span><span className="text-center">(+)</span><span className="text-center">{eodReportData.cashSummary.salesQty}</span><span className="text-right">{eodReportData.cashSummary.salesAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4"><span>Refunds</span><span className="text-center">(-)</span><span className="text-center">{eodReportData.cashSummary.refundsQty}</span><span className="text-right">{eodReportData.cashSummary.refundsAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4 font-bold border-t border-dashed mt-0.5 pt-0.5"><span>Net</span><span className="text-center">(=)</span><span className="text-center">{eodReportData.cashSummary.netQty}</span><span className="text-right">{eodReportData.cashSummary.netAmt.toFixed(2)}</span></div>
                  </div>

                  {/* CreditCard Summary Table */}
                  <div className="space-y-1 mt-3">
                    <div className="font-bold text-[9px] uppercase">CreditCard Summary</div>
                    <div className="border-t border-dashed my-1"></div>
                    <div className="grid grid-cols-4 font-bold border-b border-dashed pb-0.5 mb-1 text-[8px]">
                      <span>Category</span><span className="text-center">Sign</span><span className="text-center">Qty</span><span className="text-right">Amount</span>
                    </div>
                    <div className="grid grid-cols-4"><span>Sales</span><span className="text-center">(+)</span><span className="text-center">{eodReportData.cardSummary.salesQty}</span><span className="text-right">{eodReportData.cardSummary.salesAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4"><span>Refunds</span><span className="text-center">(-)</span><span className="text-center">{eodReportData.cardSummary.refundsQty}</span><span className="text-right">{eodReportData.cardSummary.refundsAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4 font-bold border-t border-dashed mt-0.5 pt-0.5"><span>Net</span><span className="text-center">(=)</span><span className="text-center">{eodReportData.cardSummary.netQty}</span><span className="text-right">{eodReportData.cardSummary.netAmt.toFixed(2)}</span></div>
                  </div>

                  {/* GCash Summary Table */}
                  <div className="space-y-1 mt-3">
                    <div className="font-bold text-[9px] uppercase">GCASH Summary</div>
                    <div className="border-t border-dashed my-1"></div>
                    <div className="grid grid-cols-4 font-bold border-b border-dashed pb-0.5 mb-1 text-[8px]">
                      <span>Category</span><span className="text-center">Sign</span><span className="text-center">Qty</span><span className="text-right">Amount</span>
                    </div>
                    <div className="grid grid-cols-4"><span>Sales</span><span className="text-center">(+)</span><span className="text-center">{eodReportData.gcashSummary.salesQty}</span><span className="text-right">{eodReportData.gcashSummary.salesAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4"><span>Refunds</span><span className="text-center">(-)</span><span className="text-center">{eodReportData.gcashSummary.refundsQty}</span><span className="text-right">{eodReportData.gcashSummary.refundsAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4 font-bold border-t border-dashed mt-0.5 pt-0.5"><span>Net</span><span className="text-center">(=)</span><span className="text-center">{eodReportData.gcashSummary.netQty}</span><span className="text-right">{eodReportData.gcashSummary.netAmt.toFixed(2)}</span></div>
                  </div>

                  {/* Maya Summary Table */}
                  <div className="space-y-1 mt-3">
                    <div className="font-bold text-[9px] uppercase">Maya Summary</div>
                    <div className="border-t border-dashed my-1"></div>
                    <div className="grid grid-cols-4 font-bold border-b border-dashed pb-0.5 mb-1 text-[8px]">
                      <span>Category</span><span className="text-center">Sign</span><span className="text-center">Qty</span><span className="text-right">Amount</span>
                    </div>
                    <div className="grid grid-cols-4"><span>Sales</span><span className="text-center">(+)</span><span className="text-center">{eodReportData.mayaSummary.salesQty}</span><span className="text-right">{eodReportData.mayaSummary.salesAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4"><span>Refunds</span><span className="text-center">(-)</span><span className="text-center">{eodReportData.mayaSummary.refundsQty}</span><span className="text-right">{eodReportData.mayaSummary.refundsAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4 font-bold border-t border-dashed mt-0.5 pt-0.5"><span>Net</span><span className="text-center">(=)</span><span className="text-center">{eodReportData.mayaSummary.netQty}</span><span className="text-right">{eodReportData.mayaSummary.netAmt.toFixed(2)}</span></div>
                  </div>

                  {/* Other Summary Table */}
                  <div className="space-y-1 mt-3">
                    <div className="font-bold text-[9px] uppercase">Other Summary</div>
                    <div className="border-t border-dashed my-1"></div>
                    <div className="grid grid-cols-4 font-bold border-b border-dashed pb-0.5 mb-1 text-[8px]">
                      <span>Category</span><span className="text-center">Sign</span><span className="text-center">Qty</span><span className="text-right">Amount</span>
                    </div>
                    <div className="grid grid-cols-4"><span>Sales</span><span className="text-center">(+)</span><span className="text-center">{eodReportData.otherSummary.salesQty}</span><span className="text-right">{eodReportData.otherSummary.salesAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4"><span>Refunds</span><span className="text-center">(-)</span><span className="text-center">{eodReportData.otherSummary.refundsQty}</span><span className="text-right">{eodReportData.otherSummary.refundsAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4 font-bold border-t border-dashed mt-0.5 pt-0.5"><span>Net</span><span className="text-center">(=)</span><span className="text-center">{eodReportData.otherSummary.netQty}</span><span className="text-right">{eodReportData.otherSummary.netAmt.toFixed(2)}</span></div>
                  </div>

                  {/* Sales Summary Table */}
                  <div className="space-y-1 mt-3">
                    <div className="font-bold text-[9px] uppercase">Sales Summary</div>
                    <div className="border-t border-dashed my-1"></div>
                    <div className="grid grid-cols-4 font-bold border-b border-dashed pb-0.5 mb-1 text-[8px]">
                      <span>Category</span><span className="text-center">Sign</span><span className="text-center">Qty</span><span className="text-right">Amount</span>
                    </div>
                    <div className="grid grid-cols-4"><span>Total Sales</span><span className="text-center">(+)</span><span className="text-center">{eodReportData.salesSummary.salesQty}</span><span className="text-right">{eodReportData.salesSummary.salesAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4"><span>Total Refunds</span><span className="text-center">(-)</span><span className="text-center">{eodReportData.salesSummary.refundsQty}</span><span className="text-right">{eodReportData.salesSummary.refundsAmt.toFixed(2)}</span></div>
                    <div className="grid grid-cols-4 font-bold border-t border-dashed mt-0.5 pt-0.5"><span>Total Net</span><span className="text-center">(=)</span><span className="text-center">{eodReportData.salesSummary.netQty}</span><span className="text-right">{eodReportData.salesSummary.netAmt.toFixed(2)}</span></div>
                  </div>

                  {/* Cash Drawer Summary Table */}
                  <div className="space-y-1 mt-3">
                    <div className="font-bold text-[9px] uppercase">Cash Drawer Summary</div>
                    <div className="border-t border-dashed my-1"></div>
                    <div className="flex justify-between"><span>Opening Amount</span><span>{eodReportData.openingCash.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Cash Sales (+)</span><span>{eodReportData.cashSales.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Cash Refunds (-)</span><span>{eodReportData.cashRefunds.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold border-t border-dashed mt-0.5 pt-0.5"><span>Expected Drawer</span><span>{eodReportData.expectedDrawer.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold"><span>Actual Drawer</span><span>{eodReportData.actualDrawer.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold border-t border-dashed border-b border-dashed py-0.5 mt-0.5">
                      <span>Over/Short</span>
                      <span className={eodReportData.overShort < 0 ? 'text-destructive' : 'text-emerald-600'}>
                        {eodReportData.overShort.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center border border-dashed rounded-lg bg-muted/20 p-8 h-full text-xs text-muted-foreground">
                  Select a branch and date to generate a Z-Report preview.
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowEODModal(false)} className="sm:flex-1">
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={handlePrintEODPDF}
              disabled={!eodReportData}
              className="sm:flex-1 font-bold"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print PDF
            </Button>
            <Button
              onClick={handlePrintEOD}
              disabled={!eodReportData}
              className="sm:flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Thermal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
