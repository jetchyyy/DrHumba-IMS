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
import { BarChart3, TrendingUp, RefreshCw, Clock } from 'lucide-react';

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
        p_start_date: new Date(startDate).toISOString(),
        p_end_date: new Date(endDate + 'T23:59:59').toISOString()
      });

      if (error) throw error;
      setAnalyticsData(data);
    } catch (err) {
      console.error('Error fetching branch analytics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Set default branch context
  useEffect(() => {
    if (selectedBranch) {
      setActiveBranchId(selectedBranch.id);
    } else if (branches.length > 0) {
      setActiveBranchId(branches[0].id);
    }
  }, [selectedBranch, branches]);

  // Reload when date range or branch changes
  useEffect(() => {
    if (activeBranchId) {
      loadAnalytics();
    }
  }, [activeBranchId, startDate, endDate]);

  if (loading && !refreshing) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-950">
        <div className="text-slate-400 flex items-center space-x-2 animate-pulse">
          <Clock className="w-5 h-5 animate-spin text-indigo-500" />
          <span>Loading restaurant analytics...</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);
  };

  // COLORS for charts
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
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <BarChart3 className="w-6 h-6 text-indigo-500" />
            <span>Branch Performance Analytics</span>
          </h2>
          <p className="text-sm text-slate-400">Track and compare sales, food cost ratios, and wastage across branches.</p>
        </div>

        {/* Date Filter & Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <select
              value={activeBranchId}
              onChange={(e) => {
                setActiveBranchId(e.target.value);
              }}
              className="bg-slate-900 border border-slate-800 text-xs text-white rounded px-2.5 py-1.5 focus:outline-none"
            >
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 p-1 rounded-lg">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-xs text-white border-0 focus:ring-0 p-1"
            />
            <span className="text-slate-600 text-xs">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-xs text-white border-0 focus:ring-0 p-1"
            />
          </div>
          <button
            onClick={loadAnalytics}
            disabled={refreshing}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      {analyticsData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 mb-8">
          <div className="glass p-5 rounded-xl border-slate-800">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Total Sales</span>
            <span className="text-xl font-bold text-white block mt-1">{formatCurrency(analyticsData.revenue)}</span>
            <span className="text-[10px] text-slate-400 block mt-1">{analyticsData.orders} orders processed</span>
          </div>
          
          <div className="glass p-5 rounded-xl border-slate-800">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Food Cost (COGS)</span>
            <span className="text-xl font-bold text-indigo-400 block mt-1">{formatCurrency(analyticsData.foodCost)}</span>
            <span className="text-[10px] text-slate-400 block mt-1">
              {analyticsData.revenue > 0 
                ? `${((analyticsData.foodCost / analyticsData.revenue) * 100).toFixed(1)}% of revenue`
                : '0% food ratio'}
            </span>
          </div>

          <div className="glass p-5 rounded-xl border-slate-800">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Waste & Spoilage</span>
            <span className="text-xl font-bold text-amber-500 block mt-1">{formatCurrency(analyticsData.wasteCost)}</span>
            <span className="text-[10px] text-slate-400 block mt-1">From damages & spoilage logs</span>
          </div>

          <div className="glass p-5 rounded-xl border-slate-800">
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Profit Estimate</span>
            <span className="text-xl font-bold text-emerald-400 block mt-1">{formatCurrency(analyticsData.profitEstimate)}</span>
            <span className="text-[10px] text-slate-400 block mt-1">Est. Revenue - COGS - Wastage</span>
          </div>

          <div className="glass p-5 rounded-xl border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block">Food Cost Ratio</span>
              <span className="text-2xl font-black text-indigo-500 block mt-1">
                {analyticsData.revenue > 0 
                  ? `${((analyticsData.foodCost / analyticsData.revenue) * 100).toFixed(0)}%`
                  : '0%'}
              </span>
            </div>
            <TrendingUp className="w-8 h-8 text-indigo-500/20" />
          </div>
        </div>
      )}

      {/* Visual Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Top Selling Products */}
        <div className="lg:col-span-2 glass p-6 rounded-xl">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-6">Top Selling Dishes</h4>
          <div className="h-80">
            {topProductsChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProductsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                    labelStyle={{ color: '#fff', fontWeight: 'bold' }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="circle" />
                  <Bar dataKey="Sales" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                No product sales logged in this date range.
              </div>
            )}
          </div>
        </div>

        {/* Wastage breakdown */}
        <div className="glass p-6 rounded-xl">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-6">Wastage Breakdown (₱)</h4>
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
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '8px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  {wasteChartData.map((entry, index) => (
                    <div key={index} className="flex items-center space-x-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                      <span className="text-slate-400 font-semibold truncate">{entry.name}</span>
                      <span className="text-slate-200 font-bold">₱{entry.value.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                No spoilage/damage adjustments recorded.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
