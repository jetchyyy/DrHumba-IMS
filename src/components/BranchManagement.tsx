import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Store, MapPin, Plus, Trash2, Home, Building2, X, AlertTriangle } from 'lucide-react';

export const BranchManagement: React.FC = () => {
  const { profile, branches, refreshProfile } = useAuth();
  
  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Form States
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [isWarehouse, setIsWarehouse] = useState(false);
  
  // Status States
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Re-fetch branches on mount
  useEffect(() => {
    refreshProfile();
  }, []);

  const handleOpenModal = () => {
    setName('');
    setLocation('');
    setIsWarehouse(false);
    setError('');
    setSuccess('');
    setShowAddModal(true);
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const { error: insertError } = await supabase
        .from('branches')
        .insert({
          name: name.trim(),
          location: location.trim() || null,
          is_warehouse: isWarehouse
        });

      if (insertError) throw insertError;

      setSuccess(`Branch "${name}" created successfully!`);
      setName('');
      setLocation('');
      setIsWarehouse(false);
      
      // Refresh Auth Context branches list
      await refreshProfile();
      
      // Close modal after a short delay to let the user see the success message
      setTimeout(() => {
        setShowAddModal(false);
        setSuccess('');
      }, 800);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create branch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBranch = async (id: string, branchName: string) => {
    if (!window.confirm(`Are you sure you want to delete branch "${branchName}"? This will delete all associated inventory balances.`)) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from('branches')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to delete branch');
    }
  };

  const isSuperAdmin = profile?.role_name === 'super_admin';

  // Analytics Metrics
  const totalLocations = branches.length;
  const centralWarehouses = branches.filter(b => b.is_warehouse).length;
  const retailOutlets = branches.filter(b => !b.is_warehouse).length;

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      
      {/* Header Section */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Building2 className="w-6 h-6 text-indigo-500" />
            <span>Branch & Logistics Locations</span>
          </h2>
          <p className="text-sm text-slate-400">Add, review, and delete warehouses and retail restaurant branches.</p>
        </div>

        {isSuperAdmin && (
          <button
            onClick={handleOpenModal}
            className="flex items-center space-x-2 bg-indigo-650 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow hover:shadow-indigo-650/15 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add Location</span>
          </button>
        )}
      </div>

      {/* Analytics Cards at the top */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Total Locations Card */}
        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Total Locations</span>
            <span className="text-2xl font-bold text-white">{totalLocations} {totalLocations === 1 ? 'Location' : 'Locations'}</span>
          </div>
        </div>

        {/* Warehouses Card */}
        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-amber-500/10 rounded-lg text-amber-400 border border-amber-500/20">
            <Home className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Warehouses</span>
            <span className="text-2xl font-bold text-amber-400">{centralWarehouses} {centralWarehouses === 1 ? 'Center' : 'Centers'}</span>
          </div>
        </div>

        {/* Retail Outlets Card */}
        <div className="glass p-5 rounded-xl border border-slate-800/80 bg-slate-900/30 flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">Retail Branches</span>
            <span className="text-2xl font-bold text-emerald-400">{retailOutlets} {retailOutlets === 1 ? 'Outlet' : 'Outlets'}</span>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="glass rounded-xl overflow-hidden">
        <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Active Logistics Registry</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-900/60 border-b border-slate-800 text-slate-400 font-semibold">
                <th className="p-4 pl-6">Branch Name / Label</th>
                <th className="p-4">Location Address</th>
                <th className="p-4">Classification</th>
                {isSuperAdmin && <th className="p-4 text-right pr-6 w-20">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {branches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-900/10 text-slate-350 transition-all">
                  <td className="p-4 pl-6">
                    <div className="flex items-center space-x-3.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                        b.is_warehouse 
                          ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                          : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      }`}>
                        {b.is_warehouse ? <Home className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                      </div>
                      <div>
                        <span className="font-bold text-slate-200 block">{b.name}</span>
                        {b.is_warehouse && (
                          <span className="inline-block text-[8px] px-1 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase font-semibold mt-0.5">
                            Central Warehouse
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center space-x-1.5 text-slate-400">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      <span>{b.location || 'No address specified'}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                      b.is_warehouse 
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-450'
                    }`}>
                      {b.is_warehouse ? 'Warehouse' : 'Retail Branch'}
                    </span>
                  </td>
                  {isSuperAdmin && (
                    <td className="p-4 text-right pr-6">
                      <button
                        onClick={() => handleDeleteBranch(b.id, b.name)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-all ml-auto block"
                        title="Delete Branch"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}

              {branches.length === 0 && (
                <tr>
                  <td colSpan={isSuperAdmin ? 4 : 3} className="p-8 text-center text-slate-500 text-xs">
                    No branch locations found. Click 'Add Location' to register a branch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD LOCATION MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass max-w-md w-full rounded-xl overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Create New Location
              </h3>
              <button 
                onClick={() => setShowAddModal(false)} 
                className="text-slate-400 hover:text-white transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateBranch} className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded">
                  {success}
                </div>
              )}

              <div>
                <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Branch / Warehouse Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Branch C - Westside"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Location Address
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. 789 West Blvd, City"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center space-x-2 py-2">
                <input
                  type="checkbox"
                  id="modalIsWarehouse"
                  checked={isWarehouse}
                  onChange={(e) => setIsWarehouse(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-indigo-650 focus:ring-indigo-550 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="modalIsWarehouse" className="text-xs text-slate-300 font-semibold select-none cursor-pointer">
                  This location is a Central Warehouse
                </label>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 bg-slate-900 border border-slate-800 text-slate-450 hover:text-white text-xs font-semibold py-2 rounded transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded shadow transition-all disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
