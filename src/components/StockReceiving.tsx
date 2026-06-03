import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Eye, ClipboardCheck, X, RefreshCw } from 'lucide-react';

interface Receipt {
  id: string;
  supplier: string;
  invoice_no: string | null;
  date_received: string;
  status: 'draft' | 'completed';
  created_at: string;
}

interface ReceiptItem {
  id: string;
  item_id: string;
  quantity_purchased: number;
  cost_per_purchase_unit: number;
  inventory_items?: {
    item_name: string;
    purchase_unit: string;
  };
}

interface CatalogItem {
  id: string;
  item_name: string;
  purchase_unit: string;
  conversion_factor: number;
}

export const StockReceiving: React.FC = () => {
  const { selectedBranch } = useAuth();
  
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  
  // Create Receipt Form state
  const [supplier, setSupplier] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dateReceived, setDateReceived] = useState(new Date().toISOString().split('T')[0]);
  const [addedItems, setAddedItems] = useState<{ item_id: string; qty: number; cost: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(1);
  const [currentCost, setCurrentCost] = useState(10);
  
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [processingReceiptId, setProcessingReceiptId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      // 1. Fetch Receipts
      const { data: recData, error: recError } = await supabase
        .from('stock_receipts')
        .select('*')
        .order('created_at', { ascending: false });
      if (recError) throw recError;
      setReceipts(recData || []);

      // 2. Fetch Catalog Items for selection
      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, purchase_unit, conversion_factor')
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

  const handleOpenCreateModal = () => {
    setSupplier('');
    setInvoiceNo('');
    setDateReceived(new Date().toISOString().split('T')[0]);
    setAddedItems([]);
    setFormError('');
    setFormSuccess('');
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(10);
      setCurrentCost(15);
    }
    setShowCreateModal(true);
  };

  const handleAddItemToReceiptForm = () => {
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
        qty: Number(currentQty),
        cost: Number(currentCost)
      }
    ]);
    setFormError('');
  };

  const handleRemoveItemFromReceiptForm = (index: number) => {
    setAddedItems(addedItems.filter((_, i) => i !== index));
  };

  const handleSaveReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!supplier.trim()) {
      setFormError('Supplier is required');
      return;
    }

    if (addedItems.length === 0) {
      setFormError('Add at least one item to this receipt');
      return;
    }

    if (!selectedBranch) {
      setFormError('No branch context selected');
      return;
    }

    try {
      // 1. Create stock_receipt row
      const { data: receiptData, error: receiptError } = await supabase
        .from('stock_receipts')
        .insert({
          supplier: supplier.trim(),
          invoice_no: invoiceNo.trim() || null,
          date_received: dateReceived,
          branch_id: selectedBranch.id,
          status: 'draft'
        })
        .select()
        .single();

      if (receiptError) throw receiptError;

      // 2. Create stock_receipt_items rows
      const itemsPayload = addedItems.map(item => ({
        receipt_id: receiptData.id,
        item_id: item.item_id,
        quantity_purchased: item.qty,
        cost_per_purchase_unit: item.cost
      }));

      const { error: itemsError } = await supabase
        .from('stock_receipt_items')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      setFormSuccess('Receipt draft created!');
      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Error creating receipt');
    }
  };

  const handleViewReceipt = async (receipt: Receipt) => {
    setSelectedReceipt(receipt);
    try {
      const { data, error } = await supabase
        .from('stock_receipt_items')
        .select(`
          id,
          item_id,
          quantity_purchased,
          cost_per_purchase_unit,
          inventory_items (
            item_name,
            purchase_unit
          )
        `)
        .eq('receipt_id', receipt.id);
      
      if (error) throw error;
      setReceiptItems(data as any[] || []);
      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      alert('Error fetching receipt items');
    }
  };

  const handleProcessReceipt = async (receiptId: string) => {
    if (!window.confirm('Are you sure you want to finalize this stock receipt? This will deduct the supplier costs, convert quantities to base units, update current stock levels, and write to the immutable ledger.')) {
      return;
    }

    setProcessingReceiptId(receiptId);
    try {
      // Call the Database RPC to complete the stock receipt
      const { error } = await supabase.rpc('fn_receive_stock', {
        p_receipt_id: receiptId
      });

      if (error) throw error;

      alert('Stock receipt successfully processed and ledger written.');
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to complete receipt.');
    } finally {
      setProcessingReceiptId(null);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Stock Receiving</h2>
          <p className="text-sm text-slate-400">Receive inventory shipments from suppliers and process unit conversions.</p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadData}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center space-x-2 bg-indigo-600 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow hover:bg-indigo-500 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Receive Stock (Invoice)</span>
          </button>
        </div>
      </div>

      {/* Receipts Table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
              <th className="p-4 pl-6">Invoice Date</th>
              <th className="p-4">Supplier</th>
              <th className="p-4">Invoice No.</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right pr-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {receipts.map(rec => (
              <tr key={rec.id} className="hover:bg-slate-900/10 text-slate-300">
                <td className="p-4 pl-6 font-semibold text-slate-200">{rec.date_received}</td>
                <td className="p-4 font-bold text-slate-100">{rec.supplier}</td>
                <td className="p-4 text-slate-500 font-mono">{rec.invoice_no || 'N/A'}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                    rec.status === 'completed'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                  }`}>
                    {rec.status}
                  </span>
                </td>
                <td className="p-4 text-right pr-6">
                  <button
                    onClick={() => handleViewReceipt(rec)}
                    className="flex items-center space-x-1.5 ml-auto bg-slate-900 border border-slate-800 px-2.5 py-1 rounded text-[10px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View & Manage</span>
                  </button>
                </td>
              </tr>
            ))}

            {receipts.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center p-8 text-slate-500">
                  No stock receipts logged yet. Create a draft by clicking the button above.
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
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">New Stock Delivery Draft</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveReceipt} className="p-6 space-y-4">
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

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Supplier Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={supplier}
                    onChange={(e) => setSupplier(e.target.value)}
                    placeholder="e.g. Sysco Foods"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Invoice / Receipt No.
                  </label>
                  <input
                    type="text"
                    value={invoiceNo}
                    onChange={(e) => setInvoiceNo(e.target.value)}
                    placeholder="e.g. INV-99384"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Date Received *
                  </label>
                  <input
                    type="date"
                    required
                    value={dateReceived}
                    onChange={(e) => setDateReceived(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Add Item Sub-Form */}
              <div className="bg-slate-900/60 p-4 rounded-lg border border-slate-800">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Add Delivered Item</h4>
                <div className="grid grid-cols-4 gap-3 items-end">
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Select Item
                    </label>
                    <select
                      value={currentSelectedItemId}
                      onChange={(e) => {
                        setCurrentSelectedItemId(e.target.value);
                      }}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                    >
                      {catalog.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.item_name} (Delivered in {item.purchase_unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Qty ({catalog.find(i => i.id === currentSelectedItemId)?.purchase_unit || 'Units'})
                    </label>
                    <input
                      type="number"
                      value={currentQty}
                      onChange={(e) => setCurrentQty(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Cost per Purchase Unit (₱)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={currentCost}
                      onChange={(e) => setCurrentCost(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddItemToReceiptForm}
                  className="mt-3 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-indigo-400 px-3 py-1.5 rounded border border-slate-700/50"
                >
                  + Add Item to Invoice
                </button>
              </div>

              {/* Added Items List */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Invoice Summary ({addedItems.length} items)</h4>
                <div className="bg-slate-950 rounded border border-slate-800 max-h-40 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                        <th className="p-2 pl-3">Item Name</th>
                        <th className="p-2 text-right">Quantity</th>
                        <th className="p-2 text-right">Purchase Unit Cost</th>
                        <th className="p-2 text-right">Subtotal</th>
                        <th className="p-2 text-center pr-3">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {addedItems.map((item, idx) => {
                        const info = catalog.find(c => c.id === item.item_id);
                        const sub = item.qty * item.cost;
                        return (
                          <tr key={idx} className="text-slate-300">
                            <td className="p-2 pl-3 font-semibold text-slate-200">{info?.item_name}</td>
                            <td className="p-2 text-right">
                              {item.qty} {info?.purchase_unit}
                            </td>
                            <td className="p-2 text-right">₱{item.cost.toFixed(2)}</td>
                            <td className="p-2 text-right font-semibold text-slate-100">₱{sub.toFixed(2)}</td>
                            <td className="p-2 text-center pr-3">
                              <button
                                type="button"
                                onClick={() => handleRemoveItemFromReceiptForm(idx)}
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
                  Discard Draft
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded shadow"
                >
                  Save Draft Invoice
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {showViewModal && selectedReceipt && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-xl w-full rounded-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Stock Invoice details
                </h3>
                <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">{selectedReceipt.id}</span>
              </div>
              <button onClick={() => setShowViewModal(false)} className="text-slate-400 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 block">Supplier</span>
                  <span className="font-bold text-slate-200">{selectedReceipt.supplier}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Invoice Number</span>
                  <span className="font-bold text-slate-200 font-mono">{selectedReceipt.invoice_no || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Delivery Date</span>
                  <span className="font-bold text-slate-200">{selectedReceipt.date_received}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Draft Status</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border inline-block mt-0.5 ${
                    selectedReceipt.status === 'completed'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                  }`}>
                    {selectedReceipt.status}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Delivered Items</h4>
                <div className="bg-slate-950 rounded border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                        <th className="p-2.5 pl-3">Item Name</th>
                        <th className="p-2.5 text-right">Delivered Quantity</th>
                        <th className="p-2.5 text-right">Cost Per Unit</th>
                        <th className="p-2.5 text-right pr-3">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {receiptItems.map((item, idx) => {
                        const name = item.inventory_items?.item_name || 'Deleted Item';
                        const unit = item.inventory_items?.purchase_unit || 'unit';
                        const sub = item.quantity_purchased * item.cost_per_purchase_unit;
                        return (
                          <tr key={idx} className="text-slate-300">
                            <td className="p-2.5 pl-3 font-semibold text-slate-200">{name}</td>
                            <td className="p-2.5 text-right">
                              {item.quantity_purchased} {unit}
                            </td>
                            <td className="p-2.5 text-right">₱{item.cost_per_purchase_unit.toFixed(2)}</td>
                            <td className="p-2.5 text-right font-semibold text-slate-100 pr-3">₱{sub.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  onClick={() => setShowViewModal(false)}
                  className="flex-1 bg-slate-900 border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold py-2 rounded"
                >
                  Close Window
                </button>
                {selectedReceipt.status === 'draft' && (
                  <button
                    onClick={() => handleProcessReceipt(selectedReceipt.id)}
                    disabled={processingReceiptId === selectedReceipt.id}
                    className="flex-1 flex items-center justify-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded shadow disabled:opacity-50"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    <span>{processingReceiptId === selectedReceipt.id ? 'Processing...' : 'Complete & Process Stock'}</span>
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
