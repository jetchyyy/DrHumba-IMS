import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  BackpackIcon as ShoppingCart,
  PlusIcon as Plus,
  MinusIcon as Minus,
  TrashIcon as Trash2,
  MagnifyingGlassIcon as Search,
  CheckCircledIcon as CheckCircle,
  ExclamationTriangleIcon as WifiOff,
  FileTextIcon as Printer,
  ReloadIcon as Spinner,
} from '@radix-ui/react-icons';
import {
  getTerminalConfig,
  enqueueOfflineSale,
  getOfflineSalesQueue,
  dequeueOfflineSale,
} from '../lib/offlineService';
import type { TerminalConfig } from '../lib/offlineService';
import { settingsService } from '../lib/settingsService';
import { printXZReport, printQueueNumberTicket } from '../lib/printService';
import { printBluetoothThermalInvoice, printBluetoothKitchenReceipt, ensureBluetoothPrinter } from '../lib/bluetoothPrinter';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';

import { useModal } from '../contexts/ModalContext';
import { ScrollArea } from './ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from './ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { useNetworkStatus } from '../hooks/use-network-status';
import { useBusinessVocab } from '../hooks/useBusinessVocab';
import { useTenant } from '../contexts/TenantContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  is_available: boolean;
  foodpanda_price?: number | null;
  grab_price?: number | null;
}

interface CartItem {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
}

type PaymentMethod = 'cash' | 'card' | 'gcash' | 'maya' | 'other';

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash:  'Cash',
  card:  'Credit / Debit Card',
  gcash: 'GCash',
  maya:  'Maya',
  other: 'Other',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatPHP = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(n);

const QUICK_CASH_AMOUNTS = (total: number): number[] => {
  const ceil50 = Math.ceil(total / 50) * 50;
  return Array.from(new Set([ceil50, ceil50 + 50, ceil50 + 100, ceil50 + 200]))
    .filter(v => v >= total)
    .slice(0, 4);
};

// ─── Payment Dialog ───────────────────────────────────────────────────────────

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  cartTotal: number;
  onConfirm: (method: PaymentMethod, tendered: number | null, saleCategory: string, referenceNumber: string, queueNumber: string, subStoreId: string | null) => Promise<void>;
  processing: boolean;
  onStateChange?: (state: { method: PaymentMethod; tendered: number; refNumber: string } | null) => void;
  saleCategories: Array<{ value: string; label: string }>;
  defaultSaleCategory: string;
  subStores: any[];
  initialSubStore: any | null;
}

const PaymentDialog: React.FC<PaymentDialogProps> = ({ open, onClose, cartTotal, onConfirm, processing, onStateChange, saleCategories, defaultSaleCategory, subStores, initialSubStore }) => {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tenderedStr, setTenderedStr] = useState('');
  const [saleCategory, setSaleCategory] = useState<string>(defaultSaleCategory);
  const [customCategory, setCustomCategory] = useState<string>('');
  const [refNumber, setRefNumber] = useState<string>('');
  const [queueNumber, setQueueNumber] = useState<string>('');
  const [dialogSubStoreId, setDialogSubStoreId] = useState<string>('parent');

  const tendered = parseFloat(tenderedStr) || 0;
  const change = method === 'cash' ? tendered - cartTotal : 0;

  const isRefNumRequired = method === 'gcash' || method === 'maya';
  const hasRefNum = !isRefNumRequired || refNumber.trim().length > 0;
  const isCustomCatRequired = saleCategory === 'other';
  const hasCustomCat = !isCustomCatRequired || customCategory.trim().length > 0;
  const isValidCash = method !== 'cash' || tendered >= cartTotal;

  const canConfirm = isValidCash && hasRefNum && hasCustomCat;

  // Propagate state to parent for customer display sync
  useEffect(() => {
    if (open && onStateChange) {
      onStateChange({ method, tendered: parseFloat(tenderedStr) || 0, refNumber });
    } else if (!open && onStateChange) {
      onStateChange(null);
    }
  }, [open, method, tenderedStr, refNumber, onStateChange]);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setMethod('cash');
      setTenderedStr('');
      setSaleCategory(defaultSaleCategory);
      setCustomCategory('');
      setRefNumber('');
      setQueueNumber('');
      setDialogSubStoreId(initialSubStore?.id || 'parent');
    }
  }, [open, defaultSaleCategory, initialSubStore]);

  const handleConfirm = async () => {
    const tValue = method === 'cash' ? (tendered || null) : null;
    const finalCategory = saleCategory === 'other' ? customCategory.trim() : saleCategory;
    const finalRef = (method === 'gcash' || method === 'maya') ? refNumber.trim() : '';
    const finalSubStoreId = dialogSubStoreId === 'parent' ? null : dialogSubStoreId;
    await onConfirm(method, tValue, finalCategory, finalRef, queueNumber.trim(), finalSubStoreId);
  };

  const quickAmounts = useMemo(() => QUICK_CASH_AMOUNTS(cartTotal), [cartTotal]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !processing) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight">Collect Payment</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Confirm the payment method and tender amount before finalizing the transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Order Total */}
          <div className="flex justify-between items-center bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Order Total</span>
            <span className="text-2xl font-black text-primary">{formatPHP(cartTotal)}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-2">
            {/* Left Column: Payment Input */}
            <div className="space-y-4">
              {/* Payment Method */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Payment Method
                </Label>
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map(m => (
                      <SelectItem key={m} value={m}>{PAYMENT_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Reference Number for Gcash/Maya */}
              {(method === 'gcash' || method === 'maya') && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Reference Number *
                  </Label>
                  <Input
                    required
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder={`Enter ${PAYMENT_LABELS[method]} Reference Number`}
                    autoFocus
                  />
                </div>
              )}

              {/* Cash Tendered — only for cash */}
              {method === 'cash' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Amount Tendered (₱)
                    </Label>
                    <Input
                      type="number"
                      min={cartTotal}
                      step="0.01"
                      placeholder={`Min: ${formatPHP(cartTotal)}`}
                      value={tenderedStr}
                      onChange={(e) => setTenderedStr(e.target.value)}
                      className="text-base font-bold h-12"
                      autoFocus
                    />
                  </div>

                  {/* Quick-select bills */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Quick Bill</p>
                    <div className="flex gap-2 flex-wrap">
                      {quickAmounts.map(amt => (
                        <Button
                          key={amt}
                          size="sm"
                          variant={tendered === amt ? 'default' : 'outline'}
                          className="text-xs font-bold h-8"
                          onClick={() => setTenderedStr(String(amt))}
                        >
                          ₱{amt}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-muted-foreground h-8"
                        onClick={() => setTenderedStr(cartTotal.toFixed(2))}
                      >
                        Exact
                      </Button>
                    </div>
                  </div>

                  {/* Change */}
                  {tendered > 0 && (
                    <div className={`flex justify-between items-center rounded-lg px-4 py-3 border font-bold ${
                      change >= 0
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-destructive/10 border-destructive/30 text-destructive'
                    }`}>
                      <span className="text-xs uppercase tracking-wider">{change >= 0 ? 'Change' : 'Short by'}</span>
                      <span className="text-xl">{formatPHP(Math.abs(change))}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Non-cash note */}
              {method !== 'cash' && (
                <div className="bg-muted/40 border rounded-lg px-4 py-3 text-xs text-muted-foreground">
                  {PAYMENT_LABELS[method]} — no change calculation required. Confirm when payment is received.
                </div>
              )}
            </div>

            {/* Right Column: Metadata & Attribution */}
            <div className="space-y-4">
              {/* Sale Category */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Sale Category
                </Label>
                <Select value={saleCategory} onValueChange={setSaleCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {saleCategories.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Sale Category Input */}
              {saleCategory === 'other' && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Specify Sale Category *
                  </Label>
                  <Input
                    required
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="e.g. Delivery Direct"
                  />
                </div>
              )}

              {/* Sub-Store Selection (Attribution) */}
              {subStores.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Store Attribution
                  </Label>
                  <Select value={dialogSubStoreId} onValueChange={setDialogSubStoreId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Attribution Store" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="parent">Parent Store</SelectItem>
                      {subStores.map((ss) => (
                        <SelectItem key={ss.id} value={ss.id}>
                          {ss.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Queue / Table / Order Designation */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Queue / Order / Table # (Optional)
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-2"
                    onClick={() => {
                      const randomNum = Math.floor(1000 + Math.random() * 9000);
                      setQueueNumber(String(randomNum));
                    }}
                  >
                    Random Order #
                  </Button>
                </div>
                <Input
                  value={queueNumber}
                  onChange={(e) => setQueueNumber(e.target.value)}
                  placeholder="e.g. Q-01, Table 5, 8742"
                />
              </div>
            </div>
          </div>
        </div>

        <Separator />

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={processing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={processing || !canConfirm}
            className="font-bold min-w-[140px]"
          >
            {processing ? 'Processing…' : `Confirm ${PAYMENT_LABELS[method]}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Main POS Component ───────────────────────────────────────────────────────

interface POSProps {
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const POS: React.FC<POSProps> = ({
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const { selectedBranch, profile, branches } = useAuth();
  const { showSuccess, showError } = useModal();
  const { isOnline } = useNetworkStatus();
  const vocab = useBusinessVocab();
  const { tenant } = useTenant();
  const isRestaurant = tenant?.is_restaurant ?? true;

  const [items, setItems] = useState<MenuItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);

  // Sub-store states
  const [subStores, setSubStores] = useState<any[]>([]);
  const [selectedSubStore, setSelectedSubStore] = useState<any | null>(null);

  useEffect(() => {
    if (selectedBranch?.id && branches) {
      const kids = branches.filter(b => b.parent_id === selectedBranch.id && b.status !== 'inactive');
      setSubStores(kids);
      const profileBranch = branches.find(b => b.id === profile?.branch_id);
      const defaultSubStore = (profileBranch && profileBranch.parent_id === selectedBranch.id)
        ? profileBranch
        : (kids.length > 0 ? kids[0] : null);
      setSelectedSubStore(defaultSubStore);
    } else {
      setSubStores([]);
      setSelectedSubStore(null);
    }
  }, [selectedBranch?.id, branches, profile?.branch_id]);

  // Cart
  type PriceChannel = 'standard' | 'foodpanda' | 'grab';
  const [priceChannel, setPriceChannel] = useState<PriceChannel>('standard');
  const [branchPrices, setBranchPrices] = useState<Record<string, { price?: number; foodpanda_price?: number; grab_price?: number }>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);

  // Payment dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastSaleResult, setLastSaleResult] = useState<{ id: string; change: number; method: string; sale_category?: string; reference_number?: string; control_number?: string; queue_number?: string | null; items?: any[]; branch_name?: string; cashier_email?: string; total_amount?: number; created_at?: string; } | null>(null);

  // Offline and Terminal Sync states
  const [terminalConfig, setTerminalConfig] = useState<TerminalConfig | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadOfflineData = async () => {
    try {
      const config = await getTerminalConfig();
      setTerminalConfig(config);
      const queue = await getOfflineSalesQueue();
      setPendingSyncCount(queue.length);
    } catch (e) {
      console.error('Failed to load offline data:', e);
    }
  };

  const syncOfflineSales = async () => {
    if (isSyncing || !isOnline) return;
    try {
      const queue = await getOfflineSalesQueue();
      if (queue.length === 0) return;

      setIsSyncing(true);
      let successCount = 0;

      for (const sale of queue) {
        try {
          const { error } = await supabase.rpc('fn_process_offline_sale', {
            p_branch_id:        sale.branch_id,
            p_items:            sale.items,
            p_payment_method:   sale.payment_method,
            p_amount_tendered:  sale.amount_tendered,
            p_sale_category:    sale.sale_category,
            p_reference_number: sale.reference_number,
            p_control_number:   sale.control_number,
            p_created_at:       sale.created_at,
            p_cashier_id:       sale.cashier_id,
            p_queue_number:     sale.queue_number || null,
            p_sub_store_id:     (sale as any).sub_store_id || null,
          });

          if (error) throw error;

          await dequeueOfflineSale(sale.id);
          successCount++;
        } catch (err) {
          console.error('Failed to sync offline sale', sale.control_number, err);
          break; // Stop syncing remainder to protect sequence order
        }
      }

      const remaining = await getOfflineSalesQueue();
      setPendingSyncCount(remaining.length);
      setIsSyncing(false);

      if (successCount > 0) {
        showSuccess(`Successfully synchronized ${successCount} offline transaction(s) to the cloud.`);
      }
    } catch (e) {
      console.error('Sync failure:', e);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadOfflineData();
  }, []);

  useEffect(() => {
    if (isOnline) {
      syncOfflineSales();
    }
  }, [isOnline]);

  // Customer Display Sync state
  const [supabaseChannel, setSupabaseChannel] = useState<any>(null);
  const [paymentState, setPaymentState] = useState<{ method: PaymentMethod; tendered: number; refNumber: string } | null>(null);

  // Cashier Drawer Session & shift control states
  const [activeSession, setActiveSession] = useState<any>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [openSessionOpen, setOpenSessionOpen] = useState(false);
  const [openingBalance, setOpeningBalance] = useState('1000');

  // X/Z Read report state
  const [xReadOpen, setXReadOpen] = useState(false);
  const [zReadOpen, setZReadOpen] = useState(false);
  const [actualCashStr, setActualCashStr] = useState('');
  const [sessionSummary, setSessionSummary] = useState<any>(null);
  const [viewingClosedSummary, setViewingClosedSummary] = useState<any>(null);

  const cartTotal = cart.reduce((s, ci) => s + ci.price * ci.quantity, 0);
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);

  // Set up Supabase Realtime sync channel
  useEffect(() => {
    if (!selectedBranch?.id || !profile?.id) return;

    const channelName = `pos-sync:${selectedBranch.id}:${profile.id}`;
    const channel = supabase.channel(channelName);
    
    channel.subscribe((status) => {
      console.log(`Supabase Realtime Channel ${channelName} status:`, status);
    });

    setSupabaseChannel(channel);

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedBranch?.id, profile?.id]);

  const checkActiveSession = async () => {
    if (!selectedBranch?.id || !profile?.id) return;
    try {
      setSessionLoading(true);
      const { data, error } = await supabase
        .from('cashier_sessions')
        .select('*')
        .eq('branch_id', selectedBranch.id)
        .eq('cashier_id', profile.id)
        .eq('status', 'open')
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setActiveSession(data);
        setOpenSessionOpen(false);
      } else {
        setActiveSession(null);
      }
    } catch (err: any) {
      console.error('Error checking cashier session:', err);
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    checkActiveSession();
  }, [selectedBranch?.id, profile?.id]);

  const handleOpenSession = async () => {
    if (!selectedBranch?.id) return;
    try {
      const { error } = await supabase.rpc('fn_open_cashier_session', {
        p_branch_id: selectedBranch.id,
        p_opening_balance: Number(openingBalance) || 0
      });

      if (error) throw error;

      showSuccess('Cash register session opened successfully.');
      setOpenSessionOpen(false);
      await checkActiveSession();
    } catch (err: any) {
      console.error('Error opening session:', err);
      showError(err.message || 'Error opening session');
    }
  };

  const handleGenerateXRead = async () => {
    if (!activeSession?.id) return;
    try {
      const { data, error } = await supabase.rpc('fn_get_session_summary', {
        p_session_id: activeSession.id
      });
      if (error) throw error;
      setSessionSummary(data);
      setXReadOpen(true);
    } catch (err: any) {
      console.error('Error loading session summary:', err);
      showError(err.message || 'Error loading session summary');
    }
  };

  const handleCloseSession = async () => {
    if (!activeSession?.id) return;
    try {
      const { data, error } = await supabase.rpc('fn_close_cashier_session', {
        p_session_id: activeSession.id,
        p_actual_cash: Number(actualCashStr) || 0
      });
      if (error) throw error;
      
      showSuccess('Register session closed & Z-Read complete.');
      setZReadOpen(false);
      setViewingClosedSummary(data);
      await checkActiveSession();
    } catch (err: any) {
      console.error('Error closing session:', err);
      showError(err.message || 'Error closing session');
    }
  };

  // Broadcast state helper
  const broadcastState = (
    currentCart: CartItem[],
    total: number,
    count: number,
    isPaymentOpen: boolean,
    isCheckingOut: boolean,
    successResult: any,
    payState: any
  ) => {
    const payload = {
      cart: currentCart,
      cartTotal: total,
      cartCount: count,
      paymentOpen: isPaymentOpen,
      checkingOut: isCheckingOut,
      lastSaleResult: successResult,
      selectedBranch,
      paymentMethod: payState?.method || null,
      tendered: payState?.tendered || 0,
      refNumber: payState?.refNumber || '',
    };

    // 1. Broadcast locally
    try {
      const bc = new BroadcastChannel('drhumba-pos-customer-sync');
      bc.postMessage(payload);
      bc.close();
    } catch (e) {
      console.warn('Local BroadcastChannel failed:', e);
    }

    // 2. Broadcast via Supabase Realtime
    if (supabaseChannel) {
      supabaseChannel.send({
        type: 'broadcast',
        event: 'pos-state-update',
        payload
      }).catch((err: any) => {
        console.warn('Supabase Realtime broadcast failed:', err);
      });
    }
  };

  // Trigger broadcast whenever state changes
  useEffect(() => {
    broadcastState(cart, cartTotal, cartCount, paymentOpen, checkingOut, lastSaleResult, paymentState);
  }, [cart, cartTotal, cartCount, paymentOpen, checkingOut, lastSaleResult, paymentState, supabaseChannel]);

  const toggleFullscreen = async () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
    } else {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          if ((window.screen as any).orientation?.lock) {
            await (window.screen as any).orientation.lock('landscape').catch((err: any) => {
              console.warn('Orientation lock failed:', err);
            });
          }
        } else {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          }
        }
      } catch (err) {
        console.error('Fullscreen toggle error:', err);
      }
    }
  };

  const openCustomerDisplay = () => {
    if (!selectedBranch?.id || !profile?.id) {
      showError('Please select a branch context before opening the customer display.');
      return;
    }
    const url = `${window.location.origin}/customer-display?branchId=${selectedBranch.id}&cashierId=${profile.id}`;
    window.open(url, 'customerDisplayWindow', 'width=1024,height=768,menubar=no,toolbar=no,location=no');
  };

  const loadMenuItems = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('menu_items')
        .select('*')
        .eq('status', 'active')
        .eq('is_available', true);

      if (selectedBranch?.id) {
        query = query.or(`available_branches.is.null,available_branches.cs.{"${selectedBranch.id}"}`);
      }

      const { data, error } = await query.order('name');
      if (error) throw error;
      setItems(data || []);

      if (selectedBranch?.id) {
        const { data: bpData } = await supabase
          .from('item_branch_prices')
          .select('menu_item_id, inventory_item_id, price, foodpanda_price, grab_price')
          .eq('branch_id', selectedBranch.id);

        if (bpData) {
          const bpMap: Record<string, { price?: number; foodpanda_price?: number; grab_price?: number }> = {};
          bpData.forEach(bp => {
            const overrideObj = {
              price: bp.price !== null && bp.price !== undefined ? Number(bp.price) : undefined,
              foodpanda_price: bp.foodpanda_price !== null && bp.foodpanda_price !== undefined ? Number(bp.foodpanda_price) : undefined,
              grab_price: bp.grab_price !== null && bp.grab_price !== undefined ? Number(bp.grab_price) : undefined,
            };

            if (bp.menu_item_id) {
              bpMap[bp.menu_item_id] = overrideObj;
            }
            if (bp.inventory_item_id) {
              bpMap[bp.inventory_item_id] = overrideObj;
              const targetMenuItem = (data || []).find(mi => mi.inventory_item_id === bp.inventory_item_id);
              if (targetMenuItem) {
                bpMap[targetMenuItem.id] = overrideObj;
              }
            }
          });
          setBranchPrices(bpMap);
        }
      } else {
        setBranchPrices({});
      }
    } catch (err) {
      console.error('Error loading menu items for POS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMenuItems(); }, [selectedBranch]);

  const getSaleForPrinting = async (saleId: string) => {
    if (!isOnline || saleId.startsWith('OFF-') || (saleId && saleId.length < 36)) {
      const queue = await getOfflineSalesQueue();
      const offlineSale = queue.find(s => s.id === saleId || s.control_number === saleId);
      if (offlineSale) {
        return {
          id: offlineSale.id,
          control_number: offlineSale.control_number,
          branch_id: offlineSale.branch_id,
          cashier_id: offlineSale.cashier_id,
          total_amount: Number(offlineSale.total_amount),
          status: 'completed',
          created_at: offlineSale.created_at,
          sale_category: offlineSale.sale_category,
          reference_number: offlineSale.reference_number,
          branch_name: selectedBranch?.name || 'Main Branch',
          cashier_email: offlineSale.cashier_email,
          queue_number: offlineSale.queue_number || null,
          queue_status: offlineSale.queue_status || null,
          items: offlineSale.items.map((item, idx) => ({
            id: String(idx),
            quantity: item.quantity,
            unit_price: item.price || 0,
            subtotal: (item.price || 0) * item.quantity,
            item_name: item.name || 'Unknown Item',
            sku: ''
          }))
        };
      }
    }

    const { data: saleData, error: saleError } = await supabase
      .from('sales')
      .select(`
        id,
        control_number,
        branch_id,
        cashier_id,
        total_amount,
        status,
        created_at,
        sale_category,
        reference_number,
        queue_number,
        queue_status,
        branches (name),
        sale_items (
          id,
          quantity,
          unit_price,
          subtotal,
          menu_items (name, sku)
        )
      `)
      .eq('id', saleId)
      .single();

    if (saleError || !saleData) {
      const queue = await getOfflineSalesQueue();
      const offlineSale = queue.find(s => s.id === saleId || s.control_number === saleId);
      if (offlineSale) {
        return {
          id: offlineSale.id,
          control_number: offlineSale.control_number,
          branch_id: offlineSale.branch_id,
          cashier_id: offlineSale.cashier_id,
          total_amount: Number(offlineSale.total_amount),
          status: 'completed',
          created_at: offlineSale.created_at,
          sale_category: offlineSale.sale_category,
          reference_number: offlineSale.reference_number,
          branch_name: selectedBranch?.name || 'Main Branch',
          cashier_email: offlineSale.cashier_email,
          queue_number: offlineSale.queue_number || null,
          queue_status: offlineSale.queue_status || null,
          items: offlineSale.items.map((item, idx) => ({
            id: String(idx),
            quantity: item.quantity,
            unit_price: item.price || 0,
            subtotal: (item.price || 0) * item.quantity,
            item_name: item.name || 'Unknown Item',
            sku: ''
          }))
        };
      }
      throw saleError || new Error('Sale data not found');
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', saleData.cashier_id)
      .single();

    return {
      id: saleData.id,
      control_number: saleData.control_number || null,
      branch_id: saleData.branch_id,
      cashier_id: saleData.cashier_id,
      total_amount: Number(saleData.total_amount),
      status: saleData.status,
      created_at: saleData.created_at,
      sale_category: saleData.sale_category || 'Dine in',
      reference_number: saleData.reference_number || '',
      queue_number: saleData.queue_number || null,
      queue_status: saleData.queue_status || null,
      branch_name: (Array.isArray(saleData.branches) ? saleData.branches[0]?.name : (saleData.branches as any)?.name) || selectedBranch?.name || 'Main Branch',
      cashier_email: profileData?.email || profile?.email || 'System',
      items: (saleData.sale_items || []).map((si: any) => ({
        id: si.id,
        quantity: Number(si.quantity),
        unit_price: Number(si.unit_price),
        subtotal: Number(si.subtotal),
        item_name: si.menu_items?.name || 'Unknown Dish',
        sku: si.menu_items?.sku || ''
      }))
    };
  };

  const handlePrintThermal = async (saleResult: any) => {
    try {
      await ensureBluetoothPrinter();
      const mappedSale = {
        id: saleResult.id,
        control_number: saleResult.control_number || saleResult.id.substring(0, 8),
        branch_name: saleResult.branch_name,
        cashier_email: saleResult.cashier_email,
        total_amount: saleResult.total_amount,
        created_at: saleResult.created_at,
        sale_category: saleResult.sale_category || 'Dine in',
        reference_number: saleResult.reference_number || '',
        queue_number: saleResult.queue_number,
        items: saleResult.items
      };
      const settings = await settingsService.getSettings();
      await printBluetoothThermalInvoice(mappedSale, settings.sales_invoice);
    } catch (err) {
      console.error('Failed to load and print thermal invoice:', err);
      showError('Failed to print receipt. Please reprint from Sales History.');
    }
  };

  const handlePrintKitchen = async (saleResult: any) => {
    try {
      await ensureBluetoothPrinter();
      const mappedSale = {
        id: saleResult.id,
        control_number: saleResult.control_number || saleResult.id.substring(0, 8),
        branch_name: saleResult.branch_name,
        cashier_email: saleResult.cashier_email,
        total_amount: saleResult.total_amount,
        created_at: saleResult.created_at,
        sale_category: saleResult.sale_category || 'Dine in',
        reference_number: saleResult.reference_number || '',
        queue_number: saleResult.queue_number,
        items: saleResult.items
      };
      await printBluetoothKitchenReceipt(mappedSale);
    } catch (err) {
      console.error('Failed to load and print kitchen receipt:', err);
      showError('Failed to print kitchen receipt.');
    }
  };

  const handlePrintQueue = async (saleId: string) => {
    try {
      const mappedSale = await getSaleForPrinting(saleId);
      const settings = await settingsService.getSettings();
      printQueueNumberTicket(mappedSale, settings.sales_invoice);
    } catch (err) {
      console.error('Failed to load and print queue ticket:', err);
      showError('Failed to print queue ticket.');
    }
  };

  // ─── Cart Helpers ──────────────────────────────────────────

  const getItemPrice = (item: MenuItem, channel: PriceChannel = priceChannel): number => {
    const bp = branchPrices[item.id];
    if (channel === 'foodpanda') {
      if (bp?.foodpanda_price && bp.foodpanda_price > 0) return bp.foodpanda_price;
      if (item.foodpanda_price && Number(item.foodpanda_price) > 0) return Number(item.foodpanda_price);
    }
    if (channel === 'grab') {
      if (bp?.grab_price && bp.grab_price > 0) return bp.grab_price;
      if (item.grab_price && Number(item.grab_price) > 0) return Number(item.grab_price);
    }
    if (bp?.price && bp.price > 0) return bp.price;
    return Number(item.price);
  };

  useEffect(() => {
    if (cart.length > 0) {
      setCart(prev =>
        prev.map(ci => {
          const item = items.find(i => i.id === ci.menu_item_id);
          if (!item) return ci;
          const newPrice = getItemPrice(item, priceChannel);
          return { ...ci, price: newPrice };
        })
      );
    }
  }, [priceChannel]);

  const addToCart = (item: MenuItem, qty = 1) => {
    if (!activeSession || activeSession.status !== 'open') {
      showError('Please open your register session before processing sales.');
      setOpenSessionOpen(true);
      return;
    }
    const unitPrice = getItemPrice(item);
    setCart(prev => {
      const exists = prev.find(ci => ci.menu_item_id === item.id);
      if (exists) {
        return prev.map(ci =>
          ci.menu_item_id === item.id ? { ...ci, quantity: ci.quantity + qty } : ci
        );
      }
      return [...prev, { menu_item_id: item.id, name: item.name, price: unitPrice, quantity: qty }];
    });
    showSuccess(`${qty}× ${item.name} added to cart (${priceChannel === 'standard' ? 'Standard' : priceChannel === 'foodpanda' ? 'Foodpanda' : 'Grab'}).`);
  };

  const updateCartQty = (menuItemId: string, amount: number) => {
    if (!activeSession || activeSession.status !== 'open') {
      showError('Please open your register session before processing sales.');
      setOpenSessionOpen(true);
      return;
    }
    setCart(prev =>
      prev
        .map(ci => {
          if (ci.menu_item_id !== menuItemId) return ci;
          const newQty = ci.quantity + amount;
          return newQty > 0 ? { ...ci, quantity: newQty } : null;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (menuItemId: string) =>
    setCart(prev => prev.filter(ci => ci.menu_item_id !== menuItemId));

  // ─── Checkout ─────────────────────────────────────────────

  const openPayment = () => {
    if (cart.length === 0) return;
    if (!selectedBranch) {
      showError('Please select an active branch context from the sidebar.');
      return;
    }
    if (!activeSession || activeSession.status !== 'open') {
      showError('Please open your register session before processing sales.');
      setOpenSessionOpen(true);
      return;
    }
    if (!isOnline && !terminalConfig) {
      showError('You are offline. To transact offline, this browser device must first be registered as a POS Terminal in Settings.');
      return;
    }
    setLastSaleResult(null);
    setPaymentOpen(true);
  };

  const handleConfirmPayment = async (method: PaymentMethod, tendered: number | null, saleCategory: string, referenceNumber: string, queueNumber: string, subStoreId: string | null = null) => {
    if (!selectedBranch) return;
    setCheckingOut(true);

    try {
      const payload = cart.map(ci => ({ 
        menu_item_id: ci.menu_item_id, 
        quantity: ci.quantity,
        name: ci.name,
        price: ci.price
      }));

      // Resolve final subStoreId (dialog selection overrides header selection)
      const finalSubStoreId = subStoreId || selectedSubStore?.id || null;

      if (isOnline) {
        const { data: saleId, error } = await supabase.rpc('fn_process_sale', {
          p_branch_id:        selectedBranch.id,
          p_items:            payload.map(p => ({ menu_item_id: p.menu_item_id, quantity: p.quantity, price: p.price })),
          p_payment_method:   method,
          p_amount_tendered:  tendered,
          p_sale_category:    saleCategory,
          p_reference_number: referenceNumber,
          p_queue_number:     queueNumber || null,
          p_sub_store_id:     finalSubStoreId,
        });

        if (error) throw error;

        const change = method === 'cash' && tendered ? tendered - cartTotal : 0;

        setLastSaleResult({
          id: saleId as string,
          change,
          method,
          sale_category: saleCategory,
          reference_number: referenceNumber,
          queue_number: queueNumber || null,
          items: payload.map((p, idx) => ({
            id: String(idx),
            quantity: p.quantity,
            unit_price: p.price,
            subtotal: p.price * p.quantity,
            item_name: p.name,
            sku: ''
          })),
          branch_name: selectedBranch.name,
          cashier_email: profile?.email || 'System',
          total_amount: cartTotal,
          created_at: new Date().toISOString()
        });
        setCart([]);
        setPaymentOpen(false);
        setIsCartSheetOpen(false);

        showSuccess(
          method === 'cash' && change > 0
            ? `Sale completed! Change due: ${formatPHP(change)}`
            : 'Transaction recorded successfully.'
        );
      } else {
        if (!terminalConfig) throw new Error('No terminal configuration found.');

        const offlineSale = await enqueueOfflineSale({
          branch_id: selectedBranch.id,
          sub_store_id: finalSubStoreId || undefined,
          cashier_id: profile?.id || '',
          cashier_email: profile?.email || '',
          payment_method: method,
          amount_tendered: tendered,
          sale_category: saleCategory,
          reference_number: referenceNumber,
          items: payload,
          total_amount: cartTotal,
          queue_number: queueNumber || undefined,
          queue_status: queueNumber ? 'preparing' : undefined
        } as any);

        const change = method === 'cash' && tendered ? tendered - cartTotal : 0;

        setLastSaleResult({
          id: offlineSale.id,
          change,
          method,
          sale_category: saleCategory,
          reference_number: referenceNumber,
          control_number: offlineSale.control_number,
          queue_number: queueNumber || null,
          items: offlineSale.items.map((item, idx) => ({
            id: String(idx),
            quantity: item.quantity,
            unit_price: item.price || 0,
            subtotal: (item.price || 0) * item.quantity,
            item_name: item.name || 'Unknown Item',
            sku: ''
          })),
          branch_name: selectedBranch.name,
          cashier_email: profile?.email || 'System',
          total_amount: cartTotal,
          created_at: new Date().toISOString()
        });

        setCart([]);
        setPaymentOpen(false);
        setIsCartSheetOpen(false);

        const queue = await getOfflineSalesQueue();
        setPendingSyncCount(queue.length);

        showSuccess(`Offline checkout recorded! Receipt Serial: ${offlineSale.control_number}`);
      }
    } catch (err: any) {
      console.error('POS Checkout failed:', err);
      showError(err.message || 'Rolled back — insufficient ingredient stock.');
    } finally {
      setCheckingOut(false);
    }
  };

  // ─── Derived State ─────────────────────────────────────────

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(items.map(i => i.category)))],
    [items]
  );

  const filteredItems = useMemo(
    () =>
      items.filter(item => {
        const q = searchTerm.toLowerCase();
        return (
          (item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)) &&
          (selectedCategory === 'All' || item.category === selectedCategory)
        );
      }),
    [items, searchTerm, selectedCategory]
  );

  // ─── Cart Panel (shared desktop + sheet) ──────────────────

  const renderCartContent = () => (
    <>
      {/* Header */}
      <div className="p-4 md:p-6 border-b flex items-center space-x-3 bg-background shrink-0">
        <ShoppingCart className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-sm uppercase tracking-wider flex-1">Order Cart</h3>
        <Badge variant="default" className="text-[10px]">{cartCount} Items</Badge>
      </div>

      {/* Items */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {cart.map(item => (
            <Card key={item.menu_item_id} className="bg-background/60 backdrop-blur-sm shadow-sm">
              <CardContent className="p-3 flex items-center justify-between text-xs">
                <div className="flex-1 min-w-0 pr-2">
                  <h5 className="font-bold truncate" title={item.name}>{item.name}</h5>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatPHP(item.price)} each</p>
                </div>
                <div className="flex items-center space-x-1">
                  <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateCartQty(item.menu_item_id, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="font-bold px-1 w-5 text-center select-none">{item.quantity}</span>
                  <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateCartQty(item.menu_item_id, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 ml-1 text-muted-foreground hover:text-destructive"
                    onClick={() => removeFromCart(item.menu_item_id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <span className="font-black text-xs ml-2 text-primary min-w-[52px] text-right">
                  {formatPHP(item.price * item.quantity)}
                </span>
              </CardContent>
            </Card>
          ))}

          {cart.length === 0 && !lastSaleResult && (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 mt-10">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <ShoppingCart className="w-5 h-5 opacity-50" />
              </div>
              <p className="text-sm font-medium">Your cart is empty</p>
              <p className="text-xs mt-1">Tap {vocab.itemUnitPlural} on the catalog to add them.</p>
            </div>
          )}

          {/* Empty cart indicator or checkout success logic removed from here as we use a modal now */}
        </div>
      </ScrollArea>

      {/* Checkout Summary */}
      <div className="p-4 md:p-6 border-t bg-background space-y-4 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.04)]">
        {/* Line items subtotal */}
        {cart.length > 0 && (
          <div className="space-y-1">
            {cart.map(ci => (
              <div key={ci.menu_item_id} className="flex justify-between text-xs text-muted-foreground">
                <span>{ci.name} × {ci.quantity}</span>
                <span>{formatPHP(ci.price * ci.quantity)}</span>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="flex justify-between items-center text-base font-bold">
          <span>Total</span>
          <span className="text-primary text-xl">{formatPHP(cartTotal)}</span>
        </div>

        {!selectedBranch && (
          <div className="text-[10px] text-amber-500 text-center font-medium bg-amber-500/10 p-2 rounded border border-amber-500/20">
            ⚠️ No branch context — cannot checkout without an assigned branch.
          </div>
        )}

        {!isOnline && (
          <div className={`flex items-center gap-2 text-[10px] font-medium p-2 rounded border ${
            terminalConfig 
              ? 'text-amber-500 bg-amber-500/10 border-amber-500/20' 
              : 'text-destructive bg-destructive/10 border-destructive/20'
          }`}>
            <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
            {terminalConfig 
              ? `Offline Mode Active — Sales will queue locally under ${terminalConfig.terminal_code} and sync automatically.`
              : 'Offline — Connection lost and device is not registered. Transactions are disabled.'}
          </div>
        )}

        <Button
          size="lg"
          className="w-full font-bold shadow-md"
          onClick={openPayment}
          disabled={checkingOut || cart.length === 0 || !selectedBranch || (!isOnline && !terminalConfig)}
        >
          {checkingOut ? 'Processing…' : 'Charge & Collect Payment'}
        </Button>
      </div>
    </>
  );

  // ─── Render ────────────────────────────────────────────────

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full relative">
        {/* Menu / Catalog Panel */}
        <div className="flex-1 flex flex-col p-4 md:p-8 overflow-y-auto pb-48 lg:pb-8">
          {/* Header */}
          <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
            <div>
              <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
                <ShoppingCart className="w-8 h-8 text-primary" />
                <span>{vocab.posTitle}</span>
              </h2>
              <p className="text-muted-foreground">
                {vocab.posDescription}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Pricing Channel Selector */}
              <div className="flex items-center bg-muted/60 p-1 rounded-lg border border-border/40">
                <button
                  type="button"
                  onClick={() => setPriceChannel('standard')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                    priceChannel === 'standard'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setPriceChannel('foodpanda')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                    priceChannel === 'foodpanda'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-amber-500 hover:bg-amber-500/10'
                  }`}
                >
                  Foodpanda
                </button>
                <button
                  type="button"
                  onClick={() => setPriceChannel('grab')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                    priceChannel === 'grab'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-emerald-500 hover:bg-emerald-500/10'
                  }`}
                >
                  Grab
                </button>
              </div>
              {selectedBranch && (
                <Badge variant="outline" className="px-3.5 py-1.5 text-xs font-semibold bg-primary/10 text-primary border-primary/20">
                  Checkout: <span className="underline font-bold ml-1">{selectedBranch.name}</span>
                </Badge>
              )}

              {/* Connection Status Badge */}
              <Badge 
                variant="outline" 
                className={`px-3 py-1 text-xs font-bold flex items-center gap-1.5 ${
                  isOnline 
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400' 
                    : 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400 animate-pulse'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {isOnline ? 'Online' : 'Offline Mode'}
              </Badge>

              {/* Offline Pending Sync Count Indicator */}
              {pendingSyncCount > 0 && (
                <Badge 
                  variant="default" 
                  className={`px-3 py-1 text-xs font-bold flex items-center gap-1.5 ${
                    isSyncing ? 'bg-indigo-600 animate-pulse text-white' : 'bg-amber-500 text-white'
                  }`}
                  title={isSyncing ? 'Syncing transactions to cloud...' : 'Pending offline sales to sync'}
                >
                  {isSyncing ? (
                    <>
                      <Spinner className="w-3.5 h-3.5 animate-spin" />
                      Syncing {pendingSyncCount}...
                    </>
                  ) : (
                    <>
                      <span>⚠️ {pendingSyncCount} Offline Queue</span>
                    </>
                  )}
                </Badge>
              )}

              {/* Sub-Store Selector */}
              {selectedBranch && subStores.length > 0 && (
                <Select
                  value={selectedSubStore?.id || 'parent'}
                  onValueChange={(val) => {
                    if (val === 'parent') {
                      setSelectedSubStore(null);
                    } else {
                      const ss = subStores.find(s => s.id === val);
                      setSelectedSubStore(ss || null);
                    }
                  }}
                >
                  <SelectTrigger className="w-[180px] text-xs h-8 bg-background">
                    <SelectValue placeholder="Attribution Store" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="parent" className="text-xs font-semibold">
                      {selectedBranch.name} (Parent)
                    </SelectItem>
                    {subStores.map((ss) => (
                      <SelectItem key={ss.id} value={ss.id} className="text-xs">
                        {ss.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {selectedBranch && (
                sessionLoading ? (
                  <Button variant="outline" size="sm" className="h-8 text-xs font-bold gap-1.5" disabled>
                    Loading Session...
                  </Button>
                ) : activeSession ? (
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateXRead}
                      className="h-8 text-xs font-bold gap-1.5 border-amber-500/30 hover:bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      title="Generate X-Read (Mid-Shift Report)"
                    >
                      X-Read
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setActualCashStr('');
                        setZReadOpen(true);
                      }}
                      className="h-8 text-xs font-bold gap-1.5"
                      title="Close Drawer & Z-Read"
                    >
                      Close Shift (Z)
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setOpenSessionOpen(true)}
                    className="h-8 text-xs font-bold gap-1.5 bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
                    title="Open Cash Drawer to Start Checkout"
                  >
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    Open Shift
                  </Button>
                )
              )}

              {/* Customer Display Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={openCustomerDisplay}
                className="h-8 text-xs font-bold gap-1.5 border-primary/30 hover:bg-primary/10 text-primary"
                title="Open Customer-Facing Display"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Customer Screen
              </Button>

              {/* Fullscreen Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={toggleFullscreen}
                className={`h-8 text-xs font-bold gap-1.5 ${isFullscreen ? 'bg-primary/10 text-primary border-primary/30' : ''}`}
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              >
                {isFullscreen ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L3 3m0 0l2 5M3 3l5 2m6 4l6-6m0 0l-5 2m5-2l-2 5M9 15l-6 6m0 0l5-2m-5 2l-2-5m13-1l6 6m0 0l-2-5m2 5l-5-2" />
                    </svg>
                    Exit Full
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
                    </svg>
                    Fullscreen
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={`Search ${vocab.itemUnit} name or SKU…`}
                className="pl-9"
              />
            </div>
            <div className="flex space-x-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
              {categories.map(cat => (
                <Button
                  key={cat}
                  variant={selectedCategory === cat ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(cat)}
                  className="whitespace-nowrap"
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-muted-foreground animate-pulse">Loading menu items…</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 flex-1 content-start">
              {filteredItems.map(item => (
                <Card
                  key={item.id}
                  onClick={() => addToCart(item, 1)}
                  className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group flex flex-col justify-between h-36"
                >
                  <CardContent className="p-4 flex flex-col h-full justify-between">
                    <div>
                      <Badge variant="secondary" className="text-[9px] uppercase mb-1">{item.category}</Badge>
                      <h4 className="text-sm font-bold group-hover:text-primary transition-colors line-clamp-2">{item.name}</h4>
                      <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block">{item.sku}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold">{formatPHP(getItemPrice(item))}</span>
                        {priceChannel !== 'standard' && (
                          <span className={`text-[9px] font-semibold ${priceChannel === 'foodpanda' ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {priceChannel === 'foodpanda' ? 'Foodpanda' : 'Grab'} Price
                          </span>
                        )}
                      </div>
                      <Button variant="secondary" size="sm" className="h-7 text-xs font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                        Add
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {filteredItems.length === 0 && (
                <div className="col-span-full text-center p-8 text-muted-foreground">
                  No active {vocab.itemUnitPlural} found matching criteria.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop Cart Panel */}
        <div className="hidden lg:flex w-96 border-l bg-muted/10 flex-col h-full shrink-0">
          {renderCartContent()}
        </div>

        {/* Mobile Cart Floating Bottom Bar */}
        <div className={`lg:hidden fixed ${isFullscreen ? 'bottom-4 md:bottom-0' : 'bottom-[104px] md:bottom-0'} left-4 right-4 md:left-0 md:right-0 p-4 bg-background border md:border-x-0 md:border-b-0 md:border-t rounded-2xl md:rounded-none shadow-lg flex justify-between items-center z-40`}>
          <div>
            <p className="text-xs text-muted-foreground font-semibold">Total ({cartCount} items)</p>
            <p className="text-lg font-bold text-primary">{formatPHP(cartTotal)}</p>
          </div>
          <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
            <SheetTrigger asChild>
              <Button size="lg" className="font-bold shadow-md relative">
                View Cart
                {cart.length > 0 && (
                  <span className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-background">
                    {cartCount}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[90vw] sm:w-[400px] p-0 gap-0 flex flex-col bg-muted/10">
              <SheetTitle className="sr-only">Order Cart</SheetTitle>
              <SheetDescription className="sr-only">Review your items and collect payment</SheetDescription>
              {renderCartContent()}
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Payment Dialog */}
      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        cartTotal={cartTotal}
        onConfirm={handleConfirmPayment}
        processing={checkingOut}
        onStateChange={setPaymentState}
        saleCategories={vocab.saleCategories}
        defaultSaleCategory={priceChannel === 'foodpanda' ? 'FoodPanda' : priceChannel === 'grab' ? 'GrabFood' : vocab.defaultSaleCategory}
        subStores={subStores}
        initialSubStore={selectedSubStore}
      />


      {/* Sale Success / Print Invoice Modal */}
      <Dialog open={!!lastSaleResult} onOpenChange={(open) => { if (!open) setLastSaleResult(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-6 h-6" />
              <DialogTitle className="text-xl font-bold">Sale Completed!</DialogTitle>
            </div>
            <DialogDescription className="text-xs">
              Transaction has been recorded successfully.
            </DialogDescription>
          </DialogHeader>

          {lastSaleResult && (
            <div className="space-y-4 py-4">
              <div className="bg-muted/50 p-4 rounded-lg space-y-2 border">
                {lastSaleResult.control_number && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Invoice Serial</span>
                    <span className="font-mono font-bold text-foreground">{lastSaleResult.control_number}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Transaction ID</span>
                  <span className="font-mono">{lastSaleResult.id.length === 36 ? `${lastSaleResult.id.slice(0, 8)}...` : lastSaleResult.id}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Payment Method</span>
                  <span className="font-bold text-foreground">{PAYMENT_LABELS[lastSaleResult.method as PaymentMethod]}</span>
                </div>

                {lastSaleResult.sale_category && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Sale Category</span>
                    <span className="font-bold text-foreground">{lastSaleResult.sale_category}</span>
                  </div>
                )}

                {lastSaleResult.reference_number && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Reference Number</span>
                    <span className="font-mono text-foreground">{lastSaleResult.reference_number}</span>
                  </div>
                )}

                {lastSaleResult.queue_number && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Queue / Order / Table #</span>
                    <span className="font-bold text-foreground">{lastSaleResult.queue_number}</span>
                  </div>
                )}
                
                {lastSaleResult.method === 'cash' && lastSaleResult.change > 0 && (
                  <>
                    <Separator className="my-2" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-muted-foreground">Change Due</span>
                      <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                        {formatPHP(lastSaleResult.change)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-col gap-2 w-full sm:flex-col sm:space-x-0">
            <div className={isRestaurant ? "grid grid-cols-2 gap-2 w-full" : "w-full"}>
              {isRestaurant && (
                <Button
                  variant="secondary"
                  className="w-full font-bold"
                  onClick={async () => {
                    if (lastSaleResult) {
                      try {
                        await ensureBluetoothPrinter();
                        await handlePrintKitchen(lastSaleResult);
                      } catch (err: any) {
                        console.error('Kitchen Print failed:', err);
                      }
                    }
                  }}
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print Kitchen
                </Button>
              )}
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={async () => {
                  if (lastSaleResult) {
                    try {
                      await ensureBluetoothPrinter();
                      await handlePrintThermal(lastSaleResult);
                    } catch (err: any) {
                      console.error('Thermal Print failed:', err);
                    }
                  }
                }}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print Receipt
              </Button>
            </div>
            {lastSaleResult?.queue_number && (
              <Button
                variant="outline"
                className="w-full font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-400 dark:hover:bg-indigo-950/20"
                onClick={() => {
                  if (lastSaleResult) {
                    handlePrintQueue(lastSaleResult.id);
                  }
                }}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print Queue Ticket
              </Button>
            )}
            <Button variant="outline" onClick={() => setLastSaleResult(null)} className="w-full">
              Close (New Sale)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Open Session Dialog ─── */}
      <Dialog open={openSessionOpen} onOpenChange={setOpenSessionOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight">Open Cash Drawer Shift</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Input the opening cash float balance for your register drawer before starting sales.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase font-semibold">Opening Cash Float (₱) *</Label>
              <Input
                type="number"
                step="0.01"
                required
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="e.g. 1000.00"
                className="font-bold text-lg"
              />
              <p className="text-[10px] text-muted-foreground">
                This is the initial cash float used for cashier change at the start of your shift.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSessionOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleOpenSession}
              disabled={!openingBalance || Number(openingBalance) < 0}
              className="font-bold"
            >
              Open Register Drawer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── X-Read Report Dialog ─── */}
      <Dialog open={xReadOpen} onOpenChange={setXReadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight">X-Read Report (Mid-Shift Status)</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Non-resetting audit report summarizing current transactions in this shift session.
            </DialogDescription>
          </DialogHeader>

          {sessionSummary && (
            <div className="space-y-4 py-2">
              <div className="border rounded-md p-4 bg-muted/30 font-mono text-xs space-y-1.5 max-h-[50vh] overflow-y-auto">
                <div className="text-center font-bold uppercase">{selectedBranch?.name || 'TERMINAL'}</div>
                <div className="text-center text-[10px] text-muted-foreground">X-READ SUMMARY</div>
                <div className="border-t border-dashed my-2" />
                <div className="flex justify-between"><span>Status:</span><span>{sessionSummary.status?.toUpperCase()}</span></div>
                <div className="flex justify-between"><span>Z-Counter:</span><span>#{String(sessionSummary.zCounter || 0).padStart(5, '0')}</span></div>
                <div className="flex justify-between"><span>Opened At:</span><span>{new Date(sessionSummary.openedAt).toLocaleString()}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">LIFETIME GRAND TOTALS</div>
                <div className="flex justify-between"><span>Start:</span><span>{formatPHP(sessionSummary.grandTotalStart)}</span></div>
                <div className="flex justify-between"><span>Current:</span><span>{formatPHP(sessionSummary.grandTotalEnd)}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">SALES SUMMARY</div>
                <div className="flex justify-between"><span>Gross Sales:</span><span>{formatPHP(sessionSummary.grossSales)}</span></div>
                <div className="flex justify-between"><span>Net Sales (Ex-VAT):</span><span>{formatPHP(sessionSummary.netSales)}</span></div>
                <div className="flex justify-between"><span>VAT Amount (12%):</span><span>{formatPHP(sessionSummary.vatAmount)}</span></div>
                <div className="flex justify-between"><span>Transaction Count:</span><span>{sessionSummary.transactionCount}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">PAYMENT BREAKDOWN</div>
                <div className="flex justify-between"><span>Cash:</span><span>{formatPHP(sessionSummary.cashSales)}</span></div>
                <div className="flex justify-between"><span>GCash:</span><span>{formatPHP(sessionSummary.gcashSales)}</span></div>
                <div className="flex justify-between"><span>Maya:</span><span>{formatPHP(sessionSummary.mayaSales)}</span></div>
                <div className="flex justify-between"><span>Card:</span><span>{formatPHP(sessionSummary.cardSales)}</span></div>
                <div className="flex justify-between"><span>Other:</span><span>{formatPHP(sessionSummary.otherSales)}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">SALES CHANNEL BREAKDOWN</div>
                <div className="flex justify-between"><span>Dine-in / Store:</span><span>{formatPHP(sessionSummary.dineInSales || 0)}</span></div>
                <div className="flex justify-between"><span>Take-out:</span><span>{formatPHP(sessionSummary.takeOutSales || 0)}</span></div>
                <div className="flex justify-between text-amber-500 font-bold"><span>FoodPanda:</span><span>{formatPHP(sessionSummary.foodpandaSales || 0)}</span></div>
                <div className="flex justify-between text-emerald-500 font-bold"><span>GrabFood:</span><span>{formatPHP(sessionSummary.grabSales || 0)}</span></div>
                {sessionSummary.otherChannelSales > 0 && (
                  <div className="flex justify-between"><span>Other Channels:</span><span>{formatPHP(sessionSummary.otherChannelSales)}</span></div>
                )}
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">VOIDS & REFUNDS</div>
                <div className="flex justify-between"><span>Void Count:</span><span>{sessionSummary.voidCount}</span></div>
                <div className="flex justify-between"><span>Void Amount:</span><span>{formatPHP(sessionSummary.voidAmount)}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">DRAWER FLOW</div>
                <div className="flex justify-between"><span>Opening Float:</span><span>{formatPHP(sessionSummary.openingBalance)}</span></div>
                <div className="flex justify-between"><span>Expected Cash:</span><span>{formatPHP(sessionSummary.cashSales)}</span></div>
                <div className="flex justify-between font-bold"><span>Expected Drawer:</span><span>{formatPHP(sessionSummary.openingBalance + sessionSummary.cashSales)}</span></div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setXReadOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => printXZReport(sessionSummary, false, selectedBranch?.name || 'TERMINAL')}
              className="font-bold gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Print X-Read Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Z-Read Close Shift Dialog ─── */}
      <Dialog open={zReadOpen} onOpenChange={setZReadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight">Close Drawer & Run Z-Read</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              End cashier session. This locks the terminal, runs a Z-Read report, and resets session counters.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase font-semibold">Actual Cash Counted (₱) *</Label>
              <Input
                type="number"
                step="0.01"
                required
                value={actualCashStr}
                onChange={(e) => setActualCashStr(e.target.value)}
                placeholder="Count all paper cash and coins in drawer..."
                className="font-bold text-lg text-primary border-primary/30"
              />
              <p className="text-[10px] text-muted-foreground">
                Enter the exact cash amount inside the physical drawer (including the initial cash float).
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setZReadOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleCloseSession}
              disabled={!actualCashStr || Number(actualCashStr) < 0}
              className="font-bold font-mono"
            >
              Confirm Z-Read & Close Shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Closed Z-Report View Dialog ─── */}
      <Dialog open={!!viewingClosedSummary} onOpenChange={(v) => { if (!v) setViewingClosedSummary(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold tracking-tight text-destructive">Z-Read Shift Closed Report</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Official shift summary. This terminal session is now locked.
            </DialogDescription>
          </DialogHeader>

          {viewingClosedSummary && (
            <div className="space-y-4 py-2">
              <div className="border border-destructive/20 rounded-md p-4 bg-muted/30 font-mono text-xs space-y-1.5 max-h-[50vh] overflow-y-auto">
                <div className="text-center font-bold uppercase">{selectedBranch?.name || 'TERMINAL'}</div>
                <div className="text-center text-[10px] text-destructive font-bold">Z-READ CLOSED REPORT</div>
                <div className="border-t border-dashed my-2" />
                <div className="flex justify-between"><span>Status:</span><span className="font-bold text-destructive">{viewingClosedSummary.status?.toUpperCase()}</span></div>
                <div className="flex justify-between"><span>Z-Counter:</span><span className="font-bold text-destructive">#{String(viewingClosedSummary.zCounter || 0).padStart(5, '0')}</span></div>
                <div className="flex justify-between"><span>Opened At:</span><span>{new Date(viewingClosedSummary.openedAt).toLocaleString()}</span></div>
                <div className="flex justify-between"><span>Closed At:</span><span>{new Date(viewingClosedSummary.closedAt).toLocaleString()}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">LIFETIME GRAND TOTALS</div>
                <div className="flex justify-between"><span>Start:</span><span>{formatPHP(viewingClosedSummary.grandTotalStart)}</span></div>
                <div className="flex justify-between"><span>End:</span><span>{formatPHP(viewingClosedSummary.grandTotalEnd)}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">SALES SUMMARY</div>
                <div className="flex justify-between"><span>Gross Sales:</span><span>{formatPHP(viewingClosedSummary.grossSales)}</span></div>
                <div className="flex justify-between"><span>Net Sales (Ex-VAT):</span><span>{formatPHP(viewingClosedSummary.netSales)}</span></div>
                <div className="flex justify-between"><span>VAT Amount (12%):</span><span>{formatPHP(viewingClosedSummary.vatAmount)}</span></div>
                <div className="flex justify-between"><span>Transaction Count:</span><span>{viewingClosedSummary.transactionCount}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">PAYMENT BREAKDOWN</div>
                <div className="flex justify-between"><span>Cash:</span><span>{formatPHP(viewingClosedSummary.cashSales)}</span></div>
                <div className="flex justify-between"><span>GCash:</span><span>{formatPHP(viewingClosedSummary.gcashSales)}</span></div>
                <div className="flex justify-between"><span>Maya:</span><span>{formatPHP(viewingClosedSummary.mayaSales)}</span></div>
                <div className="flex justify-between"><span>Card:</span><span>{formatPHP(viewingClosedSummary.cardSales)}</span></div>
                <div className="flex justify-between"><span>Other:</span><span>{formatPHP(viewingClosedSummary.otherSales)}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">SALES CHANNEL BREAKDOWN</div>
                <div className="flex justify-between"><span>Dine-in / Store:</span><span>{formatPHP(viewingClosedSummary.dineInSales || 0)}</span></div>
                <div className="flex justify-between"><span>Take-out:</span><span>{formatPHP(viewingClosedSummary.takeOutSales || 0)}</span></div>
                <div className="flex justify-between text-amber-500 font-bold"><span>FoodPanda:</span><span>{formatPHP(viewingClosedSummary.foodpandaSales || 0)}</span></div>
                <div className="flex justify-between text-emerald-500 font-bold"><span>GrabFood:</span><span>{formatPHP(viewingClosedSummary.grabSales || 0)}</span></div>
                {viewingClosedSummary.otherChannelSales > 0 && (
                  <div className="flex justify-between"><span>Other Channels:</span><span>{formatPHP(viewingClosedSummary.otherChannelSales)}</span></div>
                )}
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">VOIDS & REFUNDS</div>
                <div className="flex justify-between"><span>Void Count:</span><span>{viewingClosedSummary.voidCount}</span></div>
                <div className="flex justify-between"><span>Void Amount:</span><span>{formatPHP(viewingClosedSummary.voidAmount)}</span></div>
                <div className="border-t border-dashed my-2" />
                <div className="font-bold text-center">DRAWER FLOW & BALANCING</div>
                <div className="flex justify-between"><span>Opening Float:</span><span>{formatPHP(viewingClosedSummary.openingBalance)}</span></div>
                <div className="flex justify-between"><span>Expected Cash:</span><span>{formatPHP(viewingClosedSummary.expectedCash)}</span></div>
                <div className="flex justify-between font-bold"><span>Expected Drawer:</span><span>{formatPHP(viewingClosedSummary.openingBalance + viewingClosedSummary.expectedCash)}</span></div>
                <div className="flex justify-between text-indigo-600 dark:text-indigo-400 font-bold"><span>Actual Drawer:</span><span>{formatPHP(viewingClosedSummary.actualCash)}</span></div>
                <div className={`flex justify-between font-bold ${viewingClosedSummary.discrepancy < 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                  <span>Discrepancy:</span>
                  <span>{formatPHP(viewingClosedSummary.discrepancy)}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setViewingClosedSummary(null)}>
              Close & Lock POS
            </Button>
            <Button
              onClick={() => printXZReport(viewingClosedSummary, true, selectedBranch?.name || 'TERMINAL')}
              className="font-bold gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Print Z-Report Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
