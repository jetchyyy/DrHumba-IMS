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
  
  const [activeBranchId, setActiveBranchId] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); // Last 30 days
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  
  const [analyticsData, setAnalyticsData] = useState<BranchAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAnalytics = async () => {
    if (!activeBranchId) return;

    setRefreshing(true);
    try {
      const { data, error } = await supabase.rpc('get_branch_analytics', {
        p_branch_id: activeBranchId,
        p_start_date: `${startDate}T00:00:00+00:00`,
        p_end_date: `${endDate}T23:59:59+00:00`
      });

      if (error) {
        console.error('RPC error details:', error);
        throw error;
      }
      setAnalyticsData(data);
    } catch (err) {
      console.error('Error fetching branch analytics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (selectedBranch) {
      setActiveBranchId(selectedBranch.id);
    } else if (branches.length > 0) {
      setActiveBranchId(branches[0].id);
    }
  }, [selectedBranch, branches]);

  useEffect(() => {
    if (activeBranchId) {
      loadAnalytics();
    }
  }, [activeBranchId, startDate, endDate]);

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
            <span>Branch Performance Analytics</span>
          </h2>
          <p className="text-muted-foreground mt-1">{vocab.analyticsDescription}</p>
        </div>

        {/* Date Filter & Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={activeBranchId} onValueChange={setActiveBranchId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
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
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Total Sales</span>
              <span className="text-2xl font-bold block mt-1">{formatCurrency(analyticsData.revenue)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">{analyticsData.orders} {vocab.ordersUnit} processed</span>
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
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">{vocab.wasteLabel}</span>
              <span className="text-2xl font-bold text-amber-500 block mt-1">{formatCurrency(analyticsData.wasteCost)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">{vocab.wasteNote}</span>
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
