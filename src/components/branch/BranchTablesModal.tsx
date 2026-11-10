import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useTenant } from '../../contexts/TenantContext';
import { useModal } from '../../contexts/ModalContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  PlusIcon as Plus,
  TrashIcon as Trash2,
  Pencil1Icon as Edit2,
  ReloadIcon as Spinner,
  CheckIcon as Check,
  Cross2Icon as X,
} from '@radix-ui/react-icons';

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

interface BranchTablesModalProps {
  open: boolean;
  onClose: () => void;
  branch: {
    id: string;
    name: string;
  } | null;
}

const COMMON_ZONES = ['Main Dining', 'Alfresco / Patio', '2nd Floor', 'VIP Room', 'Bar Area'];

export const BranchTablesModal: React.FC<BranchTablesModalProps> = ({
  open,
  onClose,
  branch,
}) => {
  const { tenant } = useTenant();
  const { confirm, showSuccess, showError } = useModal();

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [tableNumber, setTableNumber] = useState('');
  const [zone, setZone] = useState('Main Dining');
  const [customZone, setCustomZone] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);

  // Quick generate state
  const [showQuickGen, setShowQuickGen] = useState(false);
  const [quickGenPrefix, setQuickGenPrefix] = useState('Table ');
  const [quickGenCount, setQuickGenCount] = useState(10);
  const [quickGenCapacity, setQuickGenCapacity] = useState(4);
  const [quickGenZone, setQuickGenZone] = useState('Main Dining');

  const fetchTables = async () => {
    if (!branch?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('restaurant_tables')
        .select('*')
        .eq('branch_id', branch.id)
        .order('table_number', { ascending: true });

      if (error) throw error;
      setTables(data || []);
    } catch (err: any) {
      console.error('Error fetching tables:', err);
      showError(err.message || 'Failed to load branch tables');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && branch?.id) {
      fetchTables();
      resetForm();
    }
  }, [open, branch?.id]);

  const resetForm = () => {
    setTableNumber('');
    setZone('Main Dining');
    setCustomZone('');
    setCapacity(4);
    setEditingTableId(null);
    setShowAddForm(false);
    setShowQuickGen(false);
  };

  const handleEditClick = (tbl: RestaurantTable) => {
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
    setShowAddForm(true);
    setShowQuickGen(false);
  };

  const handleSaveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branch?.id) return;
    const finalTableNum = tableNumber.trim();
    if (!finalTableNum) {
      showError('Please enter a table name/number.');
      return;
    }

    const finalZone = zone === 'Other' ? (customZone.trim() || 'Main Dining') : zone;

    setSaving(true);
    try {
      if (editingTableId) {
        // Update existing table
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
        // Create new table
        const { error } = await supabase
          .from('restaurant_tables')
          .insert({
            tenant_id: tenant?.id,
            branch_id: branch.id,
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
        showSuccess(`Table "${finalTableNum}" added.`);
      }

      resetForm();
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
      console.error('Error updating table active state:', err);
      showError(err.message || 'Failed to update table.');
    }
  };

  const handleDelete = async (tbl: RestaurantTable) => {
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
    if (!branch?.id) return;
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
          branch_id: branch.id,
          table_number: `${quickGenPrefix}${i}`,
          zone: quickGenZone,
          capacity: Math.max(1, quickGenCapacity),
          status: 'available',
          is_active: true,
        });
      }

      const { error } = await supabase
        .from('restaurant_tables')
        .insert(rows);

      if (error) {
        if (error.code === '23505') {
          throw new Error('Some table numbers already exist. Please adjust your prefix or remove duplicates.');
        }
        throw error;
      }

      showSuccess(`Successfully generated ${count} tables!`);
      resetForm();
      await fetchTables();
    } catch (err: any) {
      console.error('Error generating tables:', err);
      showError(err.message || 'Failed to generate tables.');
    } finally {
      setSaving(false);
    }
  };

  const totalSeats = tables.filter(t => t.is_active).reduce((sum, t) => sum + (t.capacity || 0), 0);

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <span>🍽️ Manage Tables</span>
                <span className="text-muted-foreground font-normal text-sm">
                  &bull; {branch?.name}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Configure table numbers, seating capacities, and floor zones for dine-in running bills.
              </DialogDescription>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {tables.length} Tables &bull; {totalSeats} Seats
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {/* Action Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
          <div className="flex items-center gap-2">
            {!showAddForm && !showQuickGen && (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setShowAddForm(true);
                  }}
                  className="h-8 text-xs gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Table
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    resetForm();
                    setShowQuickGen(true);
                  }}
                  className="h-8 text-xs gap-1.5"
                >
                  Quick Generate
                </Button>
              </>
            )}
          </div>
          {(showAddForm || showQuickGen) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetForm}
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Cancel
            </Button>
          )}
        </div>

        {/* Add/Edit Form */}
        {showAddForm && (
          <form onSubmit={handleSaveTable} className="p-4 bg-muted/40 rounded-xl border border-border/80 space-y-3">
            <div className="font-semibold text-xs text-foreground">
              {editingTableId ? 'Edit Table' : 'Add New Table'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Table Name / Number *</Label>
                <Input
                  required
                  placeholder="e.g. Table 1, VIP 2"
                  value={tableNumber}
                  onChange={e => setTableNumber(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Floor Zone</Label>
                <Select value={zone} onValueChange={setZone}>
                  <SelectTrigger className="h-8 text-xs">
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

              <div className="space-y-1">
                <Label className="text-xs">Seating Capacity (Pax)</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={capacity}
                  onChange={e => setCapacity(parseInt(e.target.value) || 1)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {zone === 'Other' && (
              <div className="space-y-1">
                <Label className="text-xs">Custom Zone Name</Label>
                <Input
                  placeholder="e.g. Rooftop Terrace"
                  value={customZone}
                  onChange={e => setCustomZone(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={resetForm} className="h-7 text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving} className="h-7 text-xs gap-1.5">
                {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {editingTableId ? 'Update Table' : 'Save Table'}
              </Button>
            </div>
          </form>
        )}

        {/* Quick Generate Form */}
        {showQuickGen && (
          <form onSubmit={handleQuickGenerate} className="p-4 bg-muted/40 rounded-xl border border-border/80 space-y-3">
            <div className="font-semibold text-xs text-foreground">
              ⚡ Quick Batch Generate Tables
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Prefix</Label>
                <Input
                  placeholder="e.g. Table "
                  value={quickGenPrefix}
                  onChange={e => setQuickGenPrefix(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={quickGenCount}
                  onChange={e => setQuickGenCount(parseInt(e.target.value) || 1)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Seats per Table</Label>
                <Input
                  type="number"
                  min="1"
                  max="20"
                  required
                  value={quickGenCapacity}
                  onChange={e => setQuickGenCapacity(parseInt(e.target.value) || 4)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Floor Zone</Label>
                <Select value={quickGenZone} onValueChange={setQuickGenZone}>
                  <SelectTrigger className="h-8 text-xs">
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

            <div className="flex justify-between items-center pt-1">
              <span className="text-[11px] text-muted-foreground">
                Will create {quickGenPrefix}1 through {quickGenPrefix}{quickGenCount}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={resetForm} className="h-7 text-xs">
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving} className="h-7 text-xs gap-1.5">
                  {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Generate Tables
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* Tables List */}
        <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[380px] border rounded-lg">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <Spinner className="w-5 h-5 animate-spin" />
              <span className="text-xs">Loading tables...</span>
            </div>
          ) : tables.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-center p-6">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2 text-xl">
                🍽️
              </div>
              <p className="text-sm font-medium text-foreground">No tables configured</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Add tables or use Quick Generate to create tables for this branch.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tables.map(tbl => {
                const isOccupied = tbl.status === 'occupied';
                const isBilledOut = tbl.status === 'billed_out';

                return (
                  <div
                    key={tbl.id}
                    className={`flex items-center justify-between p-3 transition-colors ${
                      !tbl.is_active ? 'opacity-50 bg-muted/20' : 'hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold flex items-center justify-center text-xs">
                        {tbl.table_number.replace(/\D/g, '') || tbl.table_number.substring(0, 3)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-foreground">
                            {tbl.table_number}
                          </span>
                          {isOccupied && (
                            <Badge className="bg-rose-500 hover:bg-rose-600 text-[10px] h-4 px-1.5 font-bold uppercase">
                              Occupied
                            </Badge>
                          )}
                          {isBilledOut && (
                            <Badge className="bg-amber-500 hover:bg-amber-600 text-black text-[10px] h-4 px-1.5 font-bold uppercase">
                              Billed Out
                            </Badge>
                          )}
                          {!tbl.is_active && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">
                              Inactive
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span>{tbl.capacity} Seats</span>
                          <span>&bull;</span>
                          <span>{tbl.zone}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleActive(tbl)}
                        title={tbl.is_active ? 'Deactivate table' : 'Activate table'}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      >
                        <span className={`w-2 h-2 rounded-full ${tbl.is_active ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEditClick(tbl)}
                        className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
                        title="Edit table"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isOccupied || isBilledOut}
                        onClick={() => handleDelete(tbl)}
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10 disabled:opacity-30"
                        title={isOccupied || isBilledOut ? 'Cannot delete occupied table' : 'Delete table'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t flex justify-between sm:justify-between items-center">
          <span className="text-xs text-muted-foreground">
            Changes are saved immediately and update the POS in real-time.
          </span>
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

