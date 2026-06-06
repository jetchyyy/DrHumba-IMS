import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, ExclamationTriangleIcon as AlertTriangle, LayersIcon as Layers, EyeOpenIcon as Eye, BarChartIcon as BarChart3, ExclamationTriangleIcon as ShieldAlert } from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

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
  const [splitViewItem, setSplitViewItem] = useState<GlobalStockItem | null>(null);
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory, selectedBranchId]);

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

      const mappedItems: GlobalStockItem[] = (items || []).map(item => {
        const itemBalances = (balances || []).filter(b => b.item_id === item.id);
        
        const totalQty = itemBalances.reduce((sum, b) => sum + Number(b.quantity), 0);
        const valuation = totalQty * Number(item.cost_per_base_unit);

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

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Overall Inventory Stock</h2>
          <p className="text-muted-foreground">Aggregated stock balances and valuation across all branches and warehouses.</p>
        </div>

        <Button onClick={loadGlobalStockData} disabled={loading} variant="outline" size="icon">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center mb-6">
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

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">Branch:</span>
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="All Branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Branches</SelectItem>
                {branches.map(br => (
                  <SelectItem key={br.id} value={br.id}>{br.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-xs text-muted-foreground whitespace-nowrap font-medium">Category:</span>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full sm:w-[140px]">
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

      {/* Main Aggregated Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Item Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">
                  {selectedBranchId === 'All' ? 'Total Quantity' : 'Branch Quantity'}
                </TableHead>
                <TableHead className="text-right">
                  {selectedBranchId === 'All' ? 'Est. Valuation' : 'Branch Valuation'}
                </TableHead>
                <TableHead className="text-right pr-6">Breakdown</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                    Fetching global inventory balances...
                  </TableCell>
                </TableRow>
              ) : filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No items found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedItems.map(item => {
                  return (
                    <React.Fragment key={item.id}>
                      <TableRow 
                        onClick={() => openSplitView(item)}
                        className="cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <TableCell className="font-mono text-muted-foreground font-semibold pl-6">{item.sku}</TableCell>
                        <TableCell className="font-bold">{item.item_name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            {item.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {item.display_quantity.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">{item.base_unit}</span>
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-500">
                          {formatPHP(item.display_valuation)}
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="sm" className="h-8" onClick={(e) => { e.stopPropagation(); openSplitView(item); }}>
                            <Eye className="w-4 h-4 mr-2" />
                            Show Split
                          </Button>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })
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
                const isLow = br.quantity < splitViewItem.reorder_level;
                const isSelectedBranch = br.branch_id === selectedBranchId;
                return (
                  <div 
                    key={br.branch_id} 
                    className={`p-5 rounded-xl border shadow-sm flex flex-col justify-between space-y-3 transition-all ${
                      isSelectedBranch
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : isLow 
                          ? 'border-destructive/40 bg-destructive/5' 
                          : 'bg-background/80 hover:bg-muted/20'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-base font-bold block">
                          {br.branch_name}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
                          {br.is_warehouse ? 'Warehouse / Main' : 'Sales Branch'}
                        </span>
                      </div>
                      
                      {isLow && (
                        <Badge variant="destructive" className="uppercase px-2 py-0.5 text-[10px] font-bold">
                          <AlertTriangle className="w-3 h-3 mr-1.5 inline" />
                          Low Stock
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
