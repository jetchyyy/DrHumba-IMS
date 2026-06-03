import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Search, RefreshCw, AlertTriangle, Layers, Eye, ChevronDown, ChevronUp, BarChart3, ShieldAlert } from 'lucide-react';

interface BranchBalance {
  branch_id: string;
  branch_name: string;
  is_warehouse: boolean;
  quantity: number;
}

interface GlobalStockItem {
  id: string;
  sku: string;
  item_name: string;
  category: string;
  base_unit: string;
  cost_per_base_unit: number;
  reorder_level: number;
  total_quantity: number;
  total_valuation: number;
  breakdown: BranchBalance[];
}

export const GlobalInventory: React.FC = () => {
  const { branches } = useAuth();
  
  const [stockItems, setStockItems] = useState<GlobalStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedBranchId, setSelectedBranchId] = useState('All');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  const loadGlobalStockData = async () => {
    setLoading(true);
    try {
      // 1. Fetch all active catalog items
      const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('status', 'active')
        .order('item_name');
      
      if (itemsError) throw itemsError;

      // 2. Fetch all branch balances
      const { data: balances, error: balancesError } = await supabase
        .from('inventory_balances')
        .select('branch_id, item_id, quantity');
      
      if (balancesError) throw balancesError;

      // 3. Map balances and build aggregated data
      const mappedItems: GlobalStockItem[] = (items || []).map(item => {
        const itemBalances = (balances || []).filter(b => b.item_id === item.id);
        
        // Sum up total quantity
        const totalQty = itemBalances.reduce((sum, b) => sum + Number(b.quantity), 0);
        
        // Calculate valuation
        const valuation = totalQty * Number(item.cost_per_base_unit);

        // Build breakdown for ALL branches (including those with 0 stock)
        const breakdown: BranchBalance[] = branches.map(br => {
          const bal = itemBalances.find(b => b.branch_id === br.id);
          return {
            branch_id: br.id,
            branch_name: br.name,
            is_warehouse: br.is_warehouse,
            quantity: bal ? Number(bal.quantity) : 0
          };
        });

        return {
          id: item.id,
          sku: item.sku,
          item_name: item.item_name,
          category: item.category,
          base_unit: item.base_unit,
          cost_per_base_unit: Number(item.cost_per_base_unit),
          reorder_level: Number(item.reorder_level),
          total_quantity: totalQty,
          total_valuation: valuation,
          breakdown
        };
      });

      setStockItems(mappedItems);
    } catch (err) {
      console.error('Error loading global stock data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (branches.length > 0) {
      loadGlobalStockData();
    }
  }, [branches]);

  // Extract unique categories for dropdown filter
  const categories = ['All', ...new Set(stockItems.map(item => item.category))];

  // Map items to branch display values if a specific branch is selected
  const itemsWithDisplayValues = stockItems.map(item => {
    if (selectedBranchId === 'All') {
      return {
        ...item,
        display_quantity: item.total_quantity,
        display_valuation: item.total_valuation,
      };
    } else {
      const branchBal = item.breakdown.find(b => b.branch_id === selectedBranchId);
      const q = branchBal ? branchBal.quantity : 0;
      return {
        ...item,
        display_quantity: q,
        display_valuation: q * item.cost_per_base_unit,
      };
    }
  });

  // Filter items based on search and category selections
  const filteredItems = itemsWithDisplayValues.filter(item => {
    const matchesSearch = 
      item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Calculate metrics dynamically based on branch selection
  const displayTotalItems = itemsWithDisplayValues.length;
  const displayTotalValuation = itemsWithDisplayValues.reduce((sum, item) => sum + item.display_valuation, 0);

  const displayLowStockCount = itemsWithDisplayValues.reduce((sum, item) => {
    if (selectedBranchId === 'All') {
      // count of all branch-level alerts
      const branchAlerts = item.breakdown.filter(b => b.quantity < item.reorder_level).length;
      return sum + branchAlerts;
    } else {
      return sum + (item.display_quantity < item.reorder_level ? 1 : 0);
    }
  }, 0);

  const toggleExpand = (id: string) => {
    setExpandedItemId(expandedItemId === id ? null : id);
  };

  const formatPHP = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Overall Inventory Stock</h2>
          <p className="text-sm text-slate-400">Aggregated stock balances and valuation across all branches and warehouses.</p>
        </div>

        <button
          onClick={loadGlobalStockData}
          disabled={loading}
          className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Total Catalog Items</span>
            <span className="text-2xl font-bold text-white">{displayTotalItems}</span>
          </div>
        </div>

        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
              {selectedBranchId === 'All' ? 'Total Global Stock Valuation' : 'Branch Stock Valuation'}
            </span>
            <span className="text-2xl font-bold text-emerald-400">{formatPHP(displayTotalValuation)}</span>
          </div>
        </div>

        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-amber-500/10 rounded-lg text-amber-400 border border-amber-500/20">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
              {selectedBranchId === 'All' ? 'Low Stock Branch Alerts' : 'Branch Low Stock Alerts'}
            </span>
            <span className="text-2xl font-bold text-amber-500">{displayLowStockCount}</span>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center mb-6">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search items by name or SKU..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-all placeholder-slate-500"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-xs text-slate-400 whitespace-nowrap font-medium">Branch:</span>
            <select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-indigo-500 min-w-[140px] w-full sm:w-auto cursor-pointer"
            >
              <option value="All">All Branches</option>
              {branches.map(br => (
                <option key={br.id} value={br.id}>{br.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-xs text-slate-400 whitespace-nowrap font-medium">Category:</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-indigo-500 min-w-[120px] w-full sm:w-auto cursor-pointer"
            >
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Aggregated Table */}
      <div className="glass rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-500" />
            <p className="text-xs">Fetching global inventory balances...</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                <th className="p-4 pl-6 w-10"></th>
                <th className="p-4">SKU</th>
                <th className="p-4">Item Name</th>
                <th className="p-4">Category</th>
                <th className="p-4 text-right">
                  {selectedBranchId === 'All' ? 'Total Quantity' : 'Branch Quantity'}
                </th>
                <th className="p-4 text-right">
                  {selectedBranchId === 'All' ? 'Est. Valuation' : 'Branch Valuation'}
                </th>
                <th className="p-4 text-right pr-6">Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filteredItems.map(item => {
                const isExpanded = expandedItemId === item.id;
                return (
                  <React.Fragment key={item.id}>
                    <tr 
                      onClick={() => toggleExpand(item.id)}
                      className="hover:bg-slate-900/10 text-slate-300 cursor-pointer transition-all"
                    >
                      <td className="p-4 pl-6 text-center text-slate-500">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </td>
                      <td className="p-4 font-mono text-slate-400 font-semibold">{item.sku}</td>
                      <td className="p-4 font-bold text-slate-100">{item.item_name}</td>
                      <td className="p-4">
                        <span className="bg-slate-800/80 px-2 py-0.5 rounded text-[10px] text-slate-300 border border-slate-700/30">
                          {item.category}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-slate-200">
                        {item.display_quantity.toLocaleString()} {item.base_unit}
                      </td>
                      <td className="p-4 text-right font-bold text-emerald-400">
                        {formatPHP(item.display_valuation)}
                      </td>
                      <td className="p-4 text-right pr-6">
                        <button
                          type="button"
                          className="inline-flex items-center space-x-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold py-1 px-2.5 bg-slate-900 border border-slate-800/80 rounded hover:bg-slate-800 transition-all"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Show Branch Split</span>
                        </button>
                      </td>
                    </tr>

                    {/* Expanded Branch Breakdown Detail */}
                    {isExpanded && (
                      <tr className="bg-slate-950/45">
                        <td colSpan={7} className="p-6 pl-12 pr-6 border-l-2 border-indigo-500">
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
                                Branch Stock Breakdown: {item.item_name}
                              </h4>
                              <span className="text-[10px] text-slate-500 font-medium">
                                Base Reorder Trigger: <span className="text-slate-300 font-bold">{item.reorder_level} {item.base_unit}</span>
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                              {item.breakdown.map(br => {
                                const isLow = br.quantity < item.reorder_level;
                                const isSelectedBranch = br.branch_id === selectedBranchId;
                                return (
                                  <div 
                                    key={br.branch_id} 
                                    className={`p-4 rounded-lg border bg-slate-900/50 flex flex-col justify-between space-y-2 transition-all ${
                                      isSelectedBranch
                                        ? 'border-indigo-500 bg-indigo-500/[0.03] ring-1 ring-indigo-500/30'
                                        : isLow 
                                          ? 'border-amber-500/25 bg-amber-500/[0.02]' 
                                          : 'border-slate-800/80'
                                    }`}
                                  >
                                    <div className="flex items-start justify-between">
                                      <div>
                                        <span className="text-xs font-bold text-slate-200 block truncate max-w-[150px]">
                                          {br.branch_name}
                                        </span>
                                        <span className="text-[9px] text-slate-500 uppercase font-medium">
                                          {br.is_warehouse ? 'Warehouse / Main' : 'Sales Branch'}
                                        </span>
                                      </div>
                                      
                                      {isLow && (
                                        <span className="flex items-center space-x-1 text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 uppercase">
                                          <AlertTriangle className="w-2.5 h-2.5" />
                                          <span>Low Stock</span>
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex items-end justify-between pt-1 border-t border-slate-800/40">
                                      <div>
                                        <span className="text-[10px] text-slate-400 block">Quantity</span>
                                        <span className="text-sm font-black text-slate-200">
                                          {br.quantity.toLocaleString()} <span className="text-xs font-normal text-slate-400">{item.base_unit}</span>
                                        </span>
                                      </div>
                                      <div className="text-right">
                                        <span className="text-[10px] text-slate-400 block">Valuation</span>
                                        <span className="text-xs font-bold text-slate-300">
                                          {formatPHP(br.quantity * item.cost_per_base_unit)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center p-8 text-slate-500">
                    No items found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
