import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
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
  const { showSuccess, showError } = useModal();
  
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

  // Custom Category States
  const [sessionCategories, setSessionCategories] = useState<string[]>([]);
  const [isCustomCategory, setIsCustomCategory] = useState(false);

  // Dynamic category list combining defaults, database menu items, and session-defined ones
  const categoriesList = useMemo(() => {
    const defaults = ['Burgers', 'Sides', 'Beverages', 'Desserts'];
    const fromItems = menuItems.map(item => item.category).filter(Boolean);
    return Array.from(new Set([...defaults, ...fromItems, ...sessionCategories]));
  }, [menuItems, sessionCategories]);

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
        .select('id, item_name, base_unit, cost_per_base_unit')
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
    setIsCustomCategory(false);
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
    setShowItemModal(true);
  };

  const handleOpenItemEdit = async (item: MenuItem) => {
    setSelectedItem(item);
    setItemName(item.name);
    setSku(item.sku);
    setCategory(item.category);
    setIsCustomCategory(false);
    setPrice(item.price);
    setItemStatus(item.status);
    setIsAvailable(item.is_available);
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
            version: 1
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
          quantity_base_unit: ing.qty
        }));

        const { error: insertIngsError } = await supabase
          .from('recipe_ingredients')
          .insert(ingredientsPayload);
        if (insertIngsError) throw insertIngsError;
      }

      showSuccess(selectedItem ? 'Menu item and recipe updated!' : 'Menu item and recipe created!');

      // Save category to session Categories if it is not already in the main list
      if (!categoriesList.includes(trimmedCategory)) {
        setSessionCategories(prev => [...prev, trimmedCategory]);
      }

      await loadData();
      setShowItemModal(false);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error saving menu item and recipe');
    } finally {
      setIsSaving(false);
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
            <span>Recipes & Menu Mapping</span>
          </h2>
          <p className="text-muted-foreground mt-1">Map retail dishes sold at the POS to raw inventory ingredients for automatic deduction.</p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {isEditor && (
            <Button onClick={handleOpenItemCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create Menu Item
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Menu Dish</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Retail Price</TableHead>
                <TableHead className="text-right">Ingredient Cost</TableHead>
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
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenItemEdit(item)} title="Edit Item Info">
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="outline" size="sm" className="h-8 text-primary border-primary hover:bg-primary/10" onClick={() => handleOpenItemEdit(item)}>
                          <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                          Map Ingredients
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}

              {menuItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    No menu items found. Get started by clicking 'Create Menu Item'.
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
            <DialogTitle>{selectedItem ? 'Edit Menu Item & Recipe' : 'New Menu Item & Recipe'}</DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="flex-1">
            <form id="recipe-form" onSubmit={handleSaveMenuItem} className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left Column: Menu Item Details */}
                <div className="space-y-6">
                  <div className="pb-2 border-b">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Dish Details</h4>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Dish Name *</Label>
                    <Input required value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Classic Beef Burger" />
                  </div>

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
                              setCategory('Burgers');
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
                      <Label>Price (₱) *</Label>
                      <Input type="number" step="0.01" required value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Menu Status</Label>
                      <Select value={itemStatus} onValueChange={(v: any) => setItemStatus(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

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

                {/* Right Column: Recipe & Ingredients Mapping */}
                <div className="space-y-6">
                  <div className="pb-2 border-b">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Recipe & Ingredients</h4>
                  </div>

                  <Card className="bg-muted/50 border-border/50">
                    <CardContent className="p-4 flex justify-between text-center">
                      <div className="flex-1 border-r border-border/50">
                        <span className="text-[10px] text-muted-foreground block uppercase font-bold tracking-wider mb-1">Est. Cost</span>
                        <span className="font-bold text-sm">₱{currentCost.toFixed(2)}</span>
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
                        <div className="flex space-x-2">
                          <Select value={currentSelectedItemId} onValueChange={setCurrentSelectedItemId}>
                            <SelectTrigger className="flex-1 h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {catalog.map(item => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.item_name} ({item.base_unit})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            step="any"
                            value={currentQty || ''}
                            onChange={(e) => setCurrentQty(Number(e.target.value))}
                            placeholder="Qty"
                            className="w-24 h-9"
                          />
                          <Button type="button" size="sm" className="h-9 px-4" onClick={handleAddIngredient}>
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
                              No ingredients mapped. Real-time deduction is disabled for this dish.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </form>
          </ScrollArea>
          
          <DialogFooter className="p-6 border-t shrink-0">
            <Button type="button" variant="outline" onClick={() => setShowItemModal(false)}>Cancel</Button>
            <Button type="submit" form="recipe-form" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Menu Item & Recipe'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
