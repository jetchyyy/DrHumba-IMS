import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  DollarSign,
  Layers,
  Store,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Clock
} from 'lucide-react';

interface DashboardStats {
  totalInventoryValue: number;
  totalSales: number;
  totalBranches: number;
  lowStockCount: number;
  pendingTransfersCount: number;
  todayRevenue: number;
}

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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryGrid, setInventoryGrid] = useState<ItemStockGrid[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    setRefreshing(true);
    try {
      // 1. Fetch dashboard stats from SQL function
      const { data: statsData, error: statsError } = await supabase.rpc('get_overall_dashboard_stats');
      if (statsError) throw statsError;
      setStats(statsData);

      // 2. Fetch inventory catalog items
      const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .order('item_name');
      if (itemsError) throw itemsError;

      // 3. Fetch all current balances
      const { data: balances, error: balancesError } = await supabase
        .from('inventory_balances')
        .select('*');
      if (balancesError) throw balancesError;

      // 4. Fetch active low stock alerts RPC
      const { data: alerts, error: alertsError } = await supabase.rpc('get_inventory_alerts');
      if (alertsError) throw alertsError;
      setLowStockItems(alerts || []);

      // Build grid map: item_id -> { branch_id -> quantity }
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
    }
  };

  useEffect(() => {
    loadData();
  }, [branches]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-slate-950">
        <div className="text-slate-400 flex items-center space-x-2 animate-pulse">
          <Clock className="w-5 h-5 animate-spin text-indigo-500" />
          <span>Loading restaurant metrics...</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);
  };

  const getAlertStatusClass = (qty: number, reorder: number) => {
    if (qty === 0) return 'text-red-500 bg-red-500/10 border border-red-500/20 font-bold';
    if (qty < reorder) return 'text-amber-500 bg-amber-500/10 border border-amber-500/20 font-semibold';
    return 'text-slate-400';
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Overview Dashboard</h2>
          <p className="text-sm text-slate-400">Real-time status across all warehouses and restaurant branches.</p>
        </div>
        <button
          onClick={loadData}
          disabled={refreshing}
          className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Total Inventory Value */}
        <div className="glass p-5 rounded-xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Inventory Value</p>
            <h3 className="text-2xl font-bold text-slate-100 mt-1">
              {formatCurrency(stats?.totalInventoryValue || 0)}
            </h3>
          </div>
        </div>

        {/* Today's Sales */}
        <div className="glass p-5 rounded-xl flex items-center space-x-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-400">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Today's Sales</p>
            <h3 className="text-2xl font-bold text-slate-100 mt-1">
              {formatCurrency(stats?.todayRevenue || 0)}
            </h3>
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div 
          onClick={() => setActiveTab('notifications')}
          className="glass p-5 rounded-xl flex items-center space-x-4 cursor-pointer hover:border-amber-500/30 hover:bg-slate-905 transition-all group"
        >
          <div className="w-12 h-12 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider group-hover:text-amber-400 transition-all">Low Stock Alerts</p>
            <h3 className="text-2xl font-bold text-slate-100 mt-1 flex items-center justify-between">
              <span>{stats?.lowStockCount || 0} items</span>
              <ArrowRight className="w-4 h-4 text-slate-600 group-hover:translate-x-1 transition-transform" />
            </h3>
          </div>
        </div>

        {/* Pending Transfers */}
        <div 
          onClick={() => setActiveTab('transfers')}
          className="glass p-5 rounded-xl flex items-center space-x-4 cursor-pointer hover:border-indigo-500/30 hover:bg-slate-905 transition-all group"
        >
          <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400">
            <Store className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider group-hover:text-indigo-400 transition-all">Pending Transfers</p>
            <h3 className="text-2xl font-bold text-slate-100 mt-1 flex items-center justify-between">
              <span>{stats?.pendingTransfersCount || 0} reqs</span>
              <ArrowRight className="w-4 h-4 text-slate-600 group-hover:translate-x-1 transition-transform" />
            </h3>
          </div>
        </div>
      </div>

      {/* Critical Stock Alerts List */}
      {lowStockItems.length > 0 && (
        <div className="glass p-6 rounded-xl border-amber-500/20 bg-amber-500/[0.02] mb-8">
          <div className="flex items-center space-x-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h4 className="text-sm font-bold text-amber-400 uppercase tracking-wider">Critical Reorder Alerts</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lowStockItems.slice(0, 6).map((alert, i) => (
              <div key={i} className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-lg flex items-center justify-between">
                <div>
                  <h5 className="text-xs font-bold text-slate-200">{alert.item_name}</h5>
                  <p className="text-[10px] text-slate-500 mt-0.5">{alert.branch_name}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-amber-500">{Number(alert.current_quantity).toLocaleString()}{alert.base_unit}</span>
                  <p className="text-[9px] text-slate-500 mt-0.5">Limit: {alert.reorder_level}{alert.base_unit}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Multi-Branch Inventory Visibility Grid */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Multi-Branch Inventory Grid</h4>
            <p className="text-xs text-slate-500 mt-0.5">Real-time stock balance compared across all locations.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                <th className="p-4 pl-6">Item Name</th>
                <th className="p-4">SKU</th>
                <th className="p-4">Category</th>
                {branches.map(b => (
                  <th key={b.id} className="p-4 text-center font-bold text-indigo-400">
                    {b.name} {b.is_warehouse ? '🏢' : '🍔'}
                  </th>
                ))}
                <th className="p-4 pr-6 text-right font-bold text-slate-300">Total Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {inventoryGrid.map(item => (
                <tr key={item.id} className="hover:bg-slate-900/35 transition-all text-slate-300">
                  <td className="p-4 pl-6 font-semibold text-slate-200">{item.name}</td>
                  <td className="p-4 text-slate-500 font-mono">{item.sku}</td>
                  <td className="p-4">
                    <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700/50">
                      {item.category}
                    </span>
                  </td>
                  {branches.map(b => {
                    const qty = item.stocks[b.id];
                    return (
                      <td key={b.id} className="p-4 text-center">
                        <span className={`px-2.5 py-1 rounded text-xs ${getAlertStatusClass(qty, item.reorderLevel)}`}>
                          {qty.toLocaleString()} <span className="text-[10px] opacity-75">{item.baseUnit}</span>
                        </span>
                      </td>
                    );
                  })}
                  <td className="p-4 pr-6 text-right font-bold text-slate-100">
                    {item.totalStock.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">{item.baseUnit}</span>
                  </td>
                </tr>
              ))}
              {inventoryGrid.length === 0 && (
                <tr>
                  <td colSpan={4 + branches.length} className="text-center p-8 text-slate-500">
                    No items in catalog. Go to 'Inventory Items' to create inventory records.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
