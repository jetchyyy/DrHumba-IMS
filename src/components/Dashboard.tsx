import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  DollarSign,
  Layers,
  Store,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Clock,
  LayoutDashboard,
  Search,
  Activity,
  Minus,
  X,
  Calendar,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { DataTablePagination } from "./ui/DataTablePagination";
import { usePendingApprovalCounts } from '../hooks/usePendingApprovalCounts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { getOrganizedBranches } from '../lib/utils';

interface DashboardStats {
  totalInventoryValue: number;
  totalSales: number;
  totalBranches: number;
  lowStockCount: number;
  pendingTransfersCount: number;
  todayRevenue: number;
  yesterdayRevenue?: number;
  periodRevenue?: number;
  prevRevenue?: number;
}

const formatLocalDate = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPresetDates = (preset: 'today' | 'yesterday' | '7days' | '30days' | 'this_month') => {
  const now = new Date();
  const todayStr = formatLocalDate(now);
  
  if (preset === 'today') {
    return { start: todayStr, end: todayStr };
  }
  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const yStr = formatLocalDate(y);
    return { start: yStr, end: yStr };
  }
  if (preset === '7days') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return { start: formatLocalDate(d), end: todayStr };
  }
  if (preset === '30days') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return { start: formatLocalDate(d), end: todayStr };
  }
  if (preset === 'this_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: formatLocalDate(firstDay), end: todayStr };
  }
  return { start: todayStr, end: todayStr };
};

interface ItemStockGrid {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: string;
  reorderLevel: number;
  cost: number;
  stocks: { [branchId: string]: number };
  totalStock: number;
}

export const Dashboard: React.FC<{ setActiveTab: (tab: string) => void }> = ({ setActiveTab }) => {
  const { branches } = useAuth();
  const { counts, isApprover } = usePendingApprovalCounts();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(
    () => sessionStorage.getItem('dashboard_approval_banner_dismissed') === 'true'
  );
  const [inventoryGrid, setInventoryGrid] = useState<ItemStockGrid[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Branch and Date Filters
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');
  const [dateRangeType, setDateRangeType] = useState<'today' | 'yesterday' | '7days' | '30days' | 'this_month' | 'custom'>('today');
  const [startDate, setStartDate] = useState<string>(() => formatLocalDate(new Date()));
  const [endDate, setEndDate] = useState<string>(() => formatLocalDate(new Date()));
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [inventoryGrid.length]);

  const handleStartDateChange = (newStart: string) => {
    setStartDate(newStart);
    setDateRangeType('custom');
    if (endDate && newStart > endDate) {
      setEndDate(newStart);
    }
  };

  const handleEndDateChange = (newEnd: string) => {
    setEndDate(newEnd);
    setDateRangeType('custom');
    if (startDate && newEnd < startDate) {
      setStartDate(newEnd);
    }
  };

  const loadData = async () => {
    if (!startDate || !endDate) return;
    const currentStartMs = new Date(`${startDate}T00:00:00`).getTime();
    const currentEndMs = new Date(`${endDate}T23:59:59.999`).getTime();
    if (isNaN(currentStartMs) || isNaN(currentEndMs)) return;

    setRefreshing(true);
    try {
      const startIso = new Date(`${startDate}T00:00:00`).toISOString();
      const endIso = new Date(`${endDate}T23:59:59.999`).toISOString();

      const durationMs = Math.max(86400000, currentEndMs - currentStartMs + 1);
      const prevStartIso = new Date(currentStartMs - durationMs).toISOString();
      const prevEndIso = new Date(currentStartMs - 1).toISOString();

      let salesQuery = supabase
        .from('sales')
        .select('total_amount')
        .eq('status', 'completed')
        .gte('created_at', startIso)
        .lte('created_at', endIso);

      let prevSalesQuery = supabase
        .from('sales')
        .select('total_amount')
        .eq('status', 'completed')
        .gte('created_at', prevStartIso)
        .lte('created_at', prevEndIso);

      if (selectedBranchId !== 'ALL') {
        salesQuery = salesQuery.eq('branch_id', selectedBranchId);
        prevSalesQuery = prevSalesQuery.eq('branch_id', selectedBranchId);
      }

      const [
        { data: salesData, error: salesError },
        { data: prevSalesData, error: prevSalesError },
        { data: items, error: itemsError },
        { data: balances, error: balancesError },
        { data: alerts, error: alertsError },
        { data: pendingTransfers, error: transfersError }
      ] = await Promise.all([
        salesQuery,
        prevSalesQuery,
        supabase.from('inventory_items').select('*').order('item_name'),
        supabase.from('inventory_balances').select('*'),
        supabase.rpc('get_inventory_alerts'),
        supabase.from('transfer_requests').select('id, source_branch_id, target_branch_id').eq('status', 'requested')
      ]);

      if (salesError) console.error('Error fetching sales:', salesError);
      if (prevSalesError) console.error('Error fetching prev sales:', prevSalesError);
      if (itemsError) throw itemsError;
      if (balancesError) throw balancesError;
      if (alertsError) throw alertsError;
      if (transfersError) console.error('Error fetching transfers:', transfersError);

      const periodRevenue = salesData?.reduce((sum, s) => sum + Number(s.total_amount || 0), 0) || 0;
      const prevRevenue = prevSalesData?.reduce((sum, s) => sum + Number(s.total_amount || 0), 0) || 0;

      const itemsMap = new Map((items || []).map(it => [it.id, Number(it.cost_per_base_unit || 0)]));
      const totalInventoryValue = (balances || [])
        .filter(b => selectedBranchId === 'ALL' || b.branch_id === selectedBranchId)
        .reduce((sum, b) => {
          const cost = itemsMap.get(b.item_id) || 0;
          return sum + (Number(b.quantity || 0) * cost);
        }, 0);

      const branchAlerts = ((alerts as any[]) || []).filter((a: any) => selectedBranchId === 'ALL' || a.branch_id === selectedBranchId);
      setLowStockItems(branchAlerts);
      const lowStockCount = branchAlerts.length;

      const pendingTransfersCount = (pendingTransfers || []).filter(t => {
        if (selectedBranchId === 'ALL') return true;
        return t.source_branch_id === selectedBranchId || t.target_branch_id === selectedBranchId;
      }).length;

      setStats({
        totalInventoryValue,
        totalSales: periodRevenue,
        totalBranches: selectedBranchId === 'ALL' ? branches.length : 1,
        lowStockCount,
        pendingTransfersCount,
        todayRevenue: periodRevenue,
        yesterdayRevenue: prevRevenue,
        periodRevenue,
        prevRevenue
      });

      // Activity logs
      const { data: activity, error: activityError } = await supabase
        .from('audit_logs')
        .select('id, action, module, timestamp, user_id')
        .order('timestamp', { ascending: false })
        .limit(5);

      if (activityError) {
        console.error('Error fetching recent activity:', activityError);
      }

      if (activity && activity.length > 0) {
        const userIds = [...new Set(activity.map(a => a.user_id).filter(Boolean))];
        let profilesMap: Record<string, string> = {};
        if (userIds.length > 0) {
          let { data: profiles, error: profilesError } = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .in('id', userIds);

          // Older deployments may not have the additive full_name column yet.
          if (profilesError && /full_name|column/i.test(profilesError.message || '')) {
            const legacyProfiles = await supabase
              .from('profiles')
              .select('id, email')
              .in('id', userIds);
            profiles = legacyProfiles.data?.map(p => ({ ...p, full_name: null })) || null;
            profilesError = legacyProfiles.error;
          }

          if (profiles) {
            profiles.forEach(p => {
              if (p.id) profilesMap[p.id] = p.full_name || p.email || 'User';
            });
          }
        }
        const mappedActivity = activity.map(a => ({
          ...a,
          profiles: { full_name: (a.user_id && profilesMap[a.user_id]) || 'System' }
        }));
        setRecentActivity(mappedActivity);
      } else {
        setRecentActivity([]);
      }

      const grid: ItemStockGrid[] = (items || []).map(item => {
        const itemBalances = (balances || []).filter(b => b.item_id === item.id);
        const stocks: { [branchId: string]: number } = {};
        
        let total = 0;
        branches.forEach(b => {
          const bal = itemBalances.find(ib => ib.branch_id === b.id);
          const qty = bal ? Number(bal.quantity) : 0;
          stocks[b.id] = qty;
          total += qty;
        });

        return {
          id: item.id,
          sku: item.sku,
          name: item.item_name,
          category: item.category,
          baseUnit: item.base_unit,
          reorderLevel: Number(item.reorder_level),
          cost: Number(item.cost_per_base_unit),
          stocks,
          totalStock: total
        };
      });

      setInventoryGrid(grid);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastRefreshed(new Date());
    }
  };

  useEffect(() => {
    loadData();
  }, [branches, selectedBranchId, startDate, endDate]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="text-muted-foreground flex items-center space-x-2 animate-pulse">
          <Clock className="w-5 h-5 animate-spin text-primary" />
          <span>Loading restaurant metrics...</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);
  };

  const renderStockValue = (qty: number, reorder: number, baseUnit: string) => {
    if (qty === 0) {
      return (
        <span className="text-muted-foreground/30 font-medium">
          0 <span className="text-[10px]">{baseUnit}</span>
        </span>
      );
    }
    if (qty < reorder) {
      return (
        <span className="text-amber-500 bg-amber-500/10 font-bold border border-amber-500/20 rounded px-2 py-0.5">
          {qty.toLocaleString()} <span className="text-[10px] opacity-75">{baseUnit}</span>
        </span>
      );
    }
    return (
      <span className="text-foreground font-semibold">
        {qty.toLocaleString()} <span className="text-[10px] text-muted-foreground">{baseUnit}</span>
      </span>
    );
  };

  const filteredGrid = inventoryGrid.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredGrid.length / itemsPerPage);
  const paginatedGrid = filteredGrid.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);


  const organizedBranches = getOrganizedBranches(branches);
  const selectedBranchName = selectedBranchId === 'ALL'
    ? 'All Branches'
    : (branches.find(b => b.id === selectedBranchId)?.name || 'Selected Branch');

  const displayedBranches = selectedBranchId === 'ALL'
    ? branches
    : branches.filter(b => b.id === selectedBranchId);

  const isSingleDay = startDate === endDate;
  const todayStr = formatLocalDate(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = formatLocalDate(yesterdayDate);

  let salesTitle = "Sales Revenue";
  let comparisonLabel = "vs previous period";

  if (isSingleDay) {
    if (startDate === todayStr) {
      salesTitle = "Today's Sales";
      comparisonLabel = "vs yesterday";
    } else if (startDate === yesterdayStr) {
      salesTitle = "Yesterday's Sales";
      comparisonLabel = "vs prior day";
    } else {
      salesTitle = `Sales (${startDate})`;
      comparisonLabel = "vs prior day";
    }
  } else {
    if (dateRangeType === '7days') {
      salesTitle = "Last 7 Days Sales";
      comparisonLabel = "vs prior 7 days";
    } else if (dateRangeType === '30days') {
      salesTitle = "Last 30 Days Sales";
      comparisonLabel = "vs prior 30 days";
    } else if (dateRangeType === 'this_month') {
      salesTitle = "This Month's Sales";
      comparisonLabel = "vs prior period";
    } else {
      salesTitle = `Sales (${startDate} to ${endDate})`;
      comparisonLabel = "vs prior period";
    }
  }

  const curRev = stats?.periodRevenue ?? stats?.todayRevenue ?? 0;
  const prevRev = stats?.prevRevenue ?? stats?.yesterdayRevenue ?? 0;
  const revenueTrend = prevRev > 0
    ? ((curRev - prevRev) / prevRev) * 100
    : curRev > 0 ? 100 : 0;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <LayoutDashboard className="w-8 h-8 text-primary" />
            <span>Overview Dashboard</span>
          </h2>
          <p className="text-muted-foreground">
            {selectedBranchId === 'ALL'
              ? 'Real-time status across all warehouses and restaurant branches.'
              : `Filtered view for ${selectedBranchName}.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:inline-block">
            Last updated: {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <Button onClick={loadData} disabled={refreshing} variant="outline" size="icon" className="h-9 w-9">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ── Filter Toolbar (Branch & Custom Date Filters) ── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6 p-3 sm:p-4 rounded-xl bg-card/60 border border-border/60 backdrop-blur shadow-sm">
        {/* Left: Branch Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Branch:</span>
          </div>
          <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
            <SelectTrigger className="w-[190px] sm:w-[220px] h-9 text-xs bg-background">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL" className="text-xs font-bold">
                All Branches
              </SelectItem>
              {organizedBranches.map(b => (
                <SelectItem key={b.id} value={b.id} className="text-xs">
                  {b.parent_id ? `└─ ${b.name}` : b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Right: Date Range Preset & Custom Date Inputs */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Period:</span>
          </div>
          <Select
            value={dateRangeType}
            onValueChange={(val: any) => {
              setDateRangeType(val);
              if (val !== 'custom') {
                const { start, end } = getPresetDates(val);
                setStartDate(start);
                setEndDate(end);
              }
            }}
          >
            <SelectTrigger className="w-[130px] sm:w-[145px] h-9 text-xs bg-background">
              <SelectValue placeholder="Select Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today" className="text-xs">Today</SelectItem>
              <SelectItem value="yesterday" className="text-xs">Yesterday</SelectItem>
              <SelectItem value="7days" className="text-xs">Last 7 Days</SelectItem>
              <SelectItem value="30days" className="text-xs">Last 30 Days</SelectItem>
              <SelectItem value="this_month" className="text-xs">This Month</SelectItem>
              <SelectItem value="custom" className="text-xs font-medium text-primary">Custom Dates</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom Date Inputs */}
          {dateRangeType === 'custom' && (
            <div className="flex items-center gap-1.5 bg-background border border-border/80 rounded-md px-2 py-1 h-9">
              <Input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="h-7 text-xs border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 w-[115px]"
              />
              <span className="text-muted-foreground text-xs font-medium">to</span>
              <Input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="h-7 text-xs border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 w-[115px]"
              />
            </div>
          )}

          {/* Reset button if any filter is active */}
          {(selectedBranchId !== 'ALL' || dateRangeType !== 'today') && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSelectedBranchId('ALL');
                setDateRangeType('today');
                const { start, end } = getPresetDates('today');
                setStartDate(start);
                setEndDate(end);
              }}
              title="Reset to All Branches & Today"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* ── Pending Approvals Banner (Phase 4) ── */}
      {isApprover && counts.total > 0 && !bannerDismissed && (
        <div className="mb-6 animate-slide-down rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-amber-500/10 p-4 relative overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-transparent pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                </span>
              </div>
              <div>
                <p className="text-sm font-bold text-amber-400">
                  ⚡ {counts.total} Transaction{counts.total !== 1 ? 's' : ''} Awaiting Your Approval
                </p>
                <p className="text-xs text-amber-400/70 mt-0.5">
                  Please review and approve the following pending items.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {counts.transfers > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 border-blue-500/40 text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/60 gap-1.5"
                  onClick={() => setActiveTab('transfers')}
                >
                  Transfers
                  <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-[10px] px-1.5 py-0 h-4">
                    {counts.transfers}
                  </Badge>
                  <ArrowRight className="w-3 h-3" />
                </Button>
              )}
              {counts.adjustments > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 border-purple-500/40 text-purple-400 hover:bg-purple-500/10 hover:border-purple-500/60 gap-1.5"
                  onClick={() => setActiveTab('adjustments')}
                >
                  Adjustments
                  <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[10px] px-1.5 py-0 h-4">
                    {counts.adjustments}
                  </Badge>
                  <ArrowRight className="w-3 h-3" />
                </Button>
              )}
              {counts.portioning > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-8 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/60 gap-1.5"
                  onClick={() => setActiveTab('portioning')}
                >
                  Portioning
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px] px-1.5 py-0 h-4">
                    {counts.portioning}
                  </Badge>
                  <ArrowRight className="w-3 h-3" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 flex-shrink-0"
                title="Dismiss until next login"
                onClick={() => {
                  setBannerDismissed(true);
                  sessionStorage.setItem('dashboard_approval_banner_dismissed', 'true');
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="glass-dark border-border/50">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-500">
                <DollarSign className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{salesTitle}</p>
            </div>
            <div>
              <h3 className="text-3xl font-bold">{formatCurrency(stats?.periodRevenue ?? stats?.todayRevenue ?? 0)}</h3>
              <div className="flex items-center mt-2 text-xs">
                {revenueTrend > 0 ? (
                  <span className="text-emerald-500 flex items-center font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded mr-2">
                    <ArrowUpRight className="w-3 h-3 mr-1" /> +{revenueTrend.toFixed(1)}%
                  </span>
                ) : revenueTrend < 0 ? (
                  <span className="text-rose-500 flex items-center font-semibold bg-rose-500/10 px-1.5 py-0.5 rounded mr-2">
                    <ArrowDownRight className="w-3 h-3 mr-1" /> {revenueTrend.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground flex items-center font-semibold bg-muted px-1.5 py-0.5 rounded mr-2">
                    <Minus className="w-3 h-3 mr-1" /> 0%
                  </span>
                )}
                <span className="text-muted-foreground">{comparisonLabel}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <Layers className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Inventory Value</p>
            </div>
            <div>
              <h3 className="text-3xl font-bold">{formatCurrency(stats?.totalInventoryValue || 0)}</h3>
              <p className="text-xs text-muted-foreground mt-2">
                {selectedBranchId === 'ALL'
                  ? 'Across all branches and warehouses'
                  : `For ${selectedBranchName}`}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="glass-dark border-border/50 cursor-pointer hover:border-amber-500/30 transition-all group"
          onClick={() => setActiveTab('notifications')}
        >
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-amber-500 transition-colors">Low Stock</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <h3 className="text-3xl font-bold">{stats?.lowStockCount || 0}</h3>
                <p className="text-xs text-muted-foreground mt-2">
                  {selectedBranchId === 'ALL' ? 'Items need reordering' : `Items low in ${selectedBranchName}`}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform mb-1" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="glass-dark border-border/50 cursor-pointer hover:border-primary/30 transition-all group"
          onClick={() => setActiveTab('transfers')}
        >
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <Store className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">Transfers</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <h3 className="text-3xl font-bold">{stats?.pendingTransfersCount || 0}</h3>
                <p className="text-xs text-muted-foreground mt-2">
                  {selectedBranchId === 'ALL' ? 'Pending requests' : `Pending for ${selectedBranchName}`}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform mb-1" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Stock Alerts List */}
      {lowStockItems.length > 0 && (
        <Alert variant="destructive" className="mb-8 border-amber-500/50 text-amber-500 bg-amber-500/5 relative">
          <AlertTriangle className="h-4 w-4" color="currentColor" />
          <AlertTitle className="uppercase tracking-wider font-bold text-xs mb-3 flex items-center justify-between">
            <span>Critical Reorder Alerts {selectedBranchId !== 'ALL' && `— ${selectedBranchName}`}</span>
            <Button variant="link" size="sm" className="h-auto p-0 text-amber-600 hover:text-amber-500 font-semibold" onClick={() => setActiveTab('notifications')}>
              View all alerts &rarr;
            </Button>
          </AlertTitle>
          <AlertDescription>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
              {lowStockItems.slice(0, 6).map((alert, i) => (
                <div key={i} className="bg-background/50 border p-3 rounded-lg flex items-center justify-between hover:bg-background/80 transition-colors">
                  <div>
                    <h5 className="text-xs font-bold text-foreground">{alert.item_name}</h5>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{alert.branch_name}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-amber-500">{Number(alert.current_quantity).toLocaleString()}{alert.base_unit}</span>
                    <p className="text-[9px] text-muted-foreground mt-0.5">Limit: {alert.reorder_level}{alert.base_unit}</p>
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content Grid: Activity + Inventory */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        
        {/* Recent Activity (Left Column on large screens) */}
        <div className="xl:col-span-1">
          <Card className="h-full flex flex-col glass-dark border-border/50">
            <CardHeader className="px-6 py-4 border-b shrink-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Recent Activity
              </CardTitle>
              <CardDescription>Latest system events</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col">
              {recentActivity.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground min-h-[300px]">
                  <Activity className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm font-medium text-foreground">No recent activity</p>
                  <p className="text-xs opacity-70 mt-1">Actions taken by users will appear here in real-time.</p>
                </div>
              ) : (
                <div className="divide-y divide-border flex-1">
                  {recentActivity.map(act => (
                    <div key={act.id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-foreground truncate">{act.action}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-2">
                        <Badge variant="secondary" className="text-[9px] uppercase">{act.module}</Badge>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                          {act.profiles?.full_name || 'System'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-4 border-t mt-auto shrink-0 bg-muted/10">
                <Button variant="ghost" size="sm" className="w-full text-xs font-semibold" onClick={() => setActiveTab('audit-logs')}>
                  View full history &rarr;
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Multi-Branch Inventory Visibility Grid (Right Column on large screens) */}
        <div className="xl:col-span-3">
          <Card className="h-full">
            <CardHeader className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">Multi-Branch Inventory Grid</CardTitle>
                  {selectedBranchId !== 'ALL' && (
                    <Badge variant="outline" className="text-[10px] text-primary border-primary/30 bg-primary/5">
                      Filtered: {selectedBranchName}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  {selectedBranchId === 'ALL'
                    ? 'Real-time stock balance compared across all locations.'
                    : `Showing stock balances for ${selectedBranchName}. Select "All Branches" to view all locations.`}
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input 
                  placeholder="Search item or SKU..." 
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9 h-9"
                />
              </div>
            </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 sticky left-0 z-20 bg-card min-w-[200px] border-r">Item Name</TableHead>
                  <TableHead className="min-w-[120px]">SKU</TableHead>
                  <TableHead className="min-w-[100px]">Category</TableHead>
                  {displayedBranches.map(b => (
                    <TableHead key={b.id} className="text-center text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap min-w-[110px]">
                      {b.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-right pr-6 font-bold border-l pl-4">
                    {selectedBranchId === 'ALL' ? 'Total Stock' : 'Total (All Branches)'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedGrid.map(item => (
                  <TableRow key={item.id} className="hover:bg-muted/40 transition-colors">
                    <TableCell className="pl-6 font-bold sticky left-0 z-20 bg-card border-r group-hover:bg-muted/40">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{item.sku}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[9px] uppercase font-bold">{item.category}</Badge>
                    </TableCell>
                    {displayedBranches.map(b => {
                      const qty = item.stocks[b.id] ?? 0;
                      return (
                        <TableCell key={b.id} className="text-center">
                          {renderStockValue(qty, item.reorderLevel, item.baseUnit)}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right pr-6 font-bold border-l pl-4">
                      {item.totalStock.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">{item.baseUnit}</span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredGrid.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4 + displayedBranches.length} className="h-48 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Store className="w-8 h-8 mb-2 opacity-20" />
                        <p>No inventory items found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="border-t">
            <DataTablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredGrid.length}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={setItemsPerPage}
              showPageSizeSelector={true}
              pageSizeOptions={[10, 20, 50, 100]}
            />
          </div>
        </CardContent>
      </Card>
      </div>
      </div>
    </div>
  );
};
