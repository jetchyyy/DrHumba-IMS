import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Users, Plus, Key, Mail, RefreshCw, Edit, Trash2, ShieldOff, X, UserCheck } from 'lucide-react';

interface ProfileRecord {
  id: string;
  email: string;
  role_name: string;
  branch_id: string | null;
  allowed_tabs: string[] | null;
  status: 'active' | 'suspended';
  created_at: string;
  branches?: { name: string };
}

export const UserManagement: React.FC = () => {
  const { profile, branches } = useAuth();
  
  const [staff, setStaff] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('All');
  
  // Modals Open State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  
  // Edit State
  const [editingStaff, setEditingStaff] = useState<ProfileRecord | null>(null);
  const [editRole, setEditRole] = useState<'inventory_manager' | 'branch_manager' | 'cashier' | 'auditor'>('cashier');
  const [editBranchId, setEditBranchId] = useState('');
  const [editAllowedTabs, setEditAllowedTabs] = useState<string[]>([]);

  // Creation Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'inventory_manager' | 'branch_manager' | 'cashier' | 'auditor'>('cashier');
  const [branchId, setBranchId] = useState('');
  const [allowedTabs, setAllowedTabs] = useState<string[]>(['pos', 'sales-history', 'inventory', 'global-inventory']);
  
  // Transaction processing states
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const ROLE_DEFAULTS: Record<string, string[]> = {
    inventory_manager: ['inventory', 'global-inventory', 'receiving', 'transfers', 'adjustments', 'recipes', 'analytics'],
    branch_manager: ['pos', 'sales-history', 'inventory', 'global-inventory', 'transfers', 'adjustments', 'recipes', 'analytics'],
    cashier: ['pos', 'sales-history', 'inventory', 'global-inventory'],
    auditor: ['inventory', 'global-inventory', 'transfers', 'adjustments', 'recipes', 'branches', 'analytics', 'audit-logs'],
  };

  const ALL_AVAILABLE_TABS = [
    { id: 'pos', name: 'POS (Sales)' },
    { id: 'sales-history', name: 'Sales History' },
    { id: 'inventory', name: 'Inventory Items' },
    { id: 'global-inventory', name: 'Overall Stock' },
    { id: 'receiving', name: 'Stock Receiving' },
    { id: 'transfers', name: 'Transfers' },
    { id: 'adjustments', name: 'Adjustments' },
    { id: 'recipes', name: 'Recipes' },
    { id: 'branches', name: 'Branches' },
    { id: 'analytics', name: 'Analytics' },
    { id: 'audit-logs', name: 'Audit Logs' },
    { id: 'users', name: 'Staff Management' },
  ];

  const loadStaff = async () => {
    setLoading(true);
    try {
      const { data, error: staffError } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          role_name,
          branch_id,
          allowed_tabs,
          status,
          created_at,
          branches (name)
        `)
        .order('role_name');
      
      if (staffError) throw staffError;
      setStaff(data as any[] || []);
    } catch (err) {
      console.error('Error fetching staff list:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaff();
    if (branches.length > 0) {
      setBranchId(branches[0].id);
      setEditBranchId(branches[0].id);
    }
  }, [branches]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!email.trim() || !password.trim()) {
      setError('Email and Password are required');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      // Call public.fn_create_staff RPC
      const { error: rpcError } = await supabase.rpc('fn_create_staff', {
        p_email: email.trim(),
        p_password: password,
        p_role: role,
        p_branch_id: ['branch_manager', 'cashier'].includes(role) ? branchId : null,
        p_allowed_tabs: allowedTabs
      });

      if (rpcError) throw rpcError;

      setSuccess(`Staff account successfully created! Email: ${email}`);
      setEmail('');
      setPassword('');
      setAllowedTabs(ROLE_DEFAULTS['cashier']);
      setIsCreateModalOpen(false);
      loadStaff();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create staff member. Verify if email already exists.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;

    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('fn_edit_staff', {
        p_user_id: editingStaff.id,
        p_role: editRole,
        p_branch_id: ['branch_manager', 'cashier'].includes(editRole) ? editBranchId : null,
        p_allowed_tabs: editAllowedTabs
      });

      if (rpcError) throw rpcError;

      setSuccess(`Staff account metadata updated!`);
      setIsEditModalOpen(false);
      setEditingStaff(null);
      loadStaff();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update staff configuration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleSuspend = async (member: ProfileRecord) => {
    const nextStatus = member.status === 'suspended' ? 'active' : 'suspended';
    const confirmMessage = nextStatus === 'suspended'
      ? `Are you sure you want to suspend access for ${member.email}? They will be blocked from logging in.`
      : `Are you sure you want to restore access for ${member.email}?`;
      
    if (!window.confirm(confirmMessage)) return;

    setError('');
    setSuccess('');
    try {
      const { error: rpcError } = await supabase.rpc('fn_update_staff_status', {
        p_user_id: member.id,
        p_status: nextStatus
      });

      if (rpcError) throw rpcError;

      setSuccess(`Staff status updated to ${nextStatus}!`);
      loadStaff();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update staff status.');
    }
  };

  const handleDeleteStaff = async (member: ProfileRecord) => {
    const confirmMessage = `Are you absolutely sure you want to permanently delete the staff account for ${member.email}?\n\nThis will purge their login records and cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;

    setError('');
    setSuccess('');
    try {
      const { error: rpcError } = await supabase.rpc('fn_delete_staff', {
        p_user_id: member.id
      });

      if (rpcError) throw rpcError;

      setSuccess(`Staff account successfully deleted.`);
      loadStaff();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to delete staff account.');
    }
  };

  const openEditModal = (member: ProfileRecord) => {
    setEditingStaff(member);
    setEditRole(member.role_name as any);
    setEditBranchId(member.branch_id || (branches.length > 0 ? branches[0].id : ''));
    setEditAllowedTabs(member.allowed_tabs || ROLE_DEFAULTS[member.role_name] || []);
    setIsEditModalOpen(true);
  };

  const isSuperAdmin = profile?.role_name === 'super_admin';

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Users className="w-6 h-6 text-indigo-500" />
            <span>Staff Account Management</span>
          </h2>
          <p className="text-sm text-slate-400">Manage user credentials, branch assignments, status locks, and system permission roles.</p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Branch Filter Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-450 font-medium">Filter Branch:</span>
            <select
              value={selectedBranchFilter}
              onChange={(e) => setSelectedBranchFilter(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white px-3 py-2 focus:outline-none focus:border-indigo-500 min-w-[140px] cursor-pointer"
            >
              <option value="All">All Branches</option>
              <option value="global">Corporate (Global)</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {isSuperAdmin && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold text-white transition-all shadow-md shadow-indigo-600/10"
            >
              <Plus className="w-4 h-4" />
              <span>Provision Staff Account</span>
            </button>
          )}
          <button
            onClick={loadStaff}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded mb-6">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded mb-6">
          {success}
        </div>
      )}

      {/* Staff List Panel (Full Width) */}
      {loading ? (
        <div className="p-12 text-center text-slate-500">Loading staff records...</div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-4 pl-6">Email Address</th>
                  <th className="p-4">Assigned Role</th>
                  <th className="p-4">Location context</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4">Created Date</th>
                  {isSuperAdmin && <th className="p-4 text-right pr-6">Roster Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {(() => {
                  const filteredStaff = staff.filter(member => {
                    if (selectedBranchFilter === 'All') return true;
                    if (selectedBranchFilter === 'global') return member.branch_id === null;
                    return member.branch_id === selectedBranchFilter;
                  });

                  if (filteredStaff.length === 0) {
                    return (
                      <tr>
                        <td colSpan={isSuperAdmin ? 6 : 5} className="p-8 text-center text-slate-500 text-xs">
                          No staff accounts found for the selected branch filter.
                        </td>
                      </tr>
                    );
                  }

                  return filteredStaff.map(member => {
                    const isSelf = member.id === profile?.id;
                  return (
                    <tr key={member.id} className="hover:bg-slate-900/10 text-slate-300">
                      <td className="p-4 pl-6 font-semibold text-slate-100">{member.email}</td>
                      <td className="p-4">
                        <div className="flex flex-col space-y-1">
                          <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border w-fit ${
                            member.role_name === 'super_admin'
                              ? 'bg-red-500/10 border-red-500/20 text-red-400'
                              : member.role_name === 'inventory_manager'
                              ? 'bg-purple-500/10 border-purple-500/20 text-purple-400'
                              : member.role_name === 'branch_manager'
                              ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                              : member.role_name === 'auditor'
                              ? 'bg-slate-800 border-slate-700 text-slate-400'
                              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          }`}>
                            {member.role_name.replace('_', ' ')}
                          </span>
                          {member.role_name === 'super_admin' ? (
                            <span className="text-[9px] text-slate-500">All features allowed</span>
                          ) : member.allowed_tabs ? (
                            <span className="text-[9px] text-indigo-400 font-semibold" title={member.allowed_tabs.join(', ')}>
                              Custom: {member.allowed_tabs.length} features
                            </span>
                          ) : (
                            <span className="text-[9px] text-slate-500">Default permissions</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-slate-400">
                        {member.branch_id ? member.branches?.name : 'Corporate (Global)'}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${
                          member.status === 'suspended'
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-500'
                            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        }`}>
                          {member.status}
                        </span>
                      </td>
                      <td className="p-4 text-slate-500">
                        {new Date(member.created_at).toLocaleDateString()}
                      </td>
                      {isSuperAdmin && (
                        <td className="p-4 text-right pr-6">
                          <div className="flex items-center justify-end space-x-2">
                            {/* Edit */}
                            <button
                              onClick={() => openEditModal(member)}
                              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-indigo-400 hover:text-indigo-300 transition-all"
                              title="Edit user role & allowed tabs"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>

                            {/* Suspend */}
                            {!isSelf && (
                              <button
                                onClick={() => handleToggleSuspend(member)}
                                className={`p-1.5 bg-slate-900 border rounded transition-all ${
                                  member.status === 'suspended'
                                    ? 'hover:bg-emerald-500/10 border-slate-800 text-emerald-400 hover:text-emerald-300'
                                    : 'hover:bg-amber-500/10 border-slate-800 text-amber-500 hover:text-amber-400'
                                }`}
                                title={member.status === 'suspended' ? 'Restore access (Unsuspend)' : 'Suspend access'}
                              >
                                {member.status === 'suspended' ? (
                                  <UserCheck className="w-3.5 h-3.5" />
                                ) : (
                                  <ShieldOff className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}

                            {/* Delete */}
                            {!isSelf && (
                              <button
                                onClick={() => handleDeleteStaff(member)}
                                className="p-1.5 bg-slate-900 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/20 rounded text-rose-400 hover:text-rose-300 transition-all"
                                title="Permanently delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: PROVISION STAFF ACCOUNT */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="glass max-w-lg w-full rounded-2xl border border-slate-800/90 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/60">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <Plus className="w-4 h-4 text-indigo-500" />
                <span>Provision Staff Account</span>
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form Content */}
            <form onSubmit={handleCreateStaff} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="staff@restaurant.com"
                    className="w-full bg-slate-900 border border-slate-800 rounded pl-10 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Initial Password
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-900 border border-slate-800 rounded pl-10 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    System Role
                  </label>
                  <select
                    value={role}
                    onChange={(e: any) => {
                      const selectedRole = e.target.value;
                      setRole(selectedRole);
                      setAllowedTabs(ROLE_DEFAULTS[selectedRole] || []);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="inventory_manager">Inventory Manager (Corporate)</option>
                    <option value="branch_manager">Branch Manager (Branch specific)</option>
                    <option value="cashier">Cashier (Branch POS only)</option>
                    <option value="auditor">Auditor (Corporate read-only)</option>
                  </select>
                </div>

                {['branch_manager', 'cashier'].includes(role) ? (
                  <div>
                    <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Assigned Branch Context *
                    </label>
                    <select
                      value={branchId}
                      onChange={(e) => setBranchId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="opacity-40">
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
                      Assigned Branch Context
                    </label>
                    <div className="w-full bg-slate-900/60 border border-slate-850 rounded px-3 py-2 text-xs text-slate-500 select-none">
                      Corporate (Global Scope)
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-2">
                  Allowed Features (Permissions Override)
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-3 rounded border border-slate-800/80 max-h-40 overflow-y-auto">
                  {ALL_AVAILABLE_TABS.map((tab) => {
                    const isChecked = allowedTabs.includes(tab.id);
                    return (
                      <label key={tab.id} className="flex items-center space-x-2 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setAllowedTabs(allowedTabs.filter(t => t !== tab.id));
                            } else {
                              setAllowedTabs([...allowedTabs, tab.id]);
                            }
                          }}
                          className="rounded border-slate-850 bg-slate-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-950 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span>{tab.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white rounded text-xs font-semibold hover:bg-slate-800 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold shadow transition-all disabled:opacity-50"
                >
                  {submitting ? 'Provisioning...' : 'Provision Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT STAFF CONFIGURATION */}
      {isEditModalOpen && editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="glass max-w-lg w-full rounded-2xl border border-slate-800/90 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/60">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                <Edit className="w-4 h-4 text-indigo-500" />
                <span>Edit Staff Config: {editingStaff.email}</span>
              </h3>
              <button
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingStaff(null);
                }}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form Content */}
            <form onSubmit={handleEditStaffSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                    System Role
                  </label>
                  <select
                    value={editRole}
                    onChange={(e: any) => {
                      const selectedRole = e.target.value;
                      setEditRole(selectedRole);
                      setEditAllowedTabs(ROLE_DEFAULTS[selectedRole] || []);
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="inventory_manager">Inventory Manager (Corporate)</option>
                    <option value="branch_manager">Branch Manager (Branch specific)</option>
                    <option value="cashier">Cashier (Branch POS only)</option>
                    <option value="auditor">Auditor (Corporate read-only)</option>
                  </select>
                </div>

                {['branch_manager', 'cashier'].includes(editRole) ? (
                  <div>
                    <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                      Assigned Branch Context *
                    </label>
                    <select
                      value={editBranchId}
                      onChange={(e) => setEditBranchId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                    >
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="opacity-40">
                    <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
                      Assigned Branch Context
                    </label>
                    <div className="w-full bg-slate-900/60 border border-slate-850 rounded px-3 py-2 text-xs text-slate-500 select-none">
                      Corporate (Global Scope)
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-2">
                  Allowed Features (Permissions Override)
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-900/60 p-3 rounded border border-slate-800/80 max-h-40 overflow-y-auto">
                  {ALL_AVAILABLE_TABS.map((tab) => {
                    const isChecked = editAllowedTabs.includes(tab.id);
                    return (
                      <label key={tab.id} className="flex items-center space-x-2 text-xs text-slate-300 hover:text-white cursor-pointer select-none py-0.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setEditAllowedTabs(editAllowedTabs.filter(t => t !== tab.id));
                            } else {
                              setEditAllowedTabs([...editAllowedTabs, tab.id]);
                            }
                          }}
                          className="rounded border-slate-850 bg-slate-950 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-950 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span>{tab.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingStaff(null);
                  }}
                  className="px-4 py-2 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white rounded text-xs font-semibold hover:bg-slate-800 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold shadow transition-all disabled:opacity-50"
                >
                  {submitting ? 'Saving Changes...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
