import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  PlusIcon as Plus, 
  Pencil1Icon as Edit, 
  TrashIcon as Trash, 
  ReloadIcon as RefreshCw, 
  MagnifyingGlassIcon as Search,
  CalendarIcon,
  CardStackIcon as CardIcon
} from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { useModal } from '../contexts/ModalContext';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface ExpenseRecord {
  id: string;
  tenant_id: string;
  branch_id: string;
  category: string;
  amount: number;
  description: string | null;
  expense_date: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  branches?: { name: string };
  profiles?: { email: string };
}

export const Expenses: React.FC = () => {
  const { profile, branches, selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();

  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form State (Create / Edit)
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null);
  
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Utilities');
  const [description, setDescription] = useState('');
  const [branchId, setBranchId] = useState('');

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterBranchId, setFilterBranchId] = useState('ALL');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const standardCategories = ['Utilities', 'Salaries', 'Rent', 'Supplies', 'Marketing', 'Repairs', 'Others'];

  const isSuperAdmin = profile?.role_name === 'super_admin';
  const isBranchManager = profile?.role_name === 'branch_manager';
  const canManage = isSuperAdmin || isBranchManager;

  useEffect(() => {
    if (selectedBranch) {
      setBranchId(selectedBranch.id);
      if (!isSuperAdmin) {
        setFilterBranchId(selectedBranch.id);
      }
    } else if (branches.length > 0) {
      setBranchId(branches[0].id);
    }
  }, [selectedBranch, branches, isSuperAdmin]);

  const loadExpenses = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('expenses')
        .select(`
          *,
          branches (name),
          profiles (email)
        `)
        .order('expense_date', { ascending: false });

      // Apply branch context restriction for non-global roles
      if (!isSuperAdmin && profile?.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      } else if (filterBranchId !== 'ALL') {
        query = query.eq('branch_id', filterBranchId);
      }

      if (filterCategory !== 'ALL') {
        query = query.eq('category', filterCategory);
      }

      if (startDate) {
        query = query.gte('expense_date', startDate);
      }
      if (endDate) {
        query = query.lte('expense_date', endDate);
      }

      const { data, error } = await query;
      if (error) throw error;

      let filtered = data as ExpenseRecord[] || [];
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(e => 
          (e.description?.toLowerCase().includes(q)) || 
          (e.category.toLowerCase().includes(q))
        );
      }

      setExpenses(filtered);
    } catch (err: any) {
      console.error('Error loading expenses:', err);
      showError(err.message || 'Failed to fetch expenses.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
    setCurrentPage(1);
  }, [filterBranchId, filterCategory, startDate, endDate, searchQuery, selectedBranch]);

  const handleOpenCreateModal = () => {
    setEditingExpense(null);
    setAmount('');
    setCategory('Utilities');
    setDescription('');
    setExpenseDate(new Date().toISOString().split('T')[0]);
    if (selectedBranch) {
      setBranchId(selectedBranch.id);
    } else if (branches.length > 0) {
      setBranchId(branches[0].id);
    }
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (expense: ExpenseRecord) => {
    // Check write permissions
    if (!isSuperAdmin && isBranchManager && expense.branch_id !== profile?.branch_id) {
      showError("Unauthorized: You can only edit expenses logged for your own branch.");
      return;
    }

    setEditingExpense(expense);
    setAmount(expense.amount.toString());
    setCategory(expense.category);
    setDescription(expense.description || '');
    setExpenseDate(expense.expense_date);
    setBranchId(expense.branch_id);
    setIsFormModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) {
      showError("Please enter a valid amount greater than 0.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        branch_id: branchId,
        category,
        amount: Number(amount),
        description: description.trim() || null,
        expense_date: expenseDate,
        created_by: profile?.id,
        updated_at: new Date().toISOString()
      };

      if (editingExpense) {
        const { error } = await supabase
          .from('expenses')
          .update(payload)
          .eq('id', editingExpense.id);

        if (error) throw error;
        showSuccess("Expense record updated successfully!");
      } else {
        const { error } = await supabase
          .from('expenses')
          .insert([payload]);

        if (error) throw error;
        showSuccess("Expense record added successfully!");
      }

      setIsFormModalOpen(false);
      loadExpenses();
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Failed to save expense record.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (expense: ExpenseRecord) => {
    // Check write permissions
    if (!isSuperAdmin && isBranchManager && expense.branch_id !== profile?.branch_id) {
      showError("Unauthorized: You can only delete expenses logged for your own branch.");
      return;
    }

    const confirmMessage = `Are you sure you want to permanently delete the expense of ₱${expense.amount.toLocaleString()} logged under category "${expense.category}"?`;
    if (!await confirm("Delete Expense Record", confirmMessage)) return;

    try {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', expense.id);

      if (error) throw error;
      showSuccess("Expense record successfully deleted.");
      loadExpenses();
    } catch (err: any) {
      console.error(err);
      showError(err.message || "Failed to delete expense record.");
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(val);
  };

  // Metrics calculations
  const totalAmount = expenses.reduce((acc, curr) => acc + Number(curr.amount), 0);
  const averageAmount = expenses.length > 0 ? totalAmount / expenses.length : 0;

  // Pagination
  const totalPages = Math.ceil(expenses.length / itemsPerPage);
  const paginatedExpenses = expenses.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <CardIcon className="w-8 h-8 text-primary" />
            <span>Operating Expense Tracker (OPEX)</span>
          </h2>
          <p className="text-muted-foreground mt-1">
            Log and manage your operational expenditures including utilities, payroll, rent, and repairs.
          </p>
        </div>

        <div className="flex space-x-2">
          <Button variant="outline" size="icon" onClick={loadExpenses} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {canManage && (
            <Button onClick={handleOpenCreateModal}>
              <Plus className="w-4 h-4 mr-2" />
              Log New Expense
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <Card className="glass-dark border-border/50">
          <CardContent className="p-5">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Total OPEX (Filtered)</span>
            <span className="text-2xl font-bold block mt-1 text-red-500">{formatCurrency(totalAmount)}</span>
            <span className="text-[10px] text-muted-foreground block mt-1">Across {expenses.length} transaction entries</span>
          </CardContent>
        </Card>
        
        <Card className="glass-dark border-border/50">
          <CardContent className="p-5">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Average Expense Value</span>
            <span className="text-2xl font-bold block mt-1">{formatCurrency(averageAmount)}</span>
            <span className="text-[10px] text-muted-foreground block mt-1">Per individual logged receipt</span>
          </CardContent>
        </Card>

        <Card className="glass-dark border-border/50">
          <CardContent className="p-5">
            <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block">Active Filters Period</span>
            <span className="text-sm font-semibold block mt-2 text-indigo-400 flex items-center gap-1.5">
              <CalendarIcon className="w-4 h-4" />
              {startDate} to {endDate}
            </span>
            <span className="text-[10px] text-muted-foreground block mt-1">Adjust date range below to customize</span>
          </CardContent>
        </Card>
      </div>

      {/* Filters Card */}
      <Card className="mb-6">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 space-y-1.5 w-full">
            <Label className="text-xs">Search Details</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search description or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full md:w-auto md:flex-shrink-0">
            {isSuperAdmin && (
              <div className="space-y-1.5 min-w-[120px]">
                <Label className="text-xs">Location</Label>
                <Select value={filterBranchId} onValueChange={setFilterBranchId}>
                  <SelectTrigger className="h-10 text-xs">
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Branches</SelectItem>
                    {branches.map(b => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5 min-w-[120px]">
              <Label className="text-xs">Category</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-10 text-xs">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Categories</SelectItem>
                  {standardCategories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-10 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-10 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Registry */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Date</TableHead>
                {isSuperAdmin && <TableHead>Branch</TableHead>}
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Logged By</TableHead>
                {canManage && <TableHead className="text-right pr-6">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 7 : 6} className="h-24 text-center text-muted-foreground">
                    Fetching expense logs...
                  </TableCell>
                </TableRow>
              ) : expenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSuperAdmin ? 7 : 6} className="h-24 text-center text-muted-foreground">
                    No expense records found matching current filter scope.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedExpenses.map(item => {
                  const isOwnBranch = isSuperAdmin || (profile?.branch_id === item.branch_id);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="pl-6 font-medium">
                        {new Date(item.expense_date).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </TableCell>
                      {isSuperAdmin && (
                        <TableCell className="font-semibold text-muted-foreground">
                          {item.branches?.name || 'Loading Branch...'}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant="outline" className="uppercase text-[9px] border-indigo-500/20 text-indigo-500 bg-indigo-500/5">
                          {item.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={item.description || ''}>
                        {item.description || <span className="text-muted-foreground italic">No details</span>}
                      </TableCell>
                      <TableCell className="font-bold text-red-500">
                        {formatCurrency(item.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.profiles?.email || 'System'}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end space-x-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10" 
                              onClick={() => handleOpenEditModal(item)}
                              disabled={!isOwnBranch}
                              title="Edit expense record"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" 
                              onClick={() => handleDelete(item)}
                              disabled={!isOwnBranch}
                              title="Delete expense record"
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination Controls */}
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

      {/* CREATE / EDIT MODAL */}
      <Dialog open={isFormModalOpen} onOpenChange={setIsFormModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              {editingExpense ? <Edit className="w-5 h-5 mr-2 text-primary" /> : <Plus className="w-5 h-5 mr-2 text-primary" />}
              {editingExpense ? 'Modify Expense Log' : 'Log Operational Expense'}
            </DialogTitle>
            <DialogDescription>
              Provide expense details. Make sure the location context is correct.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label>Receipt Amount (PHP) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  required
                  placeholder="₱0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Expense Date *</Label>
                  <Input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {standardCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isSuperAdmin ? (
                <div className="space-y-2">
                  <Label>Target Branch Context *</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Branch" />
                    </SelectTrigger>
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
                <div className="space-y-2 opacity-60">
                  <Label>Branch Context</Label>
                  <div className="h-10 flex items-center px-3 border rounded-md bg-muted text-sm font-medium">
                    {selectedBranch?.name || 'Your Assigned Branch'}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Expenditure Description / Details</Label>
                <Input
                  type="text"
                  placeholder="e.g. Meralco electricity bill June 2026"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setIsFormModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : editingExpense ? 'Update Expense' : 'Log Expense'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
