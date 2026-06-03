import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Store, MapPin, Plus, Trash2, Home } from 'lucide-react';

export const BranchManagement: React.FC = () => {
  const { profile, branches, refreshProfile } = useAuth();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [isWarehouse, setIsWarehouse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Re-fetch branches on mount
  useEffect(() => {
    refreshProfile();
  }, []);

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

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white tracking-tight">Branch Management</h2>
        <p className="text-sm text-slate-400">Add, review, and delete warehouses and retail restaurant branches.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Branch Form (Super Admin Only) */}
        <div className="lg:col-span-1">
          <div className="glass p-6 rounded-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 flex items-center space-x-2">
              <Plus className="w-4 h-4 text-indigo-500" />
              <span>Create New Branch</span>
            </h3>

            {isSuperAdmin ? (
              <form onSubmit={handleCreateBranch} className="space-y-4">
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded">
                    {error}
                  </div>
                )}
                {success && (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded">
                    {success}
                  </div>
                )}

                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Branch Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Branch C - Westside"
                    className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    Location Address
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. 789 West Blvd, City"
                    className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <input
                    type="checkbox"
                    id="isWarehouse"
                    checked={isWarehouse}
                    onChange={(e) => setIsWarehouse(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-800 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="isWarehouse" className="text-xs text-slate-300 font-semibold select-none cursor-pointer">
                    This location is a Warehouse
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-indigo-600 text-sm font-semibold text-white py-2 rounded hover:bg-indigo-500 transition-all disabled:opacity-50"
                >
                  {submitting ? 'Creating...' : 'Create Location'}
                </button>
              </form>
            ) : (
              <p className="text-xs text-slate-500">Only Super Admins can add new branch locations.</p>
            )}
          </div>
        </div>

        {/* Branches list */}
        <div className="lg:col-span-2">
          <div className="glass rounded-xl overflow-hidden">
            <div className="p-4 bg-slate-900 border-b border-slate-800">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Active Locations</h3>
            </div>
            <div className="divide-y divide-slate-800/60">
              {branches.map((b) => (
                <div key={b.id} className="p-5 flex items-center justify-between hover:bg-slate-900/10 transition-all">
                  <div className="flex items-center space-x-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                      b.is_warehouse 
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' 
                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    }`}>
                      {b.is_warehouse ? <Home className="w-5 h-5" /> : <Store className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                        <span>{b.name}</span>
                        {b.is_warehouse && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 uppercase font-semibold">
                            Central Warehouse
                          </span>
                        )}
                      </h4>
                      <p className="text-xs text-slate-500 flex items-center space-x-1 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-600" />
                        <span>{b.location || 'No address specified'}</span>
                      </p>
                    </div>
                  </div>

                  {isSuperAdmin && (
                    <button
                      onClick={() => handleDeleteBranch(b.id, b.name)}
                      className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/5 rounded transition-all"
                      title="Delete Branch"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}

              {branches.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-xs">
                  No branch locations loaded. Create one in the form on the left.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
