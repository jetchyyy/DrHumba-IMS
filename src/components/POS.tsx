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
} from '@radix-ui/react-icons';
import { settingsService } from '../lib/settingsService';
import { printThermalInvoice } from '../lib/printService';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { useModal } from '../contexts/ModalContext';
import { ScrollArea } from './ui/scroll-area';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from './ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { useNetworkStatus } from '../hooks/use-network-status';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MenuItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  is_available: boolean;
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
  onConfirm: (method: PaymentMethod, tendered: number | null) => Promise<void>;
  processing: boolean;
}

const PaymentDialog: React.FC<PaymentDialogProps> = ({ open, onClose, cartTotal, onConfirm, processing }) => {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tenderedStr, setTenderedStr] = useState('');

  const tendered = parseFloat(tenderedStr) || 0;
  const change = method === 'cash' ? tendered - cartTotal : 0;
  const isValidCash = method !== 'cash' || tendered >= cartTotal;

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setMethod('cash');
      setTenderedStr('');
    }
  }, [open]);

  const handleConfirm = async () => {
    const tValue = method === 'cash' ? (tendered || null) : null;
    await onConfirm(method, tValue);
  };

  const quickAmounts = useMemo(() => QUICK_CASH_AMOUNTS(cartTotal), [cartTotal]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !processing) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight">Collect Payment</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Confirm the payment method and tender amount before finalizing the transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Order Total */}
          <div className="flex justify-between items-center bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
            <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Order Total</span>
            <span className="text-2xl font-black text-primary">{formatPHP(cartTotal)}</span>
          </div>

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

        <Separator />

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={processing}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={processing || !isValidCash}
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

export const POS: React.FC = () => {
  const { selectedBranch, profile } = useAuth();
  const { showSuccess, showError } = useModal();
  const { isOnline } = useNetworkStatus();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);

  // Payment dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastSaleResult, setLastSaleResult] = useState<{ id: string; change: number; method: string } | null>(null);

  const loadMenuItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('status', 'active')
        .eq('is_available', true)
        .order('name');
      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      console.error('Error loading menu items for POS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMenuItems(); }, []);

  const handlePrintThermal = async (saleId: string) => {
    try {
      // 1. Fetch newly processed sale details from Supabase
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

      if (saleError) throw saleError;
      if (!saleData) return;

      // 2. Fetch cashier email details
      const { data: profileData } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', saleData.cashier_id)
        .single();

      const mappedSale = {
        id: saleData.id,
        control_number: saleData.control_number || null,
        branch_id: saleData.branch_id,
        cashier_id: saleData.cashier_id,
        total_amount: Number(saleData.total_amount),
        status: saleData.status,
        created_at: saleData.created_at,
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

      const settings = await settingsService.getSettings();
      printThermalInvoice(mappedSale, settings.sales_invoice);
    } catch (err) {
      console.error('Failed to load and print thermal invoice:', err);
      showError('Failed to print receipt. Please reprint from Sales History.');
    }
  };

  // ─── Cart Helpers ──────────────────────────────────────────

  const addToCart = (item: MenuItem, qty = 1) => {
    setCart(prev => {
      const exists = prev.find(ci => ci.menu_item_id === item.id);
      if (exists) {
        return prev.map(ci =>
          ci.menu_item_id === item.id ? { ...ci, quantity: ci.quantity + qty } : ci
        );
      }
      return [...prev, { menu_item_id: item.id, name: item.name, price: Number(item.price), quantity: qty }];
    });
    showSuccess(`${qty}× ${item.name} added to cart.`);
  };

  const updateCartQty = (menuItemId: string, amount: number) => {
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

  const cartTotal = cart.reduce((s, ci) => s + ci.price * ci.quantity, 0);
  const cartCount = cart.reduce((s, ci) => s + ci.quantity, 0);

  // ─── Checkout ─────────────────────────────────────────────

  const openPayment = () => {
    if (cart.length === 0) return;
    if (!selectedBranch) {
      showError('Please select an active branch context from the sidebar.');
      return;
    }
    if (!isOnline) {
      showError('You are offline. Please restore your network connection before processing a transaction.');
      return;
    }
    setLastSaleResult(null);
    setPaymentOpen(true);
  };

  const handleConfirmPayment = async (method: PaymentMethod, tendered: number | null) => {
    if (!selectedBranch) return;
    setCheckingOut(true);

    try {
      const payload = cart.map(ci => ({ menu_item_id: ci.menu_item_id, quantity: ci.quantity }));

      const { data: saleId, error } = await supabase.rpc('fn_process_sale', {
        p_branch_id:       selectedBranch.id,
        p_items:           payload,
        p_payment_method:  method,
        p_amount_tendered: tendered,
      });

      if (error) throw error;

      const change = method === 'cash' && tendered ? tendered - cartTotal : 0;

      setLastSaleResult({ id: saleId as string, change, method });
      setCart([]);
      setPaymentOpen(false);
      setIsCartSheetOpen(false);

      showSuccess(
        method === 'cash' && change > 0
          ? `Sale completed! Change due: ${formatPHP(change)}`
          : 'Transaction recorded successfully.'
      );
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
              <p className="text-xs mt-1">Tap dishes on the catalog to add them.</p>
            </div>
          )}

          {/* Last Sale Receipt */}
          {lastSaleResult && cart.length === 0 && (
            <Alert className="mt-4 border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4" color="currentColor" />
              <AlertTitle className="text-xs font-bold">Sale Recorded</AlertTitle>
              <AlertDescription className="text-[10px] space-y-1 mt-1">
                <p className="font-mono break-all">ID: {lastSaleResult.id}</p>
                <p>Method: <strong>{PAYMENT_LABELS[lastSaleResult.method as PaymentMethod]}</strong></p>
                {lastSaleResult.method === 'cash' && lastSaleResult.change > 0 && (
                  <p className="text-base font-black">Change: {formatPHP(lastSaleResult.change)}</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full font-bold flex items-center justify-center gap-1.5 h-8 bg-emerald-600 hover:bg-emerald-500 text-white border-none"
                  onClick={() => handlePrintThermal(lastSaleResult.id)}
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Thermal Receipt
                </Button>
              </AlertDescription>
            </Alert>
          )}
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
          <div className="flex items-center gap-2 text-[10px] text-destructive font-medium bg-destructive/10 p-2 rounded border border-destructive/20">
            <WifiOff className="w-3.5 h-3.5 flex-shrink-0" />
            Offline — transactions are blocked until connection is restored.
          </div>
        )}

        <Button
          size="lg"
          className="w-full font-bold shadow-md"
          onClick={openPayment}
          disabled={checkingOut || cart.length === 0 || !selectedBranch || !isOnline}
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
              <h2 className="text-3xl font-bold tracking-tight">Point of Sale</h2>
              <p className="text-muted-foreground">
                Tap items to add to cart. Inventory deductions are validated at the database layer.
              </p>
            </div>
            {selectedBranch && (
              <Badge variant="outline" className="px-3.5 py-1.5 text-xs font-semibold bg-primary/10 text-primary border-primary/20">
                Checkout: <span className="underline font-bold ml-1">{selectedBranch.name}</span>
              </Badge>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search dish name or SKU…"
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
                      <span className="text-sm font-bold">{formatPHP(Number(item.price))}</span>
                      <Button variant="secondary" size="sm" className="h-7 text-xs font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                        Add
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {filteredItems.length === 0 && (
                <div className="col-span-full text-center p-8 text-muted-foreground">
                  No active dishes found matching criteria.
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
        <div className="lg:hidden fixed bottom-[104px] md:bottom-0 left-4 right-4 md:left-0 md:right-0 p-4 bg-background border md:border-x-0 md:border-b-0 md:border-t rounded-2xl md:rounded-none shadow-lg flex justify-between items-center z-40">
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
      />
    </>
  );
};
