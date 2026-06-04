import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Plus, Edit2, BookOpen, X, RefreshCw, Trash2, ChevronDown } from 'lucide-react';

interface MenuItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  status: 'active' | 'inactive';
  is_available: boolean;
  recipes?: {
    id: string;
    instructions: string;
    recipe_ingredients?: {
      item_id: string;
      quantity_base_unit: number;
    }[];
  }[];
}

interface InventoryCatalogItem {
  id: string;
  item_name: string;
  base_unit: string;
  cost_per_base_unit: number;
}

export const Recipes: React.FC = () => {
  const { profile } = useAuth();
  
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [catalog, setCatalog] = useState<InventoryCatalogItem[]>([]);

  // Modals state
  const [showItemModal, setShowItemModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  // Menu Item Form state
  const [itemName, setItemName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('Burgers');
  const [price, setPrice] = useState(9.99);
  const [itemStatus, setItemStatus] = useState<'active' | 'inactive'>('active');
  const [isAvailable, setIsAvailable] = useState(true);

  // Recipe Form state
  const [instructions, setInstructions] = useState('');
  const [recipeIngredients, setRecipeIngredients] = useState<{ item_id: string; qty: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(1);
  const [ingSearch, setIngSearch] = useState('');
  const [ingDropdownOpen, setIngDropdownOpen] = useState(false);

  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  const loadData = async () => {
    try {
      // 1. Fetch menu items with their recipes and recipe ingredients
      const { data: menuData, error: menuError } = await supabase
        .from('menu_items')
        .select(`
          *,
          recipes (
            id,
            instructions,
            recipe_ingredients (
              item_id,
              quantity_base_unit
            )
          )
        `)
        .order('name');
      if (menuError) throw menuError;
      setMenuItems(menuData || []);

      // 2. Fetch inventory catalog items (for recipe ingredients selection and cost details)
      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, base_unit, cost_per_base_unit')
        .eq('status', 'active')
        .order('item_name');
      if (catError) throw catError;
      setCatalog(catData || []);
    } catch (err) {
      console.error(err);
    }
  };

  const calculateItemCost = (item: MenuItem) => {
    const recipe = item.recipes?.[0];
    if (!recipe || !recipe.recipe_ingredients) return 0;
    
    return recipe.recipe_ingredients.reduce((total, ing) => {
      const catalogItem = catalog.find(c => c.id === ing.item_id);
      const cost = catalogItem ? Number(catalogItem.cost_per_base_unit) : 0;
      return total + (Number(ing.quantity_base_unit) * cost);
    }, 0);
  };

  const currentCost = recipeIngredients.reduce((total, ing) => {
    const catalogItem = catalog.find(c => c.id === ing.item_id);
    const cost = catalogItem ? Number(catalogItem.cost_per_base_unit) : 0;
    return total + (ing.qty * cost);
  }, 0);
  const currentProfit = Number(price) - currentCost;
  const currentMargin = Number(price) > 0 ? (currentProfit / Number(price)) * 100 : 0;

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenItemCreate = () => {
    setSelectedItem(null);
    setItemName('');
    setSku(`MEN-${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
    setCategory('Burgers');
    setPrice(9.99);
    setItemStatus('active');
    setIsAvailable(true);
    setInstructions('');
    setRecipeIngredients([]);
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(5);
    } else {
      setCurrentSelectedItemId('');
      setCurrentQty(1);
    }
    setIngSearch('');
    setIngDropdownOpen(false);
    setFormError('');
    setFormSuccess('');
    setShowItemModal(true);
  };

  const handleOpenItemEdit = async (item: MenuItem) => {
    setSelectedItem(item);
    setItemName(item.name);
    setSku(item.sku);
    setCategory(item.category);
    setPrice(item.price);
    setItemStatus(item.status);
    setIsAvailable(item.is_available);
    setInstructions('');
    setRecipeIngredients([]);
    setFormError('');
    setFormSuccess('');

    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(5);
    } else {
      setCurrentSelectedItemId('');
      setCurrentQty(1);
    }
    setIngSearch('');
    setIngDropdownOpen(false);

    try {
      // 1. Fetch recipe row
      let { data: recipeData, error: recipeError } = await supabase
        .from('recipes')
        .select('*')
        .eq('menu_item_id', item.id)
        .maybeSingle();

      if (recipeError) throw recipeError;

      let recipeId = '';
      if (recipeData) {
        setInstructions(recipeData.instructions || '');
        recipeId = recipeData.id;
      }

      // 2. Fetch recipe ingredients
      if (recipeId) {
        const { data: ingData, error: ingError } = await supabase
          .from('recipe_ingredients')
          .select(`
            item_id,
            quantity_base_unit
          `)
          .eq('recipe_id', recipeId);
        
        if (ingError) throw ingError;
        setRecipeIngredients(
          (ingData || []).map(ing => ({
            item_id: ing.item_id,
            qty: Number(ing.quantity_base_unit)
          }))
        );
      }
    } catch (err) {
      console.error('Error fetching recipe:', err);
      alert('Error fetching recipe information');
    }

    setShowItemModal(true);
  };

  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!itemName.trim() || !sku.trim()) {
      setFormError('Name and SKU are required');
      return;
    }

    try {
      const payload = {
        name: itemName.trim(),
        sku: sku.trim(),
        category,
        price: Number(price),
        status: itemStatus,
        is_available: isAvailable
      };

      let menuItemId = '';
      if (selectedItem) {
        menuItemId = selectedItem.id;
        const { error } = await supabase
          .from('menu_items')
          .update(payload)
          .eq('id', selectedItem.id);
        if (error) throw error;
      } else {
        const { data: newMenuItem, error } = await supabase
          .from('menu_items')
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        menuItemId = newMenuItem.id;
      }

      // Save Recipe details (instructions and recipe_ingredients)
      let { data: recipeRow, error: findError } = await supabase
        .from('recipes')
        .select('id')
        .eq('menu_item_id', menuItemId)
        .maybeSingle();

      if (findError) throw findError;

      let recipeId = '';
      if (recipeRow) {
        recipeId = recipeRow.id;
        // Update instructions
        const { error: updateError } = await supabase
          .from('recipes')
          .update({ instructions, version: 1 })
          .eq('id', recipeId);
        if (updateError) throw updateError;
      } else {
        // Insert new recipe row
        const { data: newRow, error: insertError } = await supabase
          .from('recipes')
          .insert({
            menu_item_id: menuItemId,
            instructions,
            version: 1
          })
          .select()
          .single();
        if (insertError) throw insertError;
        recipeId = newRow.id;
      }

      // Delete old ingredients
      const { error: deleteError } = await supabase
        .from('recipe_ingredients')
        .delete()
        .eq('recipe_id', recipeId);
      if (deleteError) throw deleteError;

      // Insert new ingredients
      if (recipeIngredients.length > 0) {
        const ingredientsPayload = recipeIngredients.map(ing => ({
          recipe_id: recipeId,
          item_id: ing.item_id,
          quantity_base_unit: ing.qty
        }));

        const { error: insertIngsError } = await supabase
          .from('recipe_ingredients')
          .insert(ingredientsPayload);
        if (insertIngsError) throw insertIngsError;
      }

      setFormSuccess(selectedItem ? 'Menu item and recipe updated!' : 'Menu item and recipe created!');
      await loadData();
      setTimeout(() => setShowItemModal(false), 800);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Error saving menu item and recipe');
    }
  };

  const handleAddIngredient = () => {
    if (!currentSelectedItemId) return;
    const exists = recipeIngredients.find(ri => ri.item_id === currentSelectedItemId);
    if (exists) {
      setFormError('Ingredient already added to recipe.');
      return;
    }
    setRecipeIngredients([
      ...recipeIngredients,
      { item_id: currentSelectedItemId, qty: Number(currentQty) }
    ]);
    setFormError('');
  };

  const handleRemoveIngredient = (index: number) => {
    setRecipeIngredients(recipeIngredients.filter((_, i) => i !== index));
  };

  const isEditor = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Recipes & Menu Mapping</h2>
          <p className="text-sm text-slate-400">Map retail dishes sold at the POS to raw inventory ingredients for automatic deduction.</p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadData}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          {isEditor && (
            <button
              onClick={handleOpenItemCreate}
              className="flex items-center space-x-2 bg-indigo-600 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow hover:bg-indigo-500 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Create Menu Item</span>
            </button>
          )}
        </div>
      </div>

      {/* Menu Items Table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
              <th className="p-4 pl-6">Menu Dish</th>
              <th className="p-4">SKU</th>
              <th className="p-4">Category</th>
              <th className="p-4 text-right">Retail Price</th>
              <th className="p-4 text-right">Ingredient Cost</th>
              <th className="p-4 text-right">Profit (Margin)</th>
              <th className="p-4">Availability</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right pr-6">Recipe Mapping</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {menuItems.map(item => {
              const cost = calculateItemCost(item);
              const profit = Number(item.price) - cost;
              const margin = Number(item.price) > 0 ? (profit / Number(item.price)) * 100 : 0;

              return (
                <tr key={item.id} className="hover:bg-slate-900/10 text-slate-300">
                  <td className="p-4 pl-6 font-bold text-slate-200">{item.name}</td>
                  <td className="p-4 text-slate-500 font-mono">{item.sku}</td>
                  <td className="p-4">
                    <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700/50">
                      {item.category}
                    </span>
                  </td>
                  <td className="p-4 text-right font-bold text-slate-200">₱{Number(item.price).toFixed(2)}</td>
                  <td className="p-4 text-right text-slate-400">₱{cost.toFixed(2)}</td>
                  <td className="p-4 text-right">
                    <span className={`font-bold ${margin > 50 ? 'text-emerald-400' : margin > 30 ? 'text-indigo-400' : 'text-amber-500'}`}>
                      ₱{profit.toFixed(2)} <span className="text-[10px] font-normal text-slate-500">({margin.toFixed(1)}%)</span>
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                      item.is_available 
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                    }`}>
                      {item.is_available ? 'In Stock' : 'Out of Stock'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                      item.status === 'active' 
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                        : 'bg-slate-800 border-slate-700 text-slate-500'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="p-4 text-right pr-6 flex justify-end space-x-2">
                    {isEditor && (
                      <button
                        onClick={() => handleOpenItemEdit(item)}
                        className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
                        title="Edit Item Info"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenItemEdit(item)}
                      className="flex items-center space-x-1 bg-slate-900 border border-slate-800 hover:bg-slate-850 hover:text-white px-2.5 py-1 rounded text-[10px] font-bold text-indigo-400 transition-all shadow-sm"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Map Ingredients</span>
                    </button>
                  </td>
                </tr>
              );
            })}

            {menuItems.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center p-8 text-slate-500">
                  No menu items found. Get started by clicking 'Create Menu Item'.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CREATE/EDIT MENU ITEM MODAL */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-5xl w-full rounded-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {selectedItem ? 'Edit Menu Item & Recipe' : 'New Menu Item & Recipe'}
              </h3>
              <button onClick={() => setShowItemModal(false)} className="text-slate-400 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMenuItem} className="p-6 space-y-6">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column: Menu Item Details */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">Dish Details</h4>
                  
                  <div>
                    <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Dish Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={itemName}
                      onChange={(e) => setItemName(e.target.value)}
                      placeholder="e.g. Classic Beef Burger"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>

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
                        <option value="Burgers">Burgers</option>
                        <option value="Sides">Sides</option>
                        <option value="Beverages">Beverages</option>
                        <option value="Desserts">Desserts</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Price (₱) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={price}
                        onChange={(e) => setPrice(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Menu Status
                      </label>
                      <select
                        value={itemStatus}
                        onChange={(e: any) => setItemStatus(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <input
                      type="checkbox"
                      id="isAvailable"
                      checked={isAvailable}
                      onChange={(e) => setIsAvailable(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="isAvailable" className="text-xs text-slate-300 font-semibold select-none cursor-pointer">
                      Available for Sale (POS check)
                    </label>
                  </div>
                </div>

                {/* Right Column: Recipe & Ingredients Mapping */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">Recipe & Ingredients</h4>

                  {/* Real-time Profit Margin Metrics Card */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-900/60 border border-slate-800/80 p-3 rounded-lg text-center">
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-0.5">Est. Cost</span>
                      <span className="text-slate-200 font-bold text-sm">₱{currentCost.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-0.5">Est. Profit</span>
                      <span className="text-slate-200 font-bold text-sm">₱{currentProfit.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-0.5">Margin</span>
                      <span className={`font-extrabold text-sm block ${currentMargin > 50 ? 'text-emerald-400' : currentMargin > 30 ? 'text-indigo-400' : 'text-amber-500'}`}>
                        {currentMargin.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Preparation Instructions / Steps
                    </label>
                    <textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="e.g. Sear patty, toast bun, place sauce..."
                      rows={2}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none"
                    />
                  </div>

                  {/* Add Ingredient Section */}
                  {isEditor ? (
                    <div className="bg-slate-900/40 p-3 rounded border border-slate-800 space-y-2">
                      <label className="text-[10px] text-slate-400 font-semibold uppercase block">
                        Add Ingredient to Recipe
                      </label>
                      <div className="flex space-x-2">
                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={ingDropdownOpen ? ingSearch : (catalog.find(c => c.id === currentSelectedItemId)?.item_name ? `${catalog.find(c => c.id === currentSelectedItemId)?.item_name} (${catalog.find(c => c.id === currentSelectedItemId)?.base_unit})` : '')}
                            onChange={(e) => {
                              setIngSearch(e.target.value);
                              setIngDropdownOpen(true);
                            }}
                            onFocus={() => {
                              setIngDropdownOpen(true);
                              setIngSearch('');
                            }}
                            onBlur={() => {
                              setTimeout(() => {
                                setIngDropdownOpen(false);
                              }, 200);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const filtered = catalog.filter(item => 
                                  item.item_name.toLowerCase().includes(ingSearch.toLowerCase())
                                );
                                if (filtered.length > 0) {
                                  setCurrentSelectedItemId(filtered[0].id);
                                  setIngSearch('');
                                  setIngDropdownOpen(false);
                                }
                              }
                            }}
                            placeholder="Search ingredient..."
                            className="w-full bg-slate-950 border border-slate-800 rounded pl-2 pr-8 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
                          />
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                            <ChevronDown className="w-3.5 h-3.5" />
                          </div>
                          
                          {/* Dropdown Options */}
                          {ingDropdownOpen && (
                            <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-slate-900 border border-slate-800 rounded-md shadow-lg divide-y divide-slate-800/50">
                              {catalog
                                .filter(item => 
                                  item.item_name.toLowerCase().includes(ingSearch.toLowerCase())
                                )
                                .map(item => (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                      setCurrentSelectedItemId(item.id);
                                      setIngSearch('');
                                      setIngDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-slate-800 hover:text-white ${
                                      item.id === currentSelectedItemId ? 'bg-indigo-600/25 text-indigo-400 font-semibold' : 'text-slate-300'
                                    }`}
                                  >
                                    {item.item_name} ({item.base_unit})
                                  </button>
                                ))}
                              {catalog.filter(item => 
                                item.item_name.toLowerCase().includes(ingSearch.toLowerCase())
                              ).length === 0 && (
                                <div className="p-2 text-center text-slate-500 text-xs">
                                  No matches found
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <input
                          type="number"
                          step="any"
                          value={currentQty || ''}
                          onChange={(e) => setCurrentQty(Number(e.target.value))}
                          placeholder="Qty"
                          className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-white text-center focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleAddIngredient}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded text-xs font-semibold"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Only editors can manage recipe ingredient links.</p>
                  )}

                  {/* Added Ingredients List Table */}
                  <div className="bg-slate-950 rounded border border-slate-800 max-h-36 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                          <th className="p-2 pl-3">Ingredient</th>
                          <th className="p-2 text-right">Qty Needed</th>
                          <th className="p-2 text-center pr-3 w-12">Remove</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40">
                        {recipeIngredients.map((ing, idx) => {
                          const info = catalog.find(c => c.id === ing.item_id);
                          return (
                            <tr key={idx} className="text-slate-300">
                              <td className="p-2 pl-3 font-semibold text-slate-200">{info?.item_name || 'Unknown'}</td>
                              <td className="p-2 text-right font-bold text-slate-100">
                                {ing.qty} {info?.base_unit}
                              </td>
                              <td className="p-2 text-center pr-3">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveIngredient(idx)}
                                  className="text-slate-500 hover:text-red-400"
                                >
                                  <Trash2 className="w-3.5 h-3.5 mx-auto" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}

                        {recipeIngredients.length === 0 && (
                          <tr>
                            <td colSpan={3} className="text-center p-4 text-slate-500">
                              No ingredients mapped. Real-time deduction is disabled for this dish.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="flex space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  className="flex-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold py-2 rounded text-center"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded shadow"
                >
                  Save Menu Item & Recipe
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
