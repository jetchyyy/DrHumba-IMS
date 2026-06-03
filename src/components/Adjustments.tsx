import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Plus, Eye, X, RefreshCw, Trash2 } from 'lucide-react';

interface Adjustment {
  id: string;
  branch_id: string;
  reason: 'damage' | 'spoilage' | 'expired' | 'lost' | 'manual_correction';
  remarks: string | null;
  photo_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  branches?: { name: string };
}

interface AdjustmentItem {
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

export const Adjustments: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAdjustment, setSelectedAdjustment] = useState<Adjustment | null>(null);
  const [adjustmentItems, setAdjustmentItems] = useState<AdjustmentItem[]>([]);
  
  // Create Form state
  const [reason, setReason] = useState<'damage' | 'spoilage' | 'expired' | 'lost' | 'manual_correction'>('spoilage');
  const [remarks, setRemarks] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [addedItems, setAddedItems] = useState<{ item_id: string; qty: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(-10); // Default to negative deduction
  
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [processing, setProcessing] = useState(false);

  const loadData = async () => {
    try {
      // 1. Fetch adjustments
      const { data: adjData, error: adjError } = await supabase
        .from('stock_adjustments')
        .select(`
          id,
          branch_id,
          reason,
          remarks,
          photo_url,
          status,
          created_at,
          branches (name)
        `)
        .order('created_at', { ascending: false });
      if (adjError) throw adjError;
      setAdjustments((adjData as any[]) || []);

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
  }, [selectedBranch]);

  const handleOpenCreateModal = () => {
    setReason('spoilage');
    setRemarks('');
    setPhotoUrl('');
    setAddedItems([]);
    setFormError('');
    setFormSuccess('');
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(-10);
    }
    setShowCreateModal(true);
  };

  const handleAddItem = () => {
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

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (addedItems.length === 0) {
      setFormError('Add at least one item to adjust');
      return;
    }

    if (!selectedBranch) {
      setFormError('No branch context selected');
      return;
    }

    try {
      // 1. Insert stock_adjustments row
      const { data: adjData, error: adjError } = await supabase
        .from('stock_adjustments')
        .insert({
          branch_id: selectedBranch.id,
          reason,
          remarks: remarks.trim() || null,
          photo_url: photoUrl.trim() || null,
          status: 'pending'
        })
        .select()
        .single();

      if (adjError) throw adjError;

      // 2. Insert stock_adjustment_items rows
      const itemsPayload = addedItems.map(item => ({
        adjustment_id: adjData.id,
        item_id: item.item_id,
        quantity_base_unit: item.qty
      }));

      const { error: itemsError } = await supabase
        .from('stock_adjustment_items')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      // Create system notification for admins
      await supabase
        .from('notifications')
        .insert({
          branch_id: selectedBranch.id,
          type: 'adjustment_pending',
          message: `New adjustment (${reason}) pending approval at ${selectedBranch.name}`
        });

      setFormSuccess('Adjustment logged and pending approval!');
      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Error logging adjustment');
    }
  };

  const handleViewAdjustment = async (adj: Adjustment) => {
    setSelectedAdjustment(adj);
    try {
      const { data, error } = await supabase
        .from('stock_adjustment_items')
        .select(`
          id,
          item_id,
          quantity_base_unit,
          inventory_items (
            item_name,
            base_unit
          )
        `)
        .eq('adjustment_id', adj.id);
      
      if (error) throw error;
      setAdjustmentItems(data as any[] || []);
      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      alert('Error fetching adjustment items');
    }
  };

  const handleApproveAdjustment = async (adjustmentId: string) => {
    if (!window.confirm('Are you sure you want to approve this stock adjustment? Balance corrections will be instantly applied and movement ledgers committed.')) {
      return;
    }

    setProcessing(true);
    try {
      // Call public.fn_process_adjustment RPC
      const { error } = await supabase.rpc('fn_process_adjustment', {
        p_adjustment_id: adjustmentId
      });

      if (error) throw error;

      alert('Adjustment approved and inventory records updated!');
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to approve adjustment. Ensure branch has sufficient quantity for stock deductions!');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAdjustment = async (adjustmentId: string) => {
    if (!window.confirm('Are you sure you want to reject this request?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('stock_adjustments')
        .update({ status: 'rejected', approved_by: profile?.id })
        .eq('id', adjustmentId);

      if (error) throw error;

      alert('Adjustment request rejected.');
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to reject adjustment.');
    }
  };

  const canApprove = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Stock Adjustments</h2>
          <p className="text-sm text-slate-400">Log damages, spoilage, or manual inventory count corrections.</p>
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
            <span>Create Adjustment Log</span>
          </button>
        </div>
      </div>

      {/* Adjustments Table */}
      <div className="glass rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
              <th className="p-4 pl-6">Date Logged</th>
              <th className="p-4">Branch</th>
              <th className="p-4">Reason</th>
              <th className="p-4">Remarks</th>
              <th className="p-4">Status</th>
              <th className="p-4 text-right pr-6">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {adjustments.map(adj => (
              <tr key={adj.id} className="hover:bg-slate-900/10 text-slate-300">
                <td className="p-4 pl-6 font-semibold text-slate-200">
                  {new Date(adj.created_at).toLocaleDateString()}
                </td>
                <td className="p-4 font-medium text-slate-300">{adj.branches?.name || 'Unknown'}</td>
                <td className="p-4">
                  <span className="capitalize px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700/50">
                    {adj.reason.replace('_', ' ')}
                  </span>
                </td>
                <td className="p-4 text-slate-500 max-w-xs truncate">{adj.remarks || 'No remarks'}</td>
                <td className="p-4">
                  <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                    adj.status === 'approved'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : adj.status === 'rejected'
                      ? 'bg-red-500/10 border-red-500/20 text-red-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                  }`}>
                    {adj.status}
                  </span>
                </td>
                <td className="p-4 text-right pr-6">
                  <button
                    onClick={() => handleViewAdjustment(adj)}
                    className="flex items-center space-x-1.5 ml-auto bg-slate-900 border border-slate-800 px-2.5 py-1 rounded text-[10px] font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View Details</span>
                  </button>
                </td>
              </tr>
            ))}

            {adjustments.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center p-8 text-slate-500">
                  No adjustments logged yet. Click 'Create Adjustment Log' to begin.
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
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Log Stock Adjustment</h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="p-6 space-y-4">
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
                    Adjustment Reason *
                  </label>
                  <select
                    value={reason}
                    onChange={(e: any) => setReason(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="spoilage">Spoilage</option>
                    <option value="damage">Damage / Spill</option>
                    <option value="expired">Expired Goods</option>
                    <option value="lost">Lost / Theft</option>
                    <option value="manual_correction">Manual Count Correction</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Photo Attachment URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder="https://example.com/spoilage.jpg"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Remarks / Explanation *
                </label>
                <input
                  type="text"
                  required
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Freezers went down overnight, spoiling these ingredients"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Add Item Sub-Form */}
              <div className="bg-slate-900/60 p-4 rounded-lg border border-slate-800">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Add Item to Adjust</h4>
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
                      Quantity (Negative to subtract)
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
                  onClick={handleAddItem}
                  className="mt-3 bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-indigo-400 px-3 py-1.5 rounded border border-slate-700/50"
                >
                  + Add Item
                </button>
              </div>

              {/* Added Items List */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Adjustments List ({addedItems.length})</h4>
                <div className="bg-slate-950 rounded border border-slate-800 max-h-40 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                        <th className="p-2 pl-3">Item Name</th>
                        <th className="p-2 text-right">Adjustment Amount</th>
                        <th className="p-2 text-center pr-3">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {addedItems.map((item, idx) => {
                        const info = catalog.find(c => c.id === item.item_id);
                        return (
                          <tr key={idx} className="text-slate-300">
                            <td className="p-2 pl-3 font-semibold text-slate-200">{info?.item_name}</td>
                            <td className={`p-2 text-right font-bold ${item.qty < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {item.qty > 0 ? `+${item.qty}` : item.qty} {info?.base_unit}
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
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded shadow"
                >
                  Submit for Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {showViewModal && selectedAdjustment && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-xl w-full rounded-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                  Adjustment #{selectedAdjustment.id.slice(0, 8)}
                </h3>
                <span className="text-[10px] text-slate-500 mt-0.5 block">{selectedAdjustment.id}</span>
              </div>
              <button onClick={() => setShowViewModal(false)} className="text-slate-400 hover:text-white transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 block">Branch Location</span>
                  <span className="font-bold text-slate-200">{selectedAdjustment.branches?.name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Reason</span>
                  <span className="capitalize font-bold text-indigo-400">{selectedAdjustment.reason.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Created Date</span>
                  <span className="font-bold text-slate-200">{new Date(selectedAdjustment.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Approval Status</span>
                  <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border inline-block mt-0.5 ${
                    selectedAdjustment.status === 'approved'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : selectedAdjustment.status === 'rejected'
                      ? 'bg-red-500/10 border-red-500/20 text-red-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-500'
                  }`}>
                    {selectedAdjustment.status}
                  </span>
                </div>
                {selectedAdjustment.photo_url && (
                  <div className="col-span-2">
                    <span className="text-slate-500 block mb-1">Attachment Photo</span>
                    <a 
                      href={selectedAdjustment.photo_url} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="text-xs text-indigo-400 underline break-all hover:text-indigo-300"
                    >
                      {selectedAdjustment.photo_url}
                    </a>
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-slate-500 block">Remarks</span>
                  <span className="font-medium text-slate-300">{selectedAdjustment.remarks || 'No remarks'}</span>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">Adjusted Items</h4>
                <div className="bg-slate-950 rounded border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-slate-500 border-b border-slate-800">
                        <th className="p-2.5 pl-3">Item Name</th>
                        <th className="p-2.5 text-right pr-3">Adjustment Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40">
                      {adjustmentItems.map((item, idx) => {
                        const name = item.inventory_items?.item_name || 'Deleted Item';
                        const unit = item.inventory_items?.base_unit || 'unit';
                        return (
                          <tr key={idx} className="text-slate-300">
                            <td className="p-2.5 pl-3 font-semibold text-slate-200">{name}</td>
                            <td className={`p-2.5 text-right font-bold pr-3 ${item.quantity_base_unit < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {item.quantity_base_unit > 0 ? `+${item.quantity_base_unit}` : item.quantity_base_unit} {unit}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex space-x-2 pt-2">
                {selectedAdjustment.status === 'pending' && canApprove ? (
                  <>
                    <button
                      onClick={() => handleRejectAdjustment(selectedAdjustment.id)}
                      className="flex-1 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-500/20 text-xs font-semibold py-2 rounded"
                    >
                      Reject Adjustment
                    </button>
                    <button
                      onClick={() => handleApproveAdjustment(selectedAdjustment.id)}
                      disabled={processing}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold py-2 rounded shadow disabled:opacity-50"
                    >
                      {processing ? 'Processing...' : 'Approve & Apply'}
                    </button>
                  </>
                ) : (
                  <button
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
