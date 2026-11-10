import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  BackpackIcon as ShoppingCart,
  PlusIcon as Plus,
  MinusIcon as Minus,
  TrashIcon as Trash2,
  MagnifyingGlassIcon as Search,
  ExclamationTriangleIcon as WifiOff,
  ReloadIcon as Spinner,
  Cross2Icon as X,
  Pencil1Icon as Edit3,
  ChatBubbleIcon as MessageSquare,
  TableIcon,
} from '@radix-ui/react-icons';
import {
  getTerminalConfig,
  enqueueOfflineSale,
  getOfflineSalesQueue,
  dequeueOfflineSale,
} from '../lib/offlineService';
import type { TerminalConfig } from '../lib/offlineService';
import { settingsService } from '../lib/settingsService';
import { printXZReport, printQueueNumberTicket, printThermalInvoice, printKitchenReceipt, printRunningBillSlip } from '../lib/printService';
import type { RunningBillSlipData } from '../lib/printService';
import { printBluetoothThermalInvoice, printBluetoothKitchenReceipt, ensureBluetoothPrinter, printBluetoothXZReport, printBluetoothRunningBill } from '../lib/bluetoothPrinter';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { useModal } from "../contexts/ModalContext";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "./ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { useNetworkStatus } from "../hooks/use-network-status";
import { useBusinessVocab } from "../hooks/useBusinessVocab";
import { useTenant } from "../contexts/TenantContext";
import type {
  MenuItem,
  CartItem,
  ItemAvailability,
  PaymentMethod,
  PaymentState,
  LastSaleResult,
  EditingPriceItem,
  PriceChannel,
  RestaurantTable,
  PosTab,
  KitchenOrderSentPayload,
} from "./pos/types";
import {
  COMMON_ITEM_NOTES,
  formatPHP,
} from "./pos/types";
import { PaymentDialog } from "./pos/PaymentDialog";
import { TableFloorDialog } from "./pos/TableFloorDialog";
import { TabDiscountModal } from "./pos/TabDiscountModal";
import {
  MatchPriceDialog,
  SaleSuccessDialog,
  KitchenOrderSentDialog,
  BillOutDialog,
  OpenSessionDialog,
  XReadDialog,
  ZReadDialog,
  ClosedZReportDialog,
} from "./pos/POSModals";
import {
  resolveInitialPosSubStore,
  buildPosBranchPriceMap,
  resolvePosItemPrice,
} from "../lib/utils";

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
  const { showSuccess, showError, confirm } = useModal();
  const { isOnline } = useNetworkStatus();
  const vocab = useBusinessVocab();
  const { tenant } = useTenant();
  const isRestaurant = tenant?.is_restaurant ?? true;

  const [items, setItems] = useState<MenuItem[]>([]);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, ItemAvailability>>({});
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

      const storageKey = `pos_sub_store_${selectedBranch.id}`;
      const savedSubId = localStorage.getItem(storageKey);

      const targetSubStore = resolveInitialPosSubStore(
        kids,
        branches,
        savedSubId,
        profile?.branch_id,
        selectedBranch.id
      );
      setSelectedSubStore(targetSubStore);
    } else {
      setSubStores([]);
      setSelectedSubStore(null);
    }
  }, [selectedBranch?.id, branches, profile?.branch_id]);

  const handleSelectSubStore = (val: string) => {
    if (val === 'parent') {
      setSelectedSubStore(null);
      if (selectedBranch?.id) {
        localStorage.setItem(`pos_sub_store_${selectedBranch.id}`, 'parent');
      }
    } else {
      const ss = subStores.find(s => s.id === val);
      setSelectedSubStore(ss || null);
      if (selectedBranch?.id && ss) {
        localStorage.setItem(`pos_sub_store_${selectedBranch.id}`, ss.id);
      }
    }
  };

  // Cart
  const [priceChannel, setPriceChannel] = useState<PriceChannel>('standard');
  const [branchPrices, setBranchPrices] = useState<Record<string, Record<string, { price?: number; foodpanda_price?: number; grab_price?: number }>>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);

  // Payment dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastSaleResult, setLastSaleResult] = useState<LastSaleResult | null>(null);
  const [isPrintingReceiptBluetooth, setIsPrintingReceiptBluetooth] = useState(false);
  const [isPrintingKitchenBluetooth, setIsPrintingKitchenBluetooth] = useState(false);
  const [isPrintingXZBluetooth, setIsPrintingXZBluetooth] = useState(false);

  // Kitchen Notes States
  const [orderKitchenNote, setOrderKitchenNote] = useState<string>('');
  const [editingNoteItemId, setEditingNoteItemId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState<string>('');

  // Delivery Price Adjustment States (Option 3)
  const [editingPriceItem, setEditingPriceItem] = useState<EditingPriceItem | null>(null);
  const [priceAdjustmentInput, setPriceAdjustmentInput] = useState<string>('');
  const [priceAdjustmentReason, setPriceAdjustmentReason] = useState<string>('Platform Campaign Promo');

  // Table Service & Running Bills States
  const [activeTable, setActiveTable] = useState<RestaurantTable | null>(null);
  const [activeTab, setActiveTab] = useState<PosTab | null>(null);
  const [tableFloorOpen, setTableFloorOpen] = useState(false);
  const [tabDiscountOpen, setTabDiscountOpen] = useState(false);
  const [tabDiscountType, setTabDiscountType] = useState<string | null>(null);
  const [tabDiscountAmount, setTabDiscountAmount] = useState<number>(0);
  const [tabDiscountMetadata, setTabDiscountMetadata] = useState<any[]>([]);
  const [firingKitchen, setFiringKitchen] = useState(false);
  const [lastKitchenResult, setLastKitchenResult] = useState<KitchenOrderSentPayload | null>(null);
  const [lastBillOutData, setLastBillOutData] = useState<RunningBillSlipData | null>(null);
  const [isPrintingBillBluetooth, setIsPrintingBillBluetooth] = useState(false);

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
            p_branch_id: sale.branch_id,
            p_items: sale.items,
            p_payment_method: sale.payment_method,
            p_amount_tendered: sale.amount_tendered,
            p_sale_category: sale.sale_category,
            p_reference_number: sale.reference_number,
            p_control_number: sale.control_number,
            p_created_at: sale.created_at,
            p_cashier_id: sale.cashier_id,
            p_queue_number: sale.queue_number || null,
            p_sub_store_id: (sale as any).sub_store_id || null,
            p_discount_type: (sale as any).discount_type || null,
            p_discount_amount: (sale as any).discount_amount || 0,
            p_discount_metadata: (sale as any).discount_metadata || [],
            p_notes: sale.notes || (sale as any).notes || null,
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
  const [paymentState, setPaymentState] = useState<PaymentState | null>(null);

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

  const activeStore = selectedSubStore || selectedBranch;
  const rawBranchSCRate = activeStore?.service_charge_rate !== undefined && activeStore?.service_charge_rate !== null
    ? activeStore.service_charge_rate
    : (selectedBranch?.service_charge_rate !== undefined && selectedBranch?.service_charge_rate !== null ? selectedBranch.service_charge_rate : null);
  const serviceChargeRate = Number(rawBranchSCRate !== null ? rawBranchSCRate : (tenant?.default_service_charge_rate || 0));
  const isCartDineIn = priceChannel === "standard";
  const effectiveCartSCRate = isCartDineIn ? serviceChargeRate : 0;
  const serviceChargeAmount = effectiveCartSCRate > 0 ? Number((cartTotal * (effectiveCartSCRate / 100)).toFixed(2)) : 0;
  const cartTotalWithSC = Number((cartTotal + serviceChargeAmount).toFixed(2));

  const tabVatRelief = tabDiscountMetadata?.[0]?.vat_relief || 0;
  const runningTabTotalDue = Math.max(0, Number((cartTotal - tabVatRelief - tabDiscountAmount + serviceChargeAmount).toFixed(2)));
  const finalCartTotal = activeTable && tabDiscountAmount > 0 ? runningTabTotalDue : cartTotalWithSC;
  const unsentCount = cart.filter(ci => ci.kitchen_status !== 'sent').length;
  const hasUnsentItems = Boolean(activeTable && unsentCount > 0);

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
      if (selectedBranch?.enable_table_service) {
        const { data: openTabs } = await supabase
          .from('pos_tabs')
          .select('id')
          .eq('branch_id', selectedBranch.id)
          .in('status', ['open', 'billed_out']);
        if (openTabs && openTabs.length > 0) {
          const proceed = await confirm(
            'Active Tables Still Open',
            `There are currently ${openTabs.length} open table tab(s) that have not been settled. Closing this register session will finalize the Z-Read for this shift. Do you want to proceed?`
          );
          if (!proceed) return;
        }
      }

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
      applyDiscount: payState?.applyDiscount || false,
      discountType: payState?.discountType || null,
      discountAmount: payState?.discountAmount || 0,
      payableTotal: payState?.payableTotal !== undefined ? payState.payableTotal : cartTotalWithSC,
      vatRelief: payState?.vatRelief || 0,
      serviceChargeAmount: payState?.serviceChargeAmount !== undefined ? payState.serviceChargeAmount : serviceChargeAmount
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
      const buildMenuQuery = (selectCols: string) => {
        let q = supabase
          .from('menu_items')
          .select(selectCols)
          .eq('status', 'active')
          .eq('is_available', true);

        if (selectedBranch?.id) {
          q = q.or(`available_branches.is.null,available_branches.cs.{"${selectedBranch.id}"}`);
        }
        return q.order('name');
      };

      let { data, error } = await buildMenuQuery('*, inventory_items (selling_price, foodpanda_price, grab_price)');
      if (error) {
        const fallback = await buildMenuQuery('*');
        data = fallback.data;
        error = fallback.error;
      }
      if (error) throw error;

      const mappedItems: MenuItem[] = (data || []).map((raw: any) => {
        const linkedInv = Array.isArray(raw.inventory_items) ? raw.inventory_items[0] : raw.inventory_items;
        return {
          ...raw,
          linked_selling_price: linkedInv?.selling_price !== null && linkedInv?.selling_price !== undefined ? Number(linkedInv.selling_price) : null,
          linked_foodpanda_price: linkedInv?.foodpanda_price !== null && linkedInv?.foodpanda_price !== undefined ? Number(linkedInv.foodpanda_price) : null,
          linked_grab_price: linkedInv?.grab_price !== null && linkedInv?.grab_price !== undefined ? Number(linkedInv.grab_price) : null,
        };
      });
      setItems(mappedItems);

      if (selectedBranch?.id) {
        const { data: availData } = await supabase.rpc('fn_get_menu_items_availability', {
          p_branch_id: selectedBranch.id
        });
        if (availData) {
          const availMap: Record<string, ItemAvailability> = {};
          availData.forEach((row: any) => {
            availMap[row.menu_item_id] = {
              stockAvailable: typeof row.stock_available === 'boolean' ? row.stock_available : true,
              hasSufficientStock: typeof row.has_sufficient_stock === 'boolean' ? row.has_sufficient_stock : (row.stock_available ?? true),
            };
          });
          setAvailabilityMap(availMap);
        } else {
          setAvailabilityMap({});
        }

        const { data: bpData } = await supabase
          .from('item_branch_prices')
          .select('branch_id, menu_item_id, inventory_item_id, price, foodpanda_price, grab_price');

        if (bpData) {
          setBranchPrices(buildPosBranchPriceMap(bpData, mappedItems));
        }
      } else {
        setBranchPrices({});
        setAvailabilityMap({});
      }
    } catch (err) {
      console.error('Error loading menu items for POS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMenuItems(); }, [selectedBranch?.id, branches?.length]);

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
          notes: offlineSale.notes || null,
          items: offlineSale.items.map((item, idx) => ({
            id: String(idx),
            quantity: item.quantity,
            unit_price: item.price || 0,
            subtotal: (item.price || 0) * item.quantity,
            item_name: item.name || 'Unknown Item',
            sku: '',
            notes: item.notes || null
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
        notes,
        payment_method,
        amount_tendered,
        change_given,
        service_charge_rate,
        service_charge_amount,
        discount_type,
        discount_amount,
        discount_metadata,
        vatable_sales,
        vat_amount,
        vat_exempt_sales,
        branches (name),
        sale_items (
          id,
          quantity,
          unit_price,
          subtotal,
          notes,
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
          payment_method: offlineSale.payment_method || 'cash',
          amount_tendered: offlineSale.amount_tendered !== undefined && offlineSale.amount_tendered !== null ? Number(offlineSale.amount_tendered) : null,
          change_given: offlineSale.change_given !== undefined && offlineSale.change_given !== null ? Number(offlineSale.change_given) : 0,
          change: offlineSale.change_given !== undefined && offlineSale.change_given !== null ? Number(offlineSale.change_given) : 0,
          branch_name: selectedBranch?.name || 'Main Branch',
          cashier_email: offlineSale.cashier_email,
          queue_number: offlineSale.queue_number || null,
          queue_status: offlineSale.queue_status || null,
          notes: offlineSale.notes || null,
          items: offlineSale.items.map((item, idx) => ({
            id: String(idx),
            quantity: item.quantity,
            unit_price: item.price || 0,
            subtotal: (item.price || 0) * item.quantity,
            item_name: item.name || 'Unknown Item',
            sku: '',
            notes: item.notes || null
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
      notes: saleData.notes || null,
      payment_method: saleData.payment_method || 'cash',
      amount_tendered: saleData.amount_tendered !== null && saleData.amount_tendered !== undefined ? Number(saleData.amount_tendered) : null,
      change_given: saleData.change_given !== null && saleData.change_given !== undefined ? Number(saleData.change_given) : 0,
      change: saleData.change_given !== null && saleData.change_given !== undefined ? Number(saleData.change_given) : 0,
      service_charge_rate: saleData.service_charge_rate,
      service_charge_amount: saleData.service_charge_amount,
      discount_type: saleData.discount_type,
      discount_amount: saleData.discount_amount,
      discount_metadata: saleData.discount_metadata,
      vatable_sales: saleData.vatable_sales,
      vat_amount: saleData.vat_amount,
      vat_exempt_sales: saleData.vat_exempt_sales,
      branch_name: (Array.isArray(saleData.branches) ? saleData.branches[0]?.name : (saleData.branches as any)?.name) || selectedBranch?.name || 'Main Branch',
      cashier_email: profileData?.email || profile?.email || 'System',
      items: (saleData.sale_items || []).map((si: any) => ({
        id: si.id,
        quantity: Number(si.quantity),
        unit_price: Number(si.unit_price),
        subtotal: Number(si.subtotal),
        item_name: si.menu_items?.name || 'Unknown Dish',
        sku: si.menu_items?.sku || '',
        notes: si.notes || null
      }))
    };
  };

  const getMappedSale = (saleResult: any) => {
    const pMethod = saleResult.payment_method || saleResult.method || 'cash';
    const rawTendered = saleResult.amount_tendered !== undefined && saleResult.amount_tendered !== null
      ? Number(saleResult.amount_tendered)
      : (pMethod.toLowerCase() === 'cash' ? (Number(saleResult.total_amount || 0) + Number(saleResult.change || saleResult.change_given || 0)) : null);
    const rawChange = Number(saleResult.change_given ?? saleResult.change ?? 0);

    return {
      id: saleResult.id,
      control_number: saleResult.control_number || (saleResult.id ? String(saleResult.id).substring(0, 8) : 'ORDER'),
      branch_name: saleResult.branch_name,
      cashier_email: saleResult.cashier_email,
      total_amount: saleResult.total_amount,
      created_at: saleResult.created_at,
      sale_category: saleResult.sale_category || 'Dine in',
      reference_number: saleResult.reference_number || '',
      queue_number: saleResult.queue_number,
      notes: saleResult.notes,
      kitchen_notes: saleResult.notes,
      items: saleResult.items,
      service_charge_rate: saleResult.service_charge_rate,
      service_charge_amount: saleResult.service_charge_amount,
      discount_type: saleResult.discount_type,
      discount_amount: saleResult.discount_amount,
      discount_metadata: saleResult.discount_metadata,
      vatable_sales: saleResult.vatable_sales,
      vat_amount: saleResult.vat_amount,
      vat_exempt_sales: saleResult.vat_exempt_sales,
      payment_method: pMethod,
      method: pMethod,
      amount_tendered: rawTendered,
      change_given: rawChange,
      change: rawChange,
    };
  };

  const handlePrintThermalBluetooth = async (saleResult: any) => {
    try {
      setIsPrintingReceiptBluetooth(true);
      await ensureBluetoothPrinter();
      const settings = await settingsService.getSettings();
      await printBluetoothThermalInvoice(getMappedSale(saleResult), settings.sales_invoice);
    } catch (err) {
      console.error('Failed to print thermal invoice via Bluetooth:', err);
      showError('Failed to print receipt via Bluetooth.');
    } finally {
      setIsPrintingReceiptBluetooth(false);
    }
  };

  const handlePrintThermalSystem = async (saleResult: any) => {
    try {
      const settings = await settingsService.getSettings();
      printThermalInvoice(getMappedSale(saleResult), settings.sales_invoice);
    } catch (err) {
      console.error('Failed to print thermal invoice via System:', err);
      showError('Failed to print receipt via System Drivers.');
    }
  };

  const handlePrintKitchenBluetooth = async (saleResult: any) => {
    try {
      setIsPrintingKitchenBluetooth(true);
      await ensureBluetoothPrinter();
      await printBluetoothKitchenReceipt(getMappedSale(saleResult));
    } catch (err) {
      console.error('Failed to print kitchen receipt via Bluetooth:', err);
      showError('Failed to print kitchen receipt via Bluetooth.');
    } finally {
      setIsPrintingKitchenBluetooth(false);
    }
  };

  const handlePrintKitchenSystem = async (saleResult: any) => {
    try {
      const settings = await settingsService.getSettings();
      printKitchenReceipt(getMappedSale(saleResult), settings.sales_invoice);
    } catch (err) {
      console.error('Failed to print kitchen receipt via System:', err);
      showError('Failed to print kitchen receipt via System Drivers.');
    }
  };

  const handlePrintBillBluetooth = async (billData: RunningBillSlipData) => {
    try {
      setIsPrintingBillBluetooth(true);
      await ensureBluetoothPrinter();
      const settings = await settingsService.getSettings();
      await printBluetoothRunningBill(billData, settings.sales_invoice);
      showSuccess(`Printed bill out for Table ${billData.table_number} via Bluetooth.`);
    } catch (err: any) {
      console.error('Failed to print bill slip via Bluetooth:', err);
      showError('Failed to print bill slip via Bluetooth.');
    } finally {
      setIsPrintingBillBluetooth(false);
    }
  };

  const handlePrintBillSystem = async (billData: RunningBillSlipData) => {
    try {
      const settings = await settingsService.getSettings();
      printRunningBillSlip(billData, settings.sales_invoice);
    } catch (err: any) {
      console.error('Failed to print bill slip via System:', err);
      showError('Failed to print bill slip via System Drivers.');
    }
  };

  const handlePrintXZBluetooth = async (summary: any, isZRead: boolean) => {
    try {
      setIsPrintingXZBluetooth(true);
      await ensureBluetoothPrinter();
      await printBluetoothXZReport(summary, isZRead, selectedBranch?.name || 'TERMINAL');
    } catch (err) {
      console.error('Failed to print report via Bluetooth:', err);
      showError('Failed to print report via Bluetooth.');
    } finally {
      setIsPrintingXZBluetooth(false);
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
    return resolvePosItemPrice(
      item,
      channel,
      branchPrices,
      selectedBranch?.id,
      selectedSubStore?.id
    );
  };

  useEffect(() => {
    if (cart.length > 0) {
      setCart(prev =>
        prev.map(ci => {
          const item = items.find(i => i.id === ci.menu_item_id);
          if (!item) return ci;
          const newPrice = getItemPrice(item, priceChannel);
          return { ...ci, price: newPrice, original_price: newPrice, price_adjustment_reason: undefined };
        })
      );
    }
  }, [priceChannel, selectedSubStore?.id, branchPrices]);

  const addToCart = (item: MenuItem, qty = 1) => {
    if (!activeSession || activeSession.status !== 'open') {
      showError('Please open your register session before processing sales.');
      setOpenSessionOpen(true);
      return;
    }
    const avail = availabilityMap[item.id];
    if (avail && avail.stockAvailable === false) {
      showError(`"${item.name}" is currently out of stock / lacking ingredients.`);
      return;
    }
    const isAltPrep = Boolean(avail && avail.stockAvailable && !avail.hasSufficientStock);
    const unitPrice = getItemPrice(item);
    setCart(prev => {
      const exists = prev.find(ci => ci.menu_item_id === item.id);
      if (exists) {
        return prev.map(ci =>
          ci.menu_item_id === item.id ? { ...ci, quantity: ci.quantity + qty } : ci
        );
      }
      return [
        ...prev,
        {
          menu_item_id: item.id,
          name: item.name,
          price: unitPrice,
          original_price: unitPrice,
          quantity: qty,
          needsAdjustment: isAltPrep,
        },
      ];
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

  const updateCartQtyDirect = (menuItemId: string, qty: number) => {
    if (!activeSession || activeSession.status !== 'open') {
      showError('Please open your register session before processing sales.');
      setOpenSessionOpen(true);
      return;
    }
    setCart(prev =>
      prev.map(ci =>
        ci.menu_item_id === menuItemId ? { ...ci, quantity: Math.max(0, qty) } : ci
      )
    );
  };

  const removeFromCart = (menuItemId: string) =>
    setCart(prev => prev.filter(ci => ci.menu_item_id !== menuItemId));

  // ─── Table Service & Running Bills Handlers ─────────────────

  const handleSelectTable = async (table: RestaurantTable, tab: PosTab | null) => {
    setActiveTable(table);
    setActiveTab(tab);

    if (tab) {
      if (tab.discount_type) {
        setTabDiscountType(tab.discount_type);
        setTabDiscountAmount(Number(tab.discount_amount || 0));
        setTabDiscountMetadata(tab.discount_metadata || []);
      } else {
        setTabDiscountType(null);
        setTabDiscountAmount(0);
        setTabDiscountMetadata([]);
      }

      if (tab.notes) {
        setOrderKitchenNote(tab.notes);
      }

      // Fetch existing items for this tab
      try {
        const { data: tabItems, error } = await supabase
          .from('pos_tab_items')
          .select(`
            id,
            menu_item_id,
            quantity,
            price,
            notes,
            round_number,
            kitchen_status,
            menu_items (name)
          `)
          .eq('tab_id', tab.id)
          .order('round_number', { ascending: true })
          .order('created_at', { ascending: true });

        if (error) throw error;

        const loadedCart: CartItem[] = (tabItems || []).map((ti: any) => ({
          menu_item_id: ti.menu_item_id,
          name: ti.menu_items?.name || 'Menu Item',
          price: Number(ti.price),
          quantity: ti.quantity,
          notes: ti.notes || undefined,
          tab_item_id: ti.id,
          round_number: ti.round_number || 1,
          kitchen_status: ti.kitchen_status || 'sent',
        }));

        setCart(loadedCart);
      } catch (err: any) {
        console.error('Error fetching tab items:', err);
        showError('Failed to load table items');
      }
    } else {
      setCart([]);
      setTabDiscountType(null);
      setTabDiscountAmount(0);
      setTabDiscountMetadata([]);
      setOrderKitchenNote('');
    }
  };

  const handleExitTableView = () => {
    setActiveTable(null);
    setActiveTab(null);
    setCart([]);
    setTabDiscountType(null);
    setTabDiscountAmount(0);
    setTabDiscountMetadata([]);
    setOrderKitchenNote('');
  };

  const handleSendToKitchen = async () => {
    if (!activeTable || !activeTab) return;
    const pendingItems = cart.filter(ci => ci.kitchen_status !== 'sent');
    if (pendingItems.length === 0) {
      showError('All items in the cart have already been sent to the kitchen.');
      return;
    }

    setFiringKitchen(true);
    try {
      const nextRound = Math.max(0, ...cart.map(c => c.round_number || 0)) + 1;

      // Insert into pos_tab_items
      const rows = pendingItems.map(item => ({
        tenant_id: tenant?.id,
        tab_id: activeTab.id,
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes || null,
        round_number: nextRound,
        kitchen_status: 'sent',
      }));

      const { error } = await supabase
        .from('pos_tab_items')
        .insert(rows);

      if (error) throw error;

      // Prepare Kitchen Ticket Payload
      const kitchenPayload: KitchenOrderSentPayload = {
        id: String(activeTab.id || Date.now()),
        control_number: `T${activeTable.table_number}-R${nextRound}`,
        branch_name: selectedBranch?.name || 'Main Branch',
        table_number: activeTable.table_number,
        round_number: nextRound,
        server_name: activeTab.server_name || profile?.full_name || 'Staff',
        sale_category: `Table ${activeTable.table_number} (Round ${nextRound})`,
        notes: orderKitchenNote.trim() || undefined,
        created_at: new Date().toISOString(),
        items: pendingItems.map(p => ({
          item_name: p.name,
          quantity: p.quantity,
          notes: p.notes,
        })),
      };

      // Set for KitchenOrderSentDialog
      setLastKitchenResult(kitchenPayload);

      // Print via Bluetooth using the exact same approach as direct to sale POS
      try {
        setIsPrintingKitchenBluetooth(true);
        await ensureBluetoothPrinter();
        await printBluetoothKitchenReceipt(getMappedSale(kitchenPayload));
      } catch (btErr: any) {
        console.warn('Bluetooth kitchen print error or skipped:', btErr);
      } finally {
        setIsPrintingKitchenBluetooth(false);
      }

      // Update cart items in state
      setCart(prev =>
        prev.map(item => {
          if (item.kitchen_status !== 'sent') {
            return {
              ...item,
              kitchen_status: 'sent',
              round_number: nextRound,
            };
          }
          return item;
        })
      );

      showSuccess(`Round ${nextRound} sent to kitchen for Table ${activeTable.table_number}!`);
    } catch (err: any) {
      console.error('Error sending round to kitchen:', err);
      showError(err.message || 'Failed to send round to kitchen.');
    } finally {
      setFiringKitchen(false);
    }
  };

  const handlePrintBillOut = async () => {
    if (!activeTable || !activeTab) return;
    if (cart.length === 0) {
      showError('Cannot print a bill for an empty table.');
      return;
    }

    try {
      const hasUnsent = cart.some(ci => ci.kitchen_status !== 'sent');
      if (hasUnsent) {
        const proceed = await confirm(
          'Unsent Items in Cart',
          'Some newly added items have not been sent to the kitchen yet. Include them in this bill anyway?'
        );
        if (!proceed) return;
      }

      const settings = await settingsService.getSettings();
      const vatRelief = tabDiscountMetadata?.[0]?.vat_relief || 0;
      const finalDue = Math.max(0, Number((cartTotal - vatRelief - tabDiscountAmount + serviceChargeAmount).toFixed(2)));

      const billData: RunningBillSlipData = {
        branch_name: selectedBranch?.name || 'Main Branch',
        table_number: activeTable.table_number,
        pax_count: activeTab.pax_count || 1,
        server_name: activeTab.server_name || profile?.full_name || 'Staff',
        cashier_email: profile?.email || '',
        created_at: activeTab.created_at || new Date().toISOString(),
        tab_id: activeTab.id,
        items: cart.map(ci => ({
          name: ci.name,
          quantity: ci.quantity,
          price: ci.price,
          subtotal: ci.price * ci.quantity,
          notes: ci.notes,
          round_number: ci.round_number,
        })),
        subtotal: cartTotal,
        discount_type: tabDiscountType,
        discount_amount: tabDiscountAmount,
        discount_metadata: tabDiscountMetadata,
        vat_exempt_amount: vatRelief,
        service_charge_amount: serviceChargeAmount, // NO percentage displayed!
        payable_total: finalDue,
      };

      // Set bill data for the BillOutDialog (direct-to-sale approach)
      setLastBillOutData(billData);

      // Directly print via Bluetooth thermal printer using the same approach as direct to sale POS
      try {
        setIsPrintingBillBluetooth(true);
        await ensureBluetoothPrinter();
        await printBluetoothRunningBill(billData, settings.sales_invoice);
      } catch (btErr) {
        console.warn('Bluetooth running bill print failed or skipped:', btErr);
      } finally {
        setIsPrintingBillBluetooth(false);
      }

      // Update pos_tabs status to 'billed_out'
      await supabase
        .from('pos_tabs')
        .update({
          status: 'billed_out',
          discount_type: tabDiscountType,
          discount_amount: tabDiscountAmount,
          discount_metadata: tabDiscountMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeTab.id);

      setActiveTab(prev => prev ? { ...prev, status: 'billed_out' } : null);
      showSuccess(`Bill Out slip printed for ${activeTable.table_number}!`);
    } catch (err: any) {
      console.error('Error printing bill out:', err);
      showError(err.message || 'Failed to print bill slip.');
    } finally {
      // Done
    }
  };

  const handleApplyTabDiscount = async (
    discountType: string | null,
    discountAmount: number,
    metadata: any[]
  ) => {
    setTabDiscountType(discountType);
    setTabDiscountAmount(discountAmount);
    setTabDiscountMetadata(metadata);

    if (activeTab?.id) {
      try {
        await supabase
          .from('pos_tabs')
          .update({
            discount_type: discountType,
            discount_amount: discountAmount,
            discount_metadata: metadata,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeTab.id);
      } catch (err) {
        console.error('Failed to save tab discount:', err);
      }
    }
  };

  const updateCartItemNote = (menuItemId: string, note: string) => {
    setCart(prev =>
      prev.map(ci =>
        ci.menu_item_id === menuItemId
          ? { ...ci, notes: note.trim() || undefined }
          : ci
      )
    );
  };

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

  const handleConfirmPayment = async (
    method: PaymentMethod,
    tendered: number | null,
    saleCategory: string,
    referenceNumber: string,
    queueNumber: string,
    subStoreId: string | null = null,
    discountType: string | null = null,
    discountAmount: number = 0,
    discountMetadata: any[] = [],
    discountedItems: any[] = [],
    payableTotalArg?: number
  ) => {
    if (!selectedBranch) return;
    setCheckingOut(true);

    try {
      // Resolve final subStoreId (dialog selection overrides header selection)
      const finalSubStoreId = subStoreId || selectedSubStore?.id || null;
      const payableTotal = payableTotalArg !== undefined
        ? payableTotalArg
        : discountedItems.reduce((acc, p) => acc + ((p.vatable_sales || 0) + (p.vat_amount || 0) + (p.vat_exempt_sales || 0) - (p.discount_amount || 0)), 0);

      if (isOnline) {
        const { data: saleId, error } = await supabase.rpc('fn_process_sale', {
          p_branch_id: selectedBranch.id,
          p_items: discountedItems.map(p => ({
            menu_item_id: p.menu_item_id,
            quantity: p.quantity,
            price: p.price,
            discount_amount: p.discount_amount || 0,
            is_vat_exempt: p.is_vat_exempt || false,
            vatable_sales: p.vatable_sales || 0,
            vat_amount: p.vat_amount || 0,
            vat_exempt_sales: p.vat_exempt_sales || 0,
            notes: p.notes || cart.find(ci => ci.menu_item_id === p.menu_item_id)?.notes || null,
          })),
          p_payment_method: method,
          p_amount_tendered: tendered,
          p_sale_category: saleCategory,
          p_reference_number: referenceNumber,
          p_queue_number: queueNumber || null,
          p_sub_store_id: finalSubStoreId,
          p_discount_type: discountType,
          p_discount_amount: discountAmount,
          p_discount_metadata: discountMetadata,
          p_notes: orderKitchenNote.trim() || null,
        });

        if (error) throw error;

        const change = method === 'cash' && tendered ? tendered - payableTotal : 0;

        const isDineInSale = priceChannel === "standard" && (
          (saleCategory || "").toLowerCase().trim() === "dine in" ||
          (saleCategory || "").toLowerCase().trim() === "dine-in" ||
          (saleCategory || "").toLowerCase().trim() === "dine"
        );
        const branchForSC = branches.find(b => b.id === (finalSubStoreId || selectedBranch.id)) || selectedBranch;
        const branchRate = branchForSC?.service_charge_rate !== undefined && branchForSC?.service_charge_rate !== null
          ? branchForSC.service_charge_rate
          : (selectedBranch?.service_charge_rate !== undefined && selectedBranch?.service_charge_rate !== null ? selectedBranch.service_charge_rate : null);
        const effectiveSCRate = isDineInSale ? Number(branchRate !== null ? branchRate : (tenant?.default_service_charge_rate || 0)) : 0;
        const computedGrossTotal = discountedItems.reduce((acc, p) => acc + (p.price * p.quantity), 0);
        const effectiveSCAmount = effectiveSCRate > 0 ? Number((computedGrossTotal * (effectiveSCRate / 100)).toFixed(2)) : 0;

        setLastSaleResult({
          id: saleId as string,
          change,
          change_given: change,
          method,
          payment_method: method,
          amount_tendered: method === 'cash' ? (tendered !== null && tendered !== undefined ? tendered : payableTotal) : tendered,
          sale_category: saleCategory,
          reference_number: referenceNumber,
          queue_number: queueNumber || null,
          service_charge_rate: effectiveSCRate,
          service_charge_amount: effectiveSCAmount,
          notes: orderKitchenNote.trim() || null,
          items: discountedItems.map((p, idx) => ({
            id: String(idx),
            quantity: p.quantity,
            unit_price: p.price,
            subtotal: p.price * p.quantity - (p.discount_amount || 0),
            item_name: p.name || cart.find(ci => ci.menu_item_id === p.menu_item_id)?.name || 'Item',
            sku: '',
            notes: p.notes || cart.find(ci => ci.menu_item_id === p.menu_item_id)?.notes || null,
            discount_amount: p.discount_amount || 0,
            vatable_sales: p.vatable_sales || 0,
            vat_amount: p.vat_amount || 0,
            vat_exempt_sales: p.vat_exempt_sales || 0,
            is_vat_exempt: p.is_vat_exempt || false
          })),
          branch_name: selectedBranch.name,
          cashier_email: profile?.email || 'System',
          total_amount: payableTotal,
          created_at: new Date().toISOString(),
          discount_type: discountType,
          discount_amount: discountAmount,
          discount_metadata: discountMetadata,
          vatable_sales: discountedItems.reduce((acc, p) => acc + (p.vatable_sales || 0), 0),
          vat_amount: discountedItems.reduce((acc, p) => acc + (p.vat_amount || 0), 0),
          vat_exempt_sales: discountedItems.reduce((acc, p) => acc + (p.vat_exempt_sales || 0), 0)
        } as any);

        if (activeTab?.id) {
          try {
            await supabase
              .from('pos_tabs')
              .update({
                status: 'settled',
                sale_id: saleId,
                closed_at: new Date().toISOString(),
              })
              .eq('id', activeTab.id);
          } catch (tabErr) {
            console.error('Error settling tab:', tabErr);
          }
          setActiveTable(null);
          setActiveTab(null);
          setTabDiscountType(null);
          setTabDiscountAmount(0);
          setTabDiscountMetadata([]);
        }

        setCart([]);
        setOrderKitchenNote('');
        setEditingNoteItemId(null);
        setEditingNoteText('');
        setPaymentOpen(false);
        setIsCartSheetOpen(false);

        showSuccess(
          method === 'cash' && change > 0
            ? `Sale completed! Change due: ${formatPHP(change)}`
            : 'Transaction recorded successfully.'
        );
      } else {
        if (!terminalConfig) throw new Error('No terminal configuration found.');

        const isDineInSale = priceChannel === "standard" && (
          (saleCategory || "").toLowerCase().trim() === "dine in" ||
          (saleCategory || "").toLowerCase().trim() === "dine-in" ||
          (saleCategory || "").toLowerCase().trim() === "dine"
        );
        const branchForSC = branches.find(b => b.id === (finalSubStoreId || selectedBranch.id)) || selectedBranch;
        const branchRate = branchForSC?.service_charge_rate !== undefined && branchForSC?.service_charge_rate !== null
          ? branchForSC.service_charge_rate
          : (selectedBranch?.service_charge_rate !== undefined && selectedBranch?.service_charge_rate !== null ? selectedBranch.service_charge_rate : null);
        const effectiveSCRate = isDineInSale ? Number(branchRate !== null ? branchRate : (tenant?.default_service_charge_rate || 0)) : 0;
        const computedGrossTotal = discountedItems.reduce((acc, p) => acc + (p.price * p.quantity), 0);
        const effectiveSCAmount = effectiveSCRate > 0 ? Number((computedGrossTotal * (effectiveSCRate / 100)).toFixed(2)) : 0;

        const offlineSale = await enqueueOfflineSale({
          branch_id: selectedBranch.id,
          sub_store_id: finalSubStoreId || undefined,
          cashier_id: profile?.id || '',
          cashier_email: profile?.email || '',
          payment_method: method,
          amount_tendered: tendered,
          sale_category: saleCategory,
          reference_number: referenceNumber,
          service_charge_rate: effectiveSCRate,
          service_charge_amount: effectiveSCAmount,
          notes: orderKitchenNote.trim() || undefined,
          items: discountedItems.map(p => ({
            menu_item_id: p.menu_item_id,
            quantity: p.quantity,
            price: p.price,
            name: p.name || cart.find(ci => ci.menu_item_id === p.menu_item_id)?.name,
            notes: p.notes || cart.find(ci => ci.menu_item_id === p.menu_item_id)?.notes || undefined,
            discount_amount: p.discount_amount || 0,
            is_vat_exempt: p.is_vat_exempt || false,
            vatable_sales: p.vatable_sales || 0,
            vat_amount: p.vat_amount || 0,
            vat_exempt_sales: p.vat_exempt_sales || 0
          })),
          total_amount: payableTotal,
          queue_number: queueNumber || undefined,
          queue_status: queueNumber ? 'preparing' : undefined,
          discount_type: discountType,
          discount_amount: discountAmount,
          discount_metadata: discountMetadata
        } as any);

        const change = method === 'cash' && tendered ? tendered - payableTotal : 0;

        setLastSaleResult({
          id: offlineSale.id,
          change,
          change_given: change,
          method,
          payment_method: method,
          amount_tendered: method === 'cash' ? (tendered !== null && tendered !== undefined ? tendered : payableTotal) : tendered,
          sale_category: saleCategory,
          reference_number: referenceNumber,
          control_number: offlineSale.control_number,
          queue_number: queueNumber || null,
          service_charge_rate: effectiveSCRate,
          service_charge_amount: effectiveSCAmount,
          notes: orderKitchenNote.trim() || null,
          items: offlineSale.items.map((item, idx) => ({
            id: String(idx),
            quantity: item.quantity,
            unit_price: item.price || 0,
            subtotal: (item.price || 0) * item.quantity - (item.discount_amount || 0),
            item_name: item.name || 'Unknown Item',
            sku: '',
            notes: item.notes || null,
            discount_amount: item.discount_amount || 0,
            vatable_sales: item.vatable_sales || 0,
            vat_amount: item.vat_amount || 0,
            vat_exempt_sales: item.vat_exempt_sales || 0,
            is_vat_exempt: item.is_vat_exempt || false
          })),
          branch_name: selectedBranch.name,
          cashier_email: profile?.email || 'System',
          total_amount: payableTotal,
          created_at: new Date().toISOString(),
          discount_type: discountType,
          discount_amount: discountAmount,
          discount_metadata: discountMetadata,
          vatable_sales: offlineSale.items.reduce((acc, p) => acc + (p.vatable_sales || 0), 0),
          vat_amount: offlineSale.items.reduce((acc, p) => acc + (p.vat_amount || 0), 0),
          vat_exempt_sales: offlineSale.items.reduce((acc, p) => acc + (p.vat_exempt_sales || 0), 0)
        } as any);

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
      <div className="p-4 md:p-5 border-b flex items-center justify-between bg-background shrink-0 select-none">
        <div className="flex items-center space-x-2.5">
          <ShoppingCart className="w-5 h-5 text-primary" />
          <h3 className="font-black text-sm uppercase tracking-wider">Order Cart</h3>
          <Badge variant="default" className="text-[11px] px-2 py-0.5 font-bold">{cartCount} {cartCount === 1 ? 'Item' : 'Items'}</Badge>
        </div>
        {cart.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm('Clear all items from current cart?')) {
                setCart([]);
                setOrderKitchenNote('');
              }
            }}
            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 font-bold gap-1 rounded-lg active:scale-95"
            title="Void / Clear entire cart"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </Button>
        )}
      </div>

      {/* Active Table Banner */}
      {activeTable && (
        <div className="p-3 mx-3 sm:mx-4 mt-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-sm text-rose-600 dark:text-rose-400">{activeTable.table_number}</span>
              <Badge variant="outline" className="text-[10px] h-4 font-bold border-rose-500/40 text-rose-600">
                {activeTab?.pax_count || 1} Guests
              </Badge>
              {activeTab?.status === 'billed_out' && (
                <Badge className="bg-amber-500 text-black text-[9px] h-4 font-bold uppercase">
                  Billed Out
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              Server: {activeTab?.server_name || 'Staff'} {activeTab?.notes ? `• ${activeTab.notes}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTableFloorOpen(true)}
              className="h-7 text-xs px-2 border-rose-500/30 hover:bg-rose-500/10"
              title="Switch to another table"
            >
              Switch
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExitTableView}
              className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
              title="Exit table view (keeps tab running in background)"
            >
              Exit
            </Button>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 min-h-0 w-full space-y-3">
        {cart.map(item => (
          <Card key={item.menu_item_id} className="bg-background/80 backdrop-blur-sm shadow-sm border border-border/80 rounded-xl overflow-hidden w-full">
            <CardContent className="p-3 text-xs space-y-2.5">
              {/* Row 1: Item Title + Alt Prep & Line Total */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h5 className="font-bold text-sm text-foreground break-words" title={item.name}>{item.name}</h5>
                    {item.needsAdjustment && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-amber-400 text-amber-700 dark:text-amber-300 bg-amber-500/10 font-bold whitespace-nowrap">
                        Alt Prep
                      </Badge>
                    )}
                    {activeTable && (
                      item.kitchen_status === 'sent' ? (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-emerald-500/40 text-emerald-600 bg-emerald-500/10 font-bold whitespace-nowrap">
                          ✓ Sent (Round {item.round_number || 1})
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-600 bg-amber-500/10 font-bold whitespace-nowrap">
                          Ready to Send
                        </Badge>
                      )
                    )}
                  </div>
                </div>
                <span className="font-black text-base text-primary whitespace-nowrap shrink-0 text-right">
                  {formatPHP(item.price * item.quantity)}
                </span>
              </div>

              {/* Row 2: Unit Price & Large Touch Stepper */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30">
                {priceChannel !== 'standard' ? (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0 pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        const catalog = item.original_price ?? getItemPrice(items.find(i => i.id === item.menu_item_id) || (item as any), priceChannel);
                        setEditingPriceItem({
                          menu_item_id: item.menu_item_id,
                          name: item.name,
                          currentPrice: item.price,
                          catalogPrice: catalog,
                        });
                        setPriceAdjustmentInput(String(item.price));
                        setPriceAdjustmentReason(item.price_adjustment_reason || 'Platform Campaign Promo');
                      }}
                      className={`text-xs font-bold px-2 py-1 rounded-lg flex items-center gap-1.5 transition-all active:scale-95 truncate ${
                        item.original_price && Math.abs(item.original_price - item.price) > 0.01
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40 shadow-sm'
                          : 'text-muted-foreground hover:text-primary hover:bg-primary/10 border border-transparent'
                      }`}
                      title="Tap to match Grab / Foodpanda item price"
                    >
                      <span>{formatPHP(item.price)} each</span>
                      {item.original_price && Math.abs(item.original_price - item.price) > 0.01 && (
                        <span className="text-[10px] line-through opacity-70">
                          {formatPHP(item.original_price)}
                        </span>
                      )}
                      <Edit3 className="w-3 h-3 opacity-70 shrink-0" />
                    </button>
                    {item.original_price && Math.abs(item.original_price - item.price) > 0.01 && (
                      <button
                        type="button"
                        onClick={() => {
                          setCart(prev =>
                            prev.map(ci =>
                              ci.menu_item_id === item.menu_item_id
                                ? { ...ci, price: ci.original_price!, price_adjustment_reason: undefined }
                                : ci
                            )
                          );
                        }}
                        className="text-[10px] text-muted-foreground hover:text-destructive font-semibold px-1 shrink-0"
                        title="Reset to catalog price"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                    {formatPHP(item.price)} each
                  </span>
                )}

                <div className="flex items-center space-x-1.5 select-none shrink-0">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 active:scale-90 transition-transform rounded-lg border-input hover:bg-muted"
                    onClick={() => updateCartQty(item.menu_item_id, -1)}
                    title="Decrease quantity"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity || ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        updateCartQtyDirect(item.menu_item_id, val);
                      } else {
                        setCart(prev =>
                          prev.map(ci =>
                            ci.menu_item_id === item.menu_item_id ? { ...ci, quantity: 0 } : ci
                          )
                        );
                      }
                    }}
                    onBlur={() => {
                      if (!item.quantity || item.quantity < 1) {
                        updateCartQtyDirect(item.menu_item_id, 1);
                      }
                    }}
                    className="w-12 h-9 text-center text-sm font-black bg-background border border-input rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-2 focus:ring-primary shrink-0 font-mono shadow-inner"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 active:scale-90 transition-transform rounded-lg border-input hover:bg-muted"
                    onClick={() => updateCartQty(item.menu_item_id, 1)}
                    title="Increase quantity"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 ml-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg active:scale-90 transition-transform"
                    onClick={() => removeFromCart(item.menu_item_id)}
                    title="Remove item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Item Kitchen Note Pill & Action */}
              <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs">
                {item.notes ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingNoteItemId(item.menu_item_id);
                        setEditingNoteText(item.notes || '');
                      }}
                      className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1 truncate cursor-pointer hover:bg-amber-500/20 active:scale-98 transition-all flex items-center gap-1.5 min-h-[32px]"
                      title="Click to edit kitchen note"
                    >
                      <span className="truncate">{item.notes}</span>
                      <Edit3 className="w-3 h-3 opacity-60 ml-0.5 shrink-0" />
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCartItemNote(item.menu_item_id, '')}
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-90 transition-all shrink-0"
                      title="Remove note"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNoteItemId(item.menu_item_id);
                      setEditingNoteText('');
                    }}
                    className="min-h-[32px] px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 font-semibold flex items-center gap-1.5 active:scale-98 transition-all"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>+ Kitchen Note (e.g. no veggies)</span>
                  </button>
                )}
              </div>

              {/* Inline Note Editor when this item is active */}
              {editingNoteItemId === item.menu_item_id && (
                <div className="p-3 bg-muted/60 border border-border/80 rounded-xl space-y-2.5 mt-1.5 select-none w-full max-w-full overflow-hidden">
                  <div className="flex items-center justify-between text-xs font-bold text-foreground">
                    <span className="truncate pr-1">Kitchen Instructions for {item.name}:</span>
                    <button
                      type="button"
                      onClick={() => setEditingNoteItemId(null)}
                      className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {/* Quick suggestion tags (Touch-friendly chips) */}
                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_ITEM_NOTES.map(chip => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => {
                          const trimmed = editingNoteText.trim();
                          if (!trimmed) {
                            setEditingNoteText(chip);
                          } else if (!trimmed.toLowerCase().includes(chip.toLowerCase())) {
                            setEditingNoteText(`${trimmed}, ${chip}`);
                          }
                        }}
                        className="text-xs bg-background hover:bg-primary/10 hover:text-primary border border-border rounded-lg px-2.5 py-1 font-semibold transition-all active:scale-95 shadow-sm"
                      >
                        +{chip}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Type instruction (e.g. No veggies)..."
                      value={editingNoteText}
                      onChange={(e) => setEditingNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          updateCartItemNote(item.menu_item_id, editingNoteText);
                          setEditingNoteItemId(null);
                        }
                      }}
                      className="h-9 text-xs bg-background flex-1 rounded-lg min-w-0"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 px-3.5 text-xs font-bold rounded-lg shrink-0"
                      onClick={() => {
                        updateCartItemNote(item.menu_item_id, editingNoteText);
                        setEditingNoteItemId(null);
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {cart.length === 0 && !lastSaleResult && (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 mt-10">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
              <ShoppingCart className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-base font-bold text-foreground">Your cart is empty</p>
            <p className="text-xs mt-1 text-muted-foreground">Tap {vocab.itemUnitPlural} on the catalog to add them.</p>
          </div>
        )}
      </div>

      {/* Checkout Summary - Sticky Bottom & Pinned */}
      <div className="p-4 md:p-5 border-t bg-background space-y-3 shrink-0 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] z-10 select-none">
        {/* Order-level Kitchen Note */}
        {cart.length > 0 && (
          <div className="space-y-1.5 bg-muted/40 border border-border/70 rounded-xl p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-foreground flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-primary" />
                <span>Overall Kitchen / Table Note:</span>
              </span>
              {orderKitchenNote && (
                <button
                  type="button"
                  onClick={() => setOrderKitchenNote('')}
                  className="text-xs text-muted-foreground hover:text-destructive font-semibold"
                >
                  Clear
                </button>
              )}
            </div>
            <Input
              placeholder="e.g. Table 4 - Rush, Serve all together..."
              value={orderKitchenNote}
              onChange={(e) => setOrderKitchenNote(e.target.value)}
              className="h-9 text-xs bg-background rounded-lg"
            />
          </div>
        )}

        {/* Customer Pre-Bill Discount (When table is active) */}
        {activeTable && (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-amber-700 dark:text-amber-300 truncate">
                {tabDiscountAmount > 0
                  ? `${tabDiscountType === 'sc' ? 'Senior' : tabDiscountType === 'pwd' ? 'PWD' : 'Discount'}: -${formatPHP(tabDiscountAmount)}`
                  : 'Customer Discount'}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTabDiscountOpen(true)}
              className="h-7 text-xs border-amber-500/40 text-amber-700 dark:text-amber-300 font-bold hover:bg-amber-500/20 px-2.5 shrink-0"
            >
              {tabDiscountAmount > 0 ? 'Edit' : '+ Apply (SC/PWD)'}
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          {activeTable && tabDiscountAmount > 0 && (
            <div className="flex justify-between items-center text-xs text-amber-600 dark:text-amber-400 font-medium">
              <span>Customer Discount:</span>
              <span>-{formatPHP(tabDiscountAmount)}</span>
            </div>
          )}
          {serviceChargeAmount > 0 && (
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-medium">Service Charge:</span>
              <span className="font-semibold text-foreground">{formatPHP(serviceChargeAmount)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-black">
              Total Due ({cartCount} {cartCount === 1 ? 'item' : 'items'})
            </span>
            <span className="text-primary text-3xl font-black">{formatPHP(finalCartTotal)}</span>
          </div>
        </div>

        {!selectedBranch && (
          <div className="text-xs text-amber-500 text-center font-bold bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
            ⚠️ No branch context — cannot checkout without an assigned branch.
          </div>
        )}

        {!isOnline && (
          <div className={`flex items-center gap-2 text-xs font-semibold p-2.5 rounded-lg border ${terminalConfig
              ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
              : 'text-destructive bg-destructive/10 border-destructive/20'
            }`}>
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            {terminalConfig
              ? `Offline Mode Active — Sales will queue locally under ${terminalConfig.terminal_code} and sync automatically.`
              : 'Offline — Connection lost and device is not registered. Transactions are disabled.'}
          </div>
        )}

        {/* Action Buttons: Table Running Bill Mode vs Counter Direct-to-Sale Mode */}
        {activeTable ? (
          <div className="space-y-2">
            {hasUnsentItems && (
              <Button
                type="button"
                size="lg"
                onClick={handleSendToKitchen}
                disabled={firingKitchen}
                className="w-full font-bold h-11 text-xs bg-amber-500 hover:bg-amber-600 text-black active:scale-[0.99] transition-transform rounded-xl gap-1.5 shadow-sm"
              >
                {firingKitchen && <Spinner className="w-4 h-4 animate-spin" />}
                <span>Send to Kitchen ({unsentCount})</span>
              </Button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="font-bold h-12 text-xs border-primary/40 text-primary hover:bg-primary/10 rounded-xl gap-1.5"
                onClick={handlePrintBillOut}
                disabled={cart.length === 0}
              >
                <span>Print Bill Out</span>
              </Button>
              <Button
                type="button"
                size="lg"
                className="font-black h-12 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl gap-1.5 shadow-md active:scale-[0.99] transition-transform"
                onClick={openPayment}
                disabled={checkingOut || cart.length === 0 || !selectedBranch || (!isOnline && !terminalConfig)}
              >
                <span>{checkingOut ? 'Processing…' : 'Settle & Pay'}</span>
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="lg"
            className="w-full font-black shadow-lg h-14 text-base active:scale-[0.99] transition-transform rounded-xl"
            onClick={openPayment}
            disabled={checkingOut || cart.length === 0 || !selectedBranch || (!isOnline && !terminalConfig)}
          >
            {checkingOut ? 'Processing…' : 'Charge & Collect Payment'}
          </Button>
        )}
      </div>
    </>
  );

  // ─── Render ────────────────────────────────────────────────

  return (
    <>
      <div className="flex-1 flex overflow-hidden h-full min-h-0 relative">
        {/* Menu / Catalog Panel */}
        <div className="flex-1 flex flex-col p-4 md:p-6 lg:p-8 overflow-y-auto min-h-0 h-full pb-48 lg:pb-8">
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
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${priceChannel === 'standard'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setPriceChannel('foodpanda')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${priceChannel === 'foodpanda'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-amber-500 hover:bg-amber-500/10'
                    }`}
                >
                  Foodpanda
                </button>
                <button
                  type="button"
                  onClick={() => setPriceChannel('grab')}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${priceChannel === 'grab'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-emerald-500 hover:bg-emerald-500/10'
                    }`}
                >
                  Grab
                </button>
              </div>
              {/* Store & Sub-Store Selector */}
              {selectedBranch && (
                <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-lg border border-border/40">
                  {subStores.length > 0 ? (
                    <Select
                      value={selectedSubStore?.id || 'parent'}
                      onValueChange={handleSelectSubStore}
                    >
                      <SelectTrigger className="h-7 text-xs font-bold border-primary/30 bg-background min-w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="parent" className="text-xs font-bold">
                          {selectedBranch.name} (Main Store)
                        </SelectItem>
                        {subStores.map((ss) => (
                          <SelectItem key={ss.id} value={ss.id} className="text-xs font-medium">
                            {ss.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="px-3 py-1 text-xs font-bold bg-background text-primary border-primary/20">
                      Checkout: <span className="underline font-bold ml-1">{selectedBranch.name}</span>
                    </Badge>
                  )}
                  {selectedSubStore && (
                    <Badge variant="outline" className="text-[10px] px-2 py-0.5 font-bold border-emerald-500/50 text-emerald-600 bg-emerald-500/10 whitespace-nowrap">
                      Custom Pricing Active
                    </Badge>
                  )}
                </div>
              )}

              {/* Table Floor Grid Button (When branch has Table Service enabled) */}
              {selectedBranch?.enable_table_service && (
                <div className="flex items-center gap-1">
                  <Button
                    variant={activeTable ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setTableFloorOpen(true)}
                    className={`h-8 text-xs font-bold gap-1.5 transition-all ${
                      activeTable
                        ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm ring-1 ring-rose-400/40'
                        : 'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10'
                    }`}
                    title="Open Table Floor Plan"
                  >
                    <TableIcon className="w-3.5 h-3.5" />
                    <span>
                      {activeTable
                        ? `${activeTable.table_number} (${activeTab?.pax_count || 1} Pax)`
                        : 'Select Table'}
                    </span>
                  </Button>
                  {activeTable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleExitTableView}
                      className="h-8 text-xs text-muted-foreground hover:text-foreground px-2"
                      title="Exit table view (keeps tab running in background)"
                    >
                      Exit Table
                    </Button>
                  )}
                </div>
              )}

              {/* Connection Status Badge */}
              <Badge
                variant="outline"
                className={`px-3 py-1 text-xs font-bold flex items-center gap-1.5 ${isOnline
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
                  className={`px-3 py-1 text-xs font-bold flex items-center gap-1.5 ${isSyncing ? 'bg-indigo-600 animate-pulse text-white' : 'bg-amber-500 text-white'
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
                className="h-9 text-xs font-bold gap-1.5 border-primary/30 hover:bg-primary/10 text-primary rounded-lg active:scale-95"
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
                className={`h-9 text-xs font-bold gap-1.5 rounded-lg active:scale-95 ${isFullscreen ? 'bg-primary/10 text-primary border-primary/30' : ''}`}
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

          {/* Filters - Touch-Optimized Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
            <div className="relative w-full sm:w-72 lg:w-80 shrink-0">
              <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder={`Search ${vocab.itemUnit} name or SKU…`}
                className="pl-10 pr-10 h-11 text-sm rounded-xl font-medium"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-2.5 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted active:scale-90 transition-transform"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0 flex space-x-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide select-none">
              {categories.map(cat => (
                <Button
                  key={cat}
                  variant={selectedCategory === cat ? 'default' : 'outline'}
                  size="default"
                  onClick={() => setSelectedCategory(cat)}
                  className={`h-11 px-4 text-xs font-bold rounded-xl whitespace-nowrap active:scale-95 transition-transform shrink-0 ${
                    selectedCategory === cat ? 'shadow-sm' : ''
                  }`}
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
              {filteredItems.map(item => {
                const avail = availabilityMap[item.id];
                const isOutOfStock = avail ? !avail.stockAvailable : false;
                const needsAdjustment = avail ? (avail.stockAvailable && !avail.hasSufficientStock) : false;
                const inCartItem = cart.find(ci => ci.menu_item_id === item.id);
                const inCartQty = inCartItem?.quantity || 0;

                return (
                  <Card
                    key={item.id}
                    onClick={() => {
                      if (!isOutOfStock) {
                        addToCart(item, 1);
                      }
                    }}
                    className={`transition-all group flex flex-col justify-between min-h-[10rem] h-auto select-none rounded-2xl ${isOutOfStock
                        ? 'opacity-60 cursor-not-allowed bg-muted/40 border-muted-foreground/20'
                        : needsAdjustment
                          ? 'cursor-pointer border-amber-300 dark:border-amber-700/80 hover:border-amber-500 hover:shadow-md active:scale-[0.98]'
                          : 'cursor-pointer hover:border-primary/50 hover:shadow-md active:scale-[0.98]'
                      }`}
                  >
                    <CardContent className="p-4 flex flex-col h-full justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <Badge variant="secondary" className="text-[10px] font-bold uppercase">{item.category}</Badge>
                          {inCartQty > 0 && (
                            <Badge className="text-[10px] font-black px-2 py-0.5 bg-primary text-primary-foreground shadow-sm">
                              {inCartQty} in cart
                            </Badge>
                          )}
                          {isOutOfStock && (
                            <Badge variant="destructive" className="text-[10px] uppercase font-black px-2 py-0.5 whitespace-nowrap bg-rose-600 text-white border-none">
                              Out of Stock
                            </Badge>
                          )}
                          {needsAdjustment && (
                            <Badge variant="outline" className="text-[10px] uppercase font-bold px-1.5 py-0.5 whitespace-nowrap bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-400">
                              Needs Adjustment
                            </Badge>
                          )}
                        </div>
                        <h4 className={`text-sm font-bold transition-colors line-clamp-2 ${isOutOfStock ? 'text-muted-foreground' : 'group-hover:text-primary'
                          }`}>{item.name}</h4>
                        <span className="text-xs text-muted-foreground font-mono mt-0.5 block">{item.sku}</span>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/40">
                        <div className="flex flex-col">
                          <span className="text-base font-black text-foreground">{formatPHP(getItemPrice(item))}</span>
                          {priceChannel !== 'standard' && (
                            <span className={`text-[10px] font-bold ${priceChannel === 'foodpanda' ? 'text-amber-500' : 'text-emerald-500'}`}>
                              {priceChannel === 'foodpanda' ? 'Foodpanda' : 'Grab'} Price
                            </span>
                          )}
                        </div>
                        <Button
                          variant={isOutOfStock ? 'outline' : inCartQty > 0 ? 'default' : needsAdjustment ? 'outline' : 'secondary'}
                          size="sm"
                          disabled={isOutOfStock}
                          className={`h-9 px-3.5 text-xs font-bold rounded-lg transition-all active:scale-95 ${isOutOfStock
                              ? ''
                              : needsAdjustment
                                ? 'border-amber-400 text-amber-700 dark:text-amber-300 group-hover:bg-amber-500 group-hover:text-white group-hover:border-amber-500'
                                : inCartQty > 0
                                  ? 'bg-primary text-primary-foreground shadow-sm'
                                  : 'group-hover:bg-primary group-hover:text-primary-foreground'
                            }`}
                        >
                          {isOutOfStock ? 'Sold Out' : inCartQty > 0 ? `+ Add (${inCartQty})` : '+ Add'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {filteredItems.length === 0 && (
                <div className="col-span-full text-center p-8 text-muted-foreground">
                  No active {vocab.itemUnitPlural} found matching criteria.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop Cart Panel - Locked Viewport Height */}
        <div className="hidden lg:flex w-[390px] xl:w-[420px] border-l bg-muted/10 flex-col h-full shrink-0 overflow-hidden min-h-0">
          {renderCartContent()}
        </div>

        {/* Mobile Cart Floating Bottom Bar */}
        <div className={`lg:hidden fixed ${isFullscreen ? 'bottom-4 md:bottom-0' : 'bottom-[104px] md:bottom-0'} left-4 right-4 md:left-0 md:right-0 p-4 bg-background border md:border-x-0 md:border-b-0 md:border-t rounded-2xl md:rounded-none shadow-lg flex justify-between items-center z-40`}>
          <div>
            <p className="text-xs text-muted-foreground font-semibold">Total ({cartCount} items)</p>
            <p className="text-lg font-bold text-primary">{formatPHP(cartTotalWithSC)}</p>
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
            <SheetContent side="right" className="w-[90vw] sm:w-[420px] p-0 gap-0 flex flex-col bg-muted/10">
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
        cart={cart}
        onConfirm={handleConfirmPayment}
        processing={checkingOut}
        onStateChange={setPaymentState}
        saleCategories={vocab.saleCategories}
        defaultSaleCategory={
          activeTable
            ? 'Dine In'
            : priceChannel === "foodpanda"
            ? "Foodpanda"
            : priceChannel === "grab"
            ? "Grab"
            : vocab.defaultSaleCategory
        }
        subStores={subStores}
        initialSubStore={selectedSubStore}
        serviceChargeRate={serviceChargeRate}
        priceChannel={priceChannel}
        initialDiscountType={tabDiscountType}
        initialDiscountAmount={tabDiscountAmount}
        initialDiscountMetadata={tabDiscountMetadata}
        initialGroupSize={activeTab?.pax_count || 1}
        initialQueueNumber={activeTable ? (activeTable.table_number.toLowerCase().startsWith('table') ? activeTable.table_number : `Table ${activeTable.table_number}`) : undefined}
      />

      {/* Table Floor Grid Dialog */}
      {selectedBranch && (
        <TableFloorDialog
          open={tableFloorOpen}
          onClose={() => setTableFloorOpen(false)}
          branchId={selectedBranch.id}
          activeTableId={activeTable?.id}
          onSelectTable={handleSelectTable}
        />
      )}

      {/* Tab Pre-Bill Discount Modal */}
      <TabDiscountModal
        open={tabDiscountOpen}
        onClose={() => setTabDiscountOpen(false)}
        subtotal={cartTotal}
        paxCount={activeTab?.pax_count || 1}
        initialDiscountType={tabDiscountType}
        initialDiscountAmount={tabDiscountAmount}
        initialDiscountMetadata={tabDiscountMetadata}
        onApplyDiscount={handleApplyTabDiscount}
      />

      {/* ─── Match Delivery Price Dialog (Foodpanda / Grab) ─── */}
      <MatchPriceDialog
        editingPriceItem={editingPriceItem}
        onClose={() => setEditingPriceItem(null)}
        priceChannel={priceChannel}
        priceAdjustmentInput={priceAdjustmentInput}
        setPriceAdjustmentInput={setPriceAdjustmentInput}
        priceAdjustmentReason={priceAdjustmentReason}
        setPriceAdjustmentReason={setPriceAdjustmentReason}
        onApply={(price, reason) => {
          if (!editingPriceItem) return;
          setCart(prev =>
            prev.map(ci =>
              ci.menu_item_id === editingPriceItem.menu_item_id
                ? {
                    ...ci,
                    price,
                    original_price: editingPriceItem.catalogPrice,
                    price_adjustment_reason: reason,
                  }
                : ci
            )
          );
          setEditingPriceItem(null);
          showSuccess(`Updated price for ${editingPriceItem.name} to ${formatPHP(price)}.`);
        }}
      />

      {/* ─── Sale Success Dialog ─── */}
      <SaleSuccessDialog
        lastSaleResult={lastSaleResult}
        onClose={() => setLastSaleResult(null)}
        isRestaurant={isRestaurant}
        isPrintingReceiptBluetooth={isPrintingReceiptBluetooth}
        isPrintingKitchenBluetooth={isPrintingKitchenBluetooth}
        onPrintThermalBluetooth={handlePrintThermalBluetooth}
        onPrintThermalSystem={handlePrintThermalSystem}
        onPrintKitchenBluetooth={handlePrintKitchenBluetooth}
        onPrintKitchenSystem={handlePrintKitchenSystem}
        onPrintQueue={handlePrintQueue}
      />

      {/* ─── Kitchen Order Sent Dialog ─── */}
      <KitchenOrderSentDialog
        order={lastKitchenResult}
        onClose={() => setLastKitchenResult(null)}
        isPrintingKitchenBluetooth={isPrintingKitchenBluetooth}
        onPrintKitchenBluetooth={async (order) => {
          await handlePrintKitchenBluetooth(order);
        }}
        onPrintKitchenSystem={async (order) => {
          await handlePrintKitchenSystem(order);
        }}
      />

      {/* ─── Bill Out Dialog ─── */}
      <BillOutDialog
        billData={lastBillOutData}
        onClose={() => setLastBillOutData(null)}
        isPrintingBillBluetooth={isPrintingBillBluetooth}
        onPrintBillBluetooth={handlePrintBillBluetooth}
        onPrintBillSystem={handlePrintBillSystem}
        onProceedToSettle={() => {
          setLastBillOutData(null);
          openPayment();
        }}
      />

      {/* ─── Open Session Dialog ─── */}
      <OpenSessionDialog
        open={openSessionOpen}
        onClose={() => setOpenSessionOpen(false)}
        openingBalance={openingBalance}
        setOpeningBalance={setOpeningBalance}
        onOpenSession={handleOpenSession}
      />

      {/* ─── X-Read Report Dialog ─── */}
      <XReadDialog
        open={xReadOpen}
        onClose={() => setXReadOpen(false)}
        sessionSummary={sessionSummary}
        branchName={selectedBranch?.name || "TERMINAL"}
        isPrintingXZBluetooth={isPrintingXZBluetooth}
        onPrintXZBluetooth={handlePrintXZBluetooth}
        onPrintXZSystem={printXZReport}
      />

      {/* ─── Z-Read Close Shift Dialog ─── */}
      <ZReadDialog
        open={zReadOpen}
        onClose={() => setZReadOpen(false)}
        actualCashStr={actualCashStr}
        setActualCashStr={setActualCashStr}
        onCloseSession={handleCloseSession}
      />

      {/* ─── Shift Closed Summary Dialog ─── */}
      <ClosedZReportDialog
        summary={viewingClosedSummary}
        onClose={() => setViewingClosedSummary(null)}
        branchName={selectedBranch?.name || "TERMINAL"}
        isPrintingXZBluetooth={isPrintingXZBluetooth}
        onPrintXZBluetooth={handlePrintXZBluetooth}
        onPrintXZSystem={printXZReport}
      />
    </>
  );
};
