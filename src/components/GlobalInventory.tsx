import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, ExclamationTriangleIcon as AlertTriangle, LayersIcon as Layers, EyeOpenIcon as Eye, BarChartIcon as BarChart3, ExclamationTriangleIcon as ShieldAlert } from '@radix-ui/react-icons';
import { LayoutGrid, List, Store, Warehouse, Building2 } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import { DataTablePagination } from "./ui/DataTablePagination";
import { fetchPortionPackSizes, formatPackSizes } from '../lib/packSizes';

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
  purchase_unit?: string;
  conversion_factor?: number;
  pack_sizes?: number[];
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
  const [viewMode, setViewMode] = useState<'matrix' | 'summary'>('matrix');
  const [splitViewItem, setSplitViewItem] = useState<GlobalStockItem | null>(null);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory, selectedBranchId]);

  // Order branches: parent branches only (sub-stores roll up under their parent branch)
  // Central warehouses first, then sales branches alphabetically
  const displayBranches = useMemo(() => {
    return branches
      .filter(b => !b.parent_id && (b.status || 'active') === 'active')
      .sort((a, b) => {
        if (a.is_warehouse && !b.is_warehouse) return -1;
        if (!a.is_warehouse && b.is_warehouse) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [branches]);

  const loadGlobalStockData = async () => {
    setLoading(true);
    try {
      const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('status', 'active')
        .order('item_name');
      
      if (itemsError) throw itemsError;

      const { data: balances, error: balancesError } = await supabase
        .from('inventory_balances')
        .select('branch_id, item_id, quantity');
      
      if (balancesError) throw balancesError;

      const portionPackSizes = await fetchPortionPackSizes();

      const parentBranchesList = branches
        .filter(b => !b.parent_id && (b.status || 'active') === 'active')
        .sort((a, b) => {
          if (a.is_warehouse && !b.is_warehouse) return -1;
          if (!a.is_warehouse && b.is_warehouse) return 1;
          return a.name.localeCompare(b.name);
        });

      const mappedItems: GlobalStockItem[] = (items || []).map(item => {
        const itemBalances = (balances || []).filter(b => b.item_id === item.id);
        
        const totalQty = itemBalances.reduce((sum, b) => sum + Number(b.quantity), 0);
        const valuation = totalQty * Number(item.cost_per_base_unit);

        const breakdown: BranchBalance[] = parentBranchesList.map(parent => {
          // Roll up inventory of child sub-stores under their parent branch
          const childIds = branches.filter(b => b.parent_id === parent.id).map(b => b.id);
          const relevantBranchIds = new Set([parent.id, ...childIds]);

          const branchTotalQty = itemBalances
            .filter(b => relevantBranchIds.has(b.branch_id))
            .reduce((sum, b) => sum + Number(b.quantity), 0);

          return {
            branch_id: parent.id,
            branch_name: parent.name,
            is_warehouse: parent.is_warehouse,
            quantity: branchTotalQty
          };
        });

        return {
          id: item.id,
          sku: item.sku,
          item_name: item.item_name,
          category: item.category,
          base_unit: item.base_unit,
          purchase_unit: item.purchase_unit,
          // Portioned items come in several pack sizes, so no single pack factor applies
          conversion_factor: portionPackSizes[item.id] ? 1 : (item.conversion_factor ? Number(item.conversion_factor) : 1),
          pack_sizes: portionPackSizes[item.id],
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

  const categories = ['All', ...new Set(stockItems.map(item => item.category))];

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

  const filteredItems = itemsWithDisplayValues.filter(item => {
    const matchesSearch = 
      item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);
  const paginatedItems = filteredItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const displayTotalItems = itemsWithDisplayValues.length;
  const displayTotalValuation = itemsWithDisplayValues.reduce((sum, item) => sum + item.display_valuation, 0);

  const displayLowStockCount = itemsWithDisplayValues.reduce((sum, item) => {
    if (selectedBranchId === 'All') {
      const branchAlerts = item.breakdown.filter(b => b.quantity < item.reorder_level).length;
      return sum + branchAlerts;
    } else {
      return sum + (item.display_quantity < item.reorder_level ? 1 : 0);
    }
  }, 0);

  const openSplitView = (item: GlobalStockItem) => {
    setSplitViewItem(item);
  };

  const formatPHP = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const isMatrix = selectedBranchId === 'All' && viewMode === 'matrix';
  const colSpanCount = isMatrix ? 3 + displayBranches.length + 3 : 6;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <Layers className="w-8 h-8 text-primary" />
            <span>Overall Inventory Stock</span>
          </h2>
          <p className="text-muted-foreground">Aggregated stock balances and valuation across all branches and warehouses.</p>
        </div>

        <Button onClick={loadGlobalStockData} disabled={loading} variant="outline" size="icon">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-8">
        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-primary/10 rounded-lg text-primary border border-primary/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Total Catalog Items</span>
              <span className="text-2xl font-bold">{displayTotalItems}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">
                {selectedBranchId === 'All' ? 'Total Global Stock Valuation' : 'Branch Stock Valuation'}
              </span>
              <span className="text-2xl font-bold">{formatPHP(displayTotalValuation)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-amber-500/10 rounded-lg text-amber-500 border border-amber-500/20">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">
                {selectedBranchId === 'All' ? 'Low Stock Branch Alerts' : 'Branch Low Stock Alerts'}
              </span>
              <span className="text-2xl font-bold">{displayLowStockCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-blue-500/10 rounded-lg text-blue-500 border border-blue-500/20">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">
                Branches & Hubs
              </span>
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold">{displayBranches.length}</span>
                <span className="text-xs text-muted-foreground font-medium">
                  ({displayBranches.filter(b => b.is_warehouse).length} whs · {displayBranches.filter(b => !b.is_warehouse).length} branches)
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col lg:flex-row gap-4 justify-between items-start lg:items-center mb-6">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
          <Input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search items by name or SKU..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* View Mode Toggle (Matrix vs Summary) - available when All Branches is chosen */}
          {selectedBranchId === 'All' && (
            <div className="inline-flex items-center p-1 bg-muted/60 rounded-lg border border-border/50">
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${
                  viewMode === 'matrix'
                    ? 'bg-background text-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="View stock across all branches side-by-side"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Matrix View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('summary')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all ${
                  viewMode === 'summary'
                    ? 'bg-background text-foreground shadow-sm font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="View aggregated total stock"
              >
                <List className="w-3.5 h-3.5" />
                <span>Summary View</span>
              </button>
            </div>
          )}

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">Branch:</span>
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-full sm:w-[190px]">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Branches (Global)</SelectItem>
                {displayBranches.map(br => (
                  <SelectItem key={br.id} value={br.id}>
                    {br.name} {br.is_warehouse ? '(Whs)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">Category:</span>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full sm:w-[150px]">
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
      </div>

      {/* Main Aggregated / Matrix Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto w-full">
            <Table className={isMatrix ? "min-w-[1000px]" : "w-full"}>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[100px] pl-6">SKU</TableHead>
                  <TableHead className="min-w-[200px]">Item Name</TableHead>
                  <TableHead className="min-w-[110px]">Category</TableHead>

                  {isMatrix ? (
                    <>
                      {displayBranches.map(br => (
                        <TableHead key={br.id} className="text-right whitespace-nowrap min-w-[130px] px-3">
                          <div className="flex flex-col items-end">
                            <span className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
                              {br.is_warehouse ? (
                                <Warehouse className="w-3.5 h-3.5 text-primary shrink-0" />
                              ) : (
                                <Store className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              )}
                              <span className="truncate max-w-[115px]" title={br.name}>
                                {br.name}
                              </span>
                            </span>
                            <span className="text-[10px] text-muted-foreground font-normal">
                              {br.is_warehouse ? 'Warehouse' : 'Sales Branch'}
                            </span>
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="text-right min-w-[120px] font-bold">Total Stock</TableHead>
                      <TableHead className="text-right min-w-[120px] font-bold">Est. Valuation</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="text-right">
                        {selectedBranchId === 'All' ? 'Total Quantity' : 'Branch Quantity'}
                      </TableHead>
                      <TableHead className="text-right">
                        {selectedBranchId === 'All' ? 'Est. Valuation' : 'Branch Valuation'}
                      </TableHead>
                    </>
                  )}

                  <TableHead className="text-right pr-6 min-w-[90px]">Breakdown</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={colSpanCount} className="h-28 text-center">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                      Fetching global inventory balances...
                    </TableCell>
                  </TableRow>
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colSpanCount} className="h-28 text-center text-muted-foreground">
                      No items found matching your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedItems.map(item => {
                    return (
                      <TableRow 
                        key={item.id}
                        onClick={() => openSplitView(item)}
                        className="cursor-pointer hover:bg-muted/30 transition-colors group"
                      >
                        <TableCell className="font-mono text-muted-foreground font-semibold pl-6 whitespace-nowrap">
                          {item.sku}
                        </TableCell>
                        <TableCell className="font-bold">
                          <div className="flex flex-col">
                            <span className="group-hover:text-primary transition-colors">{item.item_name}</span>
                            {item.conversion_factor && Number(item.conversion_factor) > 1 && (
                              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 font-semibold w-fit mt-0.5 font-mono">
                                1 {item.purchase_unit || (item.base_unit === 'pack' ? 'pack' : 'pkg')} = {item.conversion_factor} {item.base_unit === 'pack' ? 'pcs' : item.base_unit}
                              </Badge>
                            )}
                            {item.pack_sizes && (
                              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 font-semibold w-fit mt-0.5 font-mono">
                                {formatPackSizes(item.pack_sizes, item.base_unit)}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="secondary" className="text-[10px] uppercase font-semibold">
                            {item.category}
                          </Badge>
                        </TableCell>

                        {isMatrix ? (
                          <>
                            {displayBranches.map(br => {
                              const branchBal = item.breakdown.find(b => b.branch_id === br.id);
                              const qty = branchBal ? branchBal.quantity : 0;
                              const isOut = qty === 0;
                              const isLow = !isOut && qty <= item.reorder_level;

                              return (
                                <TableCell key={br.id} className="text-right px-3 whitespace-nowrap">
                                  {isOut ? (
                                    <div className="inline-flex flex-col items-end">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-destructive/15 text-destructive border border-destructive/25">
                                        0 <span className="text-[10px] font-normal ml-0.5">{item.base_unit}</span>
                                      </span>
                                      <span className="text-[9px] font-semibold text-destructive uppercase tracking-tight mt-0.5">
                                        Out of stock
                                      </span>
                                    </div>
                                  ) : isLow ? (
                                    <div className="inline-flex flex-col items-end">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                        <AlertTriangle className="w-3 h-3 mr-1 shrink-0" />
                                        {qty.toLocaleString()} <span className="text-[10px] font-normal ml-0.5">{item.base_unit}</span>
                                      </span>
                                      <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-tight mt-0.5">
                                        Low stock
                                      </span>
                                    </div>
                                  ) : (
                                    <div className="inline-flex flex-col items-end">
                                      <span className="text-sm font-semibold tabular-nums text-foreground">
                                        {qty.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">{item.base_unit}</span>
                                      </span>
                                    </div>
                                  )}
                                </TableCell>
                              );
                            })}

                            <TableCell className="text-right font-bold whitespace-nowrap">
                              <div>
                                <span className="text-sm">{item.total_quantity.toLocaleString()}</span>{' '}
                                <span className="text-[10px] font-normal text-muted-foreground">{item.base_unit}</span>
                              </div>
                              {item.conversion_factor && Number(item.conversion_factor) > 1 && (
                                <div className="text-[11px] font-normal text-muted-foreground font-mono">
                                  {item.base_unit === 'pack' ? (
                                    <span>(= {(item.total_quantity * Number(item.conversion_factor)).toLocaleString()} pcs)</span>
                                  ) : (
                                    <span>(≈ {(item.total_quantity / Number(item.conversion_factor)).toFixed(1)} packs)</span>
                                  )}
                                </div>
                              )}
                            </TableCell>

                            <TableCell className="text-right font-bold text-emerald-500 whitespace-nowrap">
                              {formatPHP(item.total_valuation)}
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="text-right font-bold">
                              <div>
                                <span>{item.display_quantity.toLocaleString()}</span> <span className="text-[10px] font-normal text-muted-foreground">{item.base_unit}</span>
                              </div>
                              {item.conversion_factor && Number(item.conversion_factor) > 1 && (
                                <div className="text-[11px] font-normal text-muted-foreground font-mono">
                                  {item.base_unit === 'pack' ? (
                                    <span>(= {(item.display_quantity * Number(item.conversion_factor)).toLocaleString()} pcs)</span>
                                  ) : (
                                    <span>(≈ {(item.display_quantity / Number(item.conversion_factor)).toFixed(1)} packs)</span>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-bold text-emerald-500">
                              {formatPHP(item.display_valuation)}
                            </TableCell>
                          </>
                        )}

                        <TableCell className="text-right pr-6 whitespace-nowrap">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 text-xs hover:bg-primary/10 hover:text-primary" 
                            onClick={(e) => { e.stopPropagation(); openSplitView(item); }}
                          >
                            <Eye className="w-3.5 h-3.5 mr-1.5" />
                            Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Matrix Legend */}
          {isMatrix && !loading && filteredItems.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 bg-muted/20 border-t text-xs text-muted-foreground">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="font-semibold text-foreground">Status Legend:</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-foreground/60 inline-block" />
                  Healthy Stock
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                  Low Stock (≤ Reorder level)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
                  Out of Stock (0)
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <Warehouse className="w-3.5 h-3.5 text-primary" /> Warehouse / Central
                </span>
                <span className="flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5" /> Sales Branch
                </span>
              </div>
            </div>
          )}

          <div className="border-t">
            <DataTablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={filteredItems.length}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
              onItemsPerPageChange={setItemsPerPage}
              showPageSizeSelector={true}
              pageSizeOptions={[10, 20, 50, 100]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Split View Drawer */}
      <Sheet open={!!splitViewItem} onOpenChange={(open) => { if (!open) setSplitViewItem(null); }}>
        <SheetContent side="right" className="w-[90vw] sm:w-[500px] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-xl font-bold">Branch Stock Breakdown</SheetTitle>
            <SheetDescription className="flex flex-col gap-1">
              <span className="font-bold text-foreground text-lg">{splitViewItem?.item_name}</span>
              <span className="font-mono text-xs">SKU: {splitViewItem?.sku}</span>
              <span className="text-xs mt-2">
                Reorder Alert Level: <span className="font-bold text-foreground">{splitViewItem?.reorder_level} {splitViewItem?.base_unit}</span>
              </span>
            </SheetDescription>
          </SheetHeader>

          {splitViewItem && (
            <div className="space-y-4 pb-10">
              {splitViewItem.breakdown.map(br => {
                const isOut = br.quantity === 0;
                const isLow = !isOut && br.quantity <= splitViewItem.reorder_level;
                const isSelectedBranch = br.branch_id === selectedBranchId;
                return (
                  <div 
                    key={br.branch_id} 
                    className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between space-y-3 transition-all ${
                      isSelectedBranch
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : isOut
                          ? 'border-destructive/40 bg-destructive/5'
                          : isLow 
                            ? 'border-amber-500/40 bg-amber-500/5' 
                            : 'bg-background/80 hover:bg-muted/20'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-base font-bold flex items-center gap-1.5">
                          {br.is_warehouse ? (
                            <Warehouse className="w-4 h-4 text-primary" />
                          ) : (
                            <Store className="w-4 h-4 text-muted-foreground" />
                          )}
                          {br.branch_name}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
                          {br.is_warehouse ? 'Warehouse / Central Hub' : 'Sales Branch'}
                        </span>
                      </div>
                      
                      {isOut ? (
                        <Badge variant="destructive" className="uppercase px-2 py-0.5 text-[10px] font-bold">
                          Out of Stock
                        </Badge>
                      ) : isLow ? (
                        <Badge variant="outline" className="uppercase px-2 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">
                          <AlertTriangle className="w-3 h-3 mr-1 inline" />
                          Low Stock
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="uppercase px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30">
                          Healthy
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-end justify-between pt-3 border-t">
                      <div>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Available Qty</span>
                        <span className="text-xl font-black">
                          {br.quantity.toLocaleString()} <span className="text-sm font-semibold text-muted-foreground ml-0.5">{splitViewItem.base_unit}</span>
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-0.5">Est. Value</span>
                        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          {formatPHP(br.quantity * splitViewItem.cost_per_base_unit)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};
