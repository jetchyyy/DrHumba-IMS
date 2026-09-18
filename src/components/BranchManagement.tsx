import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useTenant } from '../contexts/TenantContext';
import {
  BoxModelIcon as Store,
  DrawingPinIcon as MapPin,
  PlusIcon as Plus,
  TrashIcon as Trash2,
  HomeIcon as Home,
  Pencil1Icon as Edit,
  CrossCircledIcon as ShieldOff,
  CheckCircledIcon as ShieldOn,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useModal } from '../contexts/ModalContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from './ui/sheet';

// ─── Types ────────────────────────────────────────────────────────────────────

type BranchStatus = 'active' | 'inactive';

interface FormState {
  name: string;
  location: string;
  isWarehouse: boolean;
  status: BranchStatus;
}

const EMPTY_FORM: FormState = {
  name: '',
  location: '',
  isWarehouse: false,
  status: 'active',
};

// ─── Helper ───────────────────────────────────────────────────────────────────

const mapsUrl = (address: string) =>
  `https://maps.google.com/?q=${encodeURIComponent(address)}`;

// ─── Component ────────────────────────────────────────────────────────────────

export const BranchManagement: React.FC = () => {
  const { profile, branches, refreshProfile } = useAuth();
  const { tenant } = useTenant();
  const { confirm, showSuccess, showError } = useModal();

  const isSuperAdmin = profile?.role_name === 'super_admin';

  // ── Plan limits ─────────────────────────────────────────────────────────────
  const parentBranchesCount = branches.filter(b => !b.parent_id).length;
  const maxBranches = tenant?.max_branches ?? 0;
  const limitReached = !!(tenant && parentBranchesCount >= maxBranches);
  const usagePct = maxBranches > 0 ? Math.min(100, (parentBranchesCount / maxBranches) * 100) : 0;
  const usageColor =
    usagePct >= 100 ? 'bg-red-500' : usagePct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';

  // ── Sheet / form state ──────────────────────────────────────────────────────
  type SheetMode = 'create' | 'edit' | null;
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [parentForSubStore, setParentForSubStore] = useState<any>(null);
  const [editingBranch, setEditingBranch] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSheetOpen = sheetMode !== null;

  const openCreateSheet = (parent?: any) => {
    setParentForSubStore(parent ?? null);
    setForm({ ...EMPTY_FORM, location: parent?.location ?? '' });
    setEditingBranch(null);
    setSheetMode('create');
  };

  const openEditSheet = (branch: any) => {
    setEditingBranch(branch);
    setForm({
      name: branch.name,
      location: branch.location || '',
      isWarehouse: branch.is_warehouse ?? false,
      status: branch.status || 'active',
    });
    setParentForSubStore(null);
    setSheetMode('edit');
  };

  const closeSheet = () => {
    setSheetMode(null);
    setParentForSubStore(null);
    setEditingBranch(null);
    setForm(EMPTY_FORM);
  };

  // ── Search & filter state ───────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // ── Collapse state ──────────────────────────────────────────────────────────
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  useEffect(() => {
    refreshProfile();
  }, []);

  // ── Derived / filtered lists ─────────────────────────────────────────────────
  const parentBranches = useMemo(() => branches.filter(b => !b.parent_id), [branches]);
  const subStoresOf = (parentId: string) => branches.filter(b => b.parent_id === parentId);

  const matchesBranch = (b: any) => {
    const lc = searchTerm.toLowerCase();
    const matchSearch =
      !lc ||
      b.name.toLowerCase().includes(lc) ||
      (b.location || '').toLowerCase().includes(lc);

    const matchStatus =
      statusFilter === 'all' || (b.status || 'active') === statusFilter;

    let matchType = true;
    if (typeFilter === 'warehouse') matchType = !!b.is_warehouse;
    else if (typeFilter === 'retail') matchType = !b.is_warehouse && !b.parent_id;
    else if (typeFilter === 'substore') matchType = !!b.parent_id;

    return matchSearch && matchStatus && matchType;
  };

  const filteredParents = useMemo(
    () =>
      parentBranches.filter(parent => {
        const parentMatch = matchesBranch(parent);
        const childMatch = subStoresOf(parent.id).some(c => matchesBranch(c));
        return parentMatch || childMatch;
      }),
    [branches, searchTerm, typeFilter, statusFilter]
  );

  // ── Stats ────────────────────────────────────────────────────────────────────
  const totalCount = branches.length;
  const activeCount = branches.filter(b => (b.status || 'active') === 'active').length;
  const subStoreCount = branches.filter(b => !!b.parent_id).length;

  // ── CRUD handlers ─────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    if (sheetMode === 'create' && limitReached && !parentForSubStore) {
      showError(
        `Branch limit reached. Your current plan "${tenant?.plan_type}" allows up to ${maxBranches} branch locations. Please upgrade your subscription.`
      );
      return;
    }

    setSubmitting(true);
    try {
      if (sheetMode === 'create') {
        const { error } = await supabase.from('branches').insert({
          name: form.name.trim(),
          location: form.location.trim() || null,
          is_warehouse: form.isWarehouse,
          status: form.status,
          parent_id: parentForSubStore?.id || null,
          tenant_id: tenant?.id,
        });
        if (error) throw error;
        showSuccess(
          parentForSubStore
            ? `Sub-store "${form.name}" created successfully!`
            : `Branch "${form.name}" created successfully!`
        );
      } else if (sheetMode === 'edit' && editingBranch) {
        const { error } = await supabase
          .from('branches')
          .update({
            name: form.name.trim(),
            location: form.location.trim() || null,
            is_warehouse: form.isWarehouse,
            status: form.status,
          })
          .eq('id', editingBranch.id);
        if (error) throw error;
        showSuccess(`Branch "${form.name}" updated successfully!`);
      }
      closeSheet();
      await refreshProfile();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to save branch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (
      !(await confirm(
        'Delete Branch',
        `Are you sure you want to delete branch "${name}"? This will delete all associated inventory balances.`
      ))
    )
      return;
    try {
      const { error } = await supabase.from('branches').delete().eq('id', id);
      if (error) throw error;
      showSuccess(`Branch "${name}" deleted.`);
      await refreshProfile();
    } catch (err: any) {
      showError(err.message || 'Failed to delete branch');
    }
  };

  const handleToggleStatus = async (id: string, name: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'inactive' ? 'active' : 'inactive';
    if (
      !(await confirm(
        `${nextStatus === 'active' ? 'Activate' : 'Deactivate'} Branch`,
        `Set branch "${name}" to ${nextStatus}?`
      ))
    )
      return;
    try {
      const { error } = await supabase
        .from('branches')
        .update({ status: nextStatus })
        .eq('id', id);
      if (error) throw error;
      showSuccess(`Branch "${name}" is now ${nextStatus}.`);
      await refreshProfile();
    } catch (err: any) {
      showError(err.message || 'Failed to update status');
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const TypeBadge = ({ branch }: { branch: any }) => {
    if (branch.parent_id)
      return (
        <Badge variant="outline" className="text-[10px] uppercase border-indigo-500/50 text-indigo-400 bg-indigo-500/5 gap-1">
          <Store className="w-2.5 h-2.5" /> Sub-Store
        </Badge>
      );
    if (branch.is_warehouse)
      return (
        <Badge variant="outline" className="text-[10px] uppercase border-primary/50 text-primary bg-primary/5 gap-1">
          <Home className="w-2.5 h-2.5" /> Central Warehouse
        </Badge>
      );
    return (
      <Badge variant="outline" className="text-[10px] uppercase border-emerald-500/50 text-emerald-400 bg-emerald-500/5 gap-1">
        <Store className="w-2.5 h-2.5" /> Retail Branch
      </Badge>
    );
  };

  const StatusPill = ({ branch }: { branch: any }) => {
    const isActive = (branch.status || 'active') === 'active';
    if (!isSuperAdmin) {
      return (
        <Badge
          variant={isActive ? 'default' : 'secondary'}
          className="text-[10px] uppercase"
        >
          {branch.status || 'active'}
        </Badge>
      );
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => handleToggleStatus(branch.id, branch.name, branch.status || 'active')}
            className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border transition-all hover:opacity-80 cursor-pointer ${
              isActive
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-muted-foreground'}`} />
            {branch.status || 'active'}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Click to {isActive ? 'deactivate' : 'activate'} this branch
        </TooltipContent>
      </Tooltip>
    );
  };

  const ActionButtons = ({ branch, isParent }: { branch: any; isParent: boolean }) => {
    if (!isSuperAdmin) return null;
    return (
      <div className="flex justify-end items-center gap-0.5">
        {isParent && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={e => { e.stopPropagation(); openCreateSheet(branch); }}
                  className="h-7 w-7 text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add Sub-Store</TooltipContent>
            </Tooltip>
            <div className="w-px h-4 bg-border mx-0.5" />
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={e => { e.stopPropagation(); openEditSheet(branch); }}
              className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
            >
              <Edit className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit {isParent ? 'Branch' : 'Sub-Store'}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={e => { e.stopPropagation(); handleToggleStatus(branch.id, branch.name, branch.status || 'active'); }}
              className={`h-7 w-7 ${branch.status === 'inactive' ? 'text-emerald-500 hover:text-emerald-500 hover:bg-emerald-500/10' : 'text-amber-500 hover:text-amber-500 hover:bg-amber-500/10'}`}
            >
              {branch.status === 'inactive' ? <ShieldOn className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{branch.status === 'inactive' ? 'Activate' : 'Deactivate'}</TooltipContent>
        </Tooltip>
        <div className="w-px h-4 bg-border mx-0.5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={e => { e.stopPropagation(); handleDelete(branch.id, branch.name); }}
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete {isParent ? 'Branch' : 'Sub-Store'}</TooltipContent>
        </Tooltip>
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">

        {/* ── Header ── */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Store className="w-8 h-8 text-primary" />
              Branch Management
            </h2>
            <p className="text-muted-foreground mt-1">
              Add, review, and delete warehouses and retail restaurant branches.
            </p>
          </div>

          {isSuperAdmin && (
            <div className="flex flex-col items-end gap-2 shrink-0">
              {/* Plan usage bar */}
              {maxBranches > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-52 cursor-default">
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1 font-medium">
                        <span>Branch Locations</span>
                        <span className={usagePct >= 80 ? 'text-amber-400 font-bold' : ''}>
                          {parentBranchesCount} / {maxBranches}
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${usageColor}`}
                          style={{ width: `${usagePct}%` }}
                        />
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {limitReached
                      ? `Limit reached — upgrade your plan to add more branches`
                      : `${maxBranches - parentBranchesCount} branch slot(s) remaining`}
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={() => openCreateSheet()}
                      disabled={limitReached}
                      className="gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Create New Branch
                    </Button>
                  </span>
                </TooltipTrigger>
                {limitReached && (
                  <TooltipContent>
                    Branch limit reached — upgrade your "{tenant?.plan_type}" plan to add more.
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          )}
        </div>

        {/* ── Stats Bar ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Locations', value: totalCount, color: 'text-foreground' },
            { label: 'Active', value: activeCount, color: 'text-emerald-400' },
            { label: 'Sub-Stores', value: subStoreCount, color: 'text-indigo-400' },
            {
              label: 'Plan Usage',
              value: maxBranches > 0 ? `${parentBranchesCount} / ${maxBranches}` : '—',
              color: usagePct >= 100 ? 'text-red-400' : usagePct >= 80 ? 'text-amber-400' : 'text-primary',
            },
          ].map(s => (
            <div
              key={s.label}
              className="bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-1 hover-scale"
            >
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{s.label}</span>
              <span className={`text-2xl font-bold ${s.color}`}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* ── Search & filter bar ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1 max-w-md">
            <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search branch name or location…"
              className="pl-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-full sm:w-[170px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="warehouse">Central Warehouse</SelectItem>
              <SelectItem value="retail">Retail Branch</SelectItem>
              <SelectItem value="substore">Sub-Store</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[140px]">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Table ── */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="pl-6 w-[260px]">Branch Name</TableHead>
                  <TableHead className="w-[170px]">Type</TableHead>
                  <TableHead>Location Address</TableHead>
                  <TableHead className="w-[110px] text-center">Status</TableHead>
                  {isSuperAdmin && <TableHead className="text-right pr-6 w-[160px]">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isSuperAdmin ? 5 : 4} className="h-52 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <Store className="w-10 h-10 opacity-20" />
                        <div>
                          <p className="font-semibold text-foreground/70">No branch locations yet</p>
                          <p className="text-xs mt-1">
                            Create your first branch to start managing inventory across locations.
                          </p>
                        </div>
                        {isSuperAdmin && (
                          <Button size="sm" className="text-xs mt-1 gap-1.5" onClick={() => openCreateSheet()}>
                            <Plus className="w-3.5 h-3.5" /> Create First Branch
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : filteredParents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isSuperAdmin ? 5 : 4} className="h-28 text-center text-muted-foreground text-sm">
                      No branches match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredParents.map(parent => {
                    const allSubs = subStoresOf(parent.id);
                    const visibleSubs = allSubs.filter(s =>
                      !searchTerm && typeFilter === 'all' && statusFilter === 'all'
                        ? true
                        : matchesBranch(s)
                    );
                    const isCollapsed = collapsedIds.has(parent.id);
                    const isInactive = (parent.status || 'active') === 'inactive';

                    return (
                      <React.Fragment key={parent.id}>
                        {/* ── Parent row ── */}
                        <TableRow
                          className={`group transition-colors hover:bg-muted/30 ${isInactive ? 'opacity-50' : ''}`}
                        >
                          {/* Name */}
                          <TableCell className="pl-6 font-bold">
                            <div className="flex items-center gap-2.5">
                              {/* Collapse toggle */}
                              {allSubs.length > 0 ? (
                                <button
                                  onClick={() => toggleCollapse(parent.id)}
                                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                >
                                  {isCollapsed
                                    ? <ChevronRightIcon className="w-4 h-4" />
                                    : <ChevronDownIcon className="w-4 h-4" />}
                                </button>
                              ) : (
                                <div className="w-4 shrink-0" />
                              )}

                              {/* Icon */}
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${
                                parent.is_warehouse
                                  ? 'bg-primary/10 border-primary/20 text-primary'
                                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500'
                              }`}>
                                {parent.is_warehouse ? <Home className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                              </div>

                              <div className="min-w-0">
                                <span className={`text-sm ${isInactive ? 'italic text-muted-foreground' : 'text-foreground'}`}>
                                  {parent.name}
                                </span>
                                {allSubs.length > 0 && (
                                  <div className="text-[10px] text-muted-foreground/60 font-normal mt-0.5">
                                    {allSubs.length} sub-store{allSubs.length !== 1 ? 's' : ''}
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          {/* Type */}
                          <TableCell><TypeBadge branch={parent} /></TableCell>

                          {/* Location */}
                          <TableCell>
                            {parent.location ? (
                              <a
                                href={mapsUrl(parent.location)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group/link text-sm"
                                onClick={e => e.stopPropagation()}
                              >
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{parent.location}</span>
                                <ExternalLinkIcon className="w-3 h-3 opacity-0 group-hover/link:opacity-60 transition-opacity shrink-0" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground/40 text-xs italic">No address</span>
                            )}
                          </TableCell>

                          {/* Status */}
                          <TableCell className="text-center">
                            <StatusPill branch={parent} />
                          </TableCell>

                          {/* Actions */}
                          {isSuperAdmin && (
                            <TableCell className="text-right pr-6">
                              <ActionButtons branch={parent} isParent={true} />
                            </TableCell>
                          )}
                        </TableRow>

                        {/* ── Sub-store rows ── */}
                        {!isCollapsed &&
                          visibleSubs.map(sub => {
                            const subInactive = (sub.status || 'active') === 'inactive';
                            const sameLocation = sub.location === parent.location || !sub.location;
                            return (
                              <TableRow
                                key={sub.id}
                                className={`group transition-colors hover:bg-muted/20 bg-muted/10 border-l-2 border-l-primary/20 ${subInactive ? 'opacity-50' : ''}`}
                              >
                                {/* Name */}
                                <TableCell className="pl-10 font-medium">
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground/40 text-xs select-none">└─</span>
                                    <Store className="w-3.5 h-3.5 text-indigo-400/70 shrink-0" />
                                    <span className={`text-sm ${subInactive ? 'italic text-muted-foreground' : 'text-foreground'}`}>
                                      {sub.name}
                                    </span>
                                  </div>
                                </TableCell>

                                {/* Type */}
                                <TableCell><TypeBadge branch={sub} /></TableCell>

                                {/* Location — dim if same as parent */}
                                <TableCell>
                                  {sub.location && !sameLocation ? (
                                    <a
                                      href={mapsUrl(sub.location)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group/link text-sm"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      <MapPin className="w-3 h-3 shrink-0" />
                                      <span className="truncate">{sub.location}</span>
                                      <ExternalLinkIcon className="w-3 h-3 opacity-0 group-hover/link:opacity-60 transition-opacity shrink-0" />
                                    </a>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground/30 italic pl-4">
                                      Same as parent
                                    </span>
                                  )}
                                </TableCell>

                                {/* Status */}
                                <TableCell className="text-center">
                                  <StatusPill branch={sub} />
                                </TableCell>

                                {/* Actions */}
                                {isSuperAdmin && (
                                  <TableCell className="text-right pr-6">
                                    <ActionButtons branch={sub} isParent={false} />
                                  </TableCell>
                                )}
                              </TableRow>
                            );
                          })}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Side Sheet (Create / Edit) ── */}
        <Sheet open={isSheetOpen} onOpenChange={open => { if (!open) closeSheet(); }}>
          <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto flex flex-col">
            <SheetHeader className="pb-4 border-b">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-2 ${
                sheetMode === 'create'
                  ? parentForSubStore
                    ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'
                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                  : 'bg-primary/10 border border-primary/20 text-primary'
              }`}>
                {sheetMode === 'create' ? <Plus className="w-5 h-5" /> : <Edit className="w-5 h-5" />}
              </div>
              <SheetTitle>
                {sheetMode === 'create'
                  ? parentForSubStore
                    ? `Add Sub-Store to ${parentForSubStore.name}`
                    : 'Create New Branch'
                  : `Edit: ${editingBranch?.name}`}
              </SheetTitle>
              <SheetDescription>
                {sheetMode === 'create'
                  ? parentForSubStore
                    ? 'Add a storefront or brand under this branch. Sub-stores share the parent branch inventory.'
                    : 'Add a new warehouse or retail location to the system.'
                  : 'Modify the name, address, type, and status of this branch.'}
              </SheetDescription>
            </SheetHeader>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-5 pt-6">
              {/* Sub-store context info */}
              {sheetMode === 'edit' && editingBranch?.parent_id && (
                <div className="bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-lg text-xs text-indigo-300 flex items-center gap-2">
                  <Store className="w-4 h-4 shrink-0 text-indigo-400" />
                  <span>
                    Sub-store of{' '}
                    <span className="font-bold text-indigo-200">
                      {branches.find(b => b.id === editingBranch.parent_id)?.name}
                    </span>
                    . Shares parent inventory.
                  </span>
                </div>
              )}

              {/* Name */}
              <div className="space-y-2">
                <Label>
                  {editingBranch?.parent_id || parentForSubStore
                    ? 'Sub-Store Name'
                    : 'Branch Name'}{' '}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Branch C – Westside"
                />
              </div>

              {/* Location */}
              <div className="space-y-2">
                <Label>Location Address</Label>
                <Input
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="e.g. 789 West Blvd, Cebu City"
                />
                {form.location && (
                  <a
                    href={mapsUrl(form.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-primary/70 hover:text-primary flex items-center gap-1 transition-colors"
                  >
                    <MapPin className="w-3 h-3" /> Preview on Google Maps
                    <ExternalLinkIcon className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(val: BranchStatus) => setForm(f => ({ ...f, status: val }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Active
                      </div>
                    </SelectItem>
                    <SelectItem value="inactive">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Inactive
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Warehouse toggle (only for top-level branches) */}
              {!parentForSubStore && !editingBranch?.parent_id && (
                <div className="flex items-start gap-3 p-3 bg-muted/40 rounded-lg border border-border/60">
                  <Checkbox
                    id="isWarehouse"
                    checked={form.isWarehouse}
                    onCheckedChange={checked => setForm(f => ({ ...f, isWarehouse: !!checked }))}
                    className="mt-0.5"
                  />
                  <div>
                    <Label htmlFor="isWarehouse" className="font-semibold cursor-pointer text-sm">
                      Central Warehouse
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Marks this location as a central warehouse for stock distribution to retail branches.
                    </p>
                  </div>
                </div>
              )}

              <SheetFooter className="mt-auto pt-6 border-t gap-2">
                <Button type="button" variant="outline" onClick={closeSheet} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting
                    ? sheetMode === 'create'
                      ? 'Creating…'
                      : 'Saving…'
                    : sheetMode === 'create'
                    ? parentForSubStore
                      ? 'Add Sub-Store'
                      : 'Create Branch'
                    : 'Save Changes'}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
};
