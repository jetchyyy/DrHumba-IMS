import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  DollarSign,
  Layers,
  Store,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Clock,
  LayoutDashboard,
  Search
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface DashboardStats {
  totalInventoryValue: number;
  totalSales: number;
  totalBranches: number;
  lowStockCount: number;
  pendingTransfersCount: number;
  todayRevenue: number;
}

interface ItemStockGrid {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: string;
  reorderLevel: number;
  cost: number;
  stocks: { [branchId: string]: number };
  totalStock: number;
}

export const Dashboard: React.FC<{ setActiveTab: (tab: string) => void }> = ({ setActiveTab }) => {
  const { branches } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryGrid, setInventoryGrid] = useState<ItemStockGrid[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [inventoryGrid.length, searchTerm]);

  const loadData = async () => {
    setRefreshing(true);
    try {
      const { data: statsData, error: statsError } = await supabase.rpc('get_overall_dashboard_stats');
      if (statsError) throw statsError;
      setStats(statsData);

      const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select('*')
        .order('item_name');
      if (itemsError) throw itemsError;

      const { data: balances, error: balancesError } = await supabase
        .from('inventory_balances')
        .select('*');
      if (balancesError) throw balancesError;

      const { data: alerts, error: alertsError } = await supabase.rpc('get_inventory_alerts');
      if (alertsError) throw alertsError;
      setLowStockItems(alerts || []);

      const grid: ItemStockGrid[] = (items || []).map(item => {
        const itemBalances = (balances || []).filter(b => b.item_id === item.id);
        const stocks: { [branchId: string]: number } = {};
        
        let total = 0;
        branches.forEach(b => {
          const bal = itemBalances.find(ib => ib.branch_id === b.id);
          const qty = bal ? Number(bal.quantity) : 0;
          stocks[b.id] = qty;
          total += qty;
        });

        return {
          id: item.id,
          sku: item.sku,
          name: item.item_name,
          category: item.category,
          baseUnit: item.base_unit,
          reorderLevel: Number(item.reorder_level),
          cost: Number(item.cost_per_base_unit),
          stocks,
          totalStock: total
        };
      });

      setInventoryGrid(grid);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [branches]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="text-muted-foreground flex items-center space-x-2 animate-pulse">
          <Clock className="w-5 h-5 animate-spin text-primary" />
          <span>Loading restaurant metrics...</span>
        </div>
      </div>
    );
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);
  };

  const getAlertStatusClass = (qty: number, reorder: number) => {
    if (qty === 0) return 'text-destructive bg-destructive/10 font-bold border border-destructive/20 rounded px-2 py-0.5';
    if (qty < reorder) return 'text-amber-500 bg-amber-500/10 font-semibold border border-amber-500/20 rounded px-2 py-0.5';
    return 'text-muted-foreground';
  };

  const filteredGrid = inventoryGrid.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    item.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filteredGrid.length / itemsPerPage));
  const paginatedGrid = filteredGrid.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <LayoutDashboard className="w-8 h-8 text-primary" />
            <span>Overview Dashboard</span>
          </h2>
          <p className="text-muted-foreground mt-1">Real-time status across all warehouses and restaurant branches.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastRefreshed && (
            <span className="text-xs text-muted-foreground">
              Last updated: <span className="font-semibold">{lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </span>
          )}
          <Button onClick={loadData} disabled={refreshing} variant="outline" size="icon" className="h-9 w-9 shrink-0">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="glass-dark border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inventory Value</CardDescription>
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Layers className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl font-bold">
              {formatCurrency(stats?.totalInventoryValue || 0)}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Across {stats?.totalBranches || branches.length} active locations</p>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Today's Sales</CardDescription>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <DollarSign className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl font-bold">
              {formatCurrency(stats?.todayRevenue || 0)}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">From all POS terminals today</p>
          </CardContent>
        </Card>

        <Card 
          className="glass-dark border-border/50 cursor-pointer hover:border-amber-500/30 transition-all group"
          onClick={() => setActiveTab('notifications')}
        >
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-amber-500 transition-colors">Low Stock Alerts</CardDescription>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span>{stats?.lowStockCount || 0} items</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Below reorder levels</p>
          </CardContent>
        </Card>

        <Card 
          className="glass-dark border-border/50 cursor-pointer hover:border-primary/30 transition-all group"
          onClick={() => setActiveTab('transfers')}
        >
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-primary transition-colors">Pending Transfers</CardDescription>
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Store className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span>{stats?.pendingTransfersCount || 0} reqs</span>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Awaiting approval or receipt</p>
          </CardContent>
        </Card>
      </div>

      {/* Critical Stock Alerts List */}
      {lowStockItems.length > 0 && (
        <Alert variant="destructive" className="mb-8 border-amber-500/50 text-amber-500 bg-amber-500/5 relative">
          <AlertTriangle className="h-4 w-4" color="currentColor" />
          <AlertTitle className="uppercase tracking-wider font-bold text-xs mb-3">Critical Reorder Alerts</AlertTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('notifications')} 
            className="absolute top-2 right-2 h-7 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
          >
            View all <ArrowRight className="ml-1 w-3 h-3" />
          </Button>
          <AlertDescription>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
              {lowStockItems.slice(0, 6).map((alert, i) => (
                <div key={i} className="bg-background/50 border p-3 rounded-lg flex items-center justify-between">
                  <div>
                    <h5 className="text-xs font-bold text-foreground">{alert.item_name}</h5>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{alert.branch_name}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-amber-500">{Number(alert.current_quantity).toLocaleString()}{alert.base_unit}</span>
                    <p className="text-[9px] text-muted-foreground mt-0.5">Limit: {alert.reorder_level}{alert.base_unit}</p>
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Multi-Branch Inventory Visibility Grid */}
      <Card>
        <CardHeader className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle>Multi-Branch Inventory Grid</CardTitle>
            <CardDescription>Real-time stock balance compared across all locations.</CardDescription>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search items, SKU, category..."
              className="pl-9"
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Item Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  {branches.map(b => (
                    <TableHead key={b.id} className="text-center font-bold text-primary whitespace-nowrap">
                      {b.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-right pr-6 font-bold">Total Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedGrid.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="pl-6 font-semibold">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono">{item.sku}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] uppercase">{item.category}</Badge>
                    </TableCell>
                    {branches.map(b => {
                      const qty = item.stocks[b.id];
                      return (
                        <TableCell key={b.id} className="text-center">
                          <span className={getAlertStatusClass(qty, item.reorderLevel)}>
                            {qty.toLocaleString()} <span className="text-[10px] opacity-75">{item.baseUnit}</span>
                          </span>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right pr-6 font-bold">
                      {item.totalStock.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">{item.baseUnit}</span>
                    </TableCell>
                  </TableRow>
                ))}
                {inventoryGrid.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4 + branches.length} className="h-24 text-center text-muted-foreground">
                      No items in catalog. Go to 'Inventory Items' to create inventory records.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="py-4 border-t px-2">
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
    </div>
  );
};
