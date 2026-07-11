import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import { BoxModelIcon as Store, DrawingPinIcon as MapPin, PlusIcon as Plus, TrashIcon as Trash2, HomeIcon as Home, Pencil1Icon as Edit, CrossCircledIcon as ShieldOff, CheckCircledIcon as ShieldOn } from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useModal } from '../contexts/ModalContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export const BranchManagement: React.FC = () => {
  const { profile, branches, refreshProfile } = useAuth();
  const { tenant } = useTenant();
  const { confirm, showSuccess, showError } = useModal();

  const parentBranchesCount = branches.filter(b => !b.parent_id).length;
  const limitReached = !!(tenant && parentBranchesCount >= tenant.max_branches);

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [isWarehouse, setIsWarehouse] = useState(false);
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [parentBranchForSubStore, setParentBranchForSubStore] = useState<any>(null);

  // Edit States
  const [editingBranch, setEditingBranch] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editIsWarehouse, setEditIsWarehouse] = useState(false);
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [showEditModal, setShowEditModal] = useState(false);

  const handleCloseCreateModal = (open: boolean) => {
    setShowModal(open);
    if (!open) {
      setParentBranchForSubStore(null);
      setName('');
      setLocation('');
      setIsWarehouse(false);
      setStatus('active');
    }
  };

  useEffect(() => {
    refreshProfile();
  }, []);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (limitReached && !parentBranchForSubStore) {
      showError(`Branch limit reached. Your current plan "${tenant.plan_type}" allows up to ${tenant.max_branches} branch locations. Please upgrade your subscription.`);
      return;
    }

    setSubmitting(true);

    try {
      const { error: insertError } = await supabase
        .from('branches')
        .insert({
          name: name.trim(),
          location: location.trim() || null,
          is_warehouse: isWarehouse,
          status: status,
          parent_id: parentBranchForSubStore?.id || null,
          tenant_id: tenant?.id,       // required for RLS: tenant_id = get_my_tenant_id()
        });


      if (insertError) throw insertError;

      showSuccess(parentBranchForSubStore ? `Sub-store "${name}" created successfully!` : `Branch "${name}" created successfully!`);
      setName('');
      setLocation('');
      setIsWarehouse(false);
      setStatus('active');
      setParentBranchForSubStore(null);
      setShowModal(false);

      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to create branch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBranch = async (id: string, branchName: string) => {
    if (!await confirm(
      'Delete Branch',
      `Are you sure you want to delete branch "${branchName}"? This will delete all associated inventory balances.`
    )) {
      return;
    }

    try {
      const { error: deleteError } = await supabase
        .from('branches')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      showSuccess(`Branch "${branchName}" deleted.`);
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to delete branch');
    }
  };

  const handleToggleStatus = async (id: string, branchName: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'inactive' ? 'active' : 'inactive';
    if (!await confirm(
      `${nextStatus === 'active' ? 'Activate' : 'Deactivate'} Branch`,
      `Are you sure you want to set branch "${branchName}" status to ${nextStatus}?`
    )) {
      return;
    }

    try {
      const { error: updateError } = await supabase
        .from('branches')
        .update({ status: nextStatus })
        .eq('id', id);

      if (updateError) throw updateError;

      showSuccess(`Branch "${branchName}" status set to ${nextStatus}.`);
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to update branch status');
    }
  };

  const openEditModal = (branch: any) => {
    setEditingBranch(branch);
    setEditName(branch.name);
    setEditLocation(branch.location || '');
    setEditIsWarehouse(branch.is_warehouse);
    setEditStatus(branch.status || 'active');
    setShowEditModal(true);
  };

  const handleUpdateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch || !editName.trim()) return;

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase
        .from('branches')
        .update({
          name: editName.trim(),
          location: editLocation.trim() || null,
          is_warehouse: editIsWarehouse,
          status: editStatus
        })
        .eq('id', editingBranch.id);

      if (updateError) throw updateError;

      showSuccess(`Branch "${editName}" updated successfully!`);
      setShowEditModal(false);
      setEditingBranch(null);
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to update branch');
    } finally {
      setSubmitting(false);
    }
  };

  const isSuperAdmin = profile?.role_name === 'super_admin';

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <Store className="w-8 h-8 text-primary" />
            <span>Branch Management</span>
          </h2>
          <p className="text-muted-foreground mt-1">Add, review, and delete warehouses and retail restaurant branches.</p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => setShowModal(true)} disabled={limitReached}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Branch
          </Button>
        )}
      </div>

      {limitReached && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-4 rounded-xl text-xs font-semibold mb-6">
          ⚠️ Your branch locations limit ({tenant?.max_branches}) has been reached for the current "{tenant?.plan_type}" plan. Please contact the platform superadmin to upgrade.
        </div>
      )}

      <div className="grid grid-cols-1 gap-8">
        {/* Branches list */}
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 w-[250px]">Branch Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location Address</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    {isSuperAdmin && <TableHead className="text-right pr-6">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 5 : 4} className="h-24 text-center text-muted-foreground">
                        No branch locations loaded. Create one in the form on the left.
                      </TableCell>
                    </TableRow>
                  ) : (
                    branches.filter(b => !b.parent_id).map((parent) => {
                      const subStores = branches.filter(b => b.parent_id === parent.id);
                      return (
                        <React.Fragment key={parent.id}>
                          {/* Parent Branch Row */}
                          <TableRow>
                            <TableCell className="pl-6 font-semibold">
                              <div className="flex items-center space-x-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${parent.is_warehouse
                                    ? 'bg-primary/10 border-primary/20 text-primary'
                                    : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                                  }`}>
                                  {parent.is_warehouse ? <Home className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                                </div>
                                <span>{parent.name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {parent.is_warehouse ? (
                                <Badge variant="outline" className="text-[10px] uppercase border-primary/50 text-primary bg-primary/5">
                                  Central Warehouse
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] uppercase border-emerald-500/50 text-emerald-500 bg-emerald-500/5">
                                  Retail Branch
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              <div className="flex items-center space-x-1">
                                <MapPin className="w-3.5 h-3.5" />
                                <span>{parent.location || 'No address specified'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant={parent.status === 'inactive' ? 'secondary' : 'default'} className="text-[10px] uppercase">
                                {parent.status || 'active'}
                              </Badge>
                            </TableCell>
                            {isSuperAdmin && (
                              <TableCell className="text-right pr-6">
                                <div className="flex justify-end space-x-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setParentBranchForSubStore(parent);
                                      setName('');
                                      setLocation(parent.location || '');
                                      setIsWarehouse(false);
                                      setStatus('active');
                                      setShowModal(true);
                                    }}
                                    className="h-8 w-8 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-500/10"
                                    title="Add Sub-Store"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => openEditModal(parent)}
                                    className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                                    title="Edit Branch"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleToggleStatus(parent.id, parent.name, parent.status || 'active')}
                                    className={`h-8 w-8 ${parent.status === 'inactive' ? 'text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10' : 'text-amber-500 hover:text-amber-500 hover:bg-amber-500/10'}`}
                                    title={parent.status === 'inactive' ? 'Activate Branch' : 'Deactivate Branch'}
                                  >
                                    {parent.status === 'inactive' ? <ShieldOn className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteBranch(parent.id, parent.name)}
                                    className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    title="Delete Branch"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                          {/* Sub-Store Rows */}
                          {subStores.map((sub) => (
                            <TableRow key={sub.id} className="bg-muted/10 border-l-2 border-l-primary/30">
                              <TableCell className="pl-14 font-medium text-muted-foreground">
                                <div className="flex items-center space-x-2">
                                  <span className="text-muted-foreground/60 mr-1">└─</span>
                                  <Store className="w-3.5 h-3.5 text-indigo-500/70" />
                                  <span className="text-foreground">{sub.name}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px] uppercase border-indigo-500/50 text-indigo-500 bg-indigo-500/5">
                                  Sub-Store
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground/80">
                                <div className="flex items-center space-x-1 pl-4">
                                  <MapPin className="w-3 h-3" />
                                  <span>{sub.location || parent.location || 'No address specified'}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant={sub.status === 'inactive' ? 'secondary' : 'default'} className="text-[10px] uppercase">
                                  {sub.status || 'active'}
                                </Badge>
                              </TableCell>
                              {isSuperAdmin && (
                                <TableCell className="text-right pr-6">
                                  <div className="flex justify-end space-x-1">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => openEditModal(sub)}
                                      className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10"
                                      title="Edit Sub-Store"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleToggleStatus(sub.id, sub.name, sub.status || 'active')}
                                      className={`h-8 w-8 ${sub.status === 'inactive' ? 'text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10' : 'text-amber-500 hover:text-amber-500 hover:bg-amber-500/10'}`}
                                      title={sub.status === 'inactive' ? 'Activate Sub-Store' : 'Deactivate Sub-Store'}
                                    >
                                      {sub.status === 'inactive' ? <ShieldOn className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => handleDeleteBranch(sub.id, sub.name)}
                                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      title="Delete Sub-Store"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={handleCloseCreateModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{parentBranchForSubStore ? `Add Sub-Store to ${parentBranchForSubStore.name}` : 'Create New Branch'}</DialogTitle>
            <DialogDescription>
              {parentBranchForSubStore 
                ? 'Add a storefront, brand, or sub-outlet under this branch location. Shares parent inventory.' 
                : 'Add a new warehouse or retail location to the system.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBranch} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Branch Name *</Label>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Branch C - Westside"
              />
            </div>

            <div className="space-y-2">
              <Label>Location Address</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. 789 West Blvd, City"
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(val: 'active' | 'inactive') => setStatus(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!parentBranchForSubStore && (
              <div className="flex items-center space-x-2 pt-2 pb-4">
                <Checkbox
                  id="isWarehouse"
                  checked={isWarehouse}
                  onCheckedChange={(checked) => setIsWarehouse(!!checked)}
                />
                <Label htmlFor="isWarehouse" className="font-normal cursor-pointer text-sm">
                  This location is a Central Warehouse
                </Label>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Location'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT MODAL */}
      <Dialog open={showEditModal} onOpenChange={(open) => { if (!open) { setShowEditModal(false); setEditingBranch(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Branch: {editingBranch?.name}</DialogTitle>
            <DialogDescription>
              Modify name, address location, type, and status of this branch.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateBranch} className="space-y-4 pt-4">
            {editingBranch?.parent_id && (
              <div className="bg-muted p-3 rounded-lg text-xs text-muted-foreground flex items-center space-x-2">
                <Store className="w-4 h-4 text-indigo-500" />
                <span>
                  This is a sub-store of <span className="font-bold text-foreground">{branches.find(b => b.id === editingBranch.parent_id)?.name}</span>. Shares parent inventory.
                </span>
              </div>
            )}
            <div className="space-y-2">
              <Label>{editingBranch?.parent_id ? 'Sub-Store Name *' : 'Branch Name *'}</Label>
              <Input
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. Branch C - Westside"
              />
            </div>

            <div className="space-y-2">
              <Label>Location Address</Label>
              <Input
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="e.g. 789 West Blvd, City"
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={(val: 'active' | 'inactive') => setEditStatus(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {!editingBranch?.parent_id && (
              <div className="flex items-center space-x-2 pt-2 pb-4">
                <Checkbox
                  id="editIsWarehouse"
                  checked={editIsWarehouse}
                  onCheckedChange={(checked) => setEditIsWarehouse(!!checked)}
                />
                <Label htmlFor="editIsWarehouse" className="font-normal cursor-pointer text-sm">
                  This location is a Central Warehouse
                </Label>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setShowEditModal(false); setEditingBranch(null); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
