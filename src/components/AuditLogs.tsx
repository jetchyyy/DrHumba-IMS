import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  FileTextIcon as FileText,
  MagnifyingGlassIcon as Search,
  ReloadIcon as RefreshCw,
  ChevronDownIcon as ChevronDown,
  ChevronUpIcon as ChevronUp,
  CalendarIcon as Calendar,
  DownloadIcon as Download,
  Cross2Icon,
  PersonIcon,
} from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Skeleton } from './ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { useAuth } from '../contexts/AuthContext';
import { format, isToday } from 'date-fns';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './ui/pagination';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  module: string;
  old_value: any;
  new_value: any;
  ip_address: string | null;
  timestamp: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a short relative label like "3 hrs ago" or "Sep 17" for older dates */
const getRelativeTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return format(date, 'MMM d, yyyy');
};

/** Classify action string into a UX category */
type ActionCategory = 'create' | 'transfer' | 'sale' | 'void' | 'adjust' | 'update' | 'delete' | 'default';
const getActionCategory = (action: string): ActionCategory => {
  if (/^(CREATE|RECEIVE|ADD)/.test(action)) return 'create';
  if (/^TRANSFER/.test(action)) return 'transfer';
  if (/^POS_SALE/.test(action)) return 'sale';
  if (/^VOID/.test(action)) return 'void';
  if (/^ADJUSTMENT/.test(action)) return 'adjust';
  if (/^(UPDATE|EDIT|MODIFY|CHANGE)/.test(action)) return 'update';
  if (/^(DELETE|REMOVE)/.test(action)) return 'delete';
  return 'default';
};

const ACTION_BADGE: Record<ActionCategory, { label: string; className: string }> = {
  create:   { label: 'CREATE',   className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  transfer: { label: 'TRANSFER', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  sale:     { label: 'SALE',     className: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  void:     { label: 'VOID',     className: 'bg-red-500/15 text-red-400 border-red-500/30' },
  adjust:   { label: 'ADJUST',   className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  update:   { label: 'UPDATE',   className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  delete:   { label: 'DELETE',   className: 'bg-rose-600/15 text-rose-400 border-rose-600/30' },
  default:  { label: 'ACTION',   className: 'bg-muted text-muted-foreground border-border' },
};

const MODULE_COLOR: Record<string, string> = {
  Transfers:      'bg-blue-500/15 text-blue-400 border-blue-500/30',
  POS:            'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  Adjustments:    'bg-orange-500/15 text-orange-400 border-orange-500/30',
  Inventory:      'bg-violet-500/15 text-violet-400 border-violet-500/30',
  StockReceiving: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  UserManagement: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  Auth:           'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

/** Deterministic HSL color from a string (for user avatars) */
const stringToHslColor = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
};

/** Build smart ellipsis page list */
const buildPageList = (current: number, total: number): (number | 'ellipsis')[] => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | 'ellipsis')[] = [];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  pages.push(1);
  if (left > 2) pages.push('ellipsis');
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const AuditLogs: React.FC = () => {
  const { branches } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState('All');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'simple' | 'technical'>('simple');
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Lookup maps
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});
  const [inventoryItems, setInventoryItems] = useState<Record<string, string>>({});
  const [menuItems, setMenuItems] = useState<Record<string, string>>({});

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedModule, viewMode, dateFrom, dateTo]);

  // Close expanded row on Esc; navigate pages with arrow keys
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedLogId(null);
      if (e.key === 'ArrowRight') setCurrentPage(p => Math.min(totalPages, p + 1));
      if (e.key === 'ArrowLeft') setCurrentPage(p => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false });
      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLookupData = async () => {
    try {
      const { data: profileData } = await supabase.from('profiles').select('id, email');
      const emailMap: Record<string, string> = {};
      profileData?.forEach(p => { emailMap[p.id] = p.email; });
      setUserEmails(emailMap);

      const { data: invData } = await supabase.from('inventory_items').select('id, item_name');
      const invMap: Record<string, string> = {};
      invData?.forEach(i => { invMap[i.id] = i.item_name; });
      setInventoryItems(invMap);

      const { data: menuData } = await supabase.from('menu_items').select('id, name');
      const menuMap: Record<string, string> = {};
      menuData?.forEach(m => { menuMap[m.id] = m.name; });
      setMenuItems(menuMap);
    } catch (err) {
      console.error('Error loading lookup data:', err);
    }
  };

  useEffect(() => {
    loadLogs();
    loadLookupData();
  }, []);

  // ── Friendly action text ─────────────────────────────────────────────────

  const formatFriendlyAction = useCallback((log: AuditLog) => {
    const getBranchName = (id: string) => {
      const b = branches.find(branch => branch.id === id);
      return b ? b.name : 'Unknown Branch';
    };

    switch (log.action) {
      case 'CREATE_STAFF': {
        const email = log.new_value?.email || 'N/A';
        const role = (log.new_value?.role || 'N/A').replace('_', ' ');
        return `Created a new staff account for ${email} as a ${role}`;
      }
      case 'RECEIVE_STOCK': {
        const branchName = log.new_value?.branch_id ? getBranchName(log.new_value.branch_id) : 'N/A';
        return `Received stock shipment at ${branchName}`;
      }
      case 'POS_SALE': {
        const total = log.new_value?.total_amount ? `₱${Number(log.new_value.total_amount).toFixed(2)}` : 'N/A';
        const method = (log.new_value?.payment_method || 'cash').toUpperCase();
        const branchName = log.new_value?.branch_id ? getBranchName(log.new_value.branch_id) : 'N/A';
        return `Completed a sale of ${total} (${method}) at ${branchName}`;
      }
      case 'VOID_SALE': {
        const reason = log.new_value?.void_reason || 'No reason specified';
        return `Voided/refunded sale (Reason: "${reason}")`;
      }
      case 'TRANSFER_REQUEST': {
        const source = log.new_value?.source ? getBranchName(log.new_value.source) : 'N/A';
        const target = log.new_value?.target ? getBranchName(log.new_value.target) : 'N/A';
        return `Requested inventory transfer from ${source} to ${target}`;
      }
      case 'TRANSFER_APPROVE':
        return 'Approved and dispatched stock transfer shipment';
      case 'TRANSFER_SEND': {
        const source = log.new_value?.source ? getBranchName(log.new_value.source) : 'N/A';
        const target = log.new_value?.target ? getBranchName(log.new_value.target) : 'N/A';
        return `Dispatched inventory transfer from ${source} to ${target}`;
      }
      case 'TRANSFER_RECEIVE':
        return 'Confirmed receipt of inventory transfer';
      case 'ADJUSTMENT_APPROVE':
        return 'Approved a stock adjustment';
      default: {
        const cleanAction = log.action.toLowerCase().replace(/_/g, ' ');
        return `Performed ${cleanAction} in the ${log.module} module`;
      }
    }
  }, [branches]);

  // ── Friendly details panel ───────────────────────────────────────────────

  const renderFriendlyDetails = (log: AuditLog) => {
    const getBranchName = (id: string) => {
      const b = branches.find(branch => branch.id === id);
      return b ? b.name : null; // null = unresolved UUID
    };

    /** UUID detection — 8-4-4-4-12 pattern */
    const isUUID = (val: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    /** Truncate UUID to readable short form: first 8 chars */
    const truncateUUID = (val: string) => `${val.slice(0, 8)}…`;

    /** All user-type keys that resolve to an email */
    const USER_KEYS = new Set([
      'user_id', 'staff_id', 'cashier_id', 'voided_by', 'approved_by',
      'reviewed_by', 'requested_by', 'submitted_by', 'received_by',
      'dispatched_by', 'confirmed_by', 'created_by', 'updated_by',
      'performed_by', 'processed_by', 'authorized_by',
    ]);

    /** Monetary keys → ₱ prefix */
    const MONEY_KEYS = new Set([
      'total_amount', 'amount_tendered', 'change_given', 'price',
      'cost_per_base_unit', 'cost_per_purchase_unit', 'unit_price',
      'subtotal', 'total', 'amount', 'cost',
    ]);

    /** Timestamp-like keys → formatted date */
    const DATE_KEYS = new Set([
      'created_at', 'updated_at', 'timestamp', 'dispatched_at',
      'received_at', 'approved_at', 'voided_at', 'date',
    ]);

    /**
     * Resolve a key+value pair to a human-readable string.
     * Returns { resolved: string, isRaw: boolean }
     * isRaw = true means value is still a UUID / unresolved reference (show in muted mono)
     */
    const resolveVal = (key: string, val: any): { text: string; isRaw: boolean } => {
      if (val === null || val === undefined) return { text: 'None', isRaw: false };
      if (typeof val === 'boolean') return { text: val ? 'Yes' : 'No', isRaw: false };

      // Arrays → handled separately via renderArray
      if (Array.isArray(val)) return { text: `[${val.length} item(s)]`, isRaw: false };

      // Nested objects — serialize compactly
      if (typeof val === 'object') return { text: JSON.stringify(val), isRaw: true };

      const str = String(val);

      // Branch IDs
      if (key.includes('branch_id') || key === 'source' || key === 'target') {
        const name = getBranchName(str);
        return name ? { text: name, isRaw: false } : { text: truncateUUID(str), isRaw: true };
      }

      // Item IDs
      if (key === 'item_id') {
        const name = inventoryItems[str];
        return name ? { text: name, isRaw: false } : { text: truncateUUID(str), isRaw: true };
      }
      if (key === 'menu_item_id') {
        const name = menuItems[str];
        return name ? { text: name, isRaw: false } : { text: truncateUUID(str), isRaw: true };
      }

      // Transfer IDs — can't resolve, show truncated
      if (key === 'transfer_id' || key === 'transfer_request_id') {
        return { text: isUUID(str) ? `#${truncateUUID(str)}` : str, isRaw: isUUID(str) };
      }

      // User-type keys
      if (USER_KEYS.has(key)) {
        const email = userEmails[str];
        return email ? { text: email, isRaw: false } : { text: isUUID(str) ? truncateUUID(str) : str, isRaw: isUUID(str) };
      }

      // Money
      if (MONEY_KEYS.has(key)) {
        const num = Number(str);
        return isNaN(num) ? { text: str, isRaw: false } : { text: `₱${num.toFixed(2)}`, isRaw: false };
      }

      // Date/time
      if (DATE_KEYS.has(key) && str) {
        try {
          return { text: format(new Date(str), 'MMM d, yyyy h:mm a'), isRaw: false };
        } catch {
          return { text: str, isRaw: false };
        }
      }

      // Generic UUID — truncate and mark raw
      if (isUUID(str)) return { text: truncateUUID(str), isRaw: true };

      return { text: str, isRaw: false };
    };

    const formatKey = (key: string): string =>
      key.replace(/_id$/g, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    /** Icon hint per field type */
    const fieldIcon = (key: string): string => {
      if (USER_KEYS.has(key)) return '👤';
      if (key.includes('branch') || key === 'source' || key === 'target') return '🏢';
      if (key === 'item_id' || key === 'menu_item_id') return '📦';
      if (MONEY_KEYS.has(key)) return '₱';
      if (DATE_KEYS.has(key)) return '🕐';
      if (key.includes('quantity') || key.includes('qty')) return '🔢';
      if (key === 'status') return '🔵';
      if (key.includes('reason') || key.includes('remarks') || key.includes('notes')) return '📝';
      return '';
    };

    /** Render an array value as a compact mini-table (e.g. transfer items) */
    const renderArray = (arr: any[]) => {
      if (arr.length === 0) return <span className="text-muted-foreground text-xs">Empty list</span>;
      const sampleItem = arr[0];
      if (typeof sampleItem !== 'object' || sampleItem === null) {
        return (
          <div className="flex flex-wrap gap-1">
            {arr.map((v, i) => (
              <span key={i} className="bg-muted text-foreground text-xs px-2 py-0.5 rounded font-mono">{String(v)}</span>
            ))}
          </div>
        );
      }
      const cols = Object.keys(sampleItem);
      const READABLE_COLS = ['item_name', 'name', 'quantity', 'quantity_base_unit', 'base_unit', 'unit', 'price', 'received_quantity_base_unit'];
      const visibleCols = cols.filter(c => READABLE_COLS.includes(c) || !c.includes('_id'));
      if (visibleCols.length === 0) return <span className="text-muted-foreground text-xs font-mono">{arr.length} items</span>;

      const colLabel = (c: string) => c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

      return (
        <div className="overflow-x-auto rounded-lg border border-border/60 mt-2">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr>
                {visibleCols.map(c => (
                  <th key={c} className="text-left px-3 py-2 text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                    {colLabel(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {arr.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-muted/20' : ''}>
                  {visibleCols.map(c => {
                    const cellVal = row[c];
                    const { text, isRaw } = resolveVal(c, cellVal);
                    return (
                      <td key={c} className={`px-3 py-2 ${isRaw ? 'font-mono text-muted-foreground' : 'font-medium text-foreground'}`}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    };

    /** Render a single-value detail card */
    const DetailCard = ({ fieldKey, val }: { fieldKey: string; val: any }) => {
      const isArray = Array.isArray(val);
      const { text, isRaw } = resolveVal(fieldKey, val);
      const icon = fieldIcon(fieldKey);

      return (
        <div className="bg-muted/30 p-3 rounded-lg border border-border/60 flex flex-col gap-1">
          <div className="flex items-center gap-1">
            {icon && <span className="text-[10px]">{icon}</span>}
            <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
              {formatKey(fieldKey)}
            </span>
          </div>
          {isArray ? (
            renderArray(val as any[])
          ) : (
            <div className={`text-sm font-medium mt-0.5 break-words ${isRaw ? 'font-mono text-muted-foreground text-xs' : 'text-foreground'}`}>
              {text}
              {isRaw && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 text-[10px] text-muted-foreground/50 cursor-help">?</span>
                  </TooltipTrigger>
                  <TooltipContent className="font-mono text-xs max-w-xs break-all">
                    {typeof val === 'string' ? val : JSON.stringify(val)}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      );
    };

    // ── Action-type context banner ─────────────────────────────────────────

    const renderContextBanner = () => {
      const action = log.action;
      const nv = log.new_value;

      // Transfer: show source → target visually
      if (['TRANSFER_REQUEST', 'TRANSFER_APPROVE', 'TRANSFER_SEND', 'TRANSFER_RECEIVE'].includes(action)) {
        const source = nv?.source ? getBranchName(nv.source) ?? nv.source : null;
        const target = nv?.target ? getBranchName(nv.target) ?? nv.target : null;
        if (source || target) {
          return (
            <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 mb-4">
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-blue-400/70 uppercase font-semibold tracking-wider">From</span>
                <span className="text-sm font-bold text-blue-300">{source ?? '—'}</span>
              </div>
              <div className="text-blue-400 text-lg font-light px-2">→</div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-blue-400/70 uppercase font-semibold tracking-wider">To</span>
                <span className="text-sm font-bold text-blue-300">{target ?? '—'}</span>
              </div>
              {nv?.control_number && (
                <div className="ml-auto text-right">
                  <span className="text-[10px] text-blue-400/70 uppercase font-semibold tracking-wider block">Control #</span>
                  <span className="text-xs font-mono text-blue-300">{nv.control_number}</span>
                </div>
              )}
            </div>
          );
        }
      }

      // POS Sale: highlight total + payment method
      if (action === 'POS_SALE' && nv) {
        const total = nv.total_amount ? `₱${Number(nv.total_amount).toFixed(2)}` : null;
        const method = nv.payment_method ? String(nv.payment_method).toUpperCase() : null;
        const branch = nv.branch_id ? getBranchName(nv.branch_id) : null;
        if (total) {
          return (
            <div className="flex items-center gap-4 bg-violet-500/10 border border-violet-500/20 rounded-lg px-4 py-3 mb-4">
              <div>
                <span className="text-[10px] text-violet-400/70 uppercase font-semibold tracking-wider block">Total</span>
                <span className="text-xl font-bold text-violet-300">{total}</span>
              </div>
              {method && (
                <div>
                  <span className="text-[10px] text-violet-400/70 uppercase font-semibold tracking-wider block">Method</span>
                  <span className="text-sm font-bold text-violet-300">{method}</span>
                </div>
              )}
              {branch && (
                <div className="ml-auto text-right">
                  <span className="text-[10px] text-violet-400/70 uppercase font-semibold tracking-wider block">Branch</span>
                  <span className="text-sm font-medium text-violet-300">{branch}</span>
                </div>
              )}
            </div>
          );
        }
      }

      // Void: highlight reason
      if (action === 'VOID_SALE' && nv?.void_reason) {
        return (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
            <span className="text-red-400 text-lg mt-0.5">⚠</span>
            <div>
              <span className="text-[10px] text-red-400/70 uppercase font-semibold tracking-wider block">Void Reason</span>
              <span className="text-sm font-medium text-red-300">{nv.void_reason}</span>
            </div>
          </div>
        );
      }

      // Staff creation: highlight email + role
      if (action === 'CREATE_STAFF' && nv) {
        return (
          <div className="flex items-center gap-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 mb-4">
            <div>
              <span className="text-[10px] text-emerald-400/70 uppercase font-semibold tracking-wider block">New Staff</span>
              <span className="text-sm font-bold text-emerald-300">{nv.email || '—'}</span>
            </div>
            {nv.role && (
              <div>
                <span className="text-[10px] text-emerald-400/70 uppercase font-semibold tracking-wider block">Role</span>
                <span className="text-sm font-semibold text-emerald-300 capitalize">{String(nv.role).replace(/_/g, ' ')}</span>
              </div>
            )}
          </div>
        );
      }

      return null;
    };

    // ── Skip keys that are already shown in the context banner ─────────────

    const BANNER_KEYS: Record<string, Set<string>> = {
      TRANSFER_REQUEST:  new Set(['source', 'target', 'control_number']),
      TRANSFER_APPROVE:  new Set(['source', 'target', 'control_number']),
      TRANSFER_SEND:     new Set(['source', 'target', 'control_number']),
      TRANSFER_RECEIVE:  new Set(['source', 'target', 'control_number']),
      POS_SALE:          new Set(['total_amount', 'payment_method', 'branch_id']),
      VOID_SALE:         new Set(['void_reason']),
      CREATE_STAFF:      new Set(['email', 'role']),
    };
    const skipKeys = BANNER_KEYS[log.action] ?? new Set<string>();

    // ── Main render ────────────────────────────────────────────────────────

    const oldVal = log.old_value;
    const newVal = log.new_value;

    if (!oldVal && !newVal)
      return <div className="text-muted-foreground text-sm">No transaction details recorded.</div>;

    // CREATE / DELETE: only one side exists
    if (!oldVal || !newVal) {
      const targetObj = newVal || oldVal;
      const isAdded = !!newVal;

      // Separate arrays from scalar fields
      const arrayFields = Object.entries(targetObj).filter(([, v]) => Array.isArray(v));
      const scalarFields = Object.entries(targetObj).filter(([k, v]) => !Array.isArray(v) && !skipKeys.has(k));

      return (
        <div className="space-y-4">
          {renderContextBanner()}
          {scalarFields.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {isAdded ? 'Recorded Details' : 'Removed Details'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {scalarFields.map(([key, val]) => (
                  <DetailCard key={key} fieldKey={key} val={val} />
                ))}
              </div>
            </div>
          )}
          {arrayFields.map(([key, val]) => (
            <div key={key}>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {formatKey(key)} <span className="text-muted-foreground/50 font-normal normal-case">({(val as any[]).length} items)</span>
              </div>
              {renderArray(val as any[])}
            </div>
          ))}
        </div>
      );
    }

    // UPDATE: before/after diff
    const allKeys = Array.from(new Set([...Object.keys(oldVal), ...Object.keys(newVal)]));
    const changes = allKeys
      .filter(key => JSON.stringify(oldVal[key]) !== JSON.stringify(newVal[key]))
      .map(key => ({ key, oldV: oldVal[key], newV: newVal[key] }));

    if (changes.length === 0)
      return <div className="text-muted-foreground text-sm">No fields were modified.</div>;

    return (
      <div className="space-y-4">
        {renderContextBanner()}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Modified Fields <span className="text-muted-foreground/50 font-normal normal-case">({changes.length} change{changes.length !== 1 ? 's' : ''})</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider w-[160px]">Field</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">Before</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground uppercase tracking-wider">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {changes.map(({ key, oldV, newV }) => {
                  const old = resolveVal(key, oldV);
                  const neo = resolveVal(key, newV);
                  return (
                    <tr key={key} className="bg-muted/10 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-xs text-foreground/80">
                        <div className="flex items-center gap-1">
                          {fieldIcon(key) && <span>{fieldIcon(key)}</span>}
                          {formatKey(key)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-destructive/60 text-xs">✕</span>
                          <span className={`text-xs line-through text-destructive/70 ${old.isRaw ? 'font-mono' : ''}`}>
                            {old.text}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-400 text-xs">✓</span>
                          <span className={`text-xs font-semibold text-emerald-400 ${neo.isRaw ? 'font-mono' : ''}`}>
                            {neo.text}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // ── Filtering ────────────────────────────────────────────────────────────

  const modules = ['All', ...Array.from(new Set(logs.map(log => log.module)))];

  const filteredLogs = logs.filter(log => {
    const userEmail = log.user_id ? userEmails[log.user_id] || '' : 'system';
    const friendlyAction = formatFriendlyAction(log);
    const searchLower = searchTerm.toLowerCase();

    const matchesSearch =
      log.action.toLowerCase().includes(searchLower) ||
      (log.user_id && log.user_id.toLowerCase().includes(searchLower)) ||
      log.module.toLowerCase().includes(searchLower) ||
      userEmail.toLowerCase().includes(searchLower) ||
      friendlyAction.toLowerCase().includes(searchLower);

    const matchesModule = selectedModule === 'All' || log.module === selectedModule;

    const logDate = new Date(log.timestamp);
    const matchesFrom = !dateFrom || logDate >= dateFrom;
    const matchesTo = !dateTo || logDate <= new Date(dateTo.getTime() + 86400000 - 1);

    return matchesSearch && matchesModule && matchesFrom && matchesTo;
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const pageList = buildPageList(currentPage, totalPages);

  // ── Stats (derived client-side from full log array) ──────────────────────

  const todayCount = logs.filter(l => isToday(new Date(l.timestamp))).length;
  const distinctUsers = new Set(logs.map(l => l.user_id).filter(Boolean)).size;
  const moduleCounts = logs.reduce<Record<string, number>>((acc, l) => {
    acc[l.module] = (acc[l.module] || 0) + 1;
    return acc;
  }, {});
  const topModule = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  // ── CSV Export ───────────────────────────────────────────────────────────

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Activity / Action', 'Module', 'Performed By', 'IP Address'];
    const rows = filteredLogs.map(log => {
      const email = log.user_id ? userEmails[log.user_id] || log.user_id : 'SYSTEM';
      const activity = viewMode === 'simple' ? formatFriendlyAction(log) : log.action;
      return [
        new Date(log.timestamp).toLocaleString(),
        `"${activity.replace(/"/g, '""')}"`,
        log.module,
        email,
        log.ip_address || '',
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasDateFilter = !!dateFrom || !!dateTo;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex-1 p-4 md:p-8 overflow-y-auto">

        {/* ── Header ── */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between mb-6 gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="w-8 h-8 text-primary" />
              Immutable Audit Logs
            </h2>
            <p className="text-muted-foreground mt-1">
              Read-only ledger tracking all user logins, inventory updates, and role alterations.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Tabs value={viewMode} onValueChange={(val: any) => setViewMode(val)} className="w-fit">
              <TabsList className="grid grid-cols-2 w-[280px] bg-muted/60 p-1">
                <TabsTrigger value="simple" className="text-xs">Friendly View</TabsTrigger>
                <TabsTrigger value="technical" className="text-xs">Technical View</TabsTrigger>
              </TabsList>
            </Tabs>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={exportToCSV}
                  className="h-9 w-9"
                  disabled={loading || filteredLogs.length === 0}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export filtered results to CSV</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={loadLogs} className="h-9 w-9" disabled={loading}>
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh logs</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Stats Bar ── */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total Entries', value: logs.length.toLocaleString(), color: 'text-primary' },
              { label: "Today's Events", value: todayCount.toLocaleString(), color: 'text-emerald-400' },
              { label: 'Active Users', value: distinctUsers.toLocaleString(), color: 'text-blue-400' },
              { label: 'Top Module', value: topModule, color: 'text-violet-400' },
            ].map(stat => (
              <div
                key={stat.label}
                className="bg-card border border-border/60 rounded-xl p-4 flex flex-col gap-1 hover-scale"
              >
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{stat.label}</span>
                <span className={`text-2xl font-bold truncate ${stat.color}`}>{stat.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Filters ── */}
        <div className="flex flex-col gap-3 mb-6">
          {/* Row 1: Search + Module */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={viewMode === 'simple' ? 'Search activity, user email, or module…' : 'Search action or User UUID…'}
                className="pl-9"
              />
            </div>
            <Select value={selectedModule} onValueChange={setSelectedModule}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="All Modules" />
              </SelectTrigger>
              <SelectContent>
                {modules.map(mod => (
                  <SelectItem key={mod} value={mod}>{mod}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Row 2: Date range */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Date range:</span>

            {/* From date */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  <Calendar className="h-3.5 w-3.5" />
                  {dateFrom ? format(dateFrom, 'MMM d, yyyy') : 'From'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={dateFrom}
                  onSelect={setDateFrom}
                />
              </PopoverContent>
            </Popover>

            <span className="text-xs text-muted-foreground">—</span>

            {/* To date */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  <Calendar className="h-3.5 w-3.5" />
                  {dateTo ? format(dateTo, 'MMM d, yyyy') : 'To'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={dateTo}
                  onSelect={setDateTo}
                />
              </PopoverContent>
            </Popover>

            {hasDateFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}
              >
                <Cross2Icon className="h-3 w-3" />
                Clear dates
              </Button>
            )}

            {/* Active filter pills */}
            <div className="flex items-center gap-1.5 ml-auto">
              {filteredLogs.length !== logs.length && (
                <span className="text-xs text-muted-foreground">
                  Showing <span className="text-foreground font-semibold">{filteredLogs.length}</span> of{' '}
                  <span className="font-semibold">{logs.length}</span> entries
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Table ── */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="pl-6 w-[130px]">Timestamp</TableHead>
                  {viewMode === 'simple' ? (
                    <>
                      <TableHead className="w-[80px]">Type</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead className="w-[130px]">Module</TableHead>
                      <TableHead className="w-[200px]">Performed By</TableHead>
                      <TableHead className="text-right pr-6 w-[120px]">Details</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead className="w-[80px]">Type</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="w-[130px]">Module</TableHead>
                      <TableHead>User ID (UUID)</TableHead>
                      <TableHead className="text-right pr-6 w-[120px]">Payload</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: itemsPerPage }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-6"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="text-right pr-6"><Skeleton className="h-7 w-16 ml-auto rounded-md" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center">
                      <div className="flex flex-col items-center gap-3 text-muted-foreground">
                        <PersonIcon className="w-10 h-10 opacity-30" />
                        <div>
                          <p className="font-semibold text-foreground/70">No audit entries found</p>
                          <p className="text-xs mt-1">
                            {searchTerm || selectedModule !== 'All' || hasDateFilter
                              ? 'Try adjusting your filters or clearing the date range.'
                              : 'Audit events will appear here once actions are performed.'}
                          </p>
                        </div>
                        {(searchTerm || selectedModule !== 'All' || hasDateFilter) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs"
                            onClick={() => { setSearchTerm(''); setSelectedModule('All'); setDateFrom(undefined); setDateTo(undefined); }}
                          >
                            Clear all filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedLogs.map(log => {
                    const isExpanded = expandedLogId === log.id;
                    const userEmail = log.user_id ? userEmails[log.user_id] || log.user_id : 'SYSTEM';
                    const isSystem = !log.user_id;
                    const avatarLetter = isSystem ? 'S' : userEmail.charAt(0).toUpperCase();
                    const avatarColor = isSystem ? 'hsl(0,0%,30%)' : stringToHslColor(userEmail);
                    const category = getActionCategory(log.action);
                    const actionBadge = ACTION_BADGE[category];
                    const moduleBadgeClass = MODULE_COLOR[log.module] || 'bg-muted text-muted-foreground border-border';
                    const hasPayload = !!(log.old_value || log.new_value);
                    const logDate = new Date(log.timestamp);

                    return (
                      <React.Fragment key={log.id}>
                        <TableRow
                          className={`cursor-pointer transition-colors ${
                            isExpanded
                              ? 'bg-primary/5 border-l-2 border-l-primary'
                              : 'hover:bg-muted/40'
                          }`}
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        >
                          {/* Timestamp */}
                          <TableCell className="pl-6">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground font-medium text-xs cursor-default whitespace-nowrap">
                                  {getRelativeTime(log.timestamp)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                {logDate.toLocaleString()}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>

                          {/* Action type badge */}
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[9px] px-1.5 py-0 font-bold tracking-wide border ${actionBadge.className}`}
                            >
                              {actionBadge.label}
                            </Badge>
                          </TableCell>

                          {viewMode === 'simple' ? (
                            <>
                              {/* Activity */}
                              <TableCell className="font-medium text-sm text-foreground">
                                {formatFriendlyAction(log)}
                              </TableCell>

                              {/* Module */}
                              <TableCell>
                                <Badge variant="outline" className={`text-[10px] border ${moduleBadgeClass}`}>
                                  {log.module}
                                </Badge>
                              </TableCell>

                              {/* Performed By */}
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                                    style={{ backgroundColor: avatarColor }}
                                  >
                                    {avatarLetter}
                                  </div>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-muted-foreground text-xs font-medium truncate max-w-[140px] cursor-default">
                                        {isSystem ? 'SYSTEM' : userEmail}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>{isSystem ? 'Automated system action' : userEmail}</TooltipContent>
                                  </Tooltip>
                                </div>
                              </TableCell>

                              {/* Inspect */}
                              <TableCell className="text-right pr-6">
                                {hasPayload ? (
                                  <Button variant={isExpanded ? 'default' : 'ghost'} size="sm" className="h-7 text-xs">
                                    Inspect
                                    {isExpanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                                  </Button>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground/50">—</span>
                                )}
                              </TableCell>
                            </>
                          ) : (
                            <>
                              {/* Action */}
                              <TableCell className="font-mono font-bold text-primary text-xs">
                                {log.action}
                              </TableCell>

                              {/* Module */}
                              <TableCell>
                                <Badge variant="outline" className={`text-[10px] border ${moduleBadgeClass}`}>
                                  {log.module}
                                </Badge>
                              </TableCell>

                              {/* User UUID */}
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                                    style={{ backgroundColor: avatarColor }}
                                  >
                                    {avatarLetter}
                                  </div>
                                  <span className="text-muted-foreground font-mono text-xs truncate max-w-[180px]">
                                    {log.user_id || 'SYSTEM'}
                                  </span>
                                </div>
                              </TableCell>

                              {/* Inspect payload */}
                              <TableCell className="text-right pr-6">
                                {hasPayload ? (
                                  <Button variant={isExpanded ? 'default' : 'ghost'} size="sm" className="h-7 text-xs">
                                    Payload
                                    {isExpanded ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                                  </Button>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground/50">—</span>
                                )}
                              </TableCell>
                            </>
                          )}
                        </TableRow>

                        {/* ── Expanded detail row ── */}
                        {isExpanded && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={6} className="p-0">
                              <div className="px-6 py-5 pl-12 border-l-2 border-primary/50">
                                {viewMode === 'simple' ? (
                                  renderFriendlyDetails(log)
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block mb-2">
                                        Old State
                                      </span>
                                      <pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border overflow-x-auto max-h-48 whitespace-pre-wrap">
                                        {log.old_value ? JSON.stringify(log.old_value, null, 2) : 'NULL'}
                                      </pre>
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block mb-2">
                                        New State
                                      </span>
                                      <pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border overflow-x-auto max-h-48 whitespace-pre-wrap">
                                        {log.new_value ? JSON.stringify(log.new_value, null, 2) : 'NULL'}
                                      </pre>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {/* ── Smart Pagination ── */}
            {!loading && totalPages > 1 && (
              <div className="py-4 border-t flex items-center justify-between px-6">
                <span className="text-xs text-muted-foreground hidden sm:block">
                  Page {currentPage} of {totalPages} &bull; {filteredLogs.length} entries
                </span>
                <Pagination className="mx-0 w-auto">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        className={currentPage === 1 ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                    {pageList.map((page, idx) =>
                      page === 'ellipsis' ? (
                        <PaginationItem key={`ell-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={page}>
                          <PaginationLink
                            onClick={() => setCurrentPage(page)}
                            isActive={currentPage === page}
                            className="cursor-pointer"
                          >
                            {page}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    )}
                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        className={currentPage === totalPages ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Keyboard shortcut hint */}
        <p className="text-center text-[10px] text-muted-foreground/40 mt-3">
          Tip: Use ← → arrow keys to navigate pages &bull; Esc to close expanded row
        </p>
      </div>
    </TooltipProvider>
  );
};
