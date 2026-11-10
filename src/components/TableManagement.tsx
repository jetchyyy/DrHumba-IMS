import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { useModal } from '../contexts/ModalContext';
import {
  TableIcon,
  PlusIcon as Plus,
  TrashIcon as Trash2,
  Pencil1Icon as Edit2,
  ReloadIcon as Spinner,
  CheckIcon as Check,
  MagnifyingGlassIcon as Search,
  BoxModelIcon as Store,
} from '@radix-ui/react-icons';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

export interface RestaurantTable {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_number: string;
  zone: string;
  capacity: number;
  status: 'available' | 'occupied' | 'billed_out' | 'cleaning' | 'reserved';
  is_active: boolean;
  current_tab_id?: string | null;
  created_at: string;
}

const COMMON_ZONES = ['Main Dining', 'Alfresco / Patio', '2nd Floor', 'VIP Room', 'Bar Area'];

export const TableManagement: React.FC = () => {
  const { selectedBranch, setSelectedBranch, branches, refreshProfile } = useAuth();
  const { tenant } = useTenant();
  const { confirm, showSuccess, showError } = useModal();

  const currentBranchId = selectedBranch?.id || branches?.[0]?.id || '';
  const currentBranch = branches.find(b => b.id === currentBranchId) || selectedBranch;

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedZone, setSelectedZone] = useState('All');

  // Add / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState('');
  const [zone, setZone] = useState('Main Dining');
  const [customZone, setCustomZone] = useState('');
  const [capacity, setCapacity] = useState(4);

  // Quick Generate Modal State
  const [quickGenOpen, setQuickGenOpen] = useState(false);
  const [quickGenPrefix, setQuickGenPrefix] = useState('Table ');
  const [quickGenCount, setQuickGenCount] = useState(10);
  const [quickGenCapacity, setQuickGenCapacity] = useState(4);
  const [quickGenZone, setQuickGenZone] = useState('Main Dining');

  const fetchTables = async () => {
    if (!currentBranchId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('restaurant_tables')
        .select('*')
        .eq('branch_id', currentBranchId)
        .order('table_number', { ascending: true });

      if (error) throw error;
      setTables(data || []);
    } catch (err: any) {
      console.error('Failed to load tables:', err);
      showError(err.message || 'Failed to load branch tables.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentBranchId) {
      fetchTables();
    }
  }, [currentBranchId]);

  const handleBranchChange = (branchId: string) => {
    const nextBranch = branches.find(b => b.id === branchId);
    if (nextBranch) {
      setSelectedBranch(nextBranch);
    }
  };

  const handleToggleTableService = async () => {
    if (!currentBranch) return;
    const nextState = !currentBranch.enable_table_service;

    try {
      const { error } = await supabase
        .from('branches')
        .update({ enable_table_service: nextState })
        .eq('id', currentBranch.id);

      if (error) throw error;

      showSuccess(
        nextState
          ? `Table Service enabled for ${currentBranch.name}!`
          : `Table Service disabled for ${currentBranch.name}.`
      );
      await refreshProfile();
    } catch (err: any) {
      console.error('Error updating table service:', err);
      showError(err.message || 'Failed to update branch setting.');
    }
  };

  const openAddModal = () => {
    setEditingTableId(null);
    setTableNumber('');
    setZone('Main Dining');
    setCustomZone('');
    setCapacity(4);
    setModalOpen(true);
  };

  const openEditModal = (tbl: RestaurantTable) => {
    setEditingTableId(tbl.id);
    setTableNumber(tbl.table_number);
    setCapacity(tbl.capacity);
    if (COMMON_ZONES.includes(tbl.zone)) {
      setZone(tbl.zone);
      setCustomZone('');
    } else {
      setZone('Other');
      setCustomZone(tbl.zone);
    }
    setModalOpen(true);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBranchId) return;

    const finalTableNum = tableNumber.trim();
    if (!finalTableNum) {
      showError('Please enter a table name/number.');
      return;
    }

    const finalZone = zone === 'Other' ? (customZone.trim() || 'Main Dining') : zone;

    setSaving(true);
    try {
      if (editingTableId) {
        const { error } = await supabase
          .from('restaurant_tables')
          .update({
            table_number: finalTableNum,
            zone: finalZone,
            capacity: Math.max(1, Number(capacity) || 4),
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingTableId);

        if (error) throw error;
        showSuccess(`Table "${finalTableNum}" updated.`);
      } else {
        const { error } = await supabase
          .from('restaurant_tables')
          .insert({
            tenant_id: tenant?.id,
            branch_id: currentBranchId,
            table_number: finalTableNum,
            zone: finalZone,
            capacity: Math.max(1, Number(capacity) || 4),
            status: 'available',
            is_active: true,
          });

        if (error) {
          if (error.code === '23505') {
            throw new Error(`A table named "${finalTableNum}" already exists in this branch.`);
          }
          throw error;
        }
        showSuccess(`Table "${finalTableNum}" created.`);
      }

      setModalOpen(false);
      await fetchTables();
    } catch (err: any) {
      console.error('Error saving table:', err);
      showError(err.message || 'Failed to save table.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (tbl: RestaurantTable) => {
    try {
      const nextActive = !tbl.is_active;
      const { error } = await supabase
        .from('restaurant_tables')
        .update({ is_active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', tbl.id);

      if (error) throw error;
      setTables(prev => prev.map(t => t.id === tbl.id ? { ...t, is_active: nextActive } : t));
    } catch (err: any) {
      console.error('Error updating active state:', err);
      showError(err.message || 'Failed to update table.');
    }
  };

  const handleDeleteTable = async (tbl: RestaurantTable) => {
    if (tbl.status === 'occupied' || tbl.status === 'billed_out' || tbl.current_tab_id) {
      showError(`Cannot delete table "${tbl.table_number}" while it has an active dining session.`);
      return;
    }

    const confirmed = await confirm(
      'Delete Table',
      `Are you sure you want to delete "${tbl.table_number}"? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('restaurant_tables')
        .delete()
        .eq('id', tbl.id);

      if (error) throw error;
      showSuccess(`Table "${tbl.table_number}" deleted.`);
      setTables(prev => prev.filter(t => t.id !== tbl.id));
    } catch (err: any) {
      console.error('Error deleting table:', err);
      showError(err.message || 'Failed to delete table.');
    }
  };

  const handleQuickGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBranchId) return;

    const count = Math.min(50, Math.max(1, quickGenCount));
    const confirmed = await confirm(
      'Generate Tables',
      `Generate ${count} tables (${quickGenPrefix}1 to ${quickGenPrefix}${count}) in "${quickGenZone}"?`
    );
    if (!confirmed) return;

    setSaving(true);
    try {
      const rows = [];
      for (let i = 1; i <= count; i++) {
        rows.push({
          tenant_id: tenant?.id,
          branch_id: currentBranchId,
          table_number: `${quickGenPrefix}${i}`,
          zone: quickGenZone,
          capacity: Math.max(1, quickGenCapacity),
          status: 'available',
          is_active: true,
        });
      }

      const { error } = await supabase.from('restaurant_tables').insert(rows);

      if (error) {
        if (error.code === '23505') {
          throw new Error('Some table numbers already exist. Please adjust your prefix or remove duplicates.');
        }
        throw error;
      }

      showSuccess(`Successfully generated ${count} tables!`);
      setQuickGenOpen(false);
      await fetchTables();
    } catch (err: any) {
      console.error('Error generating tables:', err);
      showError(err.message || 'Failed to generate tables.');
    } finally {
      setSaving(false);
    }
  };

  // Zones list
  const zones = useMemo(() => {
    return ['All', ...Array.from(new Set(tables.map(t => t.zone).filter(Boolean)))];
  }, [tables]);

  // Filtered tables
  const filteredTables = useMemo(() => {
    return tables.filter(tbl => {
      const matchesSearch = tbl.table_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tbl.zone.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesZone = selectedZone === 'All' || tbl.zone === selectedZone;
      return matchesSearch && matchesZone;
    });
  }, [tables, searchTerm, selectedZone]);

  const activeTablesCount = tables.filter(t => t.is_active).length;
  const totalSeats = tables.filter(t => t.is_active).reduce((sum, t) => sum + (t.capacity || 0), 0);
  const occupiedCount = tables.filter(t => t.status === 'occupied').length;
  const billedOutCount = tables.filter(t => t.status === 'billed_out').length;
  const availableCount = tables.filter(t => t.status === 'available' && t.is_active).length;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <TableIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Table Management</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure dine-in floor plans, seating capacities, and zones for POS running bills.
              </p>
            </div>
          </div>
        </div>

        {/* Branch Context Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {branches.length > 1 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Branch:</Label>
              <Select value={currentBranchId} onValueChange={handleBranchChange}>
                <SelectTrigger className="h-9 text-xs font-bold min-w-[160px]">
                  <Store className="w-3.5 h-3.5 mr-1 text-primary" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id} className="text-xs font-medium">
                      {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickGenOpen(true)}
            className="h-9 text-xs gap-1.5"
          >
            Quick Generate
          </Button>

          <Button
            size="sm"
            onClick={openAddModal}
            className="h-9 text-xs gap-1.5 bg-primary text-primary-foreground font-bold shadow"
          >
            <Plus className="w-4 h-4" /> Add Table
          </Button>
        </div>
      </div>

      {/* Branch Table Service Status Card */}
      {currentBranch && (
        <Card className={`border shadow-xs transition-all ${
          currentBranch.enable_table_service 
            ? 'bg-emerald-500/5 border-emerald-500/30' 
            : 'bg-amber-500/5 border-amber-500/30'
        }`}>
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full shrink-0 ${
                currentBranch.enable_table_service ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`} />
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-foreground">
                    Table Service for {currentBranch.name}
                  </h4>
                  <Badge variant="outline" className={`text-[10px] font-bold ${
                    currentBranch.enable_table_service 
                      ? 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10' 
                      : 'border-amber-500/40 text-amber-600 bg-amber-500/10'
                  }`}>
                    {currentBranch.enable_table_service ? 'Active in POS' : 'Disabled in POS'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {currentBranch.enable_table_service 
                    ? 'POS displays table floor layout, multi-round kitchen orders, and running bills for this branch.' 
                    : 'POS operates in direct counter sale mode. Enable table service to unlock floor grid and running bills.'}
                </p>
              </div>
            </div>

            <Button
              variant={currentBranch.enable_table_service ? 'outline' : 'default'}
              size="sm"
              onClick={handleToggleTableService}
              className="text-xs shrink-0 font-semibold"
            >
              {currentBranch.enable_table_service ? 'Disable for this Branch' : 'Enable Table Service Now'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Analytics KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <Card className="bg-card shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Total Tables</span>
            <div className="text-2xl font-black text-foreground mt-1">
              {tables.length} <span className="text-xs font-normal text-muted-foreground">({activeTablesCount} active)</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-muted-foreground font-medium">Seating Capacity</span>
            <div className="text-2xl font-black text-foreground mt-1">
              {totalSeats} <span className="text-xs font-normal text-muted-foreground">total seats</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">Vacant / Available</span>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
              {availableCount}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-xs">
          <CardContent className="p-4">
            <span className="text-xs text-rose-600 dark:text-rose-400 font-medium">Currently Occupied</span>
            <div className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
              {occupiedCount} {billedOutCount > 0 && <span className="text-xs font-bold text-amber-600">({billedOutCount} billed)</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/40 p-3 rounded-xl border">
        {/* Zones Filter */}
        <div className="flex gap-1.5 overflow-x-auto text-xs font-medium">
          {zones.map(z => (
            <button
              key={z}
              onClick={() => setSelectedZone(z)}
              className={`px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                selectedZone === z
                  ? 'bg-primary text-primary-foreground font-bold shadow-xs'
                  : 'bg-card text-muted-foreground hover:text-foreground border border-border/60'
              }`}
            >
              {z} {z === 'All' ? `(${tables.length})` : `(${tables.filter(t => t.zone === z).length})`}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search table or zone..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-xs bg-card"
          />
        </div>
      </div>

      {/* Tables Grid View */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
          <Spinner className="w-6 h-6 animate-spin text-primary" />
          <span className="text-xs">Loading tables for {currentBranch?.name}...</span>
        </div>
      ) : filteredTables.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center p-6 text-muted-foreground border rounded-2xl bg-card">
          <TableIcon className="w-12 h-12 mb-2 opacity-30" />
          <p className="text-base font-bold text-foreground">No tables found</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {searchTerm || selectedZone !== 'All'
              ? 'No tables match your search/zone filter.'
              : `No tables configured yet for ${currentBranch?.name}. Click "+ Add Table" or "Quick Generate" to get started.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTables.map(tbl => {
            const isOccupied = tbl.status === 'occupied';
            const isBilledOut = tbl.status === 'billed_out';

            return (
              <Card
                key={tbl.id}
                className={`transition-all border-2 shadow-xs ${
                  !tbl.is_active
                    ? 'opacity-50 border-dashed border-border'
                    : isOccupied
                    ? 'border-rose-500/40 bg-rose-500/5'
                    : isBilledOut
                    ? 'border-amber-500/50 bg-amber-500/5'
                    : 'border-border/80 hover:border-emerald-500/40'
                }`}
              >
                <CardContent className="p-4 flex flex-col justify-between h-full space-y-4">
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-foreground">
                          {tbl.table_number}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isOccupied && (
                          <Badge className="bg-rose-500 hover:bg-rose-600 text-white font-bold text-[10px] uppercase h-5">
                            Occupied
                          </Badge>
                        )}
                        {isBilledOut && (
                          <Badge className="bg-amber-500 hover:bg-amber-600 text-black font-bold text-[10px] uppercase h-5">
                            Billed Out
                          </Badge>
                        )}
                        {!isOccupied && !isBilledOut && tbl.is_active && (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-500/40 bg-emerald-500/10 text-[10px] font-semibold h-5">
                            Vacant
                          </Badge>
                        )}
                        {!tbl.is_active && (
                          <Badge variant="outline" className="text-muted-foreground text-[10px] h-5">
                            Inactive
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <span>{tbl.capacity} Seats</span>
                        <span>&bull;</span>
                        <span className="font-medium text-foreground">{tbl.zone}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(tbl)}
                      className="text-[11px] font-medium flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
                      title={tbl.is_active ? 'Deactivate table' : 'Activate table'}
                    >
                      <span className={`w-2 h-2 rounded-full ${tbl.is_active ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      <span>{tbl.is_active ? 'Active' : 'Disabled'}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditModal(tbl)}
                        className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                        title="Edit table"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isOccupied || isBilledOut}
                        onClick={() => handleDeleteTable(tbl)}
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
                        title={isOccupied || isBilledOut ? 'Cannot delete occupied table' : 'Delete table'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Table Modal */}
      {modalOpen && (
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <TableIcon className="w-4 h-4 text-primary" />
                <span>{editingTableId ? 'Edit Table' : 'Add New Table'}</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Set table number, floor area, and seating capacity for {currentBranch?.name}.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSaveTable} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Table Name / Number *</Label>
                <Input
                  required
                  placeholder="e.g. Table 1, Patio 3, VIP Suite"
                  value={tableNumber}
                  onChange={e => setTableNumber(e.target.value)}
                  className="text-xs"
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Floor Zone</Label>
                <Select value={zone} onValueChange={setZone}>
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_ZONES.map(z => (
                      <SelectItem key={z} value={z} className="text-xs">{z}</SelectItem>
                    ))}
                    <SelectItem value="Other" className="text-xs">Other (Custom Zone)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {zone === 'Other' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Custom Zone Name</Label>
                  <Input
                    placeholder="e.g. Garden Pavilion"
                    value={customZone}
                    onChange={e => setCustomZone(e.target.value)}
                    className="text-xs"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Seating Capacity (Pax)</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={capacity}
                  onChange={e => setCapacity(parseInt(e.target.value) || 1)}
                  className="text-xs"
                />
              </div>

              <DialogFooter className="pt-2 border-t gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving} className="text-xs gap-1.5 font-bold">
                  {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {editingTableId ? 'Save Changes' : 'Create Table'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Quick Batch Generate Modal */}
      {quickGenOpen && (
        <Dialog open={quickGenOpen} onOpenChange={setQuickGenOpen}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <span>Quick Batch Generate Tables</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Rapidly generate multiple tables for {currentBranch?.name} in one click.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleQuickGenerate} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Prefix</Label>
                  <Input
                    placeholder="e.g. Table "
                    value={quickGenPrefix}
                    onChange={e => setQuickGenPrefix(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Number of Tables</Label>
                  <Input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={quickGenCount}
                    onChange={e => setQuickGenCount(parseInt(e.target.value) || 1)}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Seats per Table</Label>
                  <Input
                    type="number"
                    min="1"
                    max="30"
                    required
                    value={quickGenCapacity}
                    onChange={e => setQuickGenCapacity(parseInt(e.target.value) || 4)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Floor Zone</Label>
                  <Select value={quickGenZone} onValueChange={setQuickGenZone}>
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_ZONES.map(z => (
                        <SelectItem key={z} value={z} className="text-xs">{z}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="p-3 bg-muted/40 rounded-lg border text-xs text-muted-foreground">
                Will create: <strong className="text-foreground">{quickGenPrefix}1</strong> through <strong className="text-foreground">{quickGenPrefix}{quickGenCount}</strong> ({quickGenCapacity} seats each in {quickGenZone}).
              </div>

              <DialogFooter className="pt-2 border-t gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setQuickGenOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving} className="text-xs gap-1.5 font-bold">
                  {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Generate {quickGenCount} Tables
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
