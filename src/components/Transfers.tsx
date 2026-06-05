import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Eye, RefreshCw, ArrowRightLeft, Trash2, Printer } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { useToast } from '../hooks/use-toast';

interface TransferRequest {
  id: string;
  control_number: string | null;
  source_branch_id: string;
  target_branch_id: string;
  status: 'requested' | 'approved' | 'rejected' | 'completed';
  remarks: string | null;
  created_at: string;
  source_branch?: { name: string };
  target_branch?: { name: string };
}

interface TransferItem {
  id: string;
  item_id: string;
  quantity_base_unit: number;
  inventory_items?: {
    item_name: string;
    base_unit: string;
  };
}

interface CatalogItem {
  id: string;
  item_name: string;
  base_unit: string;
}

export const Transfers: React.FC = () => {
  const { profile, branches, selectedBranch } = useAuth();
  const { toast } = useToast();
  
  const [transfers, setTransfers] = useState<TransferRequest[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferRequest | null>(null);
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  
  // Request Form state
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [targetBranchId, setTargetBranchId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [addedItems, setAddedItems] = useState<{ item_id: string; qty: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(50);
  
  const [approving, setApproving] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [isProactive, setIsProactive] = useState(false);

  const loadData = async () => {
    try {
      const { data: tranData, error: tranError } = await supabase
        .from('transfer_requests')
        .select(`
          id,
          control_number,
          source_branch_id,
          target_branch_id,
          status,
          remarks,
          created_at,
          source_branch:branches!transfer_requests_source_branch_id_fkey(name),
          target_branch:branches!transfer_requests_target_branch_id_fkey(name)
        `)
        .order('created_at', { ascending: false });
      if (tranError) throw tranError;
      setTransfers((tranData as any[]) || []);

      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, base_unit')
        .eq('status', 'active');
      if (catError) throw catError;
      setCatalog(catData || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenCreateModal = (proactive: boolean = false) => {
    setIsProactive(proactive);
    const warehouse = branches.find(b => b.is_warehouse);
    setSourceBranchId(warehouse?.id || selectedBranch?.id || '');
    setTargetBranchId(proactive ? '' : selectedBranch?.id || '');
    setRemarks('');
    setAddedItems([]);
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(100);
    }
    setShowCreateModal(true);
  };

  const handleAddItemToTransfer = () => {
    if (!currentSelectedItemId) return;
    
    const exists = addedItems.find(i => i.item_id === currentSelectedItemId);
    if (exists) {
      toast({ title: "Item already added", description: "Please modify it or delete first.", variant: "destructive" });
      return;
    }

    setAddedItems([
      ...addedItems,
      {
        item_id: currentSelectedItemId,
        qty: Number(currentQty)
      }
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setAddedItems(addedItems.filter((_, i) => i !== index));
  };

  const handleSaveTransferRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    if (sourceBranchId === targetBranchId) {
      toast({ title: "Validation Error", description: "Source and Target branch cannot be the same", variant: "destructive" });
      return;
    }

    if (addedItems.length === 0) {
      toast({ title: "Validation Error", description: "Add at least one item to transfer", variant: "destructive" });
      return;
    }

    try {
      const itemsPayload = addedItems.map(item => ({
        item_id: item.item_id,
        quantity_base_unit: item.qty
      }));

      if (isProactive) {
        const { error } = await supabase.rpc('fn_send_transfer', {
          p_source_branch_id: sourceBranchId,
          p_target_branch_id: targetBranchId,
          p_items: itemsPayload
        });

        if (error) throw error;
        toast({ title: "Success", description: "Stock shipment sent and in transit successfully!" });
      } else {
        const { error } = await supabase.rpc('fn_request_transfer', {
          p_source_branch_id: sourceBranchId,
          p_target_branch_id: targetBranchId,
          p_items: itemsPayload
        });

        if (error) throw error;
        toast({ title: "Success", description: "Transfer request submitted successfully!" });
      }

      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message || 'Error submitting transfer', variant: "destructive" });
    }
  };

  const handleViewTransfer = async (transfer: TransferRequest) => {
    setSelectedTransfer(transfer);
    try {
      const { data, error } = await supabase
        .from('transfer_items')
        .select(`
          id,
          item_id,
          quantity_base_unit,
          inventory_items (
            item_name,
            base_unit
          )
        `)
        .eq('transfer_id', transfer.id);
      
      if (error) throw error;
      setTransferItems(data as any[] || []);
      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Error fetching transfer items", variant: "destructive" });
    }
  };

  const handleApproveTransfer = async (transferId: string) => {
    if (!window.confirm('Are you sure you want to approve and dispatch this transfer? Stock will be immediately deducted from the source branch and marked as in transit.')) {
      return;
    }

    setApproving(true);
    try {
      const { error } = await supabase.rpc('fn_approve_transfer', {
        p_transfer_id: transferId
      });

      if (error) throw error;

      toast({ title: "Success", description: "Transfer request approved and stock is now in transit!" });
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message || 'Failed to approve transfer.', variant: "destructive" });
    } finally {
      setApproving(false);
    }
  };

  const handleReceiveTransfer = async (transferId: string) => {
    if (!window.confirm('Confirm that you have received the exact items and quantities in this shipment?')) {
      return;
    }

    setReceiving(true);
    try {
      const { error } = await supabase.rpc('fn_receive_transfer', {
        p_transfer_id: transferId
      });

      if (error) throw error;

      toast({ title: "Success", description: "Stock shipment received and confirmed successfully!" });
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message || 'Failed to receive stock.', variant: "destructive" });
    } finally {
      setReceiving(false);
    }
  };

  const handleRejectTransfer = async (transferId: string) => {
    if (!window.confirm('Are you sure you want to reject this request?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('transfer_requests')
        .update({ status: 'rejected', reviewed_by: profile?.id })
        .eq('id', transferId);

      if (error) throw error;

      toast({ title: "Success", description: "Transfer request rejected." });
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message || 'Failed to reject transfer.', variant: "destructive" });
    }
  };

  const handlePrintReceipt = (transfer: TransferRequest, items: TransferItem[]) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({ title: "Warning", description: "Please allow popups to generate the receipt.", variant: "destructive" });
      return;
    }
    
    const itemsHtml = items.map(item => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px; font-weight: 500;">${item.inventory_items?.item_name || 'Item'}</td>
        <td style="padding: 12px; text-align: right; font-weight: 700;">${item.quantity_base_unit} ${item.inventory_items?.base_unit || 'units'}</td>
      </tr>
    `).join('');

    const html = `
      <html>
        <head>
          <title>Receipt - ${transfer.id}</title>
          <style>
            body { font-family: 'Inter', sans-serif; color: #1e293b; padding: 40px; }
            .receipt-container { max-width: 800px; margin: 0 auto; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
            .brand { font-size: 24px; font-weight: 800; color: #4f46e5; }
            .title { font-size: 14px; font-weight: 700; text-transform: uppercase; color: #64748b; }
            .details-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 24px; margin-bottom: 40px; }
            .info-block h3 { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0 0 6px 0; }
            .info-block p { font-size: 14px; font-weight: 600; margin: 0; color: #0f172a; }
            .branches-box { display: flex; justify-content: space-between; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 40px; }
            .items-table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
            .items-table th { background-color: #f1f5f9; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #475569; padding: 12px; text-align: left; border-bottom: 1px solid #cbd5e1; }
            .signatures { display: flex; justify-content: space-between; margin-top: 80px; }
            .sig-box { width: 45%; border-top: 1px dashed #cbd5e1; padding-top: 15px; text-align: center; }
            .print-btn { background-color: #4f46e5; color: white; border: none; padding: 10px 20px; font-size: 14px; border-radius: 6px; cursor: pointer; margin-bottom: 20px; }
            @media print { .print-btn { display: none; } body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <button class="print-btn" onclick="window.print()">Print PDF</button>
            <div class="header">
              <div><div class="brand">SYSTEM</div><div style="font-size: 12px; color: #64748b;">Logistics Management</div></div>
              <div style="text-align: right;"><div class="title">Transfer Receipt</div><div style="font-size: 12px; color: #64748b;">Status: ${transfer.status.toUpperCase()}</div></div>
            </div>
            <div class="details-grid">
              <div class="info-block"><h3>Control Number</h3><p>${transfer.control_number || 'PENDING'}</p></div>
              <div class="info-block" style="text-align: right;"><h3>Issue Date</h3><p>${new Date(transfer.created_at).toLocaleString()}</p></div>
            </div>
            <div class="branches-box">
              <div><h3>From (Source)</h3><p>${transfer.source_branch?.name || 'Warehouse'}</p></div>
              <div style="font-size: 24px; color: #94a3b8;">➔</div>
              <div style="text-align: right;"><h3>To (Target)</h3><p>${transfer.target_branch?.name || 'Branch'}</p></div>
            </div>
            <table class="items-table"><thead><tr><th>Item Name</th><th style="text-align: right;">Quantity</th></tr></thead><tbody>${itemsHtml}</tbody></table>
            <div class="signatures">
              <div class="sig-box"><div style="font-size: 12px; font-weight: 700;">Dispatched By</div><div style="margin-top: 40px; font-size: 11px;">Name: ______________________</div></div>
              <div class="sig-box"><div style="font-size: 12px; font-weight: 700;">Received By</div><div style="margin-top: 40px; font-size: 11px;">Name: ______________________</div></div>
            </div>
          </div>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const canApprove = profile && ['super_admin', 'inventory_manager', 'branch_manager'].includes(profile.role_name);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Stock Transfers</h2>
          <p className="text-muted-foreground">Request, send, and confirm inventory movements between locations.</p>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {(profile?.role_name === 'super_admin' || profile?.role_name === 'inventory_manager' || selectedBranch?.is_warehouse) && (
            <Button variant="default" onClick={() => handleOpenCreateModal(true)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Send Shipment
            </Button>
          )}

          <Button variant="secondary" onClick={() => handleOpenCreateModal(false)}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            Request Transfer
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="px-6 py-4">
          <CardTitle>Transfer History</CardTitle>
          <CardDescription>Log of all requested and completed branch transfers.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Control No / Date</TableHead>
                <TableHead>Source Branch</TableHead>
                <TableHead>Target Branch</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="pl-6">
                    <div className="font-bold">{t.control_number || 'Pending'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{new Date(t.created_at).toLocaleDateString()}</div>
                  </TableCell>
                  <TableCell className="font-semibold">{t.source_branch?.name || 'Unknown'}</TableCell>
                  <TableCell className="font-semibold text-primary">{t.target_branch?.name || 'Unknown'}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">{t.remarks || 'No remarks'}</TableCell>
                  <TableCell>
                    <Badge variant={
                      t.status === 'completed' ? 'default' :
                      t.status === 'approved' ? 'default' :
                      t.status === 'rejected' ? 'destructive' : 'secondary'
                    } className="uppercase text-[10px]">
                      {t.status === 'approved' ? 'In Transit' : t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button variant="ghost" size="sm" onClick={() => handleViewTransfer(t)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}

              {transfers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    No stock transfers requested yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CREATE MODAL */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isProactive ? 'Send Stock Shipment' : 'New Transfer Request'}</DialogTitle>
            <DialogDescription>
              {isProactive ? 'Ship inventory from your branch to another location.' : 'Request inventory from a warehouse or branch.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveTransferRequest} className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source Branch (From) *</Label>
                <Select value={sourceBranchId} onValueChange={setSourceBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder="-- Select Source --" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target Branch (To) *</Label>
                <Select value={targetBranchId} onValueChange={setTargetBranchId}>
                  <SelectTrigger>
                    <SelectValue placeholder="-- Select Target --" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remarks / Purpose</Label>
              <Input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Weekly restock"
              />
            </div>

            {/* Add Item Sub-Form */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="md:col-span-2 space-y-2">
                    <Label>Select Item</Label>
                    <Select value={currentSelectedItemId} onValueChange={setCurrentSelectedItemId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an item" />
                      </SelectTrigger>
                      <SelectContent>
                        {catalog.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.item_name} ({item.base_unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Qty</Label>
                    <Input
                      type="number"
                      value={currentQty}
                      onChange={(e) => setCurrentQty(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="secondary" onClick={handleAddItemToTransfer}>
                    Add Item
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Added Items List */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Items to Transfer ({addedItems.length})</h4>
              <div className="border rounded-md max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addedItems.map((item, idx) => {
                      const info = catalog.find(c => c.id === item.item_id);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{info?.item_name}</TableCell>
                          <TableCell className="text-right font-bold">{item.qty} {info?.base_unit}</TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleRemoveItem(idx)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {isProactive ? 'Send Shipment' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* VIEW MODAL */}
      <Dialog open={showViewModal} onOpenChange={setShowViewModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Transfer: {selectedTransfer?.control_number || 'Pending'}</DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  ID: {selectedTransfer?.id}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mr-6"
                onClick={() => selectedTransfer && handlePrintReceipt(selectedTransfer, transferItems)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print PDF
              </Button>
            </div>
          </DialogHeader>

          {selectedTransfer && (
            <div className="space-y-6 pt-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">From (Source)</span>
                  <span className="font-medium">{selectedTransfer.source_branch?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">To (Target)</span>
                  <span className="font-medium text-primary">{selectedTransfer.target_branch?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Requested Date</span>
                  <span className="font-medium">{new Date(selectedTransfer.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Status</span>
                  <Badge variant={
                    selectedTransfer.status === 'completed' ? 'default' :
                    selectedTransfer.status === 'approved' ? 'default' :
                    selectedTransfer.status === 'rejected' ? 'destructive' : 'secondary'
                  } className="uppercase mt-1 text-[10px]">
                    {selectedTransfer.status === 'approved' ? 'In Transit' : selectedTransfer.status}
                  </Badge>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Remarks</span>
                  <span className="font-medium">{selectedTransfer.remarks || 'No remarks'}</span>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3">Requested Items</h4>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right pr-4">Quantity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transferItems.map((item, idx) => {
                        const name = item.inventory_items?.item_name || 'Deleted Item';
                        const unit = item.inventory_items?.base_unit || 'unit';
                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{name}</TableCell>
                            <TableCell className="text-right font-semibold pr-4">{item.quantity_base_unit} {unit}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {selectedTransfer.status === 'approved' && (
                <div className="text-sm text-yellow-600 bg-yellow-50 border border-yellow-200 p-3 rounded-md text-center dark:bg-yellow-950 dark:border-yellow-900/50 dark:text-yellow-500">
                  🚚 Stock is currently in transit. Please verify the physical delivery before confirming receipt.
                </div>
              )}

              <DialogFooter className="flex space-x-2 sm:space-x-0">
                {selectedTransfer.status === 'requested' && canApprove ? (
                  <>
                    <Button variant="destructive" onClick={() => handleRejectTransfer(selectedTransfer.id)}>
                      Reject Request
                    </Button>
                    <Button disabled={approving} onClick={() => handleApproveTransfer(selectedTransfer.id)}>
                      {approving ? 'Dispatching...' : 'Approve & Dispatch'}
                    </Button>
                  </>
                ) : selectedTransfer.status === 'approved' && (
                  profile?.role_name === 'super_admin' || 
                  profile?.role_name === 'inventory_manager' || 
                  profile?.branch_id === selectedTransfer.target_branch_id
                ) ? (
                  <>
                    <Button variant="outline" onClick={() => setShowViewModal(false)}>
                      Close
                    </Button>
                    <Button disabled={receiving} onClick={() => handleReceiveTransfer(selectedTransfer.id)}>
                      {receiving ? 'Confirming...' : 'Confirm & Receive Items'}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setShowViewModal(false)}>
                    Close
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
