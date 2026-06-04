import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { ShoppingCart, Plus, Minus, Trash2, Search, CheckCircle, AlertTriangle, Printer } from 'lucide-react';
import { settingsService } from '../lib/settingsService';
import { printThermalInvoice } from '../lib/printService';

interface MenuItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  is_available: boolean;
}

interface CartItem {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
}

export const POS: React.FC = () => {
  const { selectedBranch, profile } = useAuth();
  
  const [items, setItems] = useState<MenuItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  
  // Submission state
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);

  const loadMenuItems = async () => {
    setLoading(true);
    try {
      const { data, error: itemError } = await supabase
        .from('menu_items')
        .select('*')
        .eq('status', 'active')
        .eq('is_available', true)
        .order('name');
      
      if (itemError) throw itemError;
      setItems(data || []);
    } catch (err) {
      console.error('Error loading menu items for POS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMenuItems();
  }, []);

  const addToCart = (item: MenuItem) => {
    setError('');
    setSuccess('');
    
    const exists = cart.find(ci => ci.menu_item_id === item.id);
    if (exists) {
      setCart(
        cart.map(ci =>
          ci.menu_item_id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci
        )
      );
    } else {
      setCart([
        ...cart,
        {
          menu_item_id: item.id,
          name: item.name,
          price: Number(item.price),
          quantity: 1
        }
      ]);
    }
  };

  const updateCartQty = (menuItemId: string, amount: number) => {
    setError('');
    setSuccess('');
    
    setCart(
      cart
        .map(ci => {
          if (ci.menu_item_id === menuItemId) {
            const newQty = ci.quantity + amount;
            return newQty > 0 ? { ...ci, quantity: newQty } : null;
          }
          return ci;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (menuItemId: string) => {
    setError('');
    setSuccess('');
    setCart(cart.filter(ci => ci.menu_item_id !== menuItemId));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!selectedBranch) {
      setError('Please select an active branch context first from the sidebar.');
      return;
    }

    setCheckingOut(true);
    setError('');
    setSuccess('');
    setLastSaleId(null);

    try {
      // 1. Structure the items argument for the database function
      // JSON format: [{ "menu_item_id": "...", "quantity": X }]
      const payload = cart.map(ci => ({
        menu_item_id: ci.menu_item_id,
        quantity: ci.quantity
      }));

      // 2. Call Supabase RPC fn_process_sale
      const { data: saleId, error: rpcError } = await supabase.rpc('fn_process_sale', {
        p_branch_id: selectedBranch.id,
        p_items: payload
      });

      if (rpcError) throw rpcError;

      setSuccess(`Sale successfully completed! Invoice logged.`);
      setLastSaleId(saleId);
      setCart([]);
    } catch (err: any) {
      console.error('POS Checkout Transaction failed:', err);
      // Display friendly validation message if insufficient stock
      setError(
        err.message || 'Transaction rolled back. Insufficient ingredient stocks in this branch!'
      );
    } finally {
      setCheckingOut(false);
    }
  };

  const handlePrintThermal = async (saleId: string) => {
    try {
      // 1. Fetch newly processed sale details from Supabase
      const { data: saleData, error: saleError } = await supabase
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
        `)
        .eq('id', saleId)
        .single();

      if (saleError) throw saleError;
      if (!saleData) return;

      // 2. Fetch cashier email details
      const { data: profileData } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', saleData.cashier_id)
        .single();

      const mappedSale = {
        id: saleData.id,
        branch_id: saleData.branch_id,
        cashier_id: saleData.cashier_id,
        total_amount: Number(saleData.total_amount),
        status: saleData.status,
        created_at: saleData.created_at,
        branch_name: (Array.isArray(saleData.branches) ? saleData.branches[0]?.name : (saleData.branches as any)?.name) || selectedBranch?.name || 'Main Branch',
        cashier_email: profileData?.email || profile?.email || 'System',
        items: (saleData.sale_items || []).map((si: any) => ({
          id: si.id,
          quantity: Number(si.quantity),
          unit_price: Number(si.unit_price),
          subtotal: Number(si.subtotal),
          item_name: si.menu_items?.name || 'Unknown Dish',
          sku: si.menu_items?.sku || ''
        }))
      };

      const settings = await settingsService.getSettings();
      printThermalInvoice(mappedSale, settings.sales_invoice);
    } catch (err) {
      console.error('Failed to load and print thermal invoice:', err);
      alert('Failed to print receipt. Please reprint from Sales History.');
    }
  };

  // Categories list
  const categories = ['All', ...Array.from(new Set(items.map(item => item.category)))];

  // Filters
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <div className="flex-1 flex overflow-hidden h-screen bg-slate-950">
      {/* Menu / Catalog Panel */}
      <div className="flex-1 flex flex-col p-8 overflow-y-auto">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Point of Sale (POS)</h2>
            <p className="text-sm text-slate-400">
              Checkout transactions. Ingredient deductions will be validated at the database layer.
            </p>
          </div>
          {selectedBranch && (
            <div className="px-3.5 py-1.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold">
              Checkout location: <span className="underline font-bold">{selectedBranch.name}</span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
          <div className="flex items-center space-x-3 bg-slate-900 border border-slate-800 px-3.5 py-1.5 rounded-lg flex-1">
            <Search className="w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search dish name or SKU..."
              className="bg-transparent text-sm text-white focus:outline-none w-full"
            />
          </div>
          <div className="flex space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                  selectedCategory === cat
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid List */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-xs text-slate-500 animate-pulse">Loading menu items...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 flex-1">
            {filteredItems.map(item => (
              <div
                key={item.id}
                onClick={() => addToCart(item)}
                className="glass p-5 rounded-xl flex flex-col justify-between hover-scale cursor-pointer border hover:border-indigo-500/35 hover:shadow-indigo-500/5 group"
              >
                <div>
                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block mb-1">
                    {item.category}
                  </span>
                  <h4 className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors">
                    {item.name}
                  </h4>
                  <span className="text-[10px] text-slate-600 font-mono mt-0.5 block">{item.sku}</span>
                </div>
                <div className="flex items-center justify-between mt-5">
                  <span className="text-base font-bold text-slate-100">₱{Number(item.price).toFixed(2)}</span>
                  <button className="bg-slate-800 border border-slate-700/50 hover:bg-indigo-600 hover:text-white text-indigo-400 text-xs px-2.5 py-1 rounded-md font-bold transition-all shadow-sm">
                    + Add
                  </button>
                </div>
              </div>
            ))}

            {filteredItems.length === 0 && (
              <div className="col-span-full text-center p-8 text-slate-500 text-xs">
                No active dishes found matching criteria.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cart Panel */}
      <div className="w-96 border-l border-slate-800 bg-slate-900 flex flex-col h-screen">
        {/* Cart Header */}
        <div className="p-6 border-b border-slate-800 flex items-center space-x-3 text-white">
          <ShoppingCart className="w-5 h-5 text-indigo-500" />
          <h3 className="font-bold text-sm uppercase tracking-wider">Shopping Cart</h3>
          <span className="bg-slate-800 text-[10px] px-2 py-0.5 rounded font-bold text-slate-300">
            {cart.reduce((sum, item) => sum + item.quantity, 0)} Items
          </span>
        </div>

        {/* Status Alerts */}
        <div className="p-4 space-y-3">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-400 text-xs rounded flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs rounded flex items-start space-x-2">
              <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-bold">{success}</p>
                {lastSaleId && (
                  <div className="mt-2 space-y-2">
                    <p className="text-[10px] text-slate-500 font-mono truncate max-w-[280px]">
                      ID: {lastSaleId}
                    </p>
                    <button
                      onClick={() => handlePrintThermal(lastSaleId)}
                      className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] shadow-sm hover:shadow transition-all"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Thermal Receipt</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Cart Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.map(item => (
            <div key={item.menu_item_id} className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
              <div className="flex-1 min-w-0 pr-3">
                <h5 className="font-bold text-slate-200 truncate">{item.name}</h5>
                <p className="text-[10px] text-slate-500 mt-0.5">₱{item.price.toFixed(2)} each</p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => updateCartQty(item.menu_item_id, -1)}
                  className="p-1 bg-slate-900 border border-slate-800 rounded text-slate-400 hover:text-white"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="font-bold text-slate-200 px-1 select-none">{item.quantity}</span>
                <button
                  onClick={() => updateCartQty(item.menu_item_id, 1)}
                  className="p-1 bg-slate-900 border border-slate-800 rounded text-slate-400 hover:text-white"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  onClick={() => removeFromCart(item.menu_item_id)}
                  className="p-1 text-slate-500 hover:text-red-400 pl-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {cart.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 p-8">
              <div className="w-12 h-12 rounded-full bg-slate-950/40 flex items-center justify-center border border-slate-850 text-slate-600 mb-3">
                <ShoppingCart className="w-5 h-5" />
              </div>
              <p className="text-xs">Your shopping cart is empty.</p>
              <p className="text-[10px] text-slate-600 mt-1">Tap dishes on the catalog grid to add them here.</p>
            </div>
          )}
        </div>

        {/* Checkout Summary */}
        <div className="p-6 border-t border-slate-800 bg-slate-950/40 space-y-4">
          <div className="flex justify-between items-center text-sm font-semibold text-slate-400">
            <span>Subtotal</span>
            <span className="text-slate-200">₱{cartTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center text-base font-bold text-slate-200">
            <span>Total Sales Value</span>
            <span className="text-indigo-400 text-lg">₱{cartTotal.toFixed(2)}</span>
          </div>

          {!selectedBranch && (
            <div className="text-[10px] text-amber-500 text-center font-medium bg-amber-500/5 p-2 rounded border border-amber-500/10">
              ⚠️ Warning: You cannot checkout without an assigned branch context.
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={checkingOut || cart.length === 0 || !selectedBranch}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-indigo-600/10 transition-all disabled:opacity-50"
          >
            {checkingOut ? 'Checking Stock & Deducting...' : 'Place Order & Complete Checkout'}
          </button>
        </div>
      </div>
    </div>
  );
};
