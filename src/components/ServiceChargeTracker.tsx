import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Download, RefreshCw, Search, Store, TrendingUp, Receipt } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { useModal } from '../contexts/ModalContext';
import { supabase } from '../lib/supabase';
import { getOrganizedBranches } from '../lib/utils';
import {
  aggregateServiceCharge,
  buildServiceChargeCsv,
  normalizeJoinedName,
  resolveBranchServiceChargeDetails,
  resolveDatePresetBounds,
  type ServiceChargeDatePreset,
  type ServiceChargeSaleRow,
} from '../lib/serviceCharge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { DataTablePagination } from './ui/DataTablePagination';

const CHUNK_SIZE = 1000;

const formatPHP = (amount: number): string =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount);

const formatDateInput = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

interface CashierProfile {
  id: string;
  email: string;
  full_name: string | null;
}

export const ServiceChargeTracker: React.FC = () => {
  const { profile, branches } = useAuth();
  const { tenant } = useTenant();
  const { showError } = useModal();
  const tenantId = tenant?.id;

  const showErrorRef = useRef(showError);
  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  const loadRequestRef = useRef(0);

  const isGlobalRole = ['super_admin', 'auditor', 'inventory_manager'].includes(
    profile?.role_name || ''
  );
  const lockedBranchId = !isGlobalRole && profile?.branch_id ? profile.branch_id : null;

  const [filterBranchId, setFilterBranchId] = useState<string>(() => lockedBranchId || 'ALL');
  const [datePreset, setDatePreset] = useState<ServiceChargeDatePreset>('30days');
  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return formatDateInput(d);
  });
  const [customEndDate, setCustomEndDate] = useState<string>(() => formatDateInput(new Date()));
  const [searchQuery, setSearchQuery] = useState('');

  const [salesRows, setSalesRows] = useState<ServiceChargeSaleRow[]>([]);
  const [cashierProfiles, setCashierProfiles] = useState<CashierProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Keep branch-scoped users anchored to their assigned branch (or one of its sub-stores)
  useEffect(() => {
    if (lockedBranchId) {
      setFilterBranchId(prev => {
        const isAllowedChild = branches.some(
          b => b.id === prev && b.parent_id === lockedBranchId
        );
        return prev === lockedBranchId || isAllowedChild ? prev : lockedBranchId;
      });
    }
  }, [lockedBranchId, branches]);

  // Load staff profiles once to resolve cashier names/emails
  useEffect(() => {
    let cancelled = false;
    let query = supabase.from('profiles').select('id, email, full_name');
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    query.then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('Error loading cashier profiles:', error);
        return;
      }
      setCashierProfiles((data as CashierProfile[]) || []);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const scopedBranches = useMemo(() => {
    if (!lockedBranchId) return branches;
    return branches.filter(b => b.id === lockedBranchId || b.parent_id === lockedBranchId);
  }, [branches, lockedBranchId]);

  const organizedScopedBranches = useMemo(
    () => getOrganizedBranches(scopedBranches),
    [scopedBranches]
  );

  const branchNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of branches) {
      map[b.id] = b.name;
    }
    return map;
  }, [branches]);

  const cashierLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of cashierProfiles) {
      map[p.id] = p.full_name ? `${p.full_name} (${p.email})` : p.email;
    }
    return map;
  }, [cashierProfiles]);

  const loadSales = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const { from, to } = resolveDatePresetBounds(
        datePreset,
        customStartDate,
        customEndDate
      );

      const collected: ServiceChargeSaleRow[] = [];
      let offset = 0;

      while (true) {
        let query = supabase
          .from('sales')
          .select(
            `
            id,
            control_number,
            branch_id,
            sub_store_id,
            cashier_id,
            total_amount,
            service_charge_rate,
            service_charge_amount,
            sale_category,
            status,
            created_at,
            branches:branches!branch_id (name),
            sub_stores:branches!sub_store_id (name)
          `
          )
          .eq('status', 'completed')
          .gt('service_charge_amount', 0)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + CHUNK_SIZE - 1);

        if (tenantId) {
          query = query.eq('tenant_id', tenantId);
        }
        if (from) {
          query = query.gte('created_at', from);
        }
        if (to) {
          query = query.lte('created_at', to);
        }

        if (filterBranchId !== 'ALL') {
          const selected = branches.find(b => b.id === filterBranchId);
          if (selected?.parent_id) {
            query = query.eq('sub_store_id', filterBranchId);
          } else {
            query = query.or(
              `branch_id.eq.${filterBranchId},sub_store_id.eq.${filterBranchId}`
            );
          }
        }

        const { data, error } = await query;
        if (requestId !== loadRequestRef.current) return;
        if (error) throw error;

        const batch = (data || []) as unknown as ServiceChargeSaleRow[];
        collected.push(...batch);

        if (batch.length < CHUNK_SIZE) break;
        offset += CHUNK_SIZE;
      }

      if (requestId !== loadRequestRef.current) return;
      setSalesRows(collected);
    } catch (err: any) {
      if (requestId !== loadRequestRef.current) return;
      console.error('Error loading service charge sales:', err);
      showErrorRef.current(err?.message || 'Failed to load service charge records.');
      setSalesRows([]);
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [datePreset, customStartDate, customEndDate, filterBranchId, branches, tenantId]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  // Reset pagination when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterBranchId, datePreset, customStartDate, customEndDate, searchQuery, itemsPerPage]);

  const filteredSales = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return salesRows;

    return salesRows.filter(row => {
      const control = (row.control_number || row.id.slice(0, 8)).toLowerCase();
      const branchName = (
        branchNameById[row.branch_id] ||
        normalizeJoinedName(row.branches) ||
        ''
      ).toLowerCase();
      const subStoreName = (
        (row.sub_store_id &&
          (branchNameById[row.sub_store_id] || normalizeJoinedName(row.sub_stores))) ||
        ''
      ).toLowerCase();
      const cashier = (
        row.cashier_id ? cashierLabelById[row.cashier_id] || '' : 'deleted staff'
      ).toLowerCase();
      return (
        control.includes(term) ||
        branchName.includes(term) ||
        subStoreName.includes(term) ||
        cashier.includes(term)
      );
    });
  }, [salesRows, searchQuery, branchNameById, cashierLabelById]);

  const tenantDefaultSCRate = Number(tenant?.default_service_charge_rate ?? 0);

  const summary = useMemo(
    () =>
      aggregateServiceCharge(
        filteredSales,
        scopedBranches,
        tenantDefaultSCRate,
        filterBranchId
      ),
    [filteredSales, scopedBranches, tenantDefaultSCRate, filterBranchId]
  );

  const topEarningBranch = useMemo(() => {
    const withEarnings = summary.branchBreakdown.filter(b => b.serviceChargeTotal > 0);
    return withEarnings[0] || null;
  }, [summary.branchBreakdown]);

  const selectedBranchObj = useMemo(
    () => branches.find(b => b.id === filterBranchId) || null,
    [branches, filterBranchId]
  );

  const selectedBranchRateDetails = useMemo(
    () => resolveBranchServiceChargeDetails(selectedBranchObj, branches, tenantDefaultSCRate),
    [selectedBranchObj, branches, tenantDefaultSCRate]
  );

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / itemsPerPage));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSales.slice(start, start + itemsPerPage);
  }, [filteredSales, currentPage, itemsPerPage]);

  const handleBranchRowClick = (branchId: string) => {
    if (filterBranchId === branchId) {
      setFilterBranchId(lockedBranchId || 'ALL');
    } else {
      setFilterBranchId(branchId);
    }
  };

  const handleExportCsv = () => {
    if (filteredSales.length === 0) return;
    const csv = buildServiceChargeCsv(filteredSales, branchNameById, cashierLabelById);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `service-charge-tracker-${formatDateInput(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasSubStoresForLockedBranch =
    Boolean(lockedBranchId) &&
    scopedBranches.some(b => b.parent_id === lockedBranchId);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-3">
            <Coins className="w-7 h-7 sm:w-8 sm:h-8 text-primary" />
            <span>Service Charge Tracker</span>
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Monitor collected dine-in service charges and filter earnings by branch or date range.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadSales} disabled={loading} title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCsv}
            disabled={loading || filteredSales.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card className="mb-6">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-4 lg:items-end">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Search Receipt or Cashier</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search control number, branch, or cashier..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex gap-3 lg:items-end">
              <div className="space-y-1.5 min-w-[200px]">
                <Label className="text-xs">Branch Filter</Label>
                {!lockedBranchId ? (
                  <Select value={filterBranchId} onValueChange={setFilterBranchId}>
                    <SelectTrigger className="h-10 text-xs">
                      <SelectValue placeholder="All Branches" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Branches</SelectItem>
                      {organizedScopedBranches.map(b => (
                        <SelectItem key={b.id} value={b.id} className="text-xs">
                          {b.isSubStore ? `↳ ${b.name} (${b.parentName})` : b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : hasSubStoresForLockedBranch ? (
                  <Select value={filterBranchId} onValueChange={setFilterBranchId}>
                    <SelectTrigger className="h-10 text-xs">
                      <SelectValue placeholder="Select Branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {organizedScopedBranches.map(b => (
                        <SelectItem key={b.id} value={b.id} className="text-xs">
                          {b.isSubStore ? `↳ ${b.name}` : `All (${b.name})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-10 px-3 rounded-md border bg-muted/40 flex items-center text-xs font-medium">
                    <Store className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                    <span className="truncate">
                      {branchNameById[lockedBranchId] || 'Assigned Branch'}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 min-w-[160px]">
                <Label className="text-xs">Date Range</Label>
                <Select
                  value={datePreset}
                  onValueChange={val => setDatePreset(val as ServiceChargeDatePreset)}
                >
                  <SelectTrigger className="h-10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="7days">Last 7 Days</SelectItem>
                    <SelectItem value="30days">Last 30 Days</SelectItem>
                    <SelectItem value="month">This Month</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                    <SelectItem value="all">All Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {datePreset === 'custom' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Start Date</Label>
                    <Input
                      type="date"
                      value={customStartDate}
                      onChange={e => setCustomStartDate(e.target.value)}
                      className="h-10 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">End Date</Label>
                    <Input
                      type="date"
                      value={customEndDate}
                      onChange={e => setCustomEndDate(e.target.value)}
                      className="h-10 text-xs"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-5">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">
              Total Service Charge Earned
            </span>
            <span className="text-2xl font-bold block mt-1 text-emerald-500">
              {formatPHP(summary.totalServiceCharge)}
            </span>
            <span className="text-[11px] text-muted-foreground block mt-1">
              {filterBranchId === 'ALL'
                ? 'Across all branches'
                : branchNameById[filterBranchId] || 'Selected branch'}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">
              Qualifying Orders
            </span>
            <span className="text-2xl font-bold block mt-1">
              {summary.orderCount.toLocaleString()}
            </span>
            <span className="text-[11px] text-muted-foreground block mt-1">
              Sales total: {formatPHP(summary.salesTotal)}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">
              Average SC / Order
            </span>
            <span className="text-2xl font-bold block mt-1">
              {formatPHP(summary.averageServiceCharge)}
            </span>
            <span className="text-[11px] text-muted-foreground block mt-1">
              Per completed order with SC
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            {filterBranchId === 'ALL' ? (
              <>
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-primary" />
                  Top Earning Branch
                </span>
                <span className="text-lg font-bold block mt-1 truncate">
                  {topEarningBranch ? topEarningBranch.branchName : '—'}
                </span>
                <span className="text-[11px] text-muted-foreground block mt-1">
                  {topEarningBranch
                    ? `${formatPHP(topEarningBranch.serviceChargeTotal)} (${topEarningBranch.sharePercent.toFixed(1)}%)`
                    : 'No earnings in selected period'}
                </span>
              </>
            ) : (
              <>
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">
                  Configured Branch Rate
                </span>
                <span className="text-2xl font-bold block mt-1 text-primary">
                  {selectedBranchRateDetails.rate.toFixed(2)}%
                </span>
                <span className="text-[11px] text-muted-foreground block mt-1">
                  {selectedBranchRateDetails.source === 'branch'
                    ? 'Branch custom override'
                    : selectedBranchRateDetails.source === 'parent'
                      ? `Inherited from ${selectedBranchRateDetails.parentName || 'parent branch'}`
                      : `Inherited tenant default (${tenantDefaultSCRate.toFixed(2)}%)`}
                </span>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Earnings by Branch Breakdown */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Store className="w-4 h-4 text-primary" />
                Earnings by Branch
              </CardTitle>
              <CardDescription className="text-xs">
                Click a branch row to filter transactions below; click again to clear.
              </CardDescription>
            </div>
            {filterBranchId !== 'ALL' && !lockedBranchId && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-8"
                onClick={() => setFilterBranchId('ALL')}
              >
                Show All Branches
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Branch</TableHead>
                  <TableHead className="text-right">Configured Rate</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Order Sales</TableHead>
                  <TableHead className="text-right">Service Charge Earned</TableHead>
                  <TableHead className="text-right pr-6">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                      Loading branch earnings...
                    </TableCell>
                  </TableRow>
                ) : summary.branchBreakdown.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                      No branches found for the current filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  summary.branchBreakdown.map(row => {
                    const isSelected = filterBranchId === row.branchId;
                    return (
                      <TableRow
                        key={row.branchId}
                        onClick={() => handleBranchRowClick(row.branchId)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/50'
                        }`}
                      >
                        <TableCell className="pl-6 font-medium">
                          <div className="flex items-center gap-2">
                            <span>
                              {row.isSubStore ? `↳ ${row.branchName}` : row.branchName}
                            </span>
                            {row.isSubStore && row.parentName && (
                              <Badge variant="outline" className="text-[10px]">
                                {row.parentName}
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge className="text-[10px] bg-primary/20 text-primary hover:bg-primary/20">
                                Filtered
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.configuredRate.toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.orderCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatPHP(row.salesTotal)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-500">
                          {formatPHP(row.serviceChargeTotal)}
                        </TableCell>
                        <TableCell className="text-right pr-6 text-xs text-muted-foreground font-mono">
                          {row.sharePercent.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            Service Charge Transactions
          </CardTitle>
          <CardDescription className="text-xs">
            Completed dine-in transactions that collected a service charge.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Date & Time</TableHead>
                  <TableHead>Control #</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="text-right">Order Total</TableHead>
                  <TableHead className="text-right">SC Rate</TableHead>
                  <TableHead className="text-right pr-6">Service Charge</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">
                      Loading service charge transactions...
                    </TableCell>
                  </TableRow>
                ) : paginatedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">
                      No service charge transactions found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRows.map(sale => {
                    const branchLabel =
                      branchNameById[sale.branch_id] ||
                      normalizeJoinedName(sale.branches) ||
                      '—';
                    const subStoreLabel = sale.sub_store_id
                      ? branchNameById[sale.sub_store_id] ||
                        normalizeJoinedName(sale.sub_stores) ||
                        null
                      : null;
                    const cashierLabel = sale.cashier_id
                      ? cashierLabelById[sale.cashier_id] || sale.cashier_id.slice(0, 8)
                      : 'Deleted Staff';

                    return (
                      <TableRow key={sale.id}>
                        <TableCell className="pl-6 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(sale.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold">
                          {sale.control_number || sale.id.slice(0, 8)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span>{branchLabel}</span>
                          {subStoreLabel && (
                            <span className="text-muted-foreground"> / {subStoreLabel}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={cashierLabel}>
                          {cashierLabel}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatPHP(Number(sale.total_amount ?? 0))}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {Number(sale.service_charge_rate ?? 0).toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right pr-6 font-semibold text-emerald-500">
                          {formatPHP(Number(sale.service_charge_amount ?? 0))}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <DataTablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalItems={filteredSales.length}
            itemsPerPage={itemsPerPage}
            onItemsPerPageChange={setItemsPerPage}
            showPageSizeSelector
          />
        </CardContent>
      </Card>
    </div>
  );
};
