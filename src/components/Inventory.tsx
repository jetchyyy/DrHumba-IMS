import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Plus, Edit2, X, Search, RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';

interface InventoryItem {
  id: string;
  sku: string;
  item_name: string;
  category: string;
  base_unit: string;
  purchase_unit: string;
  conversion_factor: number;
  reorder_level: number;
  cost_per_base_unit: number;
  status: 'active' | 'inactive';
}

interface Balance {
  item_id: string;
  quantity: number;
}

export const Inventory: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  
  // Navigation Tabs: 'catalog' or 'balances'
  const [activeSubTab, setActiveSubTab] = useState<'balances' | 'catalog'>('balances');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Catalog Form state
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [sku, setSku] = useState('');
  const [itemName, setItemName] = useState('');
  const [category, setCategory] = useState('Vegetables');
  const [baseUnit, setBaseUnit] = useState('g');
  const [purchaseUnit, setPurchaseUnit] = useState('g');
  const [conversionFactor, setConversionFactor] = useState(1);
  const [reorderLevel, setReorderLevel] = useState(500);
  const [costPerBaseUnit, setCostPerBaseUnit] = useState(0.01);
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [initialQty, setInitialQty] = useState<number>(0);

  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Stock In state
  const [stockInItem, setStockInItem] = useState<InventoryItem | null>(null);
  const [stockInQty, setStockInQty] = useState<number>(0);
  const [stockInSubmitting, setStockInSubmitting] = useState(false);
  const [stockInError, setStockInError] = useState('');
  const [stockInSuccess, setStockInSuccess] = useState('');

  const loadInventoryData = async () => {
    try {
      // 1. Load catalog items
      const { data: itemsData, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .order('item_name');
      if (itemsError) throw itemsError;
      setItems(itemsData || []);

      // 2. Load stock balances for the currently selected branch
      if (selectedBranch) {
        const { data: balData, error: balError } = await supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .eq('branch_id', selectedBranch.id);
        if (balError) throw balError;
        setBalances(balData || []);
      }
    } catch (err) {
      console.error('Error loading inventory:', err);
    }
  };

  useEffect(() => {
    loadInventoryData();
  }, [selectedBranch]);

  const handleOpenCreateForm = () => {
    setEditingItem(null);
    setSku(`ING-${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
    setItemName('');
    setCategory('Vegetables');
    setBaseUnit('g');
    setPurchaseUnit('g');
    setConversionFactor(1);
    setReorderLevel(500);
    setCostPerBaseUnit(0.01);
    setStatus('active');
    setInitialQty(0);
    setFormError('');
    setFormSuccess('');
    setShowForm(true);
  };

  const handleOpenEditForm = (item: InventoryItem) => {
    setEditingItem(item);
    setSku(item.sku);
    setItemName(item.item_name);
    setCategory(item.category);
    setBaseUnit(item.base_unit);
    setPurchaseUnit(item.purchase_unit);
    setConversionFactor(item.conversion_factor);
    setReorderLevel(item.reorder_level);
    setCostPerBaseUnit(item.cost_per_base_unit);
    setStatus(item.status);
    setFormError('');
    setFormSuccess('');
    setShowForm(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!itemName.trim() || !sku.trim()) {
      setFormError('Name and SKU are required');
      return;
    }

    if (!editingItem && Number(initialQty) > 0 && !selectedBranch) {
      setFormError('Please select a branch first to record initial stock quantity.');
      return;
    }

    try {
      const itemPayload = {
        sku: sku.trim(),
        item_name: itemName.trim(),
        category,
        base_unit: baseUnit,
        purchase_unit: purchaseUnit,
        conversion_factor: Number(conversionFactor),
        reorder_level: Number(reorderLevel),
        cost_per_base_unit: Number(costPerBaseUnit),
        status
      };

      if (editingItem) {
        const { error } = await supabase
          .from('inventory_items')
          .update(itemPayload)
          .eq('id', editingItem.id);
        if (error) throw error;
        setFormSuccess('Item updated successfully!');
      } else {
        const { error } = await supabase.rpc('fn_create_inventory_item', {
          p_sku: sku.trim(),
          p_item_name: itemName.trim(),
          p_category: category,
          p_base_unit: baseUnit,
          p_purchase_unit: purchaseUnit,
          p_conversion_factor: Number(conversionFactor),
          p_reorder_level: Number(reorderLevel),
          p_cost_per_base_unit: Number(costPerBaseUnit),
          p_initial_quantity: Number(initialQty),
          p_branch_id: selectedBranch ? selectedBranch.id : null,
          p_created_by: profile ? profile.id : null
        });
        if (error) throw error;
        setFormSuccess('Item created successfully!');
      }

      await loadInventoryData();
      setTimeout(() => setShowForm(false), 800);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Error saving item. Make sure SKU is unique.');
    }
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    if (!window.confirm(`Are you sure you want to delete ${item.item_name}?`)) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', item.id);
        
      if (error) {
        // Code 23503 is foreign key violation (RESTRICT) in Postgres
        if (error.code === '23503') {
          alert(`Cannot delete "${item.item_name}" because it has existing transaction history or movements. You can set its status to "Inactive" instead.`);
        } else {
          throw error;
        }
      } else {
        await loadInventoryData();
      }
    } catch (err: any) {
      console.error('Error deleting item:', err);
      alert(err.message || 'Error deleting item');
    }
  };

  const handleOpenStockIn = (item: InventoryItem) => {
    setStockInItem(item);
    setStockInQty(0);
    setStockInError('');
    setStockInSuccess('');
  };

  const handleStockInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockInItem || !selectedBranch || !profile) return;
    
    setStockInSubmitting(true);
    setStockInError('');
    setStockInSuccess('');
    
    try {
      const { error } = await supabase.rpc('fn_stock_in_item', {
        p_branch_id: selectedBranch.id,
        p_item_id: stockInItem.id,
        p_quantity: Number(stockInQty),
        p_created_by: profile.id
      });
      
      if (error) throw error;
      
      setStockInSuccess('Stock added successfully!');
      await loadInventoryData();
      setTimeout(() => setStockInItem(null), 800);
    } catch (err: any) {
      console.error('Error in stock in:', err);
      setStockInError(err.message || 'Error adding stock');
    } finally {
      setStockInSubmitting(false);
    }
  };

  const isEditor = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  // Filters
  const filteredItems = items.filter(item => {
    const matchesSearch = item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Inventory</h2>
          <p className="text-sm text-slate-400">
            {selectedBranch ? `Managing stock levels for ${selectedBranch.name}` : 'Select a branch first'}
          </p>
        </div>

        <div className="flex items-center space-x-4">
          {/* Sub Navigation Tabs */}
          <div className="bg-slate-900 border border-slate-800 p-1 rounded-lg flex space-x-1">
            <button
              onClick={() => setActiveSubTab('balances')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeSubTab === 'balances'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Stock Balances
            </button>
            <button
              onClick={() => setActiveSubTab('catalog')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                activeSubTab === 'catalog'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Item Catalog
            </button>
          </div>

          <button
            onClick={loadInventoryData}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
            title="Reload Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          {activeSubTab === 'catalog' && isEditor && (
            <button
              onClick={handleOpenCreateForm}
              className="flex items-center space-x-2 bg-indigo-600 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow hover:bg-indigo-500 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create Item</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div className="space-y-6">
        {/* Search */}
        <div className="flex items-center space-x-3 glass px-3.5 py-2 rounded-lg max-w-md">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search items by name, SKU, or category..."
            className="bg-transparent text-sm text-white focus:outline-none w-full"
          />
        </div>

        {activeSubTab === 'balances' ? (
          /* Balances view */
          <div className="glass rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-4 pl-6">Item Name</th>
                  <th className="p-4">SKU</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Reorder Level</th>
                  <th className="p-4 text-right">Stock Quantity</th>
                  <th className="p-4 text-right">Unit Value</th>
                  <th className="p-4 text-right">Total Value</th>
                  {isEditor && <th className="p-4 text-right pr-6">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredItems.map(item => {
                  const bal = balances.find(b => b.item_id === item.id);
                  const qty = bal ? Number(bal.quantity) : 0;
                  const isLow = qty < item.reorder_level;
                  const value = qty * item.cost_per_base_unit;

                  return (
                    <tr key={item.id} className="hover:bg-slate-900/10 text-slate-300">
                      <td className="p-4 pl-6 font-semibold text-slate-100 flex items-center space-x-2">
                        <span>{item.item_name}</span>
                        {isLow && item.status === 'active' && (
                          <span className="flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-500 animate-pulse-subtle">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            <span>Low</span>
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-slate-500 font-mono">{item.sku}</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700/50">
                          {item.category}
                        </span>
                      </td>
                      <td className="p-4 text-slate-500">
                        {item.reorder_level.toLocaleString()} {item.base_unit}
                      </td>
                      <td className={`p-4 text-right font-bold ${isLow ? 'text-amber-500' : 'text-slate-200'}`}>
                        {qty.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">{item.base_unit}</span>
                      </td>
                      <td className="p-4 text-right text-slate-500">
                        ₱{item.cost_per_base_unit.toFixed(2)}
                      </td>
                      <td className={`p-4 text-right font-semibold text-slate-300 ${!isEditor ? 'pr-6' : ''}`}>
                        ₱{value.toFixed(2)}
                      </td>
                      {isEditor && (
                        <td className="p-4 text-right pr-6">
                          <button
                            onClick={() => handleOpenStockIn(item)}
                            className="px-2 py-1 bg-emerald-600/10 text-emerald-400 hover:bg-emerald-600/20 border border-emerald-500/20 rounded font-semibold text-[10px] tracking-wide transition-all"
                            title="Stock In"
                          >
                            Stock In
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}

                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={isEditor ? 8 : 7} className="text-center p-8 text-slate-500">
                      No items matched your search criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* Catalog view */
          <div className="glass rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-4 pl-6">SKU</th>
                  <th className="p-4">Item Name</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Base Unit</th>
                  <th className="p-4">Purchase Unit</th>
                  <th className="p-4">Conversion Factor</th>
                  <th className="p-4">Reorder Min</th>
                  <th className="p-4">Cost / Base</th>
                  <th className="p-4">Status</th>
                  {isEditor && <th className="p-4 text-right pr-6">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredItems.map(item => (
                  <tr key={item.id} className="hover:bg-slate-900/10 text-slate-300">
                    <td className="p-4 pl-6 font-mono text-indigo-400 font-medium">{item.sku}</td>
                    <td className="p-4 font-bold text-slate-100">{item.item_name}</td>
                    <td className="p-4 text-slate-400">{item.category}</td>
                    <td className="p-4 font-semibold text-slate-300">{item.base_unit}</td>
                    <td className="p-4 text-slate-400">{item.purchase_unit}</td>
                    <td className="p-4 text-slate-500 font-mono">
                      1 {item.purchase_unit} = {item.conversion_factor} {item.base_unit}
                    </td>
                    <td className="p-4 text-slate-400">{item.reorder_level} {item.base_unit}</td>
                    <td className="p-4 text-slate-400">₱{item.cost_per_base_unit.toFixed(2)}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                        item.status === 'active' 
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                          : 'bg-slate-800 border-slate-700 text-slate-500'
                      }`}>
                        {item.status}
                      </span>
                    </td>
                    {isEditor && (
                      <td className="p-4 text-right pr-6 flex justify-end space-x-2">
                        <button
                          onClick={() => handleOpenEditForm(item)}
                          className="p-1.5 text-slate-400 hover:text-indigo-400 rounded hover:bg-indigo-500/5 transition-all"
                          title="Edit Item"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-rose-500/5 transition-all"
                          title="Delete Item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-out/Modal Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-md w-full rounded-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {editingItem ? 'Edit Catalog Item' : 'New Catalog Item'}
              </h3>
              <button 
                onClick={() => setShowForm(false)}
                className="text-slate-400 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleSaveItem} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded">
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded">
                  {formSuccess}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    SKU *
                  </label>
                  <input
                    type="text"
                    required
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="Vegetables">Vegetables</option>
                    <option value="Meat">Meat</option>
                    <option value="Dairy">Dairy</option>
                    <option value="Bakery">Bakery</option>
                    <option value="Liquid">Liquid</option>
                    <option value="Dry Goods">Dry Goods</option>
                    <option value="Packaging">Packaging</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Item Name *
                </label>
                <input
                  type="text"
                  required
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="e.g. White Onion"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Unit of Measure *
                </label>
                <select
                  value={baseUnit}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBaseUnit(val);
                    setPurchaseUnit(val);
                    setConversionFactor(1);
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="g">Grams (g)</option>
                  <option value="kg">Kilograms (kg)</option>
                  <option value="pc">Pieces (pc)</option>
                  <option value="ml">Milliliters (ml)</option>
                  <option value="L">Liters (L)</option>
                </select>
              </div>

              {!editingItem && (
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Initial Stock Quantity ({baseUnit}) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={initialQty}
                    onChange={(e) => setInitialQty(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Reorder Min ({baseUnit})
                  </label>
                  <input
                    type="number"
                    required
                    value={reorderLevel}
                    onChange={(e) => setReorderLevel(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Est. Cost per {baseUnit} (₱)
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={costPerBaseUnit}
                    onChange={(e) => setCostPerBaseUnit(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {editingItem && (
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              )}

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold py-2 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded shadow"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stock In Modal */}
      {stockInItem && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-sm w-full rounded-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Stock In Item
              </h3>
              <button 
                onClick={() => setStockInItem(null)}
                className="text-slate-400 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <form onSubmit={handleStockInSubmit} className="p-6 space-y-4">
              {stockInError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded">
                  {stockInError}
                </div>
              )}
              {stockInSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded">
                  {stockInSuccess}
                </div>
              )}

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase block mb-1">
                  Item Name
                </label>
                <div className="text-sm text-slate-100 font-bold bg-slate-900 border border-slate-800 rounded px-3 py-2">
                  {stockInItem.item_name}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase block mb-1">
                    SKU
                  </label>
                  <div className="text-xs font-mono text-slate-400 bg-slate-900 border border-slate-800 rounded px-3 py-2">
                    {stockInItem.sku}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase block mb-1">
                    Current Stock
                  </label>
                  <div className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded px-3 py-2">
                    {(balances.find(b => b.item_id === stockInItem.id)?.quantity || 0).toLocaleString()} {stockInItem.base_unit}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Quantity to Add ({stockInItem.base_unit}) *
                </label>
                <input
                  type="number"
                  required
                  min="0.0001"
                  step="any"
                  value={stockInQty || ''}
                  onChange={(e) => setStockInQty(Number(e.target.value))}
                  placeholder="Enter quantity"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStockInItem(null)}
                  className="flex-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold py-2 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={stockInSubmitting}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white text-xs font-semibold py-2 rounded shadow"
                >
                  {stockInSubmitting ? 'Stocking In...' : 'Stock In'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
