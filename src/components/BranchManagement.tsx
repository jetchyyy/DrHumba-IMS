import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Store, MapPin, Plus, Trash2, Home } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useToast } from '../hooks/use-toast';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';

export const BranchManagement: React.FC = () => {
  const { profile, branches, refreshProfile } = useAuth();
  const { toast } = useToast();
  
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [isWarehouse, setIsWarehouse] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
          is_warehouse: isWarehouse
        });

      if (insertError) throw insertError;

      toast({ title: "Success", description: `Branch "${name}" created successfully!` });
      setName('');
      setLocation('');
      setIsWarehouse(false);
      
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message || 'Failed to create branch', variant: "destructive" });
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

      toast({ title: "Deleted", description: `Branch deleted.` });
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Error", description: err.message || 'Failed to delete branch', variant: "destructive" });
    }
  };

  const isSuperAdmin = profile?.role_name === 'super_admin';

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight">Branch Management</h2>
        <p className="text-muted-foreground mt-1">Add, review, and delete warehouses and retail restaurant branches.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Create Branch Form (Super Admin Only) */}
        <div className="lg:col-span-1">
          <Card className="glass-dark border-border/50">
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Plus className="w-4 h-4 mr-2 text-primary" />
                Create New Branch
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isSuperAdmin ? (
                <form onSubmit={handleCreateBranch} className="space-y-4">
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

                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="isWarehouse"
                      checked={isWarehouse}
                      onCheckedChange={(checked) => setIsWarehouse(!!checked)}
                    />
                    <Label htmlFor="isWarehouse" className="font-normal cursor-pointer">
                      This location is a Warehouse
                    </Label>
                  </div>

                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? 'Creating...' : 'Create Location'}
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">Only Super Admins can add new branch locations.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Branches list */}
        <div className="lg:col-span-2">
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
    </div>
  );
};
