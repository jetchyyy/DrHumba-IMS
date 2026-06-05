import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { CountdownTimerIcon as History, MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, ChevronDownIcon as ChevronDown, ChevronUpIcon as ChevronUp, CalendarIcon as Calendar, BackpackIcon as ShoppingBag, ValueIcon as DollarSign, EyeOpenIcon as Eye, ActivityLogIcon as TrendingUp } from '@radix-ui/react-icons';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { format } from 'date-fns';

interface SaleItem {
  id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  item_name: string;
  sku: string;
}

interface SaleRecord {
  id: string;
  branch_id: string;
  cashier_id: string;
  total_amount: number;
  status: 'completed' | 'refunded';
  created_at: string;
  branch_name: string;
  cashier_email: string;
  items: SaleItem[];
}

export const SalesHistory: React.FC = () => {
  const { profile, branches } = useAuth();
  
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('All');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  
  // UI States
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  const isAdminRole = ['super_admin', 'inventory_manager', 'auditor'].includes(profile?.role_name || '');

  const loadSalesData = async () => {
    if (!profile) return;
    setLoading(true);
    try {
      let query = supabase
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
        `);

      if (!isAdminRole && profile.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      }

      const { data: salesData, error: salesError } = await query.order('created_at', { ascending: false });
      if (salesError) throw salesError;

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email');
      if (profilesError) throw profilesError;

      const mappedSales: SaleRecord[] = (salesData || []).map((sale: any) => {
        const cashierProfile = (profilesData || []).find(p => p.id === sale.cashier_id);
        
        return {
          id: sale.id,
          branch_id: sale.branch_id,
          cashier_id: sale.cashier_id,
          total_amount: Number(sale.total_amount),
          status: sale.status,
          created_at: sale.created_at,
          branch_name: sale.branches?.name || 'Unknown Branch',
          cashier_email: cashierProfile?.email || 'System / Cashier',
          items: (sale.sale_items || []).map((si: any) => ({
            id: si.id,
            quantity: Number(si.quantity),
            unit_price: Number(si.unit_price),
            subtotal: Number(si.subtotal),
            item_name: si.menu_items?.name || 'Unknown Dish',
            sku: si.menu_items?.sku || ''
          }))
        };
      });

      setSales(mappedSales);
    } catch (err) {
      console.error('Error fetching sales history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSalesData();
    if (!isAdminRole && profile?.branch_id) {
      setSelectedBranchId(profile.branch_id);
    } else {
      setSelectedBranchId('All');
    }
  }, [profile]);

  const toggleExpand = (id: string) => {
    setExpandedSaleId(expandedSaleId === id ? null : id);
  };

  const formatPHP = (amount: number) => {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const filteredSales = sales.filter(sale => {
    const matchesSearch = 
      sale.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sale.cashier_email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBranch = selectedBranchId === 'All' || sale.branch_id === selectedBranchId;

    let matchesDate = true;
    const saleDate = new Date(sale.created_at);
    const now = new Date();

    if (dateFilter === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      matchesDate = saleDate >= todayStart;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchesDate = saleDate >= weekAgo;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchesDate = saleDate >= monthAgo;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && saleDate >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && saleDate <= end;
      }
    }

    return matchesSearch && matchesBranch && matchesDate;
  });

  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total_amount, 0);
  const totalTransactions = filteredSales.length;
  const avgOrderValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <History className="w-8 h-8 text-primary" />
            <span>Sales History Log</span>
          </h2>
          <p className="text-muted-foreground mt-1">
            {isAdminRole 
              ? 'Consolidated sales, cashier registers, and ingredient deductions across all corporate branches.'
              : `Sales transaction log for your assigned location context.`
            }
          </p>
        </div>

        <Button onClick={loadSalesData} disabled={loading} variant="outline" size="icon">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Total Sales Revenue</span>
              <span className="text-2xl font-bold">{formatPHP(totalRevenue)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-primary/10 rounded-lg text-primary border border-primary/20">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Transactions Logged</span>
              <span className="text-2xl font-bold">{totalTransactions} Orders</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-6 flex items-center space-x-4">
            <div className="p-3 bg-amber-500/10 rounded-lg text-amber-500 border border-amber-500/20">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">Average Ticket Size</span>
              <span className="text-2xl font-bold">{formatPHP(avgOrderValue)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Query Bars */}
      <div className="space-y-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="relative w-full lg:w-96">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by Invoice UUID or cashier email..."
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-start lg:justify-end">
            {isAdminRole ? (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground font-medium">Branch:</span>
                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                  <SelectTrigger className="w-[180px]">
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
            ) : (
              profile?.branch_id && (
                <div className="text-xs text-muted-foreground bg-muted/50 border px-3 py-2 rounded-lg font-medium">
                  Branch Locked: <span className="text-foreground font-bold">{sales[0]?.branch_name || 'My Branch'}</span>
                </div>
              )
            )}

            <div className="flex items-center space-x-2">
              <span className="text-xs text-muted-foreground font-medium">Date Scope:</span>
              <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 Days</SelectItem>
                  <SelectItem value="month">Last 30 Days</SelectItem>
                  <SelectItem value="custom">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {dateFilter === 'custom' && (
          <Card className="bg-muted/30">
            <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-4 text-sm">
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-muted-foreground">Start:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[130px] justify-start text-left font-normal h-8">
                      <Calendar className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <span className="text-muted-foreground">End:</span>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[130px] justify-start text-left font-normal h-8">
                      <Calendar className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, 'PPP') : <span>Pick a date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <CalendarComponent
                      mode="single"
                      selected={endDate}
                      onSelect={setEndDate}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {(startDate || endDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStartDate(undefined);
                    setEndDate(undefined);
                  }}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 sm:ml-auto h-8"
                >
                  Clear Range
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Main Transactions List */}
      <Card>
        <CardHeader className="px-6 py-4">
          <CardTitle>Transactions Ledger</CardTitle>
          <CardDescription>View all historical sales.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Invoice ID</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Cashier Register</TableHead>
                <TableHead className="text-right">Revenue Value</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right pr-6">Receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-primary mb-2" />
                    Fetching sales transaction ledger...
                  </TableCell>
                </TableRow>
              ) : filteredSales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No sales history transactions found matching filter criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredSales.map(sale => {
                  const isExpanded = expandedSaleId === sale.id;
                  const dateStr = new Date(sale.created_at).toLocaleString();
                  return (
                    <React.Fragment key={sale.id}>
                      <TableRow 
                        onClick={() => toggleExpand(sale.id)}
                        className="cursor-pointer"
                      >
                        <TableCell className="pl-4 text-muted-foreground">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </TableCell>
                        <TableCell className="font-medium text-muted-foreground">{dateStr}</TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground font-semibold">{sale.id.slice(0, 8)}...</TableCell>
                        <TableCell className="font-bold">{sale.branch_name}</TableCell>
                        <TableCell className="text-muted-foreground font-mono">{sale.cashier_email}</TableCell>
                        <TableCell className="text-right font-black text-emerald-500">
                          {formatPHP(sale.total_amount)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={
                            sale.status === 'completed' ? 'default' : 'destructive'
                          } className="uppercase text-[9px]">
                            {sale.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <Button variant="ghost" size="sm" className="h-8">
                            <Eye className="w-4 h-4 mr-2" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={8} className="p-0 border-l-2 border-primary">
                            <div className="p-6">
                              <div className="flex items-center justify-between border-b pb-2 mb-4">
                                <h4 className="text-sm font-bold text-primary uppercase tracking-wider">
                                  Invoice Detail Receipt Breakdown
                                </h4>
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  UUID: {sale.id}
                                </span>
                              </div>

                              <div className="border rounded-lg overflow-hidden bg-background/50">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-muted/50">
                                      <TableHead className="pl-4">Dish / Menu Item</TableHead>
                                      <TableHead>SKU</TableHead>
                                      <TableHead className="text-right">Unit Price</TableHead>
                                      <TableHead className="text-center">Quantity</TableHead>
                                      <TableHead className="text-right pr-4">Subtotal</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {sale.items.map((item) => (
                                      <TableRow key={item.id}>
                                        <TableCell className="pl-4 font-bold">{item.item_name}</TableCell>
                                        <TableCell className="font-mono text-[10px] text-muted-foreground">{item.sku}</TableCell>
                                        <TableCell className="text-right font-medium text-muted-foreground">{formatPHP(item.unit_price)}</TableCell>
                                        <TableCell className="text-center font-bold">{item.quantity}</TableCell>
                                        <TableCell className="text-right font-bold pr-4">{formatPHP(item.subtotal)}</TableCell>
                                      </TableRow>
                                    ))}
                                    <TableRow className="bg-muted/30 font-bold">
                                      <TableCell colSpan={4} className="pl-4 text-right">Invoice Total:</TableCell>
                                      <TableCell className="text-right text-emerald-500 pr-4 text-sm font-black">
                                        {formatPHP(sale.total_amount)}
                                      </TableCell>
                                    </TableRow>
                                  </TableBody>
                                </Table>
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
