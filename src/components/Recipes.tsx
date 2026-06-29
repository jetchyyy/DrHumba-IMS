import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { supabase } from '../lib/supabase';
import { PlusIcon as Plus, Pencil2Icon as Edit2, ReaderIcon as BookOpen, ReloadIcon as RefreshCw, TrashIcon as Trash2, MagicWandIcon as ChefHat } from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { useModal } from '../contexts/ModalContext';
import { ScrollArea } from './ui/scroll-area';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface MenuItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  cost_price?: number;
  status: 'active' | 'inactive';
  is_available: boolean;
  type?: 'restaurant' | 'retail' | 'service';
  inventory_item_id?: string | null;
  recipes?: {
    id: string;
    instructions: string | null;
    recipe_ingredients: {
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
  selling_price?: number | null;
}

export const Recipes: React.FC = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  const { confirm, showSuccess, showError } = useModal();

  const isRestaurant = tenant?.is_restaurant ?? true;
  const isRetail = tenant?.is_retail ?? false;
  
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [catalog, setCatalog] = useState<InventoryCatalogItem[]>([]);

  // Modals state
  const [showItemModal, setShowItemModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  // Menu Item Form state
  const [itemName, setItemName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState(isRestaurant ? 'Burgers' : 'General');
  const [price, setPrice] = useState(9.99);
  const [costPrice, setCostPrice] = useState(0);
  const [itemStatus, setItemStatus] = useState<'active' | 'inactive'>('active');
  const [isAvailable, setIsAvailable] = useState(true);
  const [productType, setProductType] = useState<'restaurant' | 'retail' | 'service'>('restaurant');
  const [inventoryItemId, setInventoryItemId] = useState<string | null>(null);

  // Custom Category States
  const [sessionCategories, setSessionCategories] = useState<string[]>([]);
  const [isCustomCategory, setIsCustomCategory] = useState(false);

  // Dynamic category list combining defaults, database menu items, and session-defined ones
  const categoriesList = useMemo(() => {
    const defaults = isRestaurant 
      ? ['Burgers', 'Sides', 'Beverages', 'Desserts'] 
      : ['General', 'Parts', 'Services', 'Labor'];
    const fromItems = menuItems.map(item => item.category).filter(Boolean);
    return Array.from(new Set([...defaults, ...fromItems, ...sessionCategories]));
  }, [menuItems, sessionCategories, isRestaurant]);

  // Recipe Form state
  const [instructions, setInstructions] = useState('');
  const [recipeIngredients, setRecipeIngredients] = useState<{ item_id: string; qty: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [menuItems.length]);

  const loadData = async () => {
    try {
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

      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, base_unit, cost_per_base_unit, selling_price')
        .eq('status', 'active')
        .order('item_name');
      if (catError) throw catError;
      setCatalog(catData || []);
    } catch (err) {
      console.error(err);
      showError("Failed to load recipe data");
    }
  };

  const calculateItemCost = (item: MenuItem) => {
    if (item.type === 'restaurant') {
      const recipe = item.recipes?.[0];
      if (!recipe || !recipe.recipe_ingredients) return 0;
      return recipe.recipe_ingredients.reduce((total, ing) => {
        const catalogItem = catalog.find(c => c.id === ing.item_id);
        const cost = catalogItem ? Number(catalogItem.cost_per_base_unit) : 0;
        return total + (Number(ing.quantity_base_unit) * cost);
      }, 0);
    } else if (item.type === 'retail') {
      const catalogItem = catalog.find(c => c.id === item.inventory_item_id);
      return catalogItem ? Number(catalogItem.cost_per_base_unit) : (item.cost_price || 0);
    } else {
      return item.cost_price || 0;
    }
  };

  const resolvedCost = productType === 'restaurant'
    ? recipeIngredients.reduce((total, ing) => {
        const catalogItem = catalog.find(c => c.id === ing.item_id);
        const cost = catalogItem ? Number(catalogItem.cost_per_base_unit) : 0;
        return total + (ing.qty * cost);
      }, 0)
    : productType === 'retail'
      ? (() => {
          const catalogItem = catalog.find(c => c.id === inventoryItemId);
          return catalogItem ? Number(catalogItem.cost_per_base_unit) : Number(costPrice);
        })()
      : Number(costPrice);

  const currentProfit = Number(price) - resolvedCost;
  const currentMargin = Number(price) > 0 ? (currentProfit / Number(price)) * 100 : 0;

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenItemCreate = () => {
    setSelectedItem(null);
    setItemName('');
    setSku(`MEN-${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
    setCategory(isRestaurant ? 'Burgers' : 'General');
    setIsCustomCategory(false);
    setPrice(9.99);
    setCostPrice(0);
    setItemStatus('active');
    setIsAvailable(true);
    setProductType(isRestaurant ? 'restaurant' : isRetail ? 'retail' : 'service');
    setInventoryItemId(null);
    setInstructions('');
    setRecipeIngredients([]);
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(5);
    } else {
      setCurrentSelectedItemId('');
      setCurrentQty(1);
    }
    setShowItemModal(true);
  };

  const handleOpenItemEdit = async (item: MenuItem) => {
    setSelectedItem(item);
    setItemName(item.name);
    setSku(item.sku);
    setCategory(item.category);
    setIsCustomCategory(false);
    setPrice(item.price);
    setCostPrice(item.cost_price || 0);
    setItemStatus(item.status);
    setIsAvailable(item.is_available);
    setProductType(item.type || 'restaurant');
    setInventoryItemId(item.inventory_item_id || null);
    setInstructions('');
    setRecipeIngredients([]);

    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(5);
    } else {
      setCurrentSelectedItemId('');
      setCurrentQty(1);
    }

    try {
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
      showError("Error fetching recipe information");
    }

    setShowItemModal(true);
  };

  const handleSaveMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim() || !sku.trim()) {
      showError("Name and SKU are required");
      return;
    }

    const trimmedCategory = category.trim();
    if (!trimmedCategory) {
      showError("Category is required");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: itemName.trim(),
        sku: sku.trim(),
        category: trimmedCategory,
        price: Number(price),
        cost_price: productType === 'restaurant' ? 0 : Number(costPrice),
        status: itemStatus,
        is_available: isAvailable,
        type: productType,
        inventory_item_id: productType === 'retail' ? inventoryItemId : null,
        tenant_id: tenant?.id
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

      if (productType === 'restaurant') {
        let { data: recipeRow, error: findError } = await supabase
          .from('recipes')
          .select('id')
          .eq('menu_item_id', menuItemId)
          .maybeSingle();

        if (findError) throw findError;

        let recipeId = '';
        if (recipeRow) {
          recipeId = recipeRow.id;
          const { error: updateError } = await supabase
            .from('recipes')
            .update({ instructions, version: 1 })
            .eq('id', recipeId);
          if (updateError) throw updateError;
        } else {
          const { data: newRow, error: insertError } = await supabase
            .from('recipes')
            .insert({
              menu_item_id: menuItemId,
              instructions,
              version: 1,
              tenant_id: tenant?.id
            })
            .select()
            .single();
          if (insertError) throw insertError;
          recipeId = newRow.id;
        }

        const { error: deleteError } = await supabase
          .from('recipe_ingredients')
          .delete()
          .eq('recipe_id', recipeId);
        if (deleteError) throw deleteError;

        if (recipeIngredients.length > 0) {
          const ingredientsPayload = recipeIngredients.map(ing => ({
            recipe_id: recipeId,
            item_id: ing.item_id,
            quantity_base_unit: ing.qty,
            tenant_id: tenant?.id
          }));

          const { error: insertIngsError } = await supabase
            .from('recipe_ingredients')
            .insert(ingredientsPayload);
          if (insertIngsError) throw insertIngsError;
        }
      } else {
        // Clear existing recipe associations if converting to retail/service
        let { data: recipeRow } = await supabase
          .from('recipes')
          .select('id')
          .eq('menu_item_id', menuItemId)
          .maybeSingle();

        if (recipeRow) {
          await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeRow.id);
          await supabase.from('recipes').delete().eq('id', recipeRow.id);
        }
      }

      showSuccess(selectedItem 
        ? (isRestaurant ? 'Menu item and recipe updated!' : 'Catalog item updated!') 
        : (isRestaurant ? 'Menu item and recipe created!' : 'Catalog item created!'));

      // Save category to session Categories if it is not already in the main list
      if (!categoriesList.includes(trimmedCategory)) {
        setSessionCategories(prev => [...prev, trimmedCategory]);
      }

      await loadData();
      setShowItemModal(false);
    } catch (err: any) {
      console.error(err);
      showError(err.message || (isRestaurant ? 'Error saving menu item and recipe' : 'Error saving catalog item'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteItem = async (item: MenuItem) => {
    const itemLabel = isRestaurant ? 'menu item' : 'catalog item';
    if (!await confirm('Delete Catalog Item', `Are you sure you want to delete "${item.name}"? This action cannot be undone.`)) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', item.id);
        
      if (error) {
        if (error.code === '23503') {
          showError(`Cannot delete this ${itemLabel} because it is referenced in past checkout transactions or sales history. You can change its status to "Inactive" instead.`);
        } else {
          throw error;
        }
      } else {
        showSuccess(`Successfully deleted "${item.name}".`);
        await loadData();
      }
    } catch (err: any) {
      console.error('Error deleting item:', err);
      showError(err.message || `Error deleting ${itemLabel}`);
    }
  };

  const handleAddIngredient = () => {
    if (!currentSelectedItemId) return;
    const exists = recipeIngredients.find(ri => ri.item_id === currentSelectedItemId);
    if (exists) {
      showError("Ingredient already added to recipe.");
      return;
    }
    setRecipeIngredients([
      ...recipeIngredients,
      { item_id: currentSelectedItemId, qty: Number(currentQty) }
    ]);
  };

  const handleRemoveIngredient = (index: number) => {
    setRecipeIngredients(recipeIngredients.filter((_, i) => i !== index));
  };

  const isEditor = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  const totalPages = Math.ceil(menuItems.length / itemsPerPage);
  const paginatedItems = menuItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <ChefHat className="w-8 h-8 text-primary" />
            <span>{isRestaurant ? "Recipes & Menu Mapping" : "Products & Services Catalog"}</span>
          </h2>
          <p className="text-muted-foreground mt-1">
            {isRestaurant 
              ? "Map retail dishes sold at the POS to raw inventory ingredients for automatic deduction." 
              : "Create and manage products and labor/repair services sold at the POS."}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {isEditor && (
            <Button onClick={handleOpenItemCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {isRestaurant ? "Create Menu Item" : "Create Product/Service"}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">{isRestaurant ? "Menu Dish" : "Product / Service"}</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">{isRestaurant ? "Ingredient Cost" : "Estimated Cost"}</TableHead>
                <TableHead className="text-right">Profit (Margin)</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedItems.map(item => {
                const cost = calculateItemCost(item);
                const profit = Number(item.price) - cost;
                const margin = Number(item.price) > 0 ? (profit / Number(item.price)) * 100 : 0;

                return (
                  <TableRow key={item.id}>
                    <TableCell className="pl-6 font-bold">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono">{item.sku}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {item.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold">₱{Number(item.price).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">₱{cost.toFixed(2)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-bold ${margin > 50 ? 'text-emerald-500' : margin > 30 ? 'text-primary' : 'text-amber-500'}`}>
                        ₱{profit.toFixed(2)} <span className="text-[10px] font-normal text-muted-foreground">({margin.toFixed(1)}%)</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.is_available ? "default" : "destructive"} className="text-[9px] uppercase">
                        {item.is_available ? 'In Stock' : 'Out of Stock'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'active' ? "outline" : "secondary"} className="text-[9px] uppercase">
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <div className="flex justify-end space-x-1">
                        {isEditor && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => handleOpenItemEdit(item)} title="Edit Item Info">
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteItem(item)} title="Delete Item">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button variant="outline" size="sm" className="h-8 text-primary border-primary hover:bg-primary/10" onClick={() => handleOpenItemEdit(item)}>
                          <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                          {item.type === 'retail' ? "Link Stock Item" : item.type === 'service' ? "Edit Details" : "Map Ingredients"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}

              {menuItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    {isRestaurant ? "No menu items found. Get started by clicking 'Create Menu Item'." : "No catalog products or services found. Click 'Create Product/Service' to add one."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="py-4 border-t">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <PaginationItem key={i}>
                      <PaginationLink 
                        onClick={() => setCurrentPage(i + 1)}
                        isActive={currentPage === i + 1}
                        className="cursor-pointer"
                      >
                        {i + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showItemModal} onOpenChange={setShowItemModal}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 border-b shrink-0">
            <DialogTitle>
              {selectedItem 
                ? (isRestaurant ? 'Edit Menu Item & Recipe' : 'Edit Product / Service') 
                : (isRestaurant ? 'New Menu Item & Recipe' : 'New Product / Service')}
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="flex-1">
            <form id="recipe-form" onSubmit={handleSaveMenuItem} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left Column: Menu Item Details */}
                <div className="space-y-6">
                  <div className="pb-2 border-b">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                      {isRestaurant ? "Dish Details" : "Product / Service Details"}
                    </h4>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>{isRestaurant ? "Dish Name *" : "Product / Service Name *"}</Label>
                    <Input 
                      required 
                      value={itemName} 
                      onChange={(e) => setItemName(e.target.value)} 
                      placeholder={isRestaurant ? "e.g. Classic Beef Burger" : "e.g. Inner Tube 26x1.95 / Repair Labor"} 
                    />
                  </div>

                  {!isRestaurant && (
                    <div className="space-y-2">
                      <Label>Catalog Item Type *</Label>
                      <Select value={productType} onValueChange={(val: any) => setProductType(val)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="retail">Retail Part / Item (1-to-1 Stock Deduction)</SelectItem>
                          <SelectItem value="service">Service / Labor (No Stock Deduction)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {productType === 'retail' && (
                    <div className="space-y-2">
                      <Label>Linked Inventory / Part Stock Item *</Label>
                      <Select 
                        value={inventoryItemId || ''} 
                        onValueChange={(val) => {
                          setInventoryItemId(val);
                          const catalogItem = catalog.find(c => c.id === val);
                          if (catalogItem) {
                            setCostPrice(Number(catalogItem.cost_per_base_unit) || 0);
                            if (catalogItem.selling_price) {
                              setPrice(Number(catalogItem.selling_price));
                            }
                          }
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Search or select stock item" /></SelectTrigger>
                        <SelectContent>
                          {catalog.map(item => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.item_name} ({item.base_unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">When sold, 1 unit will be deducted from this linked stock item.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>SKU *</Label>
                      <Input required value={sku} onChange={(e) => setSku(e.target.value)} className="font-mono" />
                    </div>
                    <div className="space-y-2">
                      <Label>Category *</Label>
                      {isCustomCategory ? (
                        <div className="flex space-x-2">
                          <Input
                            required
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            placeholder="Enter custom category"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setIsCustomCategory(false);
                              setCategory(isRestaurant ? 'Burgers' : 'General');
                            }}
                          >
                            Existing
                          </Button>
                        </div>
                      ) : (
                        <Select 
                          value={category} 
                          onValueChange={(val) => {
                            if (val === 'ADD_CUSTOM') {
                              setIsCustomCategory(true);
                              setCategory('');
                            } else {
                              setCategory(val);
                            }
                          }}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {categoriesList.map(cat => (
                              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                            <SelectItem value="ADD_CUSTOM" className="text-primary font-semibold">
                              + Add Custom Category...
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>
                        {productType === 'restaurant' 
                          ? 'Price (₱) *' 
                          : productType === 'service' 
                            ? 'Retail Price (₱) (Optional)' 
                            : 'Retail Price (₱) *'}
                      </Label>
                      <Input 
                        type="number" 
                        step="0.01" 
                        required={productType !== 'service'} 
                        value={price} 
                        onChange={(e) => setPrice(e.target.value === '' ? 0 : Number(e.target.value))} 
                        disabled={productType === 'retail' && !!inventoryItemId}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={itemStatus} onValueChange={(v: any) => setItemStatus(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {productType !== 'restaurant' && (
                    <div className="space-y-2 pt-2">
                      <Label>
                        {productType === 'service' 
                          ? 'Cost Price (₱) (Optional)' 
                          : 'Cost Price (₱) *'}
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        required={productType !== 'service'}
                        value={costPrice}
                        onChange={(e) => setCostPrice(e.target.value === '' ? 0 : Number(e.target.value))}
                        disabled={productType === 'retail' && !!inventoryItemId}
                      />
                      {productType === 'retail' && !!inventoryItemId && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Auto-synced from linked inventory stock item.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex items-center space-x-2 pt-2">
                    <input
                      type="checkbox"
                      id="isAvailable"
                      checked={isAvailable}
                      onChange={(e) => setIsAvailable(e.target.checked)}
                      className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                    />
                    <Label htmlFor="isAvailable" className="cursor-pointer font-normal">
                      Available for Sale (POS check)
                    </Label>
                  </div>
                </div>

                {/* Right Column: Recipe & Ingredients Mapping or Type Specific Config */}
                <div className="space-y-6">
                  <div className="pb-2 border-b">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                      {productType === 'restaurant' ? 'Recipe & Ingredients' : 'Profitability Summary'}
                    </h4>
                  </div>

                  <Card className="bg-muted/50 border-border/50">
                    <CardContent className="p-4 flex justify-between text-center">
                      <div className="flex-1 border-r border-border/50">
                        <span className="text-[10px] text-muted-foreground block uppercase font-bold tracking-wider mb-1">
                          {productType === 'restaurant' ? 'Est. Cost' : 'Unit Cost'}
                        </span>
                        <span className="font-bold text-sm">₱{resolvedCost.toFixed(2)}</span>
                      </div>
                      <div className="flex-1 border-r border-border/50">
                        <span className="text-[10px] text-muted-foreground block uppercase font-bold tracking-wider mb-1">Est. Profit</span>
                        <span className="font-bold text-sm">₱{currentProfit.toFixed(2)}</span>
                      </div>
                      <div className="flex-1">
                        <span className="text-[10px] text-muted-foreground block uppercase font-bold tracking-wider mb-1">Margin</span>
                        <span className={`font-extrabold text-sm ${currentMargin > 50 ? 'text-emerald-500' : currentMargin > 30 ? 'text-primary' : 'text-amber-500'}`}>
                          {currentMargin.toFixed(1)}%
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  {productType === 'restaurant' && (
                    <>

                      <div className="space-y-2">
                        <Label>Preparation Instructions / Steps</Label>
                        <Textarea
                          value={instructions}
                          onChange={(e) => setInstructions(e.target.value)}
                          placeholder="e.g. Sear patty, toast bun, place sauce..."
                          rows={3}
                        />
                      </div>

                      {isEditor ? (
                        <Card className="bg-muted/30">
                          <CardContent className="p-4 space-y-3">
                            <Label className="text-[10px] uppercase">Add Ingredient to Recipe</Label>
                            <div className="flex gap-2 items-center">
                              <div className="flex-1 min-w-0">
                                <Select value={currentSelectedItemId} onValueChange={setCurrentSelectedItemId}>
                                  <SelectTrigger className="w-full h-9"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {catalog.map(item => (
                                      <SelectItem key={item.id} value={item.id}>
                                        {item.item_name} ({item.base_unit})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Input
                                type="number"
                                step="any"
                                value={currentQty || ''}
                                onChange={(e) => setCurrentQty(Number(e.target.value))}
                                placeholder="Qty"
                                className="w-20 h-9 shrink-0"
                              />
                              <Button type="button" size="sm" className="h-9 px-3 shrink-0" onClick={handleAddIngredient}>
                                Add
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ) : (
                        <p className="text-xs text-muted-foreground">Only editors can manage recipe ingredient links.</p>
                      )}

                      <div className="border rounded-md overflow-hidden max-h-48 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              <TableHead className="pl-4 h-8 text-xs">Ingredient</TableHead>
                              <TableHead className="text-right h-8 text-xs">Qty Needed</TableHead>
                              <TableHead className="w-12 h-8 text-center text-xs pr-4"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {recipeIngredients.map((ing, idx) => {
                              const info = catalog.find(c => c.id === ing.item_id);
                              return (
                                <TableRow key={idx}>
                                  <TableCell className="pl-4 font-semibold text-xs py-2">{info?.item_name || 'Unknown'}</TableCell>
                                  <TableCell className="text-right font-bold text-xs py-2">
                                    {ing.qty} {info?.base_unit}
                                  </TableCell>
                                  <TableCell className="text-center pr-4 py-2">
                                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleRemoveIngredient(idx)}>
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                            {recipeIngredients.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={3} className="text-center p-4 text-xs text-muted-foreground">
                                  No ingredients mapped. Real-time deduction is disabled for this {isRestaurant ? 'dish' : 'item'}.
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}

                  {productType === 'retail' && (
                    <div className="space-y-4">
                      <div className="pb-2 border-b">
                        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Retail Catalog Configuration</h4>
                      </div>
                      <Card className="bg-muted/20 border-border/80">
                        <CardContent className="p-6 text-center space-y-4">
                          <div className="mx-auto w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
                            <Plus className="w-6 h-6 animate-pulse" />
                          </div>
                          <div className="space-y-1">
                            <h5 className="font-bold text-sm">Retail Product (1-to-1 Deduction)</h5>
                            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                              This retail catalog item is configured to deduct exactly 1 unit of the linked inventory stock item upon successful checkout. No multi-ingredient recipe mapping is required.
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {productType === 'service' && (
                    <div className="space-y-4">
                      <div className="pb-2 border-b">
                        <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Service Catalog Configuration</h4>
                      </div>
                      <Card className="bg-muted/20 border-border/80">
                        <CardContent className="p-6 text-center space-y-4">
                          <div className="mx-auto w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-500">
                            <ChefHat className="w-6 h-6 animate-pulse" />
                          </div>
                          <div className="space-y-1">
                            <h5 className="font-bold text-sm">Labor & Service Billing Item</h5>
                            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                              This catalog item represents a labor charge, repair service, or flat-rate fee. Checkout transactions of this item bypass all inventory stock deductions.
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              </div>
            </form>
          </ScrollArea>
          
          <DialogFooter className="p-6 border-t shrink-0">
            <Button type="button" variant="outline" onClick={() => setShowItemModal(false)}>Cancel</Button>
            <Button type="submit" form="recipe-form" disabled={isSaving}>
              {isSaving ? 'Saving...' : (isRestaurant ? 'Save Menu Item & Recipe' : 'Save Product / Service')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
