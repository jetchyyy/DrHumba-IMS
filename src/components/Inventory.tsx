import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { PlusIcon as Plus, Pencil2Icon as Edit2, MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, ExclamationTriangleIcon as AlertTriangle, TrashIcon as Trash2, CubeIcon as Package } from '@radix-ui/react-icons';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { useModal } from '../contexts/ModalContext';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

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
  selling_price?: number | null;
}

interface Balance {
  item_id: string;
  quantity: number;
}

export const Inventory: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  const { tenant } = useTenant();
  const isRetail = tenant?.is_retail ?? false;
  const isService = tenant?.is_service ?? false;
  
  // Navigation Tabs: 'catalog' or 'balances'
  const [activeSubTab, setActiveSubTab] = useState<'balances' | 'catalog'>('balances');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory, activeSubTab]);
  
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
  const [sellingPrice, setSellingPrice] = useState<number | ''>('');
  const [isCustomCategory, setIsCustomCategory] = useState(false);

  const isRestaurant = tenant?.is_restaurant ?? true;

  const categoriesList = useMemo(() => {
    const defaults = isRestaurant 
      ? ['Vegetables', 'Meat', 'Dairy', 'Bakery', 'Liquid', 'Dry Goods', 'Packaging']
      : ['Parts', 'Accessories', 'Services', 'Lubricants', 'Apparel', 'Tools', 'General'];
    
    const dbCategories = items.map(i => i.category);
    const merged = Array.from(new Set([...defaults, ...dbCategories]));
    return merged.filter(c => c && c.trim().length > 0);
  }, [items, isRestaurant]);

  // Stock In state
  const [stockInItem, setStockInItem] = useState<InventoryItem | null>(null);
  const [stockInQty, setStockInQty] = useState<number>(0);
  const [stockInSubmitting, setStockInSubmitting] = useState(false);

  // Edit Stock Balance state
  const [editStockItem, setEditStockItem] = useState<InventoryItem | null>(null);
  const [editStockQty, setEditStockQty] = useState<number>(0);
  const [editStockSubmitting, setEditStockSubmitting] = useState(false);

  const loadInventoryData = async () => {
    try {
      const { data: itemsData, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .order('item_name');
      if (itemsError) throw itemsError;
      setItems(itemsData || []);

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
    setCategory(isRestaurant ? 'Vegetables' : 'Parts');
    setIsCustomCategory(false);
    setBaseUnit(isRestaurant ? 'g' : 'pc');
    setPurchaseUnit(isRestaurant ? 'g' : 'pc');
    setConversionFactor(1);
    setReorderLevel(isRestaurant ? 500 : 5);
    setCostPerBaseUnit(10.00);
    setStatus('active');
    setInitialQty(0);
    setSellingPrice('');
    setShowForm(true);
  };

  const handleOpenEditForm = (item: InventoryItem) => {
    setEditingItem(item);
    setSku(item.sku);
    setItemName(item.item_name);
    setCategory(item.category);
    setIsCustomCategory(false);
    setBaseUnit(item.base_unit);
    setPurchaseUnit(item.purchase_unit);
    setConversionFactor(item.conversion_factor);
    setReorderLevel(item.reorder_level);
    setCostPerBaseUnit(item.cost_per_base_unit);
    setStatus(item.status);
    setSellingPrice(item.selling_price || '');
    setShowForm(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!itemName.trim() || !sku.trim()) {
      showError("Name and SKU are required");
      return;
    }

    if (!editingItem && Number(initialQty) > 0 && !selectedBranch) {
      showError("Please select a branch first to record initial stock quantity.");
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
        status,
        selling_price: sellingPrice === '' ? null : Number(sellingPrice)
      };

      if (editingItem) {
        const { error } = await supabase
          .from('inventory_items')
          .update(itemPayload)
          .eq('id', editingItem.id);
        if (error) throw error;
        showSuccess("Item updated successfully!");
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
          p_created_by: profile ? profile.id : null,
          p_selling_price: sellingPrice === '' ? null : Number(sellingPrice)
        });
        if (error) throw error;
        showSuccess("Item created successfully!");
      }

      await loadInventoryData();
      setTimeout(() => setShowForm(false), 800);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error saving item. Make sure SKU is unique.');
    }
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    if (!await confirm('Delete Item', `Are you sure you want to delete ${item.item_name}?`)) {
      return;
    }
    
    try {
      const { error } = await supabase
        .from('inventory_items')
        .delete()
        .eq('id', item.id);
        
      if (error) {
        if (error.code === '23503') {
          showError(`Cannot delete "${item.item_name}" because it has existing transaction history or movements. You can set its status to "Inactive" instead.`);
        } else {
          throw error;
        }
      } else {
        showSuccess(`Item "${item.item_name}" deleted.`);
        await loadInventoryData();
      }
    } catch (err: any) {
      console.error('Error deleting item:', err);
      showError(err.message || 'Error deleting item');
    }
  };

  const handleOpenStockIn = (item: InventoryItem) => {
    setStockInItem(item);
    setStockInQty(0);
  };

  const handleStockInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockInItem || !selectedBranch || !profile) return;
    
    setStockInSubmitting(true);
    
    try {
      const { error } = await supabase.rpc('fn_stock_in_item', {
        p_branch_id: selectedBranch.id,
        p_item_id: stockInItem.id,
        p_quantity: Number(stockInQty),
        p_created_by: profile.id
      });
      
      if (error) throw error;
      
      showSuccess("Stock added successfully!");
      await loadInventoryData();
      setTimeout(() => setStockInItem(null), 800);
    } catch (err: any) {
      console.error('Error in stock in:', err);
      showError(err.message || 'Error adding stock');
    } finally {
      setStockInSubmitting(false);
    }
  };

  const handleOpenEditStock = (item: InventoryItem) => {
    setEditStockItem(item);
    const currentBal = balances.find(b => b.item_id === item.id)?.quantity || 0;
    setEditStockQty(currentBal);
  };

  const handleEditStockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editStockItem || !selectedBranch || !profile) return;
    
    setEditStockSubmitting(true);
    
    try {
      const { error } = await supabase.rpc('fn_update_stock_balance', {
        p_branch_id: selectedBranch.id,
        p_item_id: editStockItem.id,
        p_quantity: Number(editStockQty),
        p_created_by: profile.id
      });
      
      if (error) throw error;
      
      showSuccess("Stock balance updated successfully!");
      await loadInventoryData();
      setTimeout(() => setEditStockItem(null), 800);
    } catch (err: any) {
      console.error('Error in edit stock balance:', err);
      showError(err.message || 'Error updating stock balance');
    } finally {
      setEditStockSubmitting(false);
    }
  };

  const isEditor = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  const hasActionPermission = profile && (
    profile.role_name === 'super_admin' || 
    (profile.allowed_tabs && profile.allowed_tabs.includes('action_buttons'))
  );

  const filteredItems = items.filter(item => {
    const matchesSearch = item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['All', ...Array.from(new Set(items.map(i => i.category)))];

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const lowStockCount = items.filter(item => {
    if (item.status !== 'active') return false;
    const bal = balances.find(b => b.item_id === item.id);
    const qty = bal ? Number(bal.quantity) : 0;
    return qty < item.reorder_level;
  }).length;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <Package className="w-8 h-8 text-primary" />
            <span>Inventory</span>
          </h2>
          <p className="text-muted-foreground">
            {selectedBranch ? `Managing stock levels for ${selectedBranch.name}` : 'Select a branch first'}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={loadInventoryData} title="Reload Data">
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {activeSubTab === 'catalog' && isEditor && (
            <Button onClick={handleOpenCreateForm}>
              <Plus className="mr-2 h-4 w-4" />
              Create Item
            </Button>
          )}
        </div>
      </div>

      {lowStockCount > 0 && selectedBranch && (
        <Alert className="mb-6 border-destructive/50 bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" color="currentColor" />
          <AlertTitle className="text-sm font-bold">Low Stock Alert</AlertTitle>
          <AlertDescription className="text-xs">
            There {lowStockCount === 1 ? 'is' : 'are'} <strong>{lowStockCount}</strong> active item{lowStockCount === 1 ? '' : 's'} running below the designated reorder level. Please replenish stock soon.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as 'balances' | 'catalog')} className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <TabsList>
            <TabsTrigger value="balances">Stock Balances</TabsTrigger>
            <TabsTrigger value="catalog">Item Catalog</TabsTrigger>
          </TabsList>
          
          <div className="flex gap-2 w-full sm:w-auto flex-col sm:flex-row">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search items..."
                className="pl-9"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value="balances" className="m-0">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Item Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Reorder Level</TableHead>
                    <TableHead className="text-right">Stock Quantity</TableHead>
                    <TableHead className="text-right">Unit Value</TableHead>
                    <TableHead className="text-right pr-6">Total Value</TableHead>
                    {(isEditor || hasActionPermission) && <TableHead className="text-right pr-6">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedItems.map(item => {
                    const bal = balances.find(b => b.item_id === item.id);
                    const qty = bal ? Number(bal.quantity) : 0;
                    const isLow = qty < item.reorder_level;
                    const value = qty * item.cost_per_base_unit;

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="pl-6 font-semibold flex items-center space-x-2">
                          <span>{item.item_name}</span>
                          {isLow && item.status === 'active' && (
                            <Badge variant="destructive" className="h-5 px-1.5 text-[9px] animate-pulse">
                              <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                              Low
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono">{item.sku}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px] uppercase">{item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.reorder_level.toLocaleString()} {item.base_unit}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${isLow ? 'text-destructive' : ''}`}>
                          {qty.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">{item.base_unit}</span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          ₱{item.cost_per_base_unit.toFixed(2)}
                        </TableCell>
                        <TableCell className={`text-right font-semibold ${!(isEditor || hasActionPermission) ? 'pr-6' : ''}`}>
                          ₱{value.toFixed(2)}
                        </TableCell>
                        {(isEditor || hasActionPermission) && (
                          <TableCell className="text-right pr-6">
                            <div className="flex justify-end space-x-2">
                              {isEditor && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-emerald-500 border-emerald-500 hover:bg-emerald-500 hover:text-white transition-all h-7 text-xs"
                                  onClick={() => handleOpenStockIn(item)}
                                >
                                  Stock In
                                </Button>
                              )}
                              {hasActionPermission && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-blue-500 border-blue-500 hover:bg-blue-500 hover:text-white transition-all h-7 text-xs"
                                  onClick={() => handleOpenEditStock(item)}
                                >
                                  Edit
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isEditor ? 8 : 7} className="h-24 text-center text-muted-foreground">
                        No items matched your search criteria.
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
        </TabsContent>

        <TabsContent value="catalog" className="m-0">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">SKU</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Base Unit</TableHead>
                    <TableHead>Purchase Unit</TableHead>
                    <TableHead>Conversion</TableHead>
                    <TableHead>Reorder Min</TableHead>
                    <TableHead>Cost / Base</TableHead>
                    <TableHead>Status</TableHead>
                    {isEditor && <TableHead className="text-right pr-6">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedItems.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="pl-6 font-mono text-primary font-medium">{item.sku}</TableCell>
                      <TableCell className="font-bold">{item.item_name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.category}</TableCell>
                      <TableCell className="font-semibold">{item.base_unit}</TableCell>
                      <TableCell className="text-muted-foreground">{item.purchase_unit}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        1 {item.purchase_unit} = {item.conversion_factor} {item.base_unit}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.reorder_level} {item.base_unit}</TableCell>
                      <TableCell className="text-muted-foreground">₱{item.cost_per_base_unit.toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={item.status === 'active' ? 'default' : 'secondary'} className="uppercase text-[9px]">
                          {item.status}
                        </Badge>
                      </TableCell>
                      {isEditor && (
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end space-x-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEditForm(item)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteItem(item)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {filteredItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isEditor ? 10 : 9} className="h-24 text-center text-muted-foreground">
                        No items matched your search criteria.
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
        </TabsContent>
      </Tabs>

      {/* Item Form Modal */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Catalog Item' : 'New Catalog Item'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveItem} className="space-y-4 pt-4">
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
                      placeholder="Custom category"
                      className="flex-1 h-9"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => {
                        setIsCustomCategory(false);
                        setCategory(isRestaurant ? 'Vegetables' : 'Parts');
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

            <div className="space-y-2">
              <Label>Item Name *</Label>
              <Input required value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. White Onion" />
            </div>

            <div className="space-y-2">
              <Label>Unit of Measure *</Label>
              <Select value={baseUnit} onValueChange={(v) => { setBaseUnit(v); setPurchaseUnit(v); setConversionFactor(1); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="g">Grams (g)</SelectItem>
                  <SelectItem value="kg">Kilograms (kg)</SelectItem>
                  <SelectItem value="pc">Pieces (pc)</SelectItem>
                  <SelectItem value="ml">Milliliters (ml)</SelectItem>
                  <SelectItem value="L">Liters (L)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!editingItem && (
              <div className="space-y-2">
                <Label>Initial Stock Quantity ({baseUnit}) *</Label>
                <Input type="number" required min="0" step="any" value={initialQty} onChange={(e) => setInitialQty(Number(e.target.value))} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reorder Min ({baseUnit})</Label>
                <Input type="number" required value={reorderLevel} onChange={(e) => setReorderLevel(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Est. Cost per {baseUnit} (₱)</Label>
                <Input type="number" step="0.0001" required value={costPerBaseUnit} onChange={(e) => setCostPerBaseUnit(Number(e.target.value))} />
              </div>
            </div>

            {(isRetail || isService) && (
              <div className="space-y-2">
                <Label>Retail Selling Price (₱) - Optional</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="e.g. 150.00 (leave blank if not for POS sale)"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Setting a selling price automatically creates and updates a matching POS catalog product.
                </p>
              </div>
            )}

            {editingItem && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit">Save Item</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stock In Modal */}
      <Dialog open={!!stockInItem} onOpenChange={(open) => !open && setStockInItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Stock In Item</DialogTitle>
          </DialogHeader>
          {stockInItem && (
            <form onSubmit={handleStockInSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Item Name</Label>
                <div className="text-sm font-bold bg-muted border rounded-md px-3 py-2">
                  {stockInItem.item_name}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SKU</Label>
                  <div className="text-xs font-mono text-muted-foreground bg-muted border rounded-md px-3 py-2">
                    {stockInItem.sku}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Current Stock</Label>
                  <div className="text-xs bg-muted border rounded-md px-3 py-2">
                    {(balances.find(b => b.item_id === stockInItem.id)?.quantity || 0).toLocaleString()} {stockInItem.base_unit}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Quantity to Add ({stockInItem.base_unit}) *</Label>
                <Input
                  type="number"
                  required
                  min="0.0001"
                  step="any"
                  value={stockInQty || ''}
                  onChange={(e) => setStockInQty(Number(e.target.value))}
                  placeholder="Enter quantity"
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setStockInItem(null)}>Cancel</Button>
                <Button type="submit" disabled={stockInSubmitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {stockInSubmitting ? 'Stocking In...' : 'Stock In'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Stock Balance Modal */}
      <Dialog open={!!editStockItem} onOpenChange={(open) => !open && setEditStockItem(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Stock Balance</DialogTitle>
          </DialogHeader>
          {editStockItem && (
            <form onSubmit={handleEditStockSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Item Name</Label>
                <div className="text-sm font-bold bg-muted border rounded-md px-3 py-2">
                  {editStockItem.item_name}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>SKU</Label>
                  <div className="text-xs font-mono text-muted-foreground bg-muted border rounded-md px-3 py-2">
                    {editStockItem.sku}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Current Stock</Label>
                  <div className="text-xs bg-muted border rounded-md px-3 py-2">
                    {(balances.find(b => b.item_id === editStockItem.id)?.quantity || 0).toLocaleString()} {editStockItem.base_unit}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>New Stock Balance Quantity ({editStockItem.base_unit}) *</Label>
                <Input
                  type="number"
                  required
                  min="0"
                  step="any"
                  value={editStockQty === 0 ? '' : editStockQty}
                  onChange={(e) => setEditStockQty(e.target.value === '' ? 0 : Number(e.target.value))}
                  placeholder="Enter new balance"
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditStockItem(null)}>Cancel</Button>
                <Button type="submit" disabled={editStockSubmitting} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {editStockSubmitting ? 'Saving...' : 'Save Balance'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
