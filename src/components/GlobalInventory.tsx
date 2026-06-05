import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Search, RefreshCw, AlertTriangle, Layers, Eye, ChevronDown, ChevronUp, BarChart3, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';

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
                <TableHead className="w-10 pl-6"></TableHead>
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
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    No items found matching your search.
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map(item => {
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <React.Fragment key={item.id}>
                      <TableRow 
                        onClick={() => toggleExpand(item.id)}
                        className="cursor-pointer"
                      >
                        <TableCell className="pl-6 text-muted-foreground">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-muted-foreground font-semibold">{item.sku}</TableCell>
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
                          <Button variant="ghost" size="sm" className="h-8">
                            <Eye className="w-4 h-4 mr-2" />
                            Show Split
                          </Button>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={7} className="p-0 border-l-2 border-primary">
                            <div className="p-6">
                              <div className="flex items-center justify-between mb-4">
                                <h4 className="text-sm font-bold text-primary uppercase tracking-wider">
                                  Branch Stock Breakdown: {item.item_name}
                                </h4>
                                <span className="text-[10px] text-muted-foreground font-medium">
                                  Base Reorder Trigger: <span className="text-foreground font-bold">{item.reorder_level} {item.base_unit}</span>
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {item.breakdown.map(br => {
                                  const isLow = br.quantity < item.reorder_level;
                                  const isSelectedBranch = br.branch_id === selectedBranchId;
                                  return (
                                    <div 
                                      key={br.branch_id} 
                                      className={`p-4 rounded-lg border flex flex-col justify-between space-y-2 transition-all ${
                                        isSelectedBranch
                                          ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                          : isLow 
                                            ? 'border-destructive/50 bg-destructive/5' 
                                            : 'bg-background/50'
                                      }`}
                                    >
                                      <div className="flex items-start justify-between">
                                        <div>
                                          <span className="text-sm font-bold truncate block max-w-[150px]">
                                            {br.branch_name}
                                          </span>
                                          <span className="text-[10px] text-muted-foreground uppercase font-medium">
                                            {br.is_warehouse ? 'Warehouse / Main' : 'Sales Branch'}
                                          </span>
                                        </div>
                                        
                                        {isLow && (
                                          <Badge variant="destructive" className="h-5 px-1.5 text-[9px] uppercase">
                                            <AlertTriangle className="w-3 h-3 mr-1" />
                                            Low Stock
                                          </Badge>
                                        )}
                                      </div>

                                      <div className="flex items-end justify-between pt-2 border-t">
                                        <div>
                                          <span className="text-[10px] text-muted-foreground block">Quantity</span>
                                          <span className="text-base font-black">
                                            {br.quantity.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{item.base_unit}</span>
                                          </span>
                                        </div>
                                        <div className="text-right">
                                          <span className="text-[10px] text-muted-foreground block">Valuation</span>
                                          <span className="text-sm font-bold text-emerald-500">
                                            {formatPHP(br.quantity * item.cost_per_base_unit)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
