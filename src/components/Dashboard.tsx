import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  DollarSign,
  Layers,
  Store,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Clock,
  LayoutDashboard,
  Search,
  Activity,
  Minus
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
  PaginationEllipsis,
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
  yesterdayRevenue?: number;
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
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [inventoryGrid.length]);

  const loadData = async () => {
    setRefreshing(true);
    try {
      const { data: statsData, error: statsError } = await supabase.rpc('get_overall_dashboard_stats');
      if (statsError) throw statsError;
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const startOfYesterday = new Date(yesterday.setHours(0,0,0,0)).toISOString();
      const endOfYesterday = new Date(yesterday.setHours(23,59,59,999)).toISOString();

      const { data: yesterdaySales } = await supabase
        .from('sales')
        .select('total_amount')
        .gte('created_at', startOfYesterday)
        .lte('created_at', endOfYesterday);

      const yesterdayRevenue = yesterdaySales?.reduce((sum, s) => sum + Number(s.total_amount), 0) || 0;
      setStats({ ...statsData, yesterdayRevenue });

      const { data: activity, error: activityError } = await supabase
        .from('audit_logs')
        .select('id, action, module, timestamp, profiles:user_id ( full_name )')
        .order('timestamp', { ascending: false })
        .limit(5);
      
      if (activityError) {
        console.error('Error fetching recent activity:', activityError);
      }
      setRecentActivity(activity || []);

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
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastRefreshed(new Date());
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

  const renderStockValue = (qty: number, reorder: number, baseUnit: string) => {
    if (qty === 0) {
      return (
        <span className="text-muted-foreground/30 font-medium">
          0 <span className="text-[10px]">{baseUnit}</span>
        </span>
      );
    }
    if (qty < reorder) {
      return (
        <span className="text-amber-500 bg-amber-500/10 font-bold border border-amber-500/20 rounded px-2 py-0.5">
          {qty.toLocaleString()} <span className="text-[10px] opacity-75">{baseUnit}</span>
        </span>
      );
    }
    return (
      <span className="text-foreground font-semibold">
        {qty.toLocaleString()} <span className="text-[10px] text-muted-foreground">{baseUnit}</span>
      </span>
    );
  };

  const filteredGrid = inventoryGrid.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    item.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalPages = Math.ceil(filteredGrid.length / itemsPerPage);
  const paginatedGrid = filteredGrid.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, 'ellipsis', totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages);
      }
    }
    return pages;
  };

  const revenueTrend = stats?.todayRevenue && stats?.yesterdayRevenue
    ? ((stats.todayRevenue - stats.yesterdayRevenue) / stats.yesterdayRevenue) * 100
    : 0;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <LayoutDashboard className="w-8 h-8 text-primary" />
            <span>Overview Dashboard</span>
          </h2>
          <p className="text-muted-foreground">Real-time status across all warehouses and restaurant branches.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:inline-block">
            Last updated: {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <Button onClick={loadData} disabled={refreshing} variant="outline" size="icon" className="h-9 w-9">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="glass-dark border-border/50">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 text-emerald-500">
                <DollarSign className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Today's Sales</p>
            </div>
            <div>
              <h3 className="text-3xl font-bold">{formatCurrency(stats?.todayRevenue || 0)}</h3>
              <div className="flex items-center mt-2 text-xs">
                {revenueTrend > 0 ? (
                  <span className="text-emerald-500 flex items-center font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded mr-2">
                    <ArrowUpRight className="w-3 h-3 mr-1" /> +{revenueTrend.toFixed(1)}%
                  </span>
                ) : revenueTrend < 0 ? (
                  <span className="text-rose-500 flex items-center font-semibold bg-rose-500/10 px-1.5 py-0.5 rounded mr-2">
                    <ArrowDownRight className="w-3 h-3 mr-1" /> {revenueTrend.toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground flex items-center font-semibold bg-muted px-1.5 py-0.5 rounded mr-2">
                    <Minus className="w-3 h-3 mr-1" /> 0%
                  </span>
                )}
                <span className="text-muted-foreground">vs yesterday</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <Layers className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Inventory Value</p>
            </div>
            <div>
              <h3 className="text-3xl font-bold">{formatCurrency(stats?.totalInventoryValue || 0)}</h3>
              <p className="text-xs text-muted-foreground mt-2">Across all branches and warehouses</p>
            </div>
          </CardContent>
        </Card>

        <Card 
          className="glass-dark border-border/50 cursor-pointer hover:border-amber-500/30 transition-all group"
          onClick={() => setActiveTab('notifications')}
        >
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center border border-amber-500/20 text-amber-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-amber-500 transition-colors">Low Stock</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <h3 className="text-3xl font-bold">{stats?.lowStockCount || 0}</h3>
                <p className="text-xs text-muted-foreground mt-2">Items need reordering</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform mb-1" />
            </div>
          </CardContent>
        </Card>

        <Card 
          className="glass-dark border-border/50 cursor-pointer hover:border-primary/30 transition-all group"
          onClick={() => setActiveTab('transfers')}
        >
          <CardContent className="p-5 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <Store className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-hover:text-primary transition-colors">Transfers</p>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <h3 className="text-3xl font-bold">{stats?.pendingTransfersCount || 0}</h3>
                <p className="text-xs text-muted-foreground mt-2">Pending requests</p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform mb-1" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Stock Alerts List */}
      {lowStockItems.length > 0 && (
        <Alert variant="destructive" className="mb-8 border-amber-500/50 text-amber-500 bg-amber-500/5 relative">
          <AlertTriangle className="h-4 w-4" color="currentColor" />
          <AlertTitle className="uppercase tracking-wider font-bold text-xs mb-3 flex items-center justify-between">
            <span>Critical Reorder Alerts</span>
            <Button variant="link" size="sm" className="h-auto p-0 text-amber-600 hover:text-amber-500 font-semibold" onClick={() => setActiveTab('notifications')}>
              View all alerts &rarr;
            </Button>
          </AlertTitle>
          <AlertDescription>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
              {lowStockItems.slice(0, 6).map((alert, i) => (
                <div key={i} className="bg-background/50 border p-3 rounded-lg flex items-center justify-between hover:bg-background/80 transition-colors">
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

      {/* Main Content Grid: Activity + Inventory */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        
        {/* Recent Activity (Left Column on large screens) */}
        <div className="xl:col-span-1">
          <Card className="h-full flex flex-col glass-dark border-border/50">
            <CardHeader className="px-6 py-4 border-b shrink-0">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Recent Activity
              </CardTitle>
              <CardDescription>Latest system events</CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col">
              {recentActivity.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground min-h-[300px]">
                  <Activity className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm font-medium text-foreground">No recent activity</p>
                  <p className="text-xs opacity-70 mt-1">Actions taken by users will appear here in real-time.</p>
                </div>
              ) : (
                <div className="divide-y divide-border flex-1">
                  {recentActivity.map(act => (
                    <div key={act.id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-foreground truncate">{act.action}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mt-2">
                        <Badge variant="secondary" className="text-[9px] uppercase">{act.module}</Badge>
                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                          {act.profiles?.full_name || 'System'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="p-4 border-t mt-auto shrink-0 bg-muted/10">
                <Button variant="ghost" size="sm" className="w-full text-xs font-semibold" onClick={() => setActiveTab('audit-logs')}>
                  View full history &rarr;
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Multi-Branch Inventory Visibility Grid (Right Column on large screens) */}
        <div className="xl:col-span-3">
          <Card className="h-full">
            <CardHeader className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b">
              <div>
                <CardTitle className="text-lg">Multi-Branch Inventory Grid</CardTitle>
                <CardDescription>Real-time stock balance compared across all locations.</CardDescription>
              </div>
              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input 
                  placeholder="Search item or SKU..." 
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9 h-9"
                />
              </div>
            </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6 sticky left-0 z-20 bg-card min-w-[200px] border-r">Item Name</TableHead>
                  <TableHead className="min-w-[120px]">SKU</TableHead>
                  <TableHead className="min-w-[100px]">Category</TableHead>
                  {branches.map(b => (
                    <TableHead key={b.id} className="text-center text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap min-w-[110px]">
                      {b.name}
                    </TableHead>
                  ))}
                  <TableHead className="text-right pr-6 font-bold border-l pl-4">Total Stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedGrid.map(item => (
                  <TableRow key={item.id} className="hover:bg-muted/40 transition-colors">
                    <TableCell className="pl-6 font-bold sticky left-0 z-20 bg-card border-r group-hover:bg-muted/40">{item.name}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">{item.sku}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[9px] uppercase font-bold">{item.category}</Badge>
                    </TableCell>
                    {branches.map(b => {
                      const qty = item.stocks[b.id];
                      return (
                        <TableCell key={b.id} className="text-center">
                          {renderStockValue(qty, item.reorderLevel, item.baseUnit)}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right pr-6 font-bold border-l pl-4">
                      {item.totalStock.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">{item.baseUnit}</span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredGrid.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4 + branches.length} className="h-48 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center">
                        <Store className="w-8 h-8 mb-2 opacity-20" />
                        <p>No inventory items found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="py-4 border-t px-6 bg-muted/10">
              <Pagination className="mx-0 w-auto justify-center sm:justify-end">
                <PaginationContent className="flex-wrap">
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  
                  {getPageNumbers().map((page, index) => (
                    <PaginationItem key={index}>
                      {page === 'ellipsis' ? (
                        <PaginationEllipsis />
                      ) : (
                        <PaginationLink 
                          onClick={() => setCurrentPage(page as number)}
                          isActive={currentPage === page}
                          className="cursor-pointer hidden sm:inline-flex"
                        >
                          {page}
                        </PaginationLink>
                      )}
                    </PaginationItem>
                  ))}
                  
                  {/* Always show current page on mobile even if we hide the rest */}
                  <div className="sm:hidden flex items-center px-4 text-sm font-medium">
                    Page {currentPage} of {totalPages}
                  </div>

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
      </div>
    </div>
  );
};
