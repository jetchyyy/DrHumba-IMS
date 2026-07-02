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
import { useTenant } from '../contexts/TenantContext';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

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
  const { tenant } = useTenant();
  const { confirm, showSuccess, showError } = useModal();

  const [staff, setStaff] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const limitReached = !!(tenant && staff.length >= tenant.max_users);

  // Modals Open State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Edit State
  const [editingStaff, setEditingStaff] = useState<ProfileRecord | null>(null);
  const [editRole, setEditRole] = useState<string>('cashier');
  const [editBranchId, setEditBranchId] = useState('');
  const [editAllowedTabs, setEditAllowedTabs] = useState<string[]>([]);
  const [editAllowTransfers, setEditAllowTransfers] = useState(false);
  const [editAllowActionButtons, setEditAllowActionButtons] = useState(false);
  const [editCustomRole, setEditCustomRole] = useState('');

  // Creation Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('cashier');
  const [branchId, setBranchId] = useState('');
  const [allowedTabs, setAllowedTabs] = useState<string[]>(['pos', 'sales-history', 'inventory', 'global-inventory']);
  const [allowTransfers, setAllowTransfers] = useState(false);
  const [allowActionButtons, setAllowActionButtons] = useState(false);
  const [customRole, setCustomRole] = useState('');

  // Transaction processing states
  const [submitting, setSubmitting] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [staff.length]);

  const ROLE_DEFAULTS: Record<string, string[]> = {
    super_admin: ['pos', 'sales-history', 'inventory', 'global-inventory', 'receiving', 'transfers', 'adjustments', 'recipes', 'branches', 'analytics', 'audit-logs', 'users', 'expenses', 'action_buttons'],
    inventory_manager: ['inventory', 'global-inventory', 'receiving', 'transfers', 'adjustments', 'recipes', 'analytics', 'action_buttons'],
    branch_manager: ['pos', 'sales-history', 'inventory', 'global-inventory', 'transfers', 'adjustments', 'recipes', 'analytics', 'expenses'],
    cashier: ['pos', 'sales-history', 'inventory', 'global-inventory'],
    auditor: ['inventory', 'global-inventory', 'transfers', 'adjustments', 'recipes', 'branches', 'analytics', 'audit-logs', 'expenses'],
  };

  const TAB_FEATURE_KEYS: Record<string, string> = {
    pos: 'pos', 'sales-history': 'sales_history', inventory: 'inventory',
    'global-inventory': 'global_inventory', receiving: 'receiving',
    adjustments: 'adjustments', recipes: 'recipes', branches: 'branches',
    analytics: 'analytics', 'audit-logs': 'audit_logs', users: 'users',
    expenses: 'expenses',
  };

  const planFeatures = (tenant?.features ?? {}) as Record<string, boolean>;
  const ALL_AVAILABLE_TABS = [
    { id: 'pos', name: 'POS (Sales)' },
    { id: 'sales-history', name: 'Sales History' },
    { id: 'expenses', name: 'Expense Tracker' },
    { id: 'inventory', name: 'Inventory Items' },
    { id: 'global-inventory', name: 'Overall Stock' },
    { id: 'receiving', name: 'Stock Receiving' },
    { id: 'adjustments', name: 'Adjustments' },
    { id: 'recipes', name: 'Recipes' },
    { id: 'branches', name: 'Branches' },
    { id: 'analytics', name: 'Analytics' },
    { id: 'audit-logs', name: 'Audit Logs' },
    { id: 'users', name: 'Staff Management' },
  ].filter(tab => {
    // Only show tabs that are enabled by the tenant plan
    const key = TAB_FEATURE_KEYS[tab.id];
    if (!key || !tenant?.features) return true;
    return planFeatures[key] !== false;
  });

  const handleRoleChange = (v: string) => {
    setRole(v);
    if (v === 'custom') {
      setAllowedTabs(['pos', 'sales-history', 'inventory', 'global-inventory']);
      setAllowTransfers(false);
      setAllowActionButtons(false);
    } else {
      const defaults = ROLE_DEFAULTS[v] || ['pos', 'sales-history', 'inventory', 'global-inventory'];
      setAllowedTabs(defaults.filter(t => t !== 'transfers' && t !== 'action_buttons'));
      setAllowTransfers(defaults.includes('transfers'));
      setAllowActionButtons(defaults.includes('action_buttons'));
    }
  };

  const handleEditRoleChange = (v: string) => {
    setEditRole(v);
    if (v === 'custom') {
      setEditAllowedTabs(['pos', 'sales-history', 'inventory', 'global-inventory']);
      setEditAllowTransfers(false);
      setEditAllowActionButtons(false);
    } else {
      const defaults = ROLE_DEFAULTS[v] || ['pos', 'sales-history', 'inventory', 'global-inventory'];
      setEditAllowedTabs(defaults.filter(t => t !== 'transfers' && t !== 'action_buttons'));
      setEditAllowTransfers(defaults.includes('transfers'));
      setEditAllowActionButtons(defaults.includes('action_buttons'));
    }
  };

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

    if (limitReached) {
      showError(`Staff user limit reached. Your current plan "${tenant.plan_type}" allows up to ${tenant.max_users} staff users. Please upgrade your subscription.`);
      return;
    }

    if (!email.trim() || !password.trim()) {
      showError("Email and Password are required");
      return;
    }

    if (password.length < 6) {
      showError("Password must be at least 6 characters");
      return;
    }

    const finalRole = role === 'custom' ? customRole.trim() : role;
    if (!finalRole) {
      showError("Please specify the role");
      return;
    }

    if (role === 'custom' && ['super_admin', 'inventory_manager', 'branch_manager', 'cashier', 'auditor'].includes(finalRole.toLowerCase())) {
      showError("Cannot create a custom role with a reserved system role name.");
      return;
    }

    const finalAllowedTabs = [...allowedTabs];
    if (allowTransfers) {
      finalAllowedTabs.push('transfers');
    }
    if (allowActionButtons) {
      finalAllowedTabs.push('action_buttons');
    }

    const isGlobal = ['inventory_manager', 'auditor', 'super_admin'].includes(finalRole);

    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('fn_create_staff', {
        p_email: email.trim(),
        p_password: password,
        p_role: finalRole,
        p_branch_id: isGlobal ? null : branchId,
        p_allowed_tabs: finalAllowedTabs
      });

      if (rpcError) throw rpcError;

      showSuccess(`Staff account successfully created! Email: ${email}`);
      setEmail('');
      setPassword('');
      setRole('cashier');
      setCustomRole('');
      setAllowTransfers(false);
      setAllowActionButtons(false);
      setAllowedTabs(ROLE_DEFAULTS['cashier'].filter(t => t !== 'transfers' && t !== 'action_buttons'));
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

    const finalRole = editRole === 'custom' ? editCustomRole.trim() : editRole;
    if (!finalRole) {
      showError("Please specify the role");
      return;
    }

    if (editRole === 'custom' && ['super_admin', 'inventory_manager', 'branch_manager', 'cashier', 'auditor'].includes(finalRole.toLowerCase())) {
      showError("Cannot assign a reserved system role name as a custom role.");
      return;
    }

    const finalAllowedTabs = [...editAllowedTabs];
    if (editAllowTransfers) {
      finalAllowedTabs.push('transfers');
    }
    if (editAllowActionButtons) {
      finalAllowedTabs.push('action_buttons');
    }

    const isGlobal = ['inventory_manager', 'auditor', 'super_admin'].includes(finalRole);

    setSubmitting(true);
    try {
      const { error: rpcError } = await supabase.rpc('fn_edit_staff', {
        p_user_id: editingStaff.id,
        p_role: finalRole,
        p_branch_id: isGlobal ? null : editBranchId,
        p_allowed_tabs: finalAllowedTabs
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
    const tabs = member.allowed_tabs || ROLE_DEFAULTS[member.role_name] || [];
    setEditingStaff(member);

    const isCustom = !['inventory_manager', 'branch_manager', 'cashier', 'auditor', 'super_admin'].includes(member.role_name);
    if (isCustom) {
      setEditRole('custom');
      setEditCustomRole(member.role_name);
    } else {
      setEditRole(member.role_name);
      setEditCustomRole('');
    }

    setEditBranchId(member.branch_id || (branches.length > 0 ? branches[0].id : ''));
    setEditAllowedTabs(tabs.filter(t => t !== 'transfers' && t !== 'action_buttons'));
    setEditAllowTransfers(tabs.includes('transfers'));
    setEditAllowActionButtons(tabs.includes('action_buttons'));
    setIsEditModalOpen(true);
  };

  const isSuperAdmin = profile?.role_name === 'super_admin';

  const defaultRoles = isSuperAdmin
    ? ['super_admin', 'inventory_manager', 'branch_manager', 'cashier', 'auditor']
    : ['inventory_manager', 'branch_manager', 'cashier', 'auditor'];
  const uniqueRoles = Array.from(
    new Set([
      ...defaultRoles,
      ...staff.map(s => s.role_name)
    ])
  ).filter(r => isSuperAdmin || r !== 'super_admin');

  const getRoleFriendlyName = (r: string) => {
    switch (r) {
      case 'super_admin': return 'Admin';
      case 'inventory_manager': return 'Inventory Manager';
      case 'branch_manager': return 'Branch Manager';
      case 'cashier': return 'Cashier';
      case 'auditor': return 'Auditor';
      default: return r.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
  };

  const totalPages = Math.ceil(staff.length / itemsPerPage);
  const paginatedStaff = staff.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

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
            <Button onClick={() => setIsCreateModalOpen(true)} disabled={limitReached}>
              <Plus className="w-4 h-4 mr-2" />
              Provision Staff Account
            </Button>
          )}
        </div>
      </div>

      {limitReached && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-4 rounded-xl text-xs font-semibold mb-6">
          ⚠️ Your staff user quota ({tenant?.max_users}) has been reached for the current "{tenant?.plan_type}" plan. Please contact the platform superadmin to upgrade.
        </div>
      )}

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
                paginatedStaff.map(member => {
                  const isSelf = member.id === profile?.id;
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="pl-6 font-semibold">{member.email}</TableCell>
                      <TableCell>
                        <div className="flex flex-col space-y-1">
                          <Badge variant="outline" className={`w-fit uppercase text-[9px] ${member.role_name === 'super_admin' ? 'border-red-500/50 text-red-500 bg-red-500/10' :
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
          {totalPages > 1 && (
            <div className="py-4 border-t">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <PaginationItem key={i}>
                      <PaginationLink
                        onClick={() => setCurrentPage(i + 1)}
                        isActive={currentPage === i + 1}
                        className="cursor-pointer"
                      >
                        {i + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CREATE MODAL */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 border-b shrink-0">
            <DialogTitle className="flex items-center">
              <Plus className="w-5 h-5 mr-2 text-primary" />
              Provision Staff Account
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateStaff} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                  <Select value={role} onValueChange={handleRoleChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {uniqueRoles.map(r => (
                        <SelectItem key={r} value={r}>{getRoleFriendlyName(r)}</SelectItem>
                      ))}
                      <SelectItem value="custom">+ Create Custom Role...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {!['inventory_manager', 'auditor', 'super_admin'].includes(role === 'custom' ? customRole : role) ? (
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

              {role === 'custom' && (
                <div className="space-y-2">
                  <Label>Custom Role Name *</Label>
                  <Input
                    type="text"
                    required
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                    placeholder="e.g. Kitchen Staff"
                  />
                </div>
              )}

              <div className="flex items-center space-x-3 p-3 border rounded-lg bg-muted/20">
                <Checkbox
                  id="allow-transfers"
                  checked={allowTransfers}
                  onCheckedChange={(checked) => setAllowTransfers(!!checked)}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="allow-transfers" className="text-sm font-semibold cursor-pointer">
                    Allow Requesting Transfers (Subject to Admin Approval)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Allow this staff member to create stock transfer requests.
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 border rounded-lg bg-muted/20">
                <Checkbox
                  id="allow-action-buttons"
                  checked={allowActionButtons}
                  onCheckedChange={(checked) => setAllowActionButtons(!!checked)}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="allow-action-buttons" className="text-sm font-semibold cursor-pointer">
                    Allow Direct Stock Actions (Edit Balances, Delete Logs)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Allow editing stock balances directly, and deleting stock receiving, transfer, or adjustment logs.
                  </p>
                </div>
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
            </div>

            <DialogFooter className="p-6 border-t shrink-0">
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
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 border-b shrink-0">
            <DialogTitle className="flex items-center">
              <Edit className="w-5 h-5 mr-2 text-primary" />
              Edit Staff Config: {editingStaff?.email}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditStaffSubmit} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>System Role</Label>
                  <Select value={editRole} onValueChange={handleEditRoleChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {uniqueRoles.map(r => (
                        <SelectItem key={r} value={r}>{getRoleFriendlyName(r)}</SelectItem>
                      ))}
                      <SelectItem value="custom">+ Create Custom Role...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {!['inventory_manager', 'auditor', 'super_admin'].includes(editRole === 'custom' ? editCustomRole : editRole) ? (
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

              {editRole === 'custom' && (
                <div className="space-y-2">
                  <Label>Custom Role Name *</Label>
                  <Input
                    type="text"
                    required
                    value={editCustomRole}
                    onChange={(e) => setEditCustomRole(e.target.value)}
                    placeholder="e.g. Kitchen Staff"
                  />
                </div>
              )}

              <div className="flex items-center space-x-3 p-3 border rounded-lg bg-muted/20">
                <Checkbox
                  id="edit-allow-transfers"
                  checked={editAllowTransfers}
                  onCheckedChange={(checked) => setEditAllowTransfers(!!checked)}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="edit-allow-transfers" className="text-sm font-semibold cursor-pointer">
                    Allow Requesting Transfers (Subject to Admin Approval)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Allow this staff member to create stock transfer requests.
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 border rounded-lg bg-muted/20">
                <Checkbox
                  id="edit-allow-action-buttons"
                  checked={editAllowActionButtons}
                  onCheckedChange={(checked) => setEditAllowActionButtons(!!checked)}
                />
                <div className="grid gap-1 leading-none">
                  <Label htmlFor="edit-allow-action-buttons" className="text-sm font-semibold cursor-pointer">
                    Allow Direct Stock Actions (Edit Balances, Delete Logs)
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Allow editing stock balances directly, and deleting stock receiving, transfer, or adjustment logs.
                  </p>
                </div>
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
            </div>

            <DialogFooter className="p-6 border-t shrink-0">
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
