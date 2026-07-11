import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useBusinessVocab } from '../hooks/useBusinessVocab';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from './ui/chart';
import { BarChartIcon as BarChart3, ReloadIcon as RefreshCw, ClockIcon as Clock } from '@radix-ui/react-icons';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { getOrganizedBranches } from '../lib/utils';

interface BranchAnalyticsData {
  branchId: string;
  revenue: number;
  orders: number;
  foodCost: number;
  wasteCost: number;
  opexCost: number;
  profitEstimate: number;
  grossProfit: number;
  netProfit: number;
  topProducts: { name: string; quantity_sold: number; revenue: number }[];
  wasteSummary: { reason: string; cost: number; events: number }[];
  cashFlowHistory: { date: string; revenue: number; expenses: number; net_cash_flow: number }[];
  salesByCategory: { category: string; quantity_sold: number; revenue: number }[];
  salesByType: { sale_type: string; order_count: number; revenue: number }[];
}

export const Analytics: React.FC = () => {
  const { branches, selectedBranch } = useAuth();
  const vocab = useBusinessVocab();
  
  const [activeBranchId, setActiveBranchId] = useState('All');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); // Last 30 days
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  
  const [analyticsData, setAnalyticsData] = useState<BranchAnalyticsData | null>(null);
  const [storePerformanceData, setStorePerformanceData] = useState<any[]>([]);
  const [rankFilter, setRankFilter] = useState<'store' | 'dish'>('store');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  const [storeSearchTerm, setStoreSearchTerm] = useState('');
  const [isStorePopoverOpen, setIsStorePopoverOpen] = useState(false);
  
  const [dateRangeType, setDateRangeType] = useState<'7days' | '30days' | 'custom'>('30days');

  const loadAnalytics = async () => {
    setRefreshing(true);
    try {
      const v_tenant_id = (branches[0] as any)?.tenant_id;
      if (!v_tenant_id) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // 1. Current Period Ranges
      const currentStart = `${startDate}T00:00:00+00:00`;
      const currentEnd = `${endDate}T23:59:59+00:00`;

      // 2. Previous Month Ranges (for performance tracker comparison)
      const lastStart = new Date(startDate);
      lastStart.setMonth(lastStart.getMonth() - 1);
      const lastStartStr = `${lastStart.toISOString().split('T')[0]}T00:00:00+00:00`;

      const lastEnd = new Date(endDate);
      lastEnd.setMonth(lastEnd.getMonth() - 1);
      const lastEndStr = `${lastEnd.toISOString().split('T')[0]}T23:59:59+00:00`;

      // 3. Fetch sales for current period
      let currentSalesQuery = supabase
        .from('sales')
        .select('id, total_amount, branch_id, sub_store_id, payment_method, sale_category, status, created_at')
        .eq('status', 'completed')
        .eq('tenant_id', v_tenant_id)
        .gte('created_at', currentStart)
        .lte('created_at', currentEnd);

      if (activeBranchId !== 'All') {
        const selected = branches.find(b => b.id === activeBranchId);
        if (selected?.parent_id) {
          currentSalesQuery = currentSalesQuery.eq('sub_store_id', activeBranchId);
        } else {
          currentSalesQuery = currentSalesQuery.eq('branch_id', activeBranchId).is('sub_store_id', null);
        }
      }

      const { data: currentSales, error: currentSalesErr } = await currentSalesQuery;
      if (currentSalesErr) throw currentSalesErr;

      // 4. Fetch sales for last month (same range) to compute performance rating
      let lastSalesQuery = supabase
        .from('sales')
        .select('id, total_amount, branch_id, sub_store_id, status, created_at')
        .eq('status', 'completed')
        .eq('tenant_id', v_tenant_id)
        .gte('created_at', lastStartStr)
        .lte('created_at', lastEndStr);

      if (activeBranchId !== 'All') {
        const selected = branches.find(b => b.id === activeBranchId);
        if (selected?.parent_id) {
          lastSalesQuery = lastSalesQuery.eq('sub_store_id', activeBranchId);
        } else {
          lastSalesQuery = lastSalesQuery.eq('branch_id', activeBranchId).is('sub_store_id', null);
        }
      }

      const { data: lastSales, error: lastSalesErr } = await lastSalesQuery;
      if (lastSalesErr) throw lastSalesErr;

      // 5. Fetch sale items for current period (to compute Top Dishes and COGS)
      const saleIds = (currentSales || []).map(s => s.id);
      let saleItems: any[] = [];
      if (saleIds.length > 0) {
        const chunkSize = 300;
        for (let i = 0; i < saleIds.length; i += chunkSize) {
          const chunk = saleIds.slice(i, i + chunkSize);
          const { data: chunkItems, error: chunkErr } = await supabase
            .from('sale_items')
            .select('quantity, unit_price, subtotal, cost_price, menu_items(name, sku, category)')
            .in('sale_id', chunk);
          if (chunkErr) throw chunkErr;
          if (chunkItems) saleItems = [...saleItems, ...chunkItems];
        }
      }

      // 6. Fetch Expenses
      let expensesQuery = supabase
        .from('expenses')
        .select('amount, branch_id, expense_date')
        .eq('tenant_id', v_tenant_id)
        .gte('expense_date', startDate)
        .lte('expense_date', endDate);

      if (activeBranchId !== 'All') {
        const selected = branches.find(b => b.id === activeBranchId);
        const parentBranchId = selected?.parent_id || activeBranchId;
        expensesQuery = expensesQuery.eq('branch_id', parentBranchId);
      }
      const { data: expensesData, error: expensesErr } = await expensesQuery;
      if (expensesErr) throw expensesErr;

      // 7. Fetch Waste cost (Stock Adjustments)
      let adjustmentsQuery = supabase
        .from('stock_adjustments')
        .select('id, reason, sa_items:stock_adjustment_items(quantity_base_unit, inventory_items(cost_per_base_unit))')
        .eq('status', 'approved')
        .eq('tenant_id', v_tenant_id)
        .gte('created_at', currentStart)
        .lte('created_at', currentEnd);

      if (activeBranchId !== 'All') {
        const selected = branches.find(b => b.id === activeBranchId);
        const parentBranchId = selected?.parent_id || activeBranchId;
        adjustmentsQuery = adjustmentsQuery.eq('branch_id', parentBranchId);
      }
      const { data: adjustmentsData, error: adjustmentsErr } = await adjustmentsQuery;
      if (adjustmentsErr) throw adjustmentsErr;

      // 8. PERFORM AGGREGATIONS
      const netSales = (currentSales || []).reduce((acc, s) => acc + Number(s.total_amount), 0);
      const transactionCount = (currentSales || []).length;

      // COGS
      const totalCOGS = saleItems.reduce((acc, item) => acc + (Number(item.cost_price || 0) * Number(item.quantity)), 0);

      // Waste cost
      let totalWaste = 0;
      const wasteSummaryMap: Record<string, { reason: string; cost: number; events: number }> = {};
      (adjustmentsData || []).forEach(adj => {
        let adjCost = 0;
        (adj.sa_items || []).forEach((item: any) => {
          const cost = Math.abs(Number(item.quantity_base_unit || 0)) * Number(item.inventory_items?.cost_per_base_unit || 0);
          adjCost += cost;
        });
        totalWaste += adjCost;

        const reason = adj.reason || 'other';
        if (!wasteSummaryMap[reason]) {
          wasteSummaryMap[reason] = { reason, cost: 0, events: 0 };
        }
        wasteSummaryMap[reason].cost += adjCost;
        wasteSummaryMap[reason].events += 1;
      });

      // OPEX
      const totalOPEX = (expensesData || []).reduce((acc, exp) => acc + Number(exp.amount), 0);

      // Profits
      const grossProfit = netSales - totalCOGS - totalWaste;
      const netProfit = grossProfit - totalOPEX;

      // Sales by Category
      const categoriesMap: Record<string, { category: string; quantity_sold: number; revenue: number }> = {};
      saleItems.forEach(item => {
        const categoryName = item.menu_items?.category || 'Uncategorized';
        if (!categoriesMap[categoryName]) {
          categoriesMap[categoryName] = { category: categoryName, quantity_sold: 0, revenue: 0 };
        }
        categoriesMap[categoryName].quantity_sold += Number(item.quantity);
        categoriesMap[categoryName].revenue += Number(item.subtotal);
      });
      const salesByCategory = Object.values(categoriesMap);

      // Sales by Category / Type
      const salesByTypeMap: Record<string, { sale_type: string; order_count: number; revenue: number }> = {};
      (currentSales || []).forEach(s => {
        const type = s.sale_category || vocab.defaultSaleCategory || 'Walk-in';
        if (!salesByTypeMap[type]) {
          salesByTypeMap[type] = { sale_type: type, order_count: 0, revenue: 0 };
        }
        salesByTypeMap[type].order_count += 1;
        salesByTypeMap[type].revenue += Number(s.total_amount);
      });

      // Item Performance (Gross Sales)
      const productsMap: Record<string, { name: string; quantity_sold: number; revenue: number }> = {};
      saleItems.forEach(item => {
        const name = item.menu_items?.name || 'Unknown Item';
        if (!productsMap[name]) {
          productsMap[name] = { name, quantity_sold: 0, revenue: 0 };
        }
        productsMap[name].quantity_sold += Number(item.quantity);
        productsMap[name].revenue += Number(item.subtotal);
      });
      const topProducts = Object.values(productsMap).sort((a, b) => b.revenue - a.revenue);

      // Cash Flow / Sales trend graph
      const dateMap: Record<string, { date: string; revenue: number; expenses: number; net_cash_flow: number }> = {};
      let d = new Date(startDate);
      const endD = new Date(endDate);
      while (d <= endD) {
        const dStr = d.toISOString().split('T')[0];
        dateMap[dStr] = { date: dStr, revenue: 0, expenses: 0, net_cash_flow: 0 };
        d.setDate(d.getDate() + 1);
      }
      (currentSales || []).forEach(s => {
        const dateStr = new Date(s.created_at).toISOString().split('T')[0];
        if (dateMap[dateStr]) {
          dateMap[dateStr].revenue += Number(s.total_amount);
        }
      });
      (expensesData || []).forEach(exp => {
        const dateStr = exp.expense_date;
        if (dateMap[dateStr]) {
          dateMap[dateStr].expenses += Number(exp.amount);
        }
      });
      const cashFlowHistory = Object.values(dateMap).map(item => ({
        ...item,
        net_cash_flow: item.revenue - item.expenses
      }));

      // Store Performance Tracker
      const storePerformance: any[] = [];
      branches.forEach(store => {
        const storeSales = (currentSales || []).filter(s => 
          store.parent_id 
            ? s.sub_store_id === store.id 
            : (s.branch_id === store.id && !s.sub_store_id)
        );
        const currentTxCount = storeSales.length;
        const currentStoreSalesVal = storeSales.reduce((acc, s) => acc + Number(s.total_amount), 0);

        const storeLastSales = (lastSales || []).filter(s => 
          store.parent_id 
            ? s.sub_store_id === store.id 
            : (s.branch_id === store.id && !s.sub_store_id)
        );
        const lastTxCount = storeLastSales.length;

        let perfRating = 0;
        if (lastTxCount > 0) {
          perfRating = ((currentTxCount - lastTxCount) / lastTxCount) * 100;
        } else if (currentTxCount > 0) {
          perfRating = 100;
        }

        storePerformance.push({
          id: store.id,
          name: store.name,
          parent_id: store.parent_id,
          transactions: currentTxCount,
          sales: currentStoreSalesVal,
          lastMonthTransactions: lastTxCount,
          rating: perfRating
        });
      });

      setAnalyticsData({
        branchId: activeBranchId,
        revenue: netSales,
        orders: transactionCount,
        foodCost: totalCOGS,
        wasteCost: totalWaste,
        opexCost: totalOPEX,
        profitEstimate: netProfit,
        grossProfit: grossProfit,
        netProfit: netProfit,
        topProducts: topProducts,
        wasteSummary: Object.values(wasteSummaryMap),
        cashFlowHistory: cashFlowHistory,
        salesByCategory: salesByCategory,
        salesByType: Object.values(salesByTypeMap)
      });

      setStorePerformanceData(storePerformance);

    } catch (err) {
      console.error('Error fetching analytics client side:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (selectedBranch) {
      setActiveBranchId(selectedBranch.id);
    } else if (branches.length > 0) {
      setActiveBranchId('All');
    }
  }, [selectedBranch, branches]);

  useEffect(() => {
    if (dateRangeType === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(new Date().toISOString().split('T')[0]);
    } else if (dateRangeType === '30days') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(new Date().toISOString().split('T')[0]);
    }
  }, [dateRangeType]);

  useEffect(() => {
    if (activeBranchId || branches.length > 0) {
      loadAnalytics();
    }
  }, [activeBranchId, startDate, endDate, branches]);

  if (loading && !refreshing) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-muted-foreground flex items-center space-x-2 animate-pulse">
          <Clock className="w-5 h-5 animate-spin text-primary" />
          <span>{vocab.loadingLabel}</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);
  };

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];

  // 1. Waste Chart Data
  const wasteChartData = analyticsData?.wasteSummary.map(w => ({
    name: w.reason.replace('_', ' ').toUpperCase(),
    value: Number(w.cost)
  })) || [];

  // 2. Top Products Chart Data
  const topProductsChartData = analyticsData?.topProducts.map(p => ({
    name: p.name,
    Sales: p.quantity_sold,
    Revenue: Number(p.revenue)
  })) || [];

  // 3. Cash Flow Chart Data
  const cashFlowChartData = analyticsData?.cashFlowHistory.map(item => ({
    date: item.date,
    Revenue: Number(item.revenue),
    Expenses: Number(item.expenses),
    "Net Cash Flow": Number(item.net_cash_flow)
  })) || [];

  // 4. Category Chart Data
  const categoryChartData = analyticsData?.salesByCategory.map(c => ({
    name: c.category,
    Revenue: Number(c.revenue),
    Qty: c.quantity_sold
  })) || [];

  // 5. Sale Type Chart Data
  const saleTypeChartData = analyticsData?.salesByType.map(st => ({
    name: st.sale_type,
    value: Number(st.revenue),
    orders: st.order_count
  })) || [];

  // Configurations for Chart Containers
  const topProductsConfig = {
    Sales: { label: "Sales (Qty)", color: "hsl(var(--primary))" },
    Revenue: { label: "Revenue (₱)", color: "#10b981" }
  };

  const wasteConfig = {
    value: { label: "Cost (₱)" }
  };

  const cashFlowConfig = {
    Revenue: { label: "Revenue (₱)", color: "#10b981" },
    Expenses: { label: "Total Expenses (₱)", color: "#ef4444" },
    "Net Cash Flow": { label: "Net Cash Flow (₱)", color: "#6366f1" }
  };

  const categoryConfig = {
    Revenue: { label: "Sales Revenue (₱)", color: "hsl(var(--primary))" }
  };

  const saleTypeConfig = {
    value: { label: "Revenue (₱)" }
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <BarChart3 className="w-8 h-8 text-primary" />
            <span>Store Performance Analytics</span>
          </h2>
          <p className="text-muted-foreground mt-1">
            {activeBranchId === 'All' ? 'Consolidated performance overview across all stores, outlets, and brands.' : vocab.analyticsDescription}
          </p>
        </div>

        {/* Date Filter & Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <Popover open={isStorePopoverOpen} onOpenChange={setIsStorePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-between text-left font-normal h-9 text-xs bg-background">
                <span className="truncate">
                  {activeBranchId === 'All' ? 'All Stores / Brands' : (branches.find(b => b.id === activeBranchId)?.name || 'Select Store')}
                </span>
                <span className="text-muted-foreground ml-1">▼</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-2 bg-background border border-border/80 rounded-lg shadow-lg">
              <Input
                placeholder="Type to search store..."
                value={storeSearchTerm}
                onChange={(e) => setStoreSearchTerm(e.target.value)}
                className="h-8 text-xs mb-2"
                autoFocus
              />
              <div className="max-h-[250px] overflow-y-auto space-y-1">
                <button
                  onClick={() => {
                    setActiveBranchId('All');
                    setIsStorePopoverOpen(false);
                    setStoreSearchTerm('');
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors hover:bg-accent ${activeBranchId === 'All' ? 'bg-accent font-semibold' : ''}`}
                >
                  All Stores / Brands
                </button>
                {getOrganizedBranches(branches)
                  .filter(b => b.name.toLowerCase().includes(storeSearchTerm.toLowerCase()))
                  .map(b => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setActiveBranchId(b.id);
                        setIsStorePopoverOpen(false);
                        setStoreSearchTerm('');
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors hover:bg-accent flex items-center ${activeBranchId === b.id ? 'bg-accent font-semibold' : ''}`}
                    >
                      {b.parent_id ? (
                        <span className="text-muted-foreground pl-3 truncate">└─ {b.name}</span>
                      ) : (
                        <span className="truncate font-semibold">{b.name}</span>
                      )}
                    </button>
                  ))}
              </div>
            </PopoverContent>
          </Popover>
          
          <Select value={dateRangeType} onValueChange={(val: any) => setDateRangeType(val)}>
            <SelectTrigger className="w-[130px] h-9 text-xs bg-background">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7days" className="text-xs">Last 7 Days</SelectItem>
              <SelectItem value="30days" className="text-xs">Last 30 Days</SelectItem>
              <SelectItem value="custom" className="text-xs">Custom Date</SelectItem>
            </SelectContent>
          </Select>
          
          {dateRangeType === 'custom' && (
            <div className="flex items-center space-x-2 bg-muted/50 border rounded-md p-1 h-9">
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-7 text-xs border-0 bg-transparent shadow-none"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-7 text-xs border-0 bg-transparent shadow-none"
              />
            </div>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={loadAnalytics}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Metrics Grid */}
      {analyticsData && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <Card className="glass-dark border-border/50">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Net Sales</span>
              <span className="text-2xl font-bold block mt-1">{formatCurrency(analyticsData.revenue)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">Transaction value</span>
            </CardContent>
          </Card>
          
          <Card className="glass-dark border-border/50">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Transactions</span>
              <span className="text-2xl font-bold block mt-1">{analyticsData.orders}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">Completed orders</span>
            </CardContent>
          </Card>
          
          <Card className="glass-dark border-border/50">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">{vocab.cogsLabel}</span>
              <span className="text-2xl font-bold text-primary block mt-1">{formatCurrency(analyticsData.foodCost)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">
                {analyticsData.revenue > 0
                  ? vocab.cogsRatioNote(((analyticsData.foodCost / analyticsData.revenue) * 100).toFixed(0))
                  : vocab.cogsRatioNote('0')}
              </span>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">OPEX (Expenses)</span>
              <span className="text-2xl font-bold text-red-500 block mt-1">{formatCurrency(analyticsData.opexCost)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">
                {analyticsData.revenue > 0
                  ? `${((analyticsData.opexCost / analyticsData.revenue) * 100).toFixed(0)}% OPEX Ratio`
                  : '0% OPEX Ratio'}
              </span>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Gross Profit</span>
              <span className="text-2xl font-bold text-indigo-400 block mt-1">
                {formatCurrency(analyticsData.grossProfit)}
              </span>
              <span className="text-[10px] text-muted-foreground block mt-1">Sales - COGS - Waste</span>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardContent className="p-4">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Net Profit</span>
              <span className={`text-2xl font-bold block mt-1 ${analyticsData.netProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {formatCurrency(analyticsData.netProfit)}
              </span>
              <span className="text-[10px] text-muted-foreground block mt-1">Gross Profit - OPEX</span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Store Performance Tracker (Only visible when "All Stores" is filtered) */}
      {activeBranchId === 'All' && storePerformanceData.length > 0 && (
        <Card className="glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Store Performance Tracker</CardTitle>
            <CardDescription className="text-xs">Compare monthly transaction counts and performance growth ratios relative to last month.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-muted-foreground">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/20">
                  <tr>
                    <th className="px-6 py-3 rounded-l-lg">Store / Brand</th>
                    <th className="px-6 py-3 text-center">Transactions (This Period)</th>
                    <th className="px-6 py-3 text-center">Transactions (Last Month)</th>
                    <th className="px-6 py-3 text-right rounded-r-lg">Growth / Performance Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {storePerformanceData.map((store) => {
                    const isPositive = store.rating >= 0;
                    return (
                      <tr key={store.id} className="border-b border-border/20 hover:bg-muted/5">
                        <td className="px-6 py-4 font-semibold text-foreground">
                          <div className="flex flex-col">
                            <span>{store.name}</span>
                            {store.parent_id && (
                              <span className="text-[10px] text-muted-foreground/75">
                                Sub-store of {branches.find(b => b.id === store.parent_id)?.name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center text-foreground font-medium">{store.transactions}</td>
                        <td className="px-6 py-4 text-center">{store.lastMonthTransactions}</td>
                        <td className={`px-6 py-4 text-right font-bold ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
                          <span>{isPositive ? '▲ +' : '▼ '}{store.rating.toFixed(1)}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Net Sales Graph */}
      <Card className="glass-dark border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Net Sales Revenue Graph</CardTitle>
          <CardDescription className="text-xs">
            Daily net sales transaction revenue trend for the selected date range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            {analyticsData && analyticsData.cashFlowHistory.length > 0 ? (
              <ChartContainer config={topProductsConfig} className="h-full w-full min-h-[300px]">
                <AreaChart data={analyticsData.cashFlowHistory} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorNetSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="revenue" name="Net Sales" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorNetSales)" />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                No transaction data available for this range.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rankings & Top Performers Card */}
      <Card className="glass-dark border-border/50">
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-2 sm:space-y-0">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Rankings & Highlights</CardTitle>
            <CardDescription className="text-xs">Rank top performing stores or dishes based on gross sales revenue.</CardDescription>
          </div>
          <Select value={rankFilter} onValueChange={(val: 'store' | 'dish') => setRankFilter(val)}>
            <SelectTrigger className="w-[220px] text-xs h-8">
              <SelectValue placeholder="Ranking Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="store" className="text-xs">Top Performing Stores</SelectItem>
              <SelectItem value="dish" className="text-xs">Top Performing Dishes</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {rankFilter === 'store' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-muted-foreground">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/20">
                  <tr>
                    <th className="px-6 py-3 rounded-l-lg">Rank</th>
                    <th className="px-6 py-3">Store Name</th>
                    <th className="px-6 py-3 text-center">Transactions</th>
                    <th className="px-6 py-3 text-right rounded-r-lg">Gross Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {storePerformanceData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-xs">No store data loaded.</td>
                    </tr>
                  ) : (
                    [...storePerformanceData]
                      .sort((a, b) => b.sales - a.sales)
                      .map((store, index) => (
                        <tr key={store.id} className="border-b border-border/20 hover:bg-muted/5">
                          <td className="px-6 py-4 font-bold text-foreground">#{index + 1}</td>
                          <td className="px-6 py-4 font-semibold text-foreground flex items-center space-x-2">
                            <span>{store.name}</span>
                            {store.parent_id && (
                              <span className="text-[10px] font-semibold text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/15">Sub-store</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">{store.transactions}</td>
                          <td className="px-6 py-4 text-right font-black text-emerald-500">{formatCurrency(store.sales)}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-muted-foreground">
                <thead className="text-xs text-muted-foreground uppercase bg-muted/20">
                  <tr>
                    <th className="px-6 py-3 rounded-l-lg">Rank</th>
                    <th className="px-6 py-3">Dish / Item Name</th>
                    <th className="px-6 py-3 text-center">Quantity Sold</th>
                    <th className="px-6 py-3 text-right rounded-r-lg">Gross Sales</th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsData && analyticsData.topProducts.length > 0 ? (
                    analyticsData.topProducts.map((dish, index) => (
                      <tr key={dish.name} className="border-b border-border/20 hover:bg-muted/5">
                        <td className="px-6 py-4 font-bold text-foreground">#{index + 1}</td>
                        <td className="px-6 py-4 font-semibold text-foreground">{dish.name}</td>
                        <td className="px-6 py-4 text-center">{dish.quantity_sold}</td>
                        <td className="px-6 py-4 text-right font-black text-emerald-500">{formatCurrency(dish.revenue)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-xs">No dish transactions loaded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Cash Flow Overview Section ── */}
      <Card className="glass-dark border-border/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Cash Flow Overview</CardTitle>
          <CardDescription className="text-xs">
            Visual comparison of daily incoming revenue against operational costs (COGS + Waste + OPEX) and the resulting net cash flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            {cashFlowChartData.length > 0 ? (
              <ChartContainer config={cashFlowConfig} className="h-full w-full min-h-[300px]">
                <AreaChart data={cashFlowChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area type="monotone" dataKey="Revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRevenue)" />
                  <Area type="monotone" dataKey="Expenses" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpenses)" />
                  <Area type="monotone" dataKey="Net Cash Flow" stroke="#6366f1" fillOpacity={0} />
                </AreaChart>
              </ChartContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
              No financial transactions logged in this date range.
            </div>
          )}
          </div>
        </CardContent>
      </Card>

      {/* ── Products & Wastage Section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Top Selling Products */}
        <Card className="lg:col-span-2 glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">{vocab.topSellingLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              {topProductsChartData.length > 0 ? (
                <ChartContainer config={topProductsConfig} className="h-full w-full min-h-[300px]">
                  <BarChart data={topProductsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="Sales" fill="var(--color-Sales)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Revenue" fill="var(--color-Revenue)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                  No {vocab.itemUnitPlural} sold in this date range.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Wastage breakdown */}
        <Card className="glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">{vocab.wastageChartLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80 flex flex-col justify-between">
              {wasteChartData.length > 0 ? (
                <>
                  <div className="h-60">
                    <ChartContainer config={wasteConfig} className="h-full w-full min-h-[240px]">
                      <PieChart>
                        <Pie
                          data={wasteChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {wasteChartData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ChartContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {wasteChartData.map((entry, index) => (
                      <div key={index} className="flex items-center space-x-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                        <span className="text-muted-foreground font-semibold truncate" title={entry.name}>{entry.name}</span>
                        <span className="font-bold">₱{entry.value.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                  {vocab.noWasteNote}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Segmentations Section (Sales Per Category & Sale Type) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sales Per Category */}
        <Card className="glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Sales Per Category</CardTitle>
            <CardDescription className="text-xs">Product sales revenue distribution across menu item categories.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              {categoryChartData.length > 0 ? (
                <ChartContainer config={categoryConfig} className="h-full w-full min-h-[300px]">
                  <BarChart data={categoryChartData} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={80} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="Revenue" fill="var(--color-Revenue)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                  No sales logged in this date range.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sale Type (Sale Category) */}
        <Card className="glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Sale Type Distribution</CardTitle>
            <CardDescription className="text-xs">Revenue breakdowns by ordering method (Dine in, Take out, Delivery, etc.).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80 flex flex-col justify-between">
              {saleTypeChartData.length > 0 ? (
                <>
                  <div className="h-60">
                    <ChartContainer config={saleTypeConfig} className="h-full w-full min-h-[240px]">
                      <PieChart>
                        <Pie
                          data={saleTypeChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          paddingAngle={4}
                          dataKey="value"
                        >
                          {saleTypeChartData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                          ))}
                        </Pie>
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </PieChart>
                    </ChartContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {saleTypeChartData.map((entry, index) => (
                      <div key={index} className="flex items-center space-x-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[(index + 2) % COLORS.length] }} />
                        <span className="text-muted-foreground font-semibold truncate capitalize">{entry.name}</span>
                        <span className="text-muted-foreground">({entry.orders} orders)</span>
                        <span className="font-bold ml-auto">{formatCurrency(entry.value)}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                  No sales logged in this date range.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
