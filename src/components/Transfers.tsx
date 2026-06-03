import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Eye, X, RefreshCw, ArrowRightLeft, Trash2, Printer } from 'lucide-react';

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
  
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [approving, setApproving] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [isProactive, setIsProactive] = useState(false);

  const loadData = async () => {
    try {
      // 1. Fetch transfers
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

      // 2. Fetch inventory items
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
    // Default source to warehouse (if exists) or currently selected branch
    const warehouse = branches.find(b => b.is_warehouse);
    setSourceBranchId(warehouse?.id || selectedBranch?.id || '');
    setTargetBranchId(proactive ? '' : selectedBranch?.id || '');
    setRemarks('');
    setAddedItems([]);
    setFormError('');
    setFormSuccess('');
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(100);
    }
    setShowCreateModal(true);
  };

  const handleAddItemToTransfer = () => {
    if (!currentSelectedItemId) return;
    
    // Check if already added
    const exists = addedItems.find(i => i.item_id === currentSelectedItemId);
    if (exists) {
      setFormError('Item already added. Please modify it or delete first.');
      return;
    }

    setAddedItems([
      ...addedItems,
      {
        item_id: currentSelectedItemId,
        qty: Number(currentQty)
      }
    ]);
    setFormError('');
  };

  const handleRemoveItem = (index: number) => {
    setAddedItems(addedItems.filter((_, i) => i !== index));
  };

  const handleSaveTransferRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (sourceBranchId === targetBranchId) {
      setFormError('Source and Target branch cannot be the same');
      return;
    }

    if (addedItems.length === 0) {
      setFormError('Add at least one item to transfer');
      return;
    }

    try {
      // Structure request payload
      const itemsPayload = addedItems.map(item => ({
        item_id: item.item_id,
        quantity_base_unit: item.qty
      }));

      if (isProactive) {
        // Call public.fn_send_transfer RPC
        const { error } = await supabase.rpc('fn_send_transfer', {
          p_source_branch_id: sourceBranchId,
          p_target_branch_id: targetBranchId,
          p_items: itemsPayload
        });

        if (error) throw error;

        setFormSuccess('Stock shipment sent and in transit successfully!');
      } else {
        // Call public.fn_request_transfer RPC
        const { error } = await supabase.rpc('fn_request_transfer', {
          p_source_branch_id: sourceBranchId,
          p_target_branch_id: targetBranchId,
          p_items: itemsPayload
        });

        if (error) throw error;

        setFormSuccess('Transfer request submitted successfully!');
      }

      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Error submitting transfer');
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
      alert('Error fetching transfer items');
    }
  };

  const handleApproveTransfer = async (transferId: string) => {
    if (!window.confirm('Are you sure you want to approve and dispatch this transfer? Stock will be immediately deducted from the source branch and marked as in transit. The target branch must confirm receipt before it is added to their balance.')) {
      return;
    }

    setApproving(true);
    try {
      // Call public.fn_approve_transfer RPC
      const { error } = await supabase.rpc('fn_approve_transfer', {
        p_transfer_id: transferId
      });

      if (error) throw error;

      alert('Transfer request approved and stock is now in transit!');
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to approve transfer. Make sure the source branch has enough stock!');
    } finally {
      setApproving(false);
    }
  };

  const handleReceiveTransfer = async (transferId: string) => {
    if (!window.confirm('Confirm that you have received the exact items and quantities in this shipment? Once confirmed, stock will be added to your branch balance.')) {
      return;
    }

    setReceiving(true);
    try {
      const { error } = await supabase.rpc('fn_receive_transfer', {
        p_transfer_id: transferId
      });

      if (error) throw error;

      alert('Stock shipment received and confirmed successfully!');
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to receive stock. Please try again.');
    } finally {
      setReceiving(false);
    }
  };

  const handlePrintReceipt = (transfer: TransferRequest, items: TransferItem[]) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to generate the receipt.');
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
            body {
              font-family: 'Inter', -apple-system, sans-serif;
              color: #1e293b;
              padding: 40px;
              background-color: #ffffff;
              margin: 0;
            }
            .receipt-container {
              max-width: 800px;
              margin: 0 auto;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 20px;
              margin-bottom: 30px;
            }
            .brand {
              font-size: 24px;
              font-weight: 800;
              color: #4f46e5;
              letter-spacing: -0.025em;
            }
            .title {
              font-size: 14px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              color: #64748b;
            }
            .details-grid {
              display: grid;
              grid-template-cols: 1fr 1fr;
              gap: 24px;
              margin-bottom: 40px;
            }
            .info-block h3 {
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              color: #64748b;
              margin: 0 0 6px 0;
              letter-spacing: 0.05em;
            }
            .info-block p {
              font-size: 14px;
              font-weight: 600;
              margin: 0;
              color: #0f172a;
            }
            .branches-box {
              display: flex;
              justify-content: space-between;
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 40px;
            }
            .branch-col {
              width: 48%;
            }
            .branch-col h3 {
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              color: #64748b;
              margin: 0 0 8px 0;
              letter-spacing: 0.05em;
            }
            .branch-col p {
              font-size: 15px;
              font-weight: 700;
              margin: 0;
              color: #0f172a;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 50px;
            }
            .items-table th {
              background-color: #f1f5f9;
              font-size: 11px;
              font-weight: 700;
              text-transform: uppercase;
              color: #475569;
              padding: 12px;
              text-align: left;
              border-bottom: 1px solid #cbd5e1;
              letter-spacing: 0.05em;
            }
            .signatures {
              display: flex;
              justify-content: space-between;
              margin-top: 80px;
              page-break-inside: avoid;
            }
            .sig-box {
              width: 45%;
              border-top: 1px dashed #cbd5e1;
              padding-top: 15px;
              text-align: center;
            }
            .sig-title {
              font-size: 12px;
              font-weight: 700;
              color: #475569;
              margin-bottom: 4px;
            }
            .sig-subtitle {
              font-size: 10px;
              color: #94a3b8;
            }
            .print-btn {
              background-color: #4f46e5;
              color: #ffffff;
              border: none;
              padding: 10px 20px;
              font-size: 14px;
              font-weight: 700;
              border-radius: 6px;
              cursor: pointer;
              margin-bottom: 20px;
              display: inline-flex;
              align-items: center;
              gap: 8px;
            }
            @media print {
              .print-btn {
                display: none;
              }
              body {
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
            
            <div class="header">
              <div>
                <div class="brand">RESTAURANT INVENTORY SYSTEM</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Kitchen & Stock Logistics Management</div>
              </div>
              <div style="text-align: right;">
                <div class="title">Delivery Slip / Transfer Receipt</div>
                <div style="font-size: 12px; color: #64748b; font-weight: bold; margin-top: 4px;">Status: ${transfer.status.toUpperCase()}</div>
              </div>
            </div>

            <div class="details-grid">
              <div class="info-block">
                <h3>Control Number</h3>
                <p style="font-weight: 700; font-size: 16px; color: #4f46e5;">${transfer.control_number || 'PENDING'}</p>
                <div style="font-family: monospace; font-size: 10px; color: #94a3b8; margin-top: 4px;">System ID: ${transfer.id}</div>
              </div>
              <div class="info-block" style="text-align: right;">
                <h3>Issue Date</h3>
                <p>${new Date(transfer.created_at).toLocaleString()}</p>
              </div>
            </div>

            <div class="branches-box">
              <div class="branch-col">
                <h3>Dispatched From (Source)</h3>
                <p>${transfer.source_branch?.name || 'Warehouse'}</p>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Authorized Dispatch Location</div>
              </div>
              <div style="display: flex; align-items: center; justify-content: center; font-size: 24px; color: #94a3b8;">➔</div>
              <div class="branch-col" style="text-align: right;">
                <h3>Delivered To (Target)</h3>
                <p>${transfer.target_branch?.name || 'Branch'}</p>
                <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Destination Location</div>
              </div>
            </div>

            <div class="info-block" style="margin-bottom: 24px;">
              <h3>Remarks / Purpose</h3>
              <p style="font-weight: 500; font-style: ${transfer.remarks ? 'normal' : 'italic'}; color: ${transfer.remarks ? '#1e293b' : '#94a3b8'};">
                ${transfer.remarks || 'No remarks provided'}
              </p>
            </div>

            <table class="items-table">
              <thead>
                <tr>
                  <th>Item Name</th>
                  <th style="text-align: right;">Quantity (Base Unit)</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>

            <div class="signatures">
              <div class="sig-box">
                <div class="sig-title">Dispatched By (Sender Signature)</div>
                <div class="sig-subtitle">Main Warehouse / Source Branch Authority</div>
                <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
                  <span>Name: ______________________</span>
                  <span>Date: ____/____/________</span>
                </div>
              </div>
              <div class="sig-box">
                <div class="sig-title">Received By (Receiver Signature)</div>
                <div class="sig-subtitle">Target Branch Manager / Cashier Authority</div>
                <div style="margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: left; display: flex; justify-content: space-between;">
                  <span>Name: ______________________</span>
                  <span>Date: ____/____/________</span>
                </div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
    
    printWindow.document.write(html);
    printWindow.document.close();
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

      alert('Transfer request rejected.');
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to reject transfer.');
    }
  };

  const canApprove = profile && ['super_admin', 'inventory_manager', 'branch_manager'].includes(profile.role_name);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Stock Transfers</h2>
          <p className="text-sm text-slate-400">Request, send, and confirm inventory movements between warehouses and branches.</p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={loadData}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          {(profile?.role_name === 'super_admin' || profile?.role_name === 'inventory_manager' || selectedBranch?.is_warehouse) && (
            <button
              type="button"
              onClick={() => handleOpenCreateModal(true)}
              className="flex items-center space-x-2 bg-emerald-600 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow hover:bg-emerald-500 transition-all"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span>Send Stock Shipment</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleOpenCreateModal(false)}
            className="flex items-center space-x-2 bg-indigo-600 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow hover:bg-indigo-500 transition-all"
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span>Request Stock Transfer</span>
          </button>
        </div>
      </div>

      {/* Transfers Table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
              <th className="p-4 pl-6">Control No / Date</th>
              <th className="p-4">Source Branch (From)</th>
              <th className="p-4">Target Branch (To)</th>
              <th className="p-4">Remarks</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right pr-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {transfers.map(t => (
              <tr key={t.id} className="hover:bg-slate-900/10 text-slate-300">
                <td className="p-4 pl-6">
                  <div className="font-bold text-slate-200">{t.control_number || 'Pending'}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{new Date(t.created_at).toLocaleDateString()}</div>
                </td>
                <td className="p-4 font-bold text-slate-100">{t.source_branch?.name || 'Unknown'}</td>
                <td className="p-4 font-bold text-indigo-400">{t.target_branch?.name || 'Unknown'}</td>
                <td className="p-4 text-slate-500 max-w-xs truncate">{t.remarks || 'No remarks'}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                    t.status === 'completed'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : t.status === 'approved'
                      ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                      : t.status === 'rejected'
                      ? 'bg-red-500/10 border-red-500/20 text-red-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                  }`}>
                    {t.status === 'approved' ? 'In Transit' : t.status}
                  </span>
                </td>
                <td className="p-4 text-right pr-6">
                  <button
                    onClick={() => handleViewTransfer(t)}
                    className="flex items-center space-x-1.5 ml-auto bg-slate-900 border border-slate-800 px-2.5 py-1 rounded text-[10px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View & Manage</span>
                  </button>
                </td>
              </tr>
            ))}

            {transfers.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center p-8 text-slate-500">
                  No stock transfers requested yet. Click 'Request Stock Transfer' to begin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CREATE MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-2xl w-full rounded-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {isProactive ? 'Send Stock Shipment' : 'New Transfer Request'}
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTransferRequest} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded">
                  {formError}
                </div>
              )}
              {formSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded">
                  {formSuccess}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Source Branch (From) *
                  </label>
                  <select
                    value={sourceBranchId}
                    onChange={(e) => setSourceBranchId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Select Source --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Target Branch (To) *
                  </label>
                  <select
                    value={targetBranchId}
                    onChange={(e) => setTargetBranchId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Select Target --</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Remarks / Purpose
                </label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Weekly restock of onions and buns"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Add Item Sub-Form */}
              <div className="bg-slate-900/60 p-4 rounded-lg border border-slate-800">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Add Transfer Item</h4>
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Select Item
                    </label>
                    <select
                      value={currentSelectedItemId}
                      onChange={(e) => setCurrentSelectedItemId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                    >
                      {catalog.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.item_name} (Base unit: {item.base_unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Qty ({catalog.find(i => i.id === currentSelectedItemId)?.base_unit || 'Base Units'})
                    </label>
                    <input
                      type="number"
                      value={currentQty}
                      onChange={(e) => setCurrentQty(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddItemToTransfer}
                  className="mt-3 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-indigo-400 px-3 py-1.5 rounded border border-slate-700/50"
                >
                  + Add Item
                </button>
              </div>

              {/* Added Items List */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Items to Transfer ({addedItems.length})</h4>
                <div className="bg-slate-950 rounded border border-slate-800 max-h-40 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                        <th className="p-2 pl-3">Item Name</th>
                        <th className="p-2 text-right">Quantity</th>
                        <th className="p-2 text-center pr-3">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {addedItems.map((item, idx) => {
                        const info = catalog.find(c => c.id === item.item_id);
                        return (
                          <tr key={idx} className="text-slate-300">
                            <td className="p-2 pl-3 font-semibold text-slate-200">{info?.item_name}</td>
                            <td className="p-2 text-right font-bold text-slate-100">
                              {item.qty} {info?.base_unit}
                            </td>
                            <td className="p-2 text-center pr-3">
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(idx)}
                                className="text-slate-500 hover:text-red-400"
                              >
                                <Trash2 className="w-3.5 h-3.5 mx-auto" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold py-2 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`flex-1 text-white text-xs font-semibold py-2 rounded shadow ${
                    isProactive ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {isProactive ? 'Send Shipment' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {showViewModal && selectedTransfer && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-xl w-full rounded-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Transfer: {selectedTransfer.control_number || 'Pending'}
                </h3>
                <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">ID: {selectedTransfer.id}</span>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => handlePrintReceipt(selectedTransfer, transferItems)}
                  className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-400 border border-slate-700/50 px-2.5 py-1 rounded text-[10px] font-bold transition-all"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Slip / PDF</span>
                </button>
                <button onClick={() => setShowViewModal(false)} className="text-slate-400 hover:text-white transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 block">From (Source)</span>
                  <span className="font-bold text-slate-200">{selectedTransfer.source_branch?.name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">To (Target)</span>
                  <span className="font-bold text-indigo-400">{selectedTransfer.target_branch?.name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Requested Date</span>
                  <span className="font-bold text-slate-200">{new Date(selectedTransfer.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border inline-block mt-0.5 ${
                    selectedTransfer.status === 'completed'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : selectedTransfer.status === 'approved'
                      ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                      : selectedTransfer.status === 'rejected'
                      ? 'bg-red-500/10 border-red-500/20 text-red-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                  }`}>
                    {selectedTransfer.status === 'approved' ? 'In Transit' : selectedTransfer.status}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Remarks</span>
                  <span className="font-medium text-slate-300">{selectedTransfer.remarks || 'No remarks'}</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Requested Items</h4>
                <div className="bg-slate-950 rounded border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                        <th className="p-2.5 pl-3">Item Name</th>
                        <th className="p-2.5 text-right pr-3">Transfer Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {transferItems.map((item, idx) => {
                        const name = item.inventory_items?.item_name || 'Deleted Item';
                        const unit = item.inventory_items?.base_unit || 'unit';
                        return (
                          <tr key={idx} className="text-slate-300">
                            <td className="p-2.5 pl-3 font-semibold text-slate-200">{name}</td>
                            <td className="p-2.5 text-right font-bold text-slate-100 pr-3">
                              {item.quantity_base_unit} {unit}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedTransfer.status === 'approved' && (
                <div className="text-[11px] text-amber-500 bg-amber-500/5 border border-amber-500/10 p-2.5 rounded text-center w-full mb-2">
                  🚚 Stock is currently in transit. Please verify the physical delivery before confirming receipt.
                </div>
              )}

              <div className="flex space-x-2 pt-2">
                {selectedTransfer.status === 'requested' && canApprove ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleRejectTransfer(selectedTransfer.id)}
                      className="flex-1 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 text-xs font-semibold py-2 rounded"
                    >
                      Reject Request
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApproveTransfer(selectedTransfer.id)}
                      disabled={approving}
                      className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded shadow disabled:opacity-50"
                    >
                      {approving ? 'Dispatching...' : 'Approve & Dispatch'}
                    </button>
                  </>
                ) : selectedTransfer.status === 'approved' && (
                  profile?.role_name === 'super_admin' || 
                  profile?.role_name === 'inventory_manager' || 
                  profile?.branch_id === selectedTransfer.target_branch_id
                ) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowViewModal(false)}
                      className="flex-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold py-2 rounded text-center"
                    >
                      Close Window
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReceiveTransfer(selectedTransfer.id)}
                      disabled={receiving}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded shadow disabled:opacity-50 font-bold"
                    >
                      {receiving ? 'Confirming...' : 'Confirm & Receive Items'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowViewModal(false)}
                    className="flex-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold py-2 rounded text-center"
                  >
                    Close Window
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
