import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { History, Search, RefreshCw, ChevronDown, ChevronUp, Calendar, ShoppingBag, DollarSign, Eye, TrendingUp } from 'lucide-react';

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
  branch_id: string;
  cashier_id: string;
  total_amount: number;
  status: 'completed' | 'refunded';
  created_at: string;
  branch_name: string;
  cashier_email: string;
  items: SaleItem[];
}

export const SalesHistory: React.FC = () => {
  const { profile, branches } = useAuth();
  
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('All');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // UI States
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  const isAdminRole = ['super_admin', 'inventory_manager', 'auditor'].includes(profile?.role_name || '');

  const loadSalesData = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      // 1. Fetch sales list with branch details and menu items
      let query = supabase
        .from('sales')
        .select(`
          id,
          branch_id,
          cashier_id,
          total_amount,
          status,
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

      // If they are not admin, enforce branch filter at the application level too
      if (!isAdminRole && profile.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      }

      const { data: salesData, error: salesError } = await query.order('created_at', { ascending: false });
      if (salesError) throw salesError;

      // 2. Fetch profiles to map Cashier UUID to emails
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email');
      if (profilesError) throw profilesError;

      // 3. Map database objects to our clean local model structure
      const mappedSales: SaleRecord[] = (salesData || []).map((sale: any) => {
        const cashierProfile = (profilesData || []).find(p => p.id === sale.cashier_id);
        
        return {
          id: sale.id,
          branch_id: sale.branch_id,
          cashier_id: sale.cashier_id,
          total_amount: Number(sale.total_amount),
          status: sale.status,
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
    // Default selected branch filter
    if (!isAdminRole && profile?.branch_id) {
      setSelectedBranchId(profile.branch_id);
    } else {
      setSelectedBranchId('All');
    }
  }, [profile]);

  const toggleExpand = (id: string) => {
    setExpandedSaleId(expandedSaleId === id ? null : id);
  };

  const formatPHP = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  // Perform sales filtering reactively in frontend
  const filteredSales = sales.filter(sale => {
    // 1. Search term match (Invoice ID or Cashier Email)
    const matchesSearch = 
      sale.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sale.cashier_email.toLowerCase().includes(searchTerm.toLowerCase());

    // 2. Branch selector match
    const matchesBranch = selectedBranchId === 'All' || sale.branch_id === selectedBranchId;

    // 3. Date range match
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

  // Calculate summary statistics reactively based on filtered items
  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalTransactions = filteredSales.length;
  const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <History className="w-6 h-6 text-indigo-500" />
            <span>Sales History Log</span>
          </h2>
          <p className="text-sm text-slate-400">
            {isAdminRole 
              ? 'Consolidated sales, cashier registers, and ingredient deductions across all corporate branches.'
              : `Sales transaction log for your assigned location context.`
            }
          </p>
        </div>

        <button
          onClick={loadSalesData}
          disabled={loading}
          className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Total Sales Revenue</span>
            <span className="text-2xl font-bold text-emerald-400">{formatPHP(totalRevenue)}</span>
          </div>
        </div>

        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Transactions Logged</span>
            <span className="text-2xl font-bold text-white">{totalTransactions} Orders</span>
          </div>
        </div>

        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-amber-500/10 rounded-lg text-amber-400 border border-amber-500/20">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Average Ticket Size</span>
            <span className="text-2xl font-bold text-amber-500">{formatPHP(avgOrderValue)}</span>
          </div>
        </div>
      </div>

      {/* Filter and Query Bars */}
      <div className="space-y-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          
          {/* Left search */}
          <div className="relative w-full lg:w-96">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Invoice UUID or cashier email..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all placeholder-slate-500"
            />
          </div>

          {/* Filters (Date presets + Branch selector) */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-start lg:justify-end">
            
            {/* Branch Filter Selector (Admins Only) */}
            {isAdminRole ? (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-400 font-medium">Branch:</span>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-indigo-500 min-w-[140px] cursor-pointer"
                >
                  <option value="All">All Branches</option>
                  {branches.map(br => (
                    <option key={br.id} value={br.id}>{br.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              profile?.branch_id && (
                <div className="text-xs text-slate-400 bg-slate-900/60 border border-slate-800 px-3 py-2 rounded-lg font-medium">
                  Branch Locked: <span className="text-white font-bold">{sales[0]?.branch_name || 'My Branch'}</span>
                </div>
              )
            )}

            {/* Date Preset Selector */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400 font-medium">Date Scope:</span>
              <select
                value={dateFilter}
                onChange={(e: any) => setDateFilter(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="week">Last 7 Days</option>
                <option value="month">Last 30 Days</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
          </div>
        </div>

        {/* Custom Date Range Panel */}
        {dateFilter === 'custom' && (
          <div className="glass p-4 rounded-xl border border-slate-800/80 bg-slate-900/20 flex flex-col sm:flex-row items-center gap-4 text-xs">
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">Start Date:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500 w-full sm:w-auto"
              />
            </div>
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <Calendar className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-slate-400">End Date:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white focus:outline-none focus:border-indigo-500 w-full sm:w-auto"
              />
            </div>
            {(startDate || endDate) && (
              <button
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                }}
                className="text-[10px] text-red-400 hover:text-red-300 font-semibold px-2 py-1 bg-slate-900 border border-red-500/10 rounded transition-all sm:ml-auto"
              >
                Clear Custom Range
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Transactions List */}
      <div className="glass rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-500" />
            <p className="text-xs">Fetching sales transaction ledger...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-4 pl-6 w-10"></th>
                  <th className="p-4">Timestamp</th>
                  <th className="p-4">Invoice ID / UUID</th>
                  <th className="p-4">Branch</th>
                  <th className="p-4">Cashier Register</th>
                  <th className="p-4 text-right">Revenue Value</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right pr-6">Items Break</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {filteredSales.map(sale => {
                  const isExpanded = expandedSaleId === sale.id;
                  const dateStr = new Date(sale.created_at).toLocaleString();
                  return (
                    <React.Fragment key={sale.id}>
                      <tr 
                        onClick={() => toggleExpand(sale.id)}
                        className="hover:bg-slate-900/10 text-slate-300 cursor-pointer transition-all"
                      >
                        <td className="p-4 pl-6 text-center text-slate-500">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </td>
                        <td className="p-4 font-medium text-slate-400">{dateStr}</td>
                        <td className="p-4 font-mono text-[10px] text-slate-500 font-semibold">{sale.id}</td>
                        <td className="p-4 font-bold text-slate-200">{sale.branch_name}</td>
                        <td className="p-4 text-slate-400 font-mono">{sale.cashier_email}</td>
                        <td className="p-4 text-right font-black text-emerald-400">
                          {formatPHP(sale.total_amount)}
                        </td>
                        <td className="p-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                            sale.status === 'completed' 
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}>
                            {sale.status}
                          </span>
                        </td>
                        <td className="p-4 text-right pr-6">
                          <button
                            type="button"
                            className="inline-flex items-center space-x-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold py-1 px-2.5 bg-slate-900 border border-slate-800/80 rounded hover:bg-slate-800 transition-all"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Receipt</span>
                          </button>
                        </td>
                      </tr>

                      {/* Expanded Order Breakdown Detail */}
                      {isExpanded && (
                        <tr className="bg-slate-950/45">
                          <td colSpan={8} className="p-6 pl-12 pr-6 border-l-2 border-indigo-500">
                            <div className="space-y-4">
                              <div className="flex items-center justify-between border-b border-slate-800/50 pb-2">
                                <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                                  Invoice Detail Receipt Breakdown
                                </h4>
                                <span className="text-[10px] text-slate-500 font-mono">
                                  UUID: {sale.id}
                                </span>
                              </div>

                              <div className="glass rounded-lg border border-slate-800/80 overflow-hidden bg-slate-900/20">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-slate-900/60 border-b border-slate-800/60 text-slate-400 font-semibold text-[10px]">
                                      <th className="p-3 pl-4">Dish / Menu Item</th>
                                      <th className="p-3">SKU</th>
                                      <th className="p-3 text-right">Unit Price</th>
                                      <th className="p-3 text-center">Quantity</th>
                                      <th className="p-3 text-right pr-4">Subtotal</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/30">
                                    {sale.items.map((item) => (
                                      <tr key={item.id} className="text-slate-300 hover:bg-slate-900/5">
                                        <td className="p-3 pl-4 font-bold text-slate-200">{item.item_name}</td>
                                        <td className="p-3 font-mono text-[10px] text-slate-500">{item.sku}</td>
                                        <td className="p-3 text-right font-medium text-slate-400">{formatPHP(item.unit_price)}</td>
                                        <td className="p-3 text-center font-bold text-slate-200">{item.quantity}</td>
                                        <td className="p-3 text-right font-bold text-slate-100 pr-4">{formatPHP(item.subtotal)}</td>
                                      </tr>
                                    ))}
                                    <tr className="bg-slate-900/30 font-bold text-slate-200">
                                      <td colSpan={4} className="p-3 pl-4 text-right">Invoice Total:</td>
                                      <td className="p-3 text-right text-emerald-400 pr-4 text-sm font-black">
                                        {formatPHP(sale.total_amount)}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center p-12 text-slate-500 font-medium">
                      No sales history transactions found matching filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
