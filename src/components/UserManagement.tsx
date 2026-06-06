import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { GroupIcon as Users, PlusIcon as Plus, LockClosedIcon as Key, EnvelopeClosedIcon as Mail, ReloadIcon as RefreshCw, Pencil1Icon as Edit, TrashIcon as Trash2, CrossCircledIcon as ShieldOff, PersonIcon as UserCheck } from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { useModal } from '../contexts/ModalContext';

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
  const { confirm, showSuccess, showError } = useModal();
  
  const [staff, setStaff] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
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

    if (!email.trim() || !password.trim()) {
      showError("Email and Password are required");
      return;
    }

    if (password.length < 6) {
      showError("Password must be at least 6 characters");
      return;
    }

    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('fn_create_staff', {
        p_email: email.trim(),
        p_password: password,
        p_role: role,
        p_branch_id: ['branch_manager', 'cashier'].includes(role) ? branchId : null,
        p_allowed_tabs: allowedTabs
      });

      if (rpcError) throw rpcError;

      showSuccess(`Staff account successfully created! Email: ${email}`);
      setEmail('');
      setPassword('');
      setAllowedTabs(ROLE_DEFAULTS['cashier']);
      setIsCreateModalOpen(false);
      loadStaff();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to create staff member. Verify if email already exists.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff) return;

    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('fn_edit_staff', {
        p_user_id: editingStaff.id,
        p_role: editRole,
        p_branch_id: ['branch_manager', 'cashier'].includes(editRole) ? editBranchId : null,
        p_allowed_tabs: editAllowedTabs
      });

      if (rpcError) throw rpcError;

      showSuccess("Staff account metadata updated!");
      setIsEditModalOpen(false);
      setEditingStaff(null);
      loadStaff();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to update staff configuration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleSuspend = async (member: ProfileRecord) => {
    const nextStatus = member.status === 'suspended' ? 'active' : 'suspended';
    const confirmMessage = nextStatus === 'suspended'
      ? `Are you sure you want to suspend access for ${member.email}? They will be blocked from logging in.`
      : `Are you sure you want to restore access for ${member.email}?`;
      
    if (!await confirm(nextStatus === 'suspended' ? 'Suspend Staff' : 'Restore Staff', confirmMessage)) return;

    try {
      const { error: rpcError } = await supabase.rpc('fn_update_staff_status', {
        p_user_id: member.id,
        p_status: nextStatus
      });

      if (rpcError) throw rpcError;

      showSuccess(`Staff status updated to ${nextStatus}!`);
      loadStaff();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to update staff status.');
    }
  };

  const handleDeleteStaff = async (member: ProfileRecord) => {
    const confirmMessage = `Are you absolutely sure you want to permanently delete the staff account for ${member.email}?\n\nThis will purge their login records and cannot be undone.`;
    if (!await confirm('Delete Staff', confirmMessage)) return;

    try {
      const { error: rpcError } = await supabase.rpc('fn_delete_staff', {
        p_user_id: member.id
      });

      if (rpcError) throw rpcError;

      showSuccess("Staff account successfully deleted.");
      loadStaff();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to delete staff account.');
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
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <Users className="w-8 h-8 text-primary" />
            <span>Staff Account Management</span>
          </h2>
          <p className="text-muted-foreground mt-1">Manage user credentials, branch assignments, status locks, and system permission roles.</p>
        </div>

        <div className="flex space-x-2">
          <Button variant="outline" size="icon" onClick={loadStaff}>
            <RefreshCw className="w-4 h-4" />
          </Button>
          {isSuperAdmin && (
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Provision Staff Account
            </Button>
          )}
        </div>
      </div>

      {/* Staff List Panel */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Email Address</TableHead>
                <TableHead>Assigned Role</TableHead>
                <TableHead>Location context</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Created Date</TableHead>
                {isSuperAdmin && <TableHead className="text-right pr-6">Roster Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 6 : 5} className="h-24 text-center text-muted-foreground">
                    Loading staff records...
                  </TableCell>
                </TableRow>
              ) : staff.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 6 : 5} className="h-24 text-center text-muted-foreground">
                    No staff records found.
                  </TableCell>
                </TableRow>
              ) : (
                staff.map(member => {
                  const isSelf = member.id === profile?.id;
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="pl-6 font-semibold">{member.email}</TableCell>
                      <TableCell>
                        <div className="flex flex-col space-y-1">
                          <Badge variant="outline" className={`w-fit uppercase text-[9px] ${
                            member.role_name === 'super_admin' ? 'border-red-500/50 text-red-500 bg-red-500/10' :
                            member.role_name === 'inventory_manager' ? 'border-purple-500/50 text-purple-500 bg-purple-500/10' :
                            member.role_name === 'branch_manager' ? 'border-blue-500/50 text-blue-500 bg-blue-500/10' :
                            member.role_name === 'auditor' ? 'border-muted text-muted-foreground bg-muted/10' :
                            'border-emerald-500/50 text-emerald-500 bg-emerald-500/10'
                          }`}>
                            {member.role_name.replace('_', ' ')}
                          </Badge>
                          {member.role_name === 'super_admin' ? (
                            <span className="text-[9px] text-muted-foreground">All features allowed</span>
                          ) : member.allowed_tabs ? (
                            <span className="text-[9px] text-primary font-semibold" title={member.allowed_tabs.join(', ')}>
                              Custom: {member.allowed_tabs.length} features
                            </span>
                          ) : (
                            <span className="text-[9px] text-muted-foreground">Default permissions</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.branch_id ? member.branches?.name : 'Corporate (Global)'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={member.status === 'suspended' ? "destructive" : "default"} className="uppercase text-[9px]">
                          {member.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {new Date(member.created_at).toLocaleDateString()}
                      </TableCell>
                      {isSuperAdmin && (
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end space-x-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10" onClick={() => openEditModal(member)} title="Edit user role & allowed tabs">
                              <Edit className="h-4 w-4" />
                            </Button>
                            
                            {!isSelf && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`h-8 w-8 ${member.status === 'suspended' ? 'text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10' : 'text-amber-500 hover:text-amber-500 hover:bg-amber-500/10'}`}
                                onClick={() => handleToggleSuspend(member)}
                                title={member.status === 'suspended' ? 'Restore access' : 'Suspend access'}
                              >
                                {member.status === 'suspended' ? <UserCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
                              </Button>
                            )}

                            {!isSelf && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDeleteStaff(member)} title="Permanently delete user">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* CREATE MODAL */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Plus className="w-5 h-5 mr-2 text-primary" />
              Provision Staff Account
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateStaff} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@restaurant.com" className="pl-9" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Initial Password</Label>
              <div className="relative">
                <Key className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="pl-9" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>System Role</Label>
                <Select value={role} onValueChange={(v: any) => { setRole(v); setAllowedTabs(ROLE_DEFAULTS[v] || []); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inventory_manager">Inventory Manager</SelectItem>
                    <SelectItem value="branch_manager">Branch Manager</SelectItem>
                    <SelectItem value="cashier">Cashier</SelectItem>
                    <SelectItem value="auditor">Auditor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {['branch_manager', 'cashier'].includes(role) ? (
                <div className="space-y-2">
                  <Label>Assigned Branch Context *</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2 opacity-50">
                  <Label>Assigned Branch Context</Label>
                  <div className="h-10 flex items-center px-3 border rounded-md bg-muted text-sm text-muted-foreground">
                    Corporate (Global Scope)
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Allowed Features (Permissions Override)</Label>
              <div className="grid grid-cols-2 gap-2 p-4 border rounded-md max-h-40 overflow-y-auto bg-muted/30">
                {ALL_AVAILABLE_TABS.map((tab) => {
                  const isChecked = allowedTabs.includes(tab.id);
                  return (
                    <div key={tab.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`tab-${tab.id}`}
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          if (!checked) {
                            setAllowedTabs(allowedTabs.filter(t => t !== tab.id));
                          } else {
                            setAllowedTabs([...allowedTabs, tab.id]);
                          }
                        }}
                      />
                      <Label htmlFor={`tab-${tab.id}`} className="text-xs font-normal cursor-pointer">
                        {tab.name}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Provisioning...' : 'Provision Account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT MODAL */}
      <Dialog open={isEditModalOpen} onOpenChange={(open) => { if (!open) { setIsEditModalOpen(false); setEditingStaff(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Edit className="w-5 h-5 mr-2 text-primary" />
              Edit Staff Config: {editingStaff?.email}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditStaffSubmit} className="space-y-4 pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>System Role</Label>
                <Select value={editRole} onValueChange={(v: any) => { setEditRole(v); setEditAllowedTabs(ROLE_DEFAULTS[v] || []); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inventory_manager">Inventory Manager</SelectItem>
                    <SelectItem value="branch_manager">Branch Manager</SelectItem>
                    <SelectItem value="cashier">Cashier</SelectItem>
                    <SelectItem value="auditor">Auditor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {['branch_manager', 'cashier'].includes(editRole) ? (
                <div className="space-y-2">
                  <Label>Assigned Branch Context *</Label>
                  <Select value={editBranchId} onValueChange={setEditBranchId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {branches.map(b => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2 opacity-50">
                  <Label>Assigned Branch Context</Label>
                  <div className="h-10 flex items-center px-3 border rounded-md bg-muted text-sm text-muted-foreground">
                    Corporate (Global Scope)
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Allowed Features (Permissions Override)</Label>
              <div className="grid grid-cols-2 gap-2 p-4 border rounded-md max-h-40 overflow-y-auto bg-muted/30">
                {ALL_AVAILABLE_TABS.map((tab) => {
                  const isChecked = editAllowedTabs.includes(tab.id);
                  return (
                    <div key={tab.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`edit-tab-${tab.id}`}
                        checked={isChecked}
                        onCheckedChange={(checked) => {
                          if (!checked) {
                            setEditAllowedTabs(editAllowedTabs.filter(t => t !== tab.id));
                          } else {
                            setEditAllowedTabs([...editAllowedTabs, tab.id]);
                          }
                        }}
                      />
                      <Label htmlFor={`edit-tab-${tab.id}`} className="text-xs font-normal cursor-pointer">
                        {tab.name}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => { setIsEditModalOpen(false); setEditingStaff(null); }}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving Changes...' : 'Save Configuration'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
