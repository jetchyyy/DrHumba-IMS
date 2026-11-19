import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { discrepancyColorClass, getOrganizedBranches, canViewServiceCharge } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useModal } from '../contexts/ModalContext';
import { printXZReport } from '../lib/printService';
import { printBluetoothXZReport, ensureBluetoothPrinter } from '../lib/bluetoothPrinter';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { format } from 'date-fns';
import {
  FileTextIcon as FileText,
  FileTextIcon as Printer,
  MagnifyingGlassIcon as Search,
  ReloadIcon as RefreshCw,
  CalendarIcon as Calendar,
  BackpackIcon as ShoppingBag,
  ValueIcon as DollarSign,
  ActivityLogIcon as TrendingUp
} from '@radix-ui/react-icons';
import { Banknote, Smartphone } from 'lucide-react';
import { DataTablePagination } from "./ui/DataTablePagination";

interface CashierSession {
  id: string;
  branch_id?: string;
  cashier_id?: string;
  opened_at: string;
  closed_at: string;
  opening_balance: number;
  closing_balance: number;
  actual_cash: number;
  status: string;
  z_counter: number;
  grand_total_start: number;
  grand_total_end: number;
  sales_summary: any;
  control_number?: string;
  shift_name?: string | null;
  branches?: { name: string } | null;
  profiles?: { email: string; full_name?: string | null } | null;
}

const formatPHP = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(n);

const STANDARD_SHIFTS = ['Morning', 'Mid', 'Night'];

export const ZReadHistory: React.FC = () => {
  const { profile, branches } = useAuth();
  const { showError } = useModal();
  const isAdminRole = Boolean(profile && ['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name));
  const showServiceCharge = canViewServiceCharge(profile);

  const [sessions, setSessions] = useState<CashierSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBranchId, setFilterBranchId] = useState('All');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');
  const [discrepancyFilter, setDiscrepancyFilter] = useState<'all' | 'short' | 'over' | 'exact'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [dateBy, setDateBy] = useState<'closed' | 'opened'>('opened');
  const [selectedSession, setSelectedSession] = useState<CashierSession | null>(null);
  const [isPrintingXZBluetooth, setIsPrintingXZBluetooth] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const loadRequestRef = useRef(0);

  const loadSessions = async () => {
    if (!profile) return;
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      let query = supabase
        .from('cashier_sessions')
        .select(`
          *,
          branches (name),
          profiles (email, full_name)
        `)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (!isAdminRole && profile.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      } else if (filterBranchId !== 'All') {
        query = query.eq('branch_id', filterBranchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (requestId !== loadRequestRef.current) return;

      const normalized: CashierSession[] = (data || []).map((row: any) => ({
        ...row,
        branches: Array.isArray(row.branches) ? row.branches[0] ?? null : row.branches ?? null,
        profiles: Array.isArray(row.profiles) ? row.profiles[0] ?? null : row.profiles ?? null,
      }));
      setSessions(normalized);
    } catch (err: any) {
      if (requestId !== loadRequestRef.current) return;
      console.error('Error loading Z-Reports:', err);
      showError(err.message || 'Error loading Z-Reports');
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!profile) return;
    if (!isAdminRole && profile.branch_id) {
      setFilterBranchId(profile.branch_id);
    } else {
      setFilterBranchId('All');
    }
  }, [profile, isAdminRole]);

  useEffect(() => {
    if (profile) {
      loadSessions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBranchId, profile?.id, profile?.branch_id, isAdminRole]);

  const getDateRange = () => {
    const now = new Date();
    let from: Date | undefined;
    let to: Date | undefined;
    if (dateFilter === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (dateFilter === 'week') {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateFilter === 'month') {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (dateFilter === 'custom') {
      if (startDate) {
        from = new Date(startDate);
        from.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        to = new Date(endDate);
        to.setHours(23, 59, 59, 999);
      }
    }
    return { from, to };
  };

  // Safe JSON extraction helper
  const getSummaryObject = (session: CashierSession) => {
    if (!session.sales_summary) return null;
    let summary: any = null;
    if (typeof session.sales_summary === 'string') {
      try {
        summary = JSON.parse(session.sales_summary);
      } catch {
        return null;
      }
    } else {
      summary = { ...session.sales_summary };
    }

    if (summary) {
      if (!summary.cashierName && (session.profiles?.full_name || session.profiles?.email)) {
        summary.cashierName = session.profiles?.full_name || session.profiles?.email?.split('@')[0] || 'Staff';
      }
      if (!summary.cashierEmail && session.profiles?.email) {
        summary.cashierEmail = session.profiles?.email;
      }
      if (!summary.shiftName && session.shift_name) {
        summary.shiftName = session.shift_name;
      }
      if (!summary.controlNumber && session.control_number) {
        summary.controlNumber = session.control_number;
      }
      if (summary.totalPayments === undefined || summary.totalPayments === null) {
        summary.totalPayments = Number(
          Number(summary.cashSales || 0) +
          Number(summary.gcashSales || 0) +
          Number(summary.mayaSales || 0) +
          Number(summary.cardSales || 0) +
          Number(summary.otherSales || 0)
        );
      }
    }
    return summary;
  };

  const getSessionDrawerMetrics = (session: CashierSession) => {
    const summary = getSummaryObject(session);
    const expectedCash = summary ? Number(summary.expectedCash || 0) : 0;
    const expectedDrawer = session.opening_balance + expectedCash;
    const discrepancy = session.actual_cash - expectedDrawer;
    return { summary, expectedDrawer, discrepancy };
  };

  const shiftOptions = useMemo(() => {
    const extras = new Set<string>();
    let hasUnassigned = false;
    sessions.forEach(s => {
      const name = s.shift_name?.trim();
      if (!name) {
        hasUnassigned = true;
      } else if (!STANDARD_SHIFTS.includes(name)) {
        extras.add(name);
      }
    });
    return {
      shifts: [...STANDARD_SHIFTS, ...Array.from(extras).sort()],
      hasUnassigned,
    };
  }, [sessions]);

  const cashierOptions = useMemo(() => {
    const map = new Map<string, string>();
    sessions.forEach(s => {
      const key = s.cashier_id || s.profiles?.email || '';
      if (!key) return;
      if (!map.has(key)) {
        const label = s.profiles?.full_name?.trim() || s.profiles?.email || 'Staff';
        map.set(key, label);
      }
    });
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sessions]);

  useEffect(() => {
    if (cashierFilter !== 'all' && !cashierOptions.some(c => c.id === cashierFilter)) {
      setCashierFilter('all');
    }
  }, [cashierOptions, cashierFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterBranchId, shiftFilter, cashierFilter, discrepancyFilter, dateFilter, startDate, endDate, dateBy, itemsPerPage]);

  // Filters logic
  const filteredSessions = useMemo(() => {
    const { from, to } = getDateRange();
    const query = searchTerm.trim().toLowerCase();

    return sessions.filter(session => {
      if (query) {
        const cashierEmail = session.profiles?.email?.toLowerCase() || '';
        const cashierFullName = session.profiles?.full_name?.toLowerCase() || '';
        const branchName = session.branches?.name?.toLowerCase() || '';
        const matchesSearch =
          cashierEmail.includes(query) ||
          cashierFullName.includes(query) ||
          branchName.includes(query) ||
          (session.shift_name || '').toLowerCase().includes(query) ||
          String(session.z_counter).includes(query) ||
          (session.control_number || '').toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      if (shiftFilter === 'none') {
        if (session.shift_name?.trim()) return false;
      } else if (shiftFilter !== 'all') {
        if ((session.shift_name || '').trim().toLowerCase() !== shiftFilter.toLowerCase()) return false;
      }

      if (cashierFilter !== 'all') {
        const key = session.cashier_id || session.profiles?.email || '';
        if (key !== cashierFilter) return false;
      }

      if (discrepancyFilter !== 'all') {
        const { discrepancy } = getSessionDrawerMetrics(session);
        const cents = Math.round(Number(discrepancy || 0) * 100);
        if (discrepancyFilter === 'short' && cents >= 0) return false;
        if (discrepancyFilter === 'over' && cents <= 0) return false;
        if (discrepancyFilter === 'exact' && cents !== 0) return false;
      }

      if (dateFilter !== 'all') {
        const rawDate = dateBy === 'opened' ? session.opened_at : session.closed_at;
        const targetDate = new Date(rawDate);
        if (from && targetDate < from) return false;
        if (to && targetDate > to) return false;
      }

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, searchTerm, shiftFilter, cashierFilter, discrepancyFilter, dateFilter, startDate, endDate, dateBy]);

  // Summary Card Totals across all filtered Z-Read shifts
  const summaryStats = useMemo(() => {
    let totalRevenue = 0;
    let transactionCount = 0;
    let cashSales = 0;
    let gcashSales = 0;
    let foodpandaSales = 0;
    let grabSales = 0;
    let totalDiscrepancy = 0;

    filteredSessions.forEach(session => {
      const { summary, discrepancy } = getSessionDrawerMetrics(session);
      totalDiscrepancy += discrepancy;
      if (summary) {
        totalRevenue += Number(summary.totalPayments || 0);
        transactionCount += Number(summary.transactionCount || 0);
        cashSales += Number(summary.cashSales || 0);
        gcashSales += Number(summary.gcashSales || 0);
        foodpandaSales += Number(summary.foodpandaSales || 0);
        grabSales += Number(summary.grabSales || 0);
      }
    });

    const avgTicket = transactionCount > 0 ? totalRevenue / transactionCount : 0;

    return {
      totalRevenue,
      transactionCount,
      avgTicket,
      cashSales,
      gcashSales,
      foodpandaSales,
      grabSales,
      totalDiscrepancy,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSessions]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredSessions.length / itemsPerPage);
  const paginatedSessions = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSessions.slice(start, start + itemsPerPage);
  }, [filteredSessions, currentPage, itemsPerPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const sanitizeSummaryForDisplay = (summary: any) => {
    if (!summary || showServiceCharge) return summary;
    return { ...summary, serviceChargeTotal: 0 };
  };

  const handlePrintXZBluetooth = async (summary: any, isZRead: boolean, branchName: string) => {
    try {
      setIsPrintingXZBluetooth(true);
      await ensureBluetoothPrinter();
      await printBluetoothXZReport(sanitizeSummaryForDisplay(summary), isZRead, branchName);
    } catch (err: any) {
      console.error('Failed to print Z-Read via Bluetooth:', err);
      showError(err?.message || 'Failed to print report via Bluetooth.');
    } finally {
      setIsPrintingXZBluetooth(false);
    }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="w-8 h-8 text-primary" />
            BIR Z-Read Report History
          </h2>
          <p className="text-muted-foreground mt-1">
            Audit history of closed drawer shifts, cumulative lifetime totals, and sequential Z-Read counters.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="icon" onClick={loadSessions} className="h-9 w-9" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Top Level Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Total Sales Revenue</span>
              <span className="text-2xl font-bold">{formatPHP(summaryStats.totalRevenue)}</span>
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
              <span className="text-2xl font-bold">{summaryStats.transactionCount} Orders</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">{filteredSessions.length} Z-Read shifts</span>
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
              <span className="text-2xl font-bold">{formatPHP(summaryStats.avgTicket)}</span>
              <span className="text-[11px] text-muted-foreground block mt-0.5">
                Net Discrepancy:{' '}
                <span className={`font-semibold ${discrepancyColorClass(summaryStats.totalDiscrepancy)}`}>
                  {formatPHP(summaryStats.totalDiscrepancy)}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payment & Channel Breakdown Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="glass-dark border-green-500/30 bg-green-500/5">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-green-500/10 rounded-lg text-green-600 border border-green-500/20">
              <Banknote className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <span className="text-xs text-green-600 dark:text-green-400 font-bold uppercase tracking-wider block">Cash Sales</span>
              <span className="text-2xl font-bold text-green-600 dark:text-green-400">{formatPHP(summaryStats.cashSales)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-blue-500/10 rounded-lg text-blue-600 border border-blue-500/20">
              <Smartphone className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <span className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider block">GCash Sales</span>
              <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatPHP(summaryStats.gcashSales)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-amber-500/10 rounded-lg text-amber-600 border border-amber-500/20">
              <ShoppingBag className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <span className="text-xs text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider block">FoodPanda Sales</span>
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatPHP(summaryStats.foodpandaSales)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-600 border border-emerald-500/20">
              <ShoppingBag className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider block">GrabFood Sales</span>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatPHP(summaryStats.grabSales)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Query Bars */}
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="relative w-full lg:w-96">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3 pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by cashier email, branch, shift or Z-Count..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-start lg:justify-end">
            {isAdminRole ? (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground font-medium">Branch:</span>
                <Select value={filterBranchId} onValueChange={setFilterBranchId}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Branches</SelectItem>
                    {getOrganizedBranches(branches).map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.isSubStore ? `└─ ${b.name}` : b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              profile?.branch_id && (
                <div className="text-xs text-muted-foreground bg-muted/50 border px-3 py-2 rounded-lg font-medium">
                  Branch Locked: <span className="text-foreground font-bold">{branches.find(b => b.id === filterBranchId)?.name || 'My Branch'}</span>
                </div>
              )
            )}

            <div className="flex items-center space-x-2">
              <span className="text-xs text-muted-foreground font-medium">Shift:</span>
              <Select value={shiftFilter} onValueChange={setShiftFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Shifts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Shifts</SelectItem>
                  {shiftOptions.shifts.map(shift => (
                    <SelectItem key={shift} value={shift}>{shift} Shift</SelectItem>
                  ))}
                  {shiftOptions.hasUnassigned && (
                    <SelectItem value="none">No Shift</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-xs text-muted-foreground font-medium">Cashier:</span>
              <Select value={cashierFilter} onValueChange={setCashierFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All Cashiers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Cashiers</SelectItem>
                  {cashierOptions.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-xs text-muted-foreground font-medium">Discrepancy:</span>
              <Select value={discrepancyFilter} onValueChange={(v: any) => setDiscrepancyFilter(v)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                  <SelectItem value="over">Over</SelectItem>
                  <SelectItem value="exact">Exact</SelectItem>
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

            <div className="flex items-center space-x-2">
              <span className="text-xs text-muted-foreground font-medium">Date By:</span>
              <Select value={dateBy} onValueChange={(v: any) => setDateBy(v)} disabled={dateFilter === 'all'}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opened">Opened Date</SelectItem>
                  <SelectItem value="closed">Closed Date</SelectItem>
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
                    <Button variant="outline" className="min-w-[140px] justify-start text-left font-normal h-8">
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
                    <Button variant="outline" className="min-w-[140px] justify-start text-left font-normal h-8">
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

      {/* Discrepancy color legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium">Discrepancy:</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />Short (drawer below expected)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" />Over (drawer above expected)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Exact (balanced)</span>
      </div>

      {/* Table Card */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="pl-6 w-24">Z-Counter</TableHead>
                  <TableHead>Closed Date</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead>Branch Location</TableHead>
                  <TableHead className="text-right">Opening Cash</TableHead>
                  <TableHead className="text-right">Expected Drawer</TableHead>
                  <TableHead className="text-right">Actual Drawer</TableHead>
                  <TableHead className="text-right">Discrepancy</TableHead>
                  <TableHead className="text-right pr-6 w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                      Loading cashier session logs...
                    </TableCell>
                  </TableRow>
                ) : paginatedSessions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No closed register drawer shifts found matching filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSessions.map(session => {
                    const { summary, expectedDrawer, discrepancy } = getSessionDrawerMetrics(session);

                    return (
                      <TableRow key={session.id}>
                        <TableCell className="pl-6 font-bold font-mono text-destructive">
                          {session.control_number || `#${String(session.z_counter).padStart(5, '0')}`}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          {new Date(session.closed_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs font-semibold max-w-[150px]" title={session.profiles?.full_name ? `${session.profiles.full_name} (${session.profiles.email})` : session.profiles?.email}>
                          <div className="truncate">{session.profiles?.full_name || session.profiles?.email}</div>
                          {session.shift_name && (
                            <Badge variant="outline" className="mt-0.5 text-[10px] font-bold py-0 h-4 border-indigo-400/40 text-indigo-500 bg-indigo-500/10">
                              {session.shift_name} Shift
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          {session.branches?.name || 'Main Branch'}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-xs">
                          {formatPHP(session.opening_balance)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-xs text-muted-foreground">
                          {formatPHP(expectedDrawer)}
                        </TableCell>
                        <TableCell className="text-right font-black text-xs text-primary">
                          {formatPHP(session.actual_cash)}
                        </TableCell>
                        <TableCell className={`text-right font-bold text-xs ${discrepancyColorClass(discrepancy)
                          }`}>
                          {formatPHP(discrepancy)}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-primary"
                              onClick={() => setSelectedSession(session)}
                              title="View Z-Report Summary"
                            >
                              <FileText className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={() => printXZReport(sanitizeSummaryForDisplay(summary), true, session.branches?.name || 'TERMINAL')}
                              title="Reprint Z-Read Receipt"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                              </svg>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="border-t">
            <DataTablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredSessions.length}
              itemsPerPage={itemsPerPage}
              onPageChange={handlePageChange}
              onItemsPerPageChange={setItemsPerPage}
              showPageSizeSelector={true}
              pageSizeOptions={[10, 20, 50, 100]}
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── Detailed Report Dialog ─── */}
      <Dialog open={!!selectedSession} onOpenChange={(v) => { if (!v) setSelectedSession(null); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-destructive">Z-Read Shift Audit Details</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Official shift summary logs details.
            </DialogDescription>
          </DialogHeader>

          {selectedSession && (() => {
            const summary = getSummaryObject(selectedSession);
            if (!summary) return <p className="text-xs text-muted-foreground text-center py-4">Summary metadata unavailable.</p>;

            return (
              <div className="space-y-4 py-2">
                <div className="border border-destructive/20 rounded-md p-4 bg-muted/30 font-mono text-xs space-y-1.5 max-h-[50vh] overflow-y-auto">
                  <div className="text-center font-bold uppercase">{selectedSession.branches?.name || 'TERMINAL'}</div>
                  <div className="text-center text-[10px] text-destructive font-bold">Z-READ AUDIT REPORT</div>
                  <div className="border-t border-dashed my-2" />
                  <div className="flex justify-between"><span>Status:</span><span className="font-bold text-destructive">{selectedSession.status?.toUpperCase()}</span></div>
                  {selectedSession.control_number && (
                    <div className="flex justify-between"><span>Control No:</span><span className="font-bold text-destructive">{selectedSession.control_number}</span></div>
                  )}
                  <div className="flex justify-between"><span>Z-Counter:</span><span className="font-bold text-destructive">#{String(selectedSession.z_counter).padStart(5, '0')}</span></div>
                  {(summary.cashierName || selectedSession.profiles?.full_name || selectedSession.profiles?.email) && (
                    <div className="flex justify-between"><span>Cashier:</span><span className="font-bold text-foreground">{summary.cashierName || selectedSession.profiles?.full_name || selectedSession.profiles?.email?.split('@')[0]}</span></div>
                  )}
                  {(summary.shiftName || selectedSession.shift_name) && (
                    <div className="flex justify-between"><span>Shift:</span><span className="font-bold text-foreground">{summary.shiftName || selectedSession.shift_name}</span></div>
                  )}
                  <div className="flex justify-between"><span>Opened At:</span><span>{new Date(summary.openedAt).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Closed At:</span><span>{new Date(summary.closedAt).toLocaleString()}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">LIFETIME GRAND TOTALS</div>
                  <div className="flex justify-between"><span>Start:</span><span>{formatPHP(summary.grandTotalStart)}</span></div>
                  <div className="flex justify-between"><span>End:</span><span>{formatPHP(summary.grandTotalEnd)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">SALES SUMMARY</div>
                  <div className="flex justify-between"><span>Gross Sales:</span><span>{formatPHP(summary.grossSales)}</span></div>
                  <div className="flex justify-between"><span>Net Sales (Ex-VAT):</span><span>{formatPHP(summary.netSales)}</span></div>
                  <div className="flex justify-between"><span>VAT Amount (12%):</span><span>{formatPHP(summary.vatAmount)}</span></div>
                  <div className="flex justify-between"><span>VAT-Exempt Sales:</span><span>{formatPHP(summary.vatExemptSales || 0)}</span></div>
                  <div className="flex justify-between"><span>Discount Total:</span><span>{formatPHP(summary.discountAmount || 0)}</span></div>
                  {showServiceCharge && Number(summary.serviceChargeTotal || 0) > 0 && (
                    <div className="flex justify-between"><span>Service Charge:</span><span>{formatPHP(summary.serviceChargeTotal)}</span></div>
                  )}
                  <div className="flex justify-between"><span>Transaction Count:</span><span>{summary.transactionCount}</span></div>
                  <div className="flex justify-between font-bold border-t border-dashed pt-1 mt-1"><span>Net Due / Paid:</span><span>{formatPHP(summary.totalPayments || 0)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">PAYMENT BREAKDOWN</div>
                  <div className="flex justify-between"><span>Cash:</span><span>{formatPHP(summary.cashSales)}</span></div>
                  <div className="flex justify-between"><span>GCash:</span><span>{formatPHP(summary.gcashSales)}</span></div>
                  <div className="flex justify-between"><span>Maya:</span><span>{formatPHP(summary.mayaSales)}</span></div>
                  <div className="flex justify-between"><span>Card:</span><span>{formatPHP(summary.cardSales)}</span></div>
                  <div className="flex justify-between"><span>Other:</span><span>{formatPHP(summary.otherSales)}</span></div>
                  <div className="flex justify-between font-bold border-t border-dashed pt-1 mt-1"><span>Total Payments:</span><span>{formatPHP(summary.totalPayments || 0)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">SALES CHANNEL BREAKDOWN</div>
                  <div className="flex justify-between"><span>Dine-in / Store:</span><span>{formatPHP(summary.dineInSales || 0)}</span></div>
                  <div className="flex justify-between"><span>Take-out:</span><span>{formatPHP(summary.takeOutSales || 0)}</span></div>
                  <div className="flex justify-between text-amber-500 font-bold"><span>FoodPanda:</span><span>{formatPHP(summary.foodpandaSales || 0)}</span></div>
                  <div className="flex justify-between text-emerald-500 font-bold"><span>GrabFood:</span><span>{formatPHP(summary.grabSales || 0)}</span></div>
                  {summary.otherChannelSales > 0 && (
                    <div className="flex justify-between"><span>Other Channels:</span><span>{formatPHP(summary.otherChannelSales)}</span></div>
                  )}
                  <div className="flex justify-between font-bold border-t border-dashed pt-1 mt-1"><span>Total Channels:</span><span>{formatPHP(summary.totalPayments || 0)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">VOIDS & REFUNDS</div>
                  <div className="flex justify-between"><span>Void Count:</span><span>{summary.voidCount}</span></div>
                  <div className="flex justify-between"><span>Void Amount:</span><span>{formatPHP(summary.voidAmount)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">DRAWER FLOW & BALANCING</div>
                  <div className="flex justify-between"><span>Opening Float:</span><span>{formatPHP(summary.openingBalance)}</span></div>
                  <div className="flex justify-between"><span>Expected Cash:</span><span>{formatPHP(summary.expectedCash)}</span></div>
                  <div className="flex justify-between font-bold"><span>Expected Drawer:</span><span>{formatPHP(summary.openingBalance + summary.expectedCash)}</span></div>
                  <div className="flex justify-between text-indigo-600 dark:text-indigo-400 font-bold"><span>Actual Drawer:</span><span>{formatPHP(summary.actualCash)}</span></div>
                  <div className={`flex justify-between font-bold ${discrepancyColorClass(summary.discrepancy)}`}>
                    <span>Discrepancy:</span>
                    <span>{formatPHP(summary.discrepancy)}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button variant="outline" onClick={() => setSelectedSession(null)} className="sm:flex-1">
              Close Dialog
            </Button>
            <Button
              onClick={() => {
                const summary = getSummaryObject(selectedSession!);
                handlePrintXZBluetooth(summary, true, selectedSession!.branches?.name || 'TERMINAL');
              }}
              disabled={isPrintingXZBluetooth}
              className="sm:flex-1 font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isPrintingXZBluetooth ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Print Bluetooth
            </Button>
            <Button
              onClick={() => {
                const summary = getSummaryObject(selectedSession!);
                printXZReport(sanitizeSummaryForDisplay(summary), true, selectedSession!.branches?.name || 'TERMINAL');
              }}
              className="sm:flex-1 font-bold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Printer className="w-4 h-4" />
              Print System
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
