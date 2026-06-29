import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useModal } from '../contexts/ModalContext';
import { printXZReport } from '../lib/printService';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
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
  const { selectedBranch } = useAuth();
  const { showError } = useModal();

  const [sessions, setSessions] = useState<CashierSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSession, setSelectedSession] = useState<CashierSession | null>(null);

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

      if (selectedBranch?.id) {
        query = query.eq('branch_id', selectedBranch.id);
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
    loadSessions();
  }, [selectedBranch?.id]);

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
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">BIR Z-Read Report History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Audit history of closed drawer shifts, cumulative lifetime totals, and sequential Z-Read counters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadSessions} className="gap-1.5 h-9" disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Logs
          </Button>
        </div>
      </div>

      {/* Filter panel */}
      <Card className="bg-background/60 backdrop-blur-sm shadow-sm border border-muted/50">
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 min-w-0 space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Search reports</Label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by cashier email, branch or Z-Count..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                className="pl-9"
              />
            </div>
          </div>
          <div className="w-full md:w-44 space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Start Date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <div className="w-full md:w-44 space-y-1">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">End Date</Label>
            <Input
              type="date"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setCurrentPage(1); }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table Card */}
      <Card className="shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
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
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Loading cashier sessions logs...
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

        {/* Pagination navigation */}
        {totalPages > 1 && (
          <div className="p-4 border-t bg-muted/20">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="gap-1"
                  >
                    <PaginationPrevious />
                  </Button>
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      isActive={page === currentPage}
                      onClick={() => handlePageChange(page)}
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="gap-1"
                  >
                    <PaginationNext />
                  </Button>
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </Card>

      {/* ─── Detailed Report Dialog ─── */}
      <Dialog open={!!selectedSession} onOpenChange={(v) => { if (!v) setSelectedSession(null); }}>
        <DialogContent className="sm:max-w-md">
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
                  <div className="flex justify-between"><span>Transaction Count:</span><span>{summary.transactionCount}</span></div>
                  <div className="border-t border-dashed my-2" />
                  <div className="font-bold text-center">PAYMENT BREAKDOWN</div>
                  <div className="flex justify-between"><span>Cash:</span><span>{formatPHP(summary.cashSales)}</span></div>
                  <div className="flex justify-between"><span>GCash:</span><span>{formatPHP(summary.gcashSales)}</span></div>
                  <div className="flex justify-between"><span>Maya:</span><span>{formatPHP(summary.mayaSales)}</span></div>
                  <div className="flex justify-between"><span>Card:</span><span>{formatPHP(summary.cardSales)}</span></div>
                  <div className="flex justify-between"><span>Other:</span><span>{formatPHP(summary.otherSales)}</span></div>
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

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setSelectedSession(null)}>
              Close Dialog
            </Button>
            <Button
              onClick={() => {
                const summary = getSummaryObject(selectedSession!);
                printXZReport(summary, true, selectedSession!.branches?.name || 'TERMINAL');
              }}
              className="font-bold gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Reprint Thermal Z-Read
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
