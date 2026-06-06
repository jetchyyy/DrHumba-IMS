import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BoxModelIcon as Store, DrawingPinIcon as MapPin, PlusIcon as Plus, TrashIcon as Trash2, HomeIcon as Home } from '@radix-ui/react-icons';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useModal } from '../contexts/ModalContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';

export const BranchManagement: React.FC = () => {
  const { profile, branches, refreshProfile } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [isWarehouse, setIsWarehouse] = useState(false);
  const [status, setStatus] = useState<'active'|'inactive'>('active');
  const [submitting, setSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    refreshProfile();
  }, []);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);

    try {
      const { error: insertError } = await supabase
        .from('branches')
        .insert({
          name: name.trim(),
          location: location.trim() || null,
          is_warehouse: isWarehouse,
          status: status
        });

      if (insertError) throw insertError;

      showSuccess(`Branch "${name}" created successfully!`);
      setName('');
      setLocation('');
      setIsWarehouse(false);
      setStatus('active');
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

  const isSuperAdmin = profile?.role_name === 'super_admin';

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Branch Management</h2>
          <p className="text-muted-foreground mt-1">Add, review, and delete warehouses and retail restaurant branches.</p>
        </div>
        {isSuperAdmin && (
          <Button onClick={() => setShowModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Branch
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Branches list */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="bg-muted/30 border-b pb-4">
              <CardTitle className="text-lg uppercase tracking-wider text-muted-foreground">Active Locations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {branches.map((b) => (
                  <div key={b.id} className="p-5 flex items-center justify-between hover:bg-muted/20 transition-all">
                    <div className="flex items-center space-x-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${
                        b.is_warehouse 
                          ? 'bg-primary/10 border-primary/20 text-primary' 
                          : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                      }`}>
                        {b.is_warehouse ? <Home className="w-5 h-5" /> : <Store className="w-5 h-5" />}
                      </div>
                      <div>
                        <h4 className="text-base font-bold flex items-center space-x-2">
                          <span>{b.name}</span>
                          {b.is_warehouse && (
                            <Badge variant="outline" className="text-[9px] uppercase border-primary/50 text-primary bg-primary/5">
                              Central Warehouse
                            </Badge>
                          )}
                          <Badge variant={b.status === 'inactive' ? 'secondary' : 'default'} className="text-[9px] uppercase">
                            {b.status || 'active'}
                          </Badge>
                        </h4>
                        <p className="text-sm text-muted-foreground flex items-center space-x-1 mt-1">
                          <MapPin className="w-3.5 h-3.5" />
                          <span>{b.location || 'No address specified'}</span>
                        </p>
                      </div>
                    </div>

                    {isSuperAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteBranch(b.id, b.name)}
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete Branch"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}

                {branches.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground">
                    No branch locations loaded. Create one in the form on the left.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Branch</DialogTitle>
            <DialogDescription>
              Add a new warehouse or retail location to the system.
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
              <Select value={status} onValueChange={(val: 'active'|'inactive') => setStatus(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

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
    </div>
  );
};
