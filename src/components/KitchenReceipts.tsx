import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useModal } from '../contexts/ModalContext';
import { supabase } from '../lib/supabase';
import { printKitchenReceipt } from '../lib/printService';
import { settingsService } from '../lib/settingsService';
import {
  MagnifyingGlassIcon as Search,
  ReloadIcon as RefreshCw,
  EyeOpenIcon as Eye,
  MagicWandIcon as ChefHat,
  FileTextIcon as Printer
} from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

interface KitchenReceipt {
  id: string;
  control_number: string;
  sale_id: string;
  branch_id: string;
  status: 'pending' | 'preparing' | 'completed' | 'cancelled';
  created_at: string;
  sales?: {
    control_number: string;
    sale_category?: string;
    cashier_id?: string;
    created_at: string;
    sale_items?: {
      id: string;
      quantity: number;
      menu_items: {
        name: string;
        sku: string;
      };
    }[];
  };
  branches?: {
    name: string;
  };
}

export const KitchenReceipts: React.FC = () => {
  const { profile, selectedBranch, branches } = useAuth();
  const { showError, showSuccess } = useModal();

  const [receipts, setReceipts] = useState<KitchenReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');

  // Modal
  const [selectedReceipt, setSelectedReceipt] = useState<KitchenReceipt | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);

  const isAdminRole = profile && ['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name);

  // Initialize branch filter context
  useEffect(() => {
    if (!isAdminRole && profile?.branch_id) {
      setSelectedBranchId(profile.branch_id);
    } else if (selectedBranch?.id) {
      setSelectedBranchId(selectedBranch.id);
    } else {
      setSelectedBranchId('All');
    }
  }, [profile, selectedBranch, isAdminRole]);

  const loadKitchenReceipts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('kitchen_receipts')
        .select(`
          id,
          control_number,
          sale_id,
          branch_id,
          status,
          created_at,
          branches(name),
          sales(
            control_number,
            sale_category,
            cashier_id,
            created_at,
            sale_items(
              id,
              quantity,
              menu_items(
                name,
                sku
              )
            )
          )
        `)
        .order('created_at', { ascending: false });

      // Enforce branch-level visibility constraint
      if (!isAdminRole && profile?.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      } else if (selectedBranchId !== 'All') {
        query = query.eq('branch_id', selectedBranchId);
      }

      if (selectedStatus !== 'All') {
        query = query.eq('status', selectedStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      const mappedData = (data || []).map((row: any) => {
        const branchObj = Array.isArray(row.branches) ? row.branches[0] : row.branches;
        const saleObj = Array.isArray(row.sales) ? row.sales[0] : row.sales;
        return {
          ...row,
          branches: branchObj || null,
          sales: saleObj || null
        };
      });
      setReceipts(mappedData);
    } catch (err: any) {
      console.error('Failed to load kitchen receipts:', err);
      showError(err.message || 'Could not load kitchen orders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKitchenReceipts();
  }, [selectedBranchId, selectedStatus]);

  const handleUpdateStatus = async (receiptId: string, newStatus: string) => {
    setUpdatingId(receiptId);
    try {
      const { error } = await supabase
        .from('kitchen_receipts')
        .update({ status: newStatus })
        .eq('id', receiptId);

      if (error) throw error;

      // Update local state
      setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, status: newStatus as any } : r));
      if (selectedReceipt && selectedReceipt.id === receiptId) {
        setSelectedReceipt(prev => prev ? { ...prev, status: newStatus as any } : null);
      }
      showSuccess(`Order status updated to ${newStatus.toUpperCase()}`);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to update order status.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handlePrint = async (receipt: KitchenReceipt) => {
    try {
      const settings = await settingsService.getSettings();
      const saleForPrinting = {
        id: receipt.sale_id,
        control_number: receipt.sales?.control_number,
        created_at: receipt.sales?.created_at,
        sale_category: receipt.sales?.sale_category,
        items: (receipt.sales?.sale_items || []).map((item: any) => ({
          quantity: item.quantity,
          item_name: item.menu_items?.name || 'Unknown Item'
        }))
      };

      printKitchenReceipt(saleForPrinting, settings.sales_invoice);
    } catch (err: any) {
      console.error('Print failure:', err);
      showError('Failed to trigger receipt printing.');
    }
  };

  // Filtered List
  const filteredReceipts = useMemo(() => {
    if (!searchTerm.trim()) return receipts;
    const term = searchTerm.toLowerCase();
    return receipts.filter(r => 
      r.control_number.toLowerCase().includes(term) ||
      (r.sales?.control_number && r.sales.control_number.toLowerCase().includes(term))
    );
  }, [receipts, searchTerm]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">Pending</Badge>;
      case 'preparing':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/20">Preparing</Badge>;
      case 'completed':
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">Completed</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border-rose-500/20">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Kitchen Orders Queue</h1>
          <p className="text-muted-foreground text-sm">
            Monitor, prepare, and manage food production tickets generated from POS checkouts.
          </p>
        </div>
        <Button onClick={loadKitchenReceipts} variant="outline" size="sm" className="w-fit self-end md:self-auto">
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filters Bar */}
      <Card className="bg-muted/10">
        <CardContent className="p-4 flex flex-col md:flex-row items-center gap-4">
          {/* Search Term */}
          <div className="w-full md:flex-1 space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Search Tickets</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by Ticket KIT # or Invoice INV #..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Branch Context Selector */}
          <div className="w-full md:w-52 space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Branch Location</Label>
            {isAdminRole ? (
              <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Branches</SelectItem>
                  {branches.filter(b => !b.parent_id).map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-sm font-semibold bg-muted/40 border rounded-lg h-9 px-3 py-2 leading-none flex items-center">
                {branches.find(b => b.id === selectedBranchId)?.name || 'My Branch'}
              </div>
            )}
          </div>

          {/* Status Filter */}
          <div className="w-full md:w-44 space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Order Status</Label>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="preparing">Preparing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">Kitchen Ticket</TableHead>
                  <TableHead className="w-[150px]">Invoice Number</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Placed At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                      Loading kitchen queue...
                    </TableCell>
                  </TableRow>
                ) : filteredReceipts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No kitchen tickets found matching filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredReceipts.map(receipt => (
                    <TableRow key={receipt.id}>
                      <TableCell className="font-bold">{receipt.control_number}</TableCell>
                      <TableCell className="text-muted-foreground">{receipt.sales?.control_number || 'N/A'}</TableCell>
                      <TableCell>{receipt.branches?.name || 'Unknown'}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] uppercase font-bold">
                          {receipt.sales?.sale_category || 'REGULAR'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(receipt.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>{getStatusBadge(receipt.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-muted/80"
                            title="View Items"
                            onClick={() => {
                              setSelectedReceipt(receipt);
                              setShowViewModal(true);
                            }}
                          >
                            <Eye className="w-4 h-4 text-white" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 hover:bg-muted/80"
                            title="Print Kitchen Ticket"
                            onClick={() => handlePrint(receipt)}
                          >
                            <Printer className="w-4 h-4 text-emerald-500" />
                          </Button>
                          
                          <Select
                            value={receipt.status}
                            onValueChange={(val) => handleUpdateStatus(receipt.id, val)}
                            disabled={updatingId === receipt.id}
                          >
                            <SelectTrigger className="w-[110px] h-8 text-[11px] font-semibold">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending" className="text-amber-500">Pending</SelectItem>
                              <SelectItem value="preparing" className="text-blue-500">Preparing</SelectItem>
                              <SelectItem value="completed" className="text-emerald-500">Completed</SelectItem>
                              <SelectItem value="cancelled" className="text-rose-500">Cancelled</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* View Items Modal */}
      <Dialog open={showViewModal} onOpenChange={setShowViewModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <ChefHat className="w-5 h-5 text-primary" />
              <span>Kitchen Ticket: {selectedReceipt?.control_number}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Ordered at {selectedReceipt && new Date(selectedReceipt.created_at).toLocaleString()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-2">
            <div className="bg-muted/20 border border-border/80 rounded-2xl p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase font-semibold">Branch Location</span>
                <span className="font-bold">{selectedReceipt?.branches?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase font-semibold">Invoice Ref</span>
                <span className="font-mono font-semibold">{selectedReceipt?.sales?.control_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground uppercase font-semibold">Sale Category</span>
                <span className="font-bold uppercase text-primary">{selectedReceipt?.sales?.sale_category || 'REGULAR'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground uppercase font-semibold">Queue Status</span>
                <span>{selectedReceipt && getStatusBadge(selectedReceipt.status)}</span>
              </div>
            </div>

            <div className="border border-border/60 rounded-2xl overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="text-xs font-semibold py-2">Quantity</TableHead>
                    <TableHead className="text-xs font-semibold py-2">Item Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedReceipt?.sales?.sale_items && selectedReceipt.sales.sale_items.length > 0 ? (
                    selectedReceipt.sales.sale_items.map((item: any) => (
                      <TableRow key={item.id} className="hover:bg-transparent">
                        <TableCell className="font-bold text-[13px] py-3 text-primary">{item.quantity} x</TableCell>
                        <TableCell className="font-bold text-[13px] py-3">{item.menu_items?.name}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center py-4 text-xs text-muted-foreground">
                        No items found in this ticket.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter className="flex justify-between sm:justify-between items-center gap-2 border-t pt-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectedReceipt && handlePrint(selectedReceipt)}
              >
                <Printer className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                Print Ticket
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowViewModal(false)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
