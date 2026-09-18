import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useModal } from '../contexts/ModalContext';
import { printXZReport } from '../lib/printService';
import { printBluetoothXZReport, ensureBluetoothPrinter } from '../lib/bluetoothPrinter';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  FileTextIcon as FileText,
  FileTextIcon as Printer,
  MagnifyingGlassIcon as Search,
  ReloadIcon as RefreshCw
} from '@radix-ui/react-icons';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface CashierSession {
  id: string;
  opened_at: string;
  closed_at: string;
  opening_balance: number;
  closing_balance: number;
  actual_cash: number;
  status: string;
  z_counter: number;
  grand_total_start: number;
  grand_total_end: number;
  sales_summary: any;
  control_number?: string;
  branches?: { name: string };
  profiles?: { email: string };
}

const formatPHP = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(n);

export const ZReadHistory: React.FC = () => {
  const { profile, selectedBranch, branches } = useAuth();
  const { showError } = useModal();
  const isAdminRole = profile && ['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name);

  const [sessions, setSessions] = useState<CashierSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSession, setSelectedSession] = useState<CashierSession | null>(null);
  const [filterBranchId, setFilterBranchId] = useState('All');
  const [isPrintingXZBluetooth, setIsPrintingXZBluetooth] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const loadSessions = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('cashier_sessions')
        .select(`
          *,
          branches (name),
          profiles (email)
        `)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (!isAdminRole && profile?.branch_id) {
        query = query.eq('branch_id', profile.branch_id);
      } else if (filterBranchId !== 'All') {
        query = query.eq('branch_id', filterBranchId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setSessions(data || []);
    } catch (err: any) {
      console.error('Error loading Z-Reports:', err);
      showError(err.message || 'Error loading Z-Reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdminRole && profile?.branch_id) {
      setFilterBranchId(profile.branch_id);
    } else if (selectedBranch?.id) {
      setFilterBranchId(selectedBranch.id);
    } else {
      setFilterBranchId('All');
    }
  }, [selectedBranch?.id, profile, isAdminRole]);

  useEffect(() => {
    loadSessions();
  }, [filterBranchId]);

  // Filters logic
  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      const cashierEmail = session.profiles?.email?.toLowerCase() || '';
      const branchName = session.branches?.name?.toLowerCase() || '';
      const query = searchTerm.toLowerCase();

      const matchesSearch = 
        cashierEmail.includes(query) || 
        branchName.includes(query) || 
        String(session.z_counter).includes(query) || 
        (session.control_number || '').toLowerCase().includes(query);

      let matchesDates = true;
      if (startDate) {
        matchesDates = matchesDates && new Date(session.closed_at) >= new Date(startDate);
      }
      if (endDate) {
        // Set end date to end of that day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDates = matchesDates && new Date(session.closed_at) <= end;
      }

      return matchesSearch && matchesDates;
    });
  }, [sessions, searchTerm, startDate, endDate]);

  // Pagination Logic
  const totalPages = Math.ceil(filteredSessions.length / itemsPerPage);
  const paginatedSessions = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredSessions.slice(start, start + itemsPerPage);
  }, [filteredSessions, currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const handlePrintXZBluetooth = async (summary: any, isZRead: boolean, branchName: string) => {
    try {
      setIsPrintingXZBluetooth(true);
      await ensureBluetoothPrinter();
      await printBluetoothXZReport(summary, isZRead, branchName);
    } catch (err) {
      console.error('Failed to print Z-Read via Bluetooth:', err);
      showError('Failed to print report via Bluetooth.');
    } finally {
      setIsPrintingXZBluetooth(false);
    }
  };

  // Safe JSON extraction helper
  const getSummaryObject = (session: CashierSession) => {
    if (!session.sales_summary) return null;
    if (typeof session.sales_summary === 'string') {
      try {
        return JSON.parse(session.sales_summary);
      } catch (e) {
        return null;
      }
    }
    return session.sales_summary;
  };

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="w-8 h-8 text-primary" />
            BIR Z-Read Report History
          </h2>
          <p className="text-muted-foreground mt-1">
            Audit history of closed drawer shifts, cumulative lifetime totals, and sequential Z-Read counters.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="icon" onClick={loadSessions} className="h-9 w-9" disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search by cashier email, branch or Z-Count..."
            value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="pl-9"
          />
        </div>
        {isAdminRole ? (
          <Select value={filterBranchId} onValueChange={val => { setFilterBranchId(val); setCurrentPage(1); }}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Branches</SelectItem>
              {branches.filter(b => !b.parent_id).map(b => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-sm font-semibold bg-muted/40 border rounded-lg h-9 px-3 py-2 leading-none flex items-center">
            {branches.find(b => b.id === filterBranchId)?.name || 'My Branch'}
          </div>
        )}
        <Input
          type="date"
          value={startDate}
          onChange={e => { setStartDate(e.target.value); setCurrentPage(1); }}
          className="w-full sm:w-[150px]"
        />
        <Input
          type="date"
          value={endDate}
          onChange={e => { setEndDate(e.target.value); setCurrentPage(1); }}
          className="w-full sm:w-[150px]"
        />
      </div>

      {/* Table Card */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="pl-6 w-24">Z-Counter</TableHead>
                <TableHead>Closed Date</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Branch Location</TableHead>
                <TableHead className="text-right">Opening Cash</TableHead>
                <TableHead className="text-right">Expected Drawer</TableHead>
                <TableHead className="text-right">Actual Drawer</TableHead>
                <TableHead className="text-right">Discrepancy</TableHead>
                <TableHead className="text-right pr-6 w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading cashier session logs...
                  </TableCell>
                </TableRow>
              ) : paginatedSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No closed register drawer shifts found matching filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedSessions.map(session => {
                  const summary = getSummaryObject(session);
                  const expectedCash = summary ? Number(summary.expectedCash || 0) : 0;
                  const expectedDrawer = session.opening_balance + expectedCash;
                  const discrepancy = session.actual_cash - expectedDrawer;

                  return (
                    <TableRow key={session.id}>
                      <TableCell className="pl-6 font-bold font-mono text-destructive">
                        {session.control_number || `#${String(session.z_counter).padStart(5, '0')}`}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {new Date(session.closed_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs font-semibold max-w-[150px] truncate" title={session.profiles?.email}>
                        {session.profiles?.email}
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        {session.branches?.name || 'Main Branch'}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-xs">
                        {formatPHP(session.opening_balance)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-xs text-muted-foreground">
                        {formatPHP(expectedDrawer)}
                      </TableCell>
                      <TableCell className="text-right font-black text-xs text-primary">
                        {formatPHP(session.actual_cash)}
                      </TableCell>
                      <TableCell className={`text-right font-bold text-xs ${
                        discrepancy < 0 
                          ? 'text-rose-600 dark:text-rose-400' 
                          : discrepancy > 0 
                            ? 'text-amber-500' 
                            : 'text-emerald-500'
                      }`}>
                        {formatPHP(discrepancy)}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-primary"
                            onClick={() => setSelectedSession(session)}
                            title="View Z-Report Summary"
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => printXZReport(summary, true, session.branches?.name || 'TERMINAL')}
                            title="Reprint Z-Read Receipt"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                            </svg>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="py-4 border-t flex items-center justify-between px-6">
              <span className="text-xs text-muted-foreground hidden sm:block">
                Page {currentPage} of {totalPages} &bull; {filteredSessions.length} sessions
              </span>
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => handlePageChange(currentPage - 1)}
                      className={currentPage === 1 ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        isActive={page === currentPage}
                        onClick={() => handlePageChange(page)}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => handlePageChange(currentPage + 1)}
                      className={currentPage === totalPages ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Detailed Report Dialog ─── */}
      <Dialog open={!!selectedSession} onOpenChange={(v) => { if (!v) setSelectedSession(null); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-destructive">Z-Read Shift Audit Details</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Official shift summary logs details.
            </DialogDescription>
          </DialogHeader>

          {selectedSession && (() => {
            const summary = getSummaryObject(selectedSession);
            if (!summary) return <p className="text-xs text-muted-foreground text-center py-4">Summary metadata unavailable.</p>;

            return (
              <div className="space-y-4 py-2">
                <div className="border border-destructive/20 rounded-md p-4 bg-muted/30 font-mono text-xs space-y-1.5 max-h-[50vh] overflow-y-auto">
                  <div className="text-center font-bold uppercase">{selectedSession.branches?.name || 'TERMINAL'}</div>
                  <div className="text-center text-[10px] text-destructive font-bold">Z-READ AUDIT REPORT</div>
                  <div className="border-t border-dashed my-2" />
                  <div className="flex justify-between"><span>Status:</span><span className="font-bold text-destructive">{selectedSession.status?.toUpperCase()}</span></div>
                  {selectedSession.control_number && (
                    <div className="flex justify-between"><span>Control No:</span><span className="font-bold text-destructive">{selectedSession.control_number}</span></div>
                  )}
                  <div className="flex justify-between"><span>Z-Counter:</span><span className="font-bold text-destructive">#{String(selectedSession.z_counter).padStart(5, '0')}</span></div>
                  <div className="flex justify-between"><span>Opened At:</span><span>{new Date(summary.openedAt).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Closed At:</span><span>{new Date(summary.closedAt).toLocaleString()}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">LIFETIME GRAND TOTALS</div>
                  <div className="flex justify-between"><span>Start:</span><span>{formatPHP(summary.grandTotalStart)}</span></div>
                  <div className="flex justify-between"><span>End:</span><span>{formatPHP(summary.grandTotalEnd)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">SALES SUMMARY</div>
                  <div className="flex justify-between"><span>Gross Sales:</span><span>{formatPHP(summary.grossSales)}</span></div>
                  <div className="flex justify-between"><span>Net Sales (Ex-VAT):</span><span>{formatPHP(summary.netSales)}</span></div>
                  <div className="flex justify-between"><span>VAT Amount (12%):</span><span>{formatPHP(summary.vatAmount)}</span></div>
                  <div className="flex justify-between"><span>VAT-Exempt Sales:</span><span>{formatPHP(summary.vatExemptSales || 0)}</span></div>
                  <div className="flex justify-between"><span>Discount Total:</span><span>{formatPHP(summary.discountAmount || 0)}</span></div>
                  <div className="flex justify-between"><span>Transaction Count:</span><span>{summary.transactionCount}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">PAYMENT BREAKDOWN</div>
                  <div className="flex justify-between"><span>Cash:</span><span>{formatPHP(summary.cashSales)}</span></div>
                  <div className="flex justify-between"><span>GCash:</span><span>{formatPHP(summary.gcashSales)}</span></div>
                  <div className="flex justify-between"><span>Maya:</span><span>{formatPHP(summary.mayaSales)}</span></div>
                  <div className="flex justify-between"><span>Card:</span><span>{formatPHP(summary.cardSales)}</span></div>
                  <div className="flex justify-between"><span>Other:</span><span>{formatPHP(summary.otherSales)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">SALES CHANNEL BREAKDOWN</div>
                  <div className="flex justify-between"><span>Dine-in / Store:</span><span>{formatPHP(summary.dineInSales || 0)}</span></div>
                  <div className="flex justify-between"><span>Take-out:</span><span>{formatPHP(summary.takeOutSales || 0)}</span></div>
                  <div className="flex justify-between text-amber-500 font-bold"><span>FoodPanda:</span><span>{formatPHP(summary.foodpandaSales || 0)}</span></div>
                  <div className="flex justify-between text-emerald-500 font-bold"><span>GrabFood:</span><span>{formatPHP(summary.grabSales || 0)}</span></div>
                  {summary.otherChannelSales > 0 && (
                    <div className="flex justify-between"><span>Other Channels:</span><span>{formatPHP(summary.otherChannelSales)}</span></div>
                  )}
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">VOIDS & REFUNDS</div>
                  <div className="flex justify-between"><span>Void Count:</span><span>{summary.voidCount}</span></div>
                  <div className="flex justify-between"><span>Void Amount:</span><span>{formatPHP(summary.voidAmount)}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">DRAWER FLOW & BALANCING</div>
                  <div className="flex justify-between"><span>Opening Float:</span><span>{formatPHP(summary.openingBalance)}</span></div>
                  <div className="flex justify-between"><span>Expected Cash:</span><span>{formatPHP(summary.expectedCash)}</span></div>
                  <div className="flex justify-between font-bold"><span>Expected Drawer:</span><span>{formatPHP(summary.openingBalance + summary.expectedCash)}</span></div>
                  <div className="flex justify-between text-indigo-600 dark:text-indigo-400 font-bold"><span>Actual Drawer:</span><span>{formatPHP(summary.actualCash)}</span></div>
                  <div className={`flex justify-between font-bold ${summary.discrepancy < 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                    <span>Discrepancy:</span>
                    <span>{formatPHP(summary.discrepancy)}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button variant="outline" onClick={() => setSelectedSession(null)} className="sm:flex-1">
              Close Dialog
            </Button>
            <Button
              onClick={() => {
                const summary = getSummaryObject(selectedSession!);
                handlePrintXZBluetooth(summary, true, selectedSession!.branches?.name || 'TERMINAL');
              }}
              disabled={isPrintingXZBluetooth}
              className="sm:flex-1 font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isPrintingXZBluetooth ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Print Bluetooth
            </Button>
            <Button
              onClick={() => {
                const summary = getSummaryObject(selectedSession!);
                printXZReport(summary, true, selectedSession!.branches?.name || 'TERMINAL');
              }}
              className="sm:flex-1 font-bold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Printer className="w-4 h-4" />
              Print System
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
