import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { BarChartIcon as BarChart3, ActivityLogIcon as TrendingUp, ReloadIcon as RefreshCw, ClockIcon as Clock } from '@radix-ui/react-icons';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Input } from './ui/input';
import { Button } from './ui/button';

interface BranchAnalyticsData {
  branchId: string;
  revenue: number;
  orders: number;
  foodCost: number;
  wasteCost: number;
  profitEstimate: number;
  topProducts: { name: string; quantity_sold: number; revenue: number }[];
  wasteSummary: { reason: string; cost: number; events: number }[];
}

export const Analytics: React.FC = () => {
  const { branches, selectedBranch } = useAuth();
  
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
          <span>Loading restaurant analytics...</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);
  };

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const wasteChartData = analyticsData?.wasteSummary.map(w => ({
    name: w.reason.replace('_', ' ').toUpperCase(),
    value: Number(w.cost)
  })) || [];

  const topProductsChartData = analyticsData?.topProducts.map(p => ({
    name: p.name,
    Sales: p.quantity_sold,
    Revenue: Number(p.revenue)
  })) || [];

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <BarChart3 className="w-8 h-8 text-primary" />
            <span>Branch Performance Analytics</span>
          </h2>
          <p className="text-muted-foreground mt-1">Track and compare sales, food cost ratios, and wastage across branches.</p>
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

      {/* Metrics Row */}
      {analyticsData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 mb-8">
          <Card className="glass-dark border-border/50">
            <CardContent className="p-5">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Total Sales</span>
              <span className="text-2xl font-bold block mt-1">{formatCurrency(analyticsData.revenue)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">{analyticsData.orders} orders processed</span>
            </CardContent>
          </Card>
          
          <Card className="glass-dark border-border/50">
            <CardContent className="p-5">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Food Cost (COGS)</span>
              <span className="text-2xl font-bold text-primary block mt-1">{formatCurrency(analyticsData.foodCost)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">
                {analyticsData.revenue > 0 
                  ? `${((analyticsData.foodCost / analyticsData.revenue) * 100).toFixed(1)}% of revenue`
                  : '0% food ratio'}
              </span>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardContent className="p-5">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Waste & Spoilage</span>
              <span className="text-2xl font-bold text-amber-500 block mt-1">{formatCurrency(analyticsData.wasteCost)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">From damages & spoilage logs</span>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardContent className="p-5">
              <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Profit Estimate</span>
              <span className="text-2xl font-bold text-emerald-500 block mt-1">{formatCurrency(analyticsData.profitEstimate)}</span>
              <span className="text-[10px] text-muted-foreground block mt-1">Est. Revenue - COGS - Wastage</span>
            </CardContent>
          </Card>

          <Card className="glass-dark border-border/50">
            <CardContent className="p-5 flex items-center justify-between h-full">
              <div>
                <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Food Cost Ratio</span>
                <span className="text-3xl font-black text-primary block mt-1">
                  {analyticsData.revenue > 0 
                    ? `${((analyticsData.foodCost / analyticsData.revenue) * 100).toFixed(0)}%`
                    : '0%'}
                </span>
              </div>
              <TrendingUp className="w-10 h-10 text-primary/20" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Visual Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Top Selling Products */}
        <Card className="lg:col-span-2 glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Top Selling Dishes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              {topProductsChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 'bold' }}
                    />
                    <Legend verticalAlign="top" height={36} iconType="circle" />
                    <Bar dataKey="Sales" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                  No product sales logged in this date range.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Wastage breakdown */}
        <Card className="glass-dark border-border/50">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Wastage Breakdown (₱)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80 flex flex-col justify-between">
              {wasteChartData.length > 0 ? (
                <>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
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
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
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
                  No spoilage/damage adjustments recorded.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
