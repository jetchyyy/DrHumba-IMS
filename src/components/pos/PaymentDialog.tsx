import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Banknote, Smartphone, CreditCard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Separator } from '../ui/separator';
import type {
  PaymentDialogProps,
  PaymentMethod,
} from './types';
import {
  PAYMENT_LABELS,
  formatPHP,
  QUICK_CASH_AMOUNTS
} from './types';

interface GroupedItemCalculation {
  menu_item_id: string;
  quantity: number;
  price: number;
  name: string;
  notes?: string;
  discount_amount: number;
  vatable_sales: number;
  vat_amount: number;
  vat_exempt_sales: number;
  is_vat_exempt: boolean;
}

export const PaymentDialog: React.FC<PaymentDialogProps> = ({
  open,
  onClose,
  cartTotal,
  cart,
  onConfirm,
  processing,
  onStateChange,
  saleCategories,
  defaultSaleCategory,
  subStores,
  initialSubStore,
  serviceChargeRate = 0,
  priceChannel = 'standard',
}) => {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tenderedStr, setTenderedStr] = useState('');
  const [saleCategory, setSaleCategory] = useState<string>(defaultSaleCategory);
  const [customCategory, setCustomCategory] = useState<string>('');
  const [refNumber, setRefNumber] = useState<string>('');
  const [queueNumber, setQueueNumber] = useState<string>('');
  const [dialogSubStoreId, setDialogSubStoreId] = useState<string>('parent');

  // Discount states
  const [applyDiscount, setApplyDiscount] = useState(false);
  const [discountMode, setDiscountMode] = useState<'shared' | 'itemized'>('shared');
  const [discountType, setDiscountType] = useState<string>('sc'); // sc, pwd, mov, solo, custom, delivery_promo
  const [groupSize, setGroupSize] = useState<number>(1);
  const [discountCount, setDiscountCount] = useState<number>(1);

  // Custom discount values
  const [customDiscountRate, setCustomDiscountRate] = useState<number>(20);
  const [customDiscountIsVatExempt, setCustomDiscountIsVatExempt] = useState<boolean>(true);

  // Delivery Platform Voucher Promo states
  const [deliveryPromoMode, setDeliveryPromoMode] = useState<'fixed' | 'percent'>('fixed');
  const [deliveryPromoAmount, setDeliveryPromoAmount] = useState<number>(0);
  const [deliveryPromoRate, setDeliveryPromoRate] = useState<number>(10);

  // Card holders metadata
  const [cardHolders, setCardHolders] = useState<Array<{ name: string; id: string }>>([{ name: '', id: '' }]);

  // Manual unit selection overrides
  const [manualSelection, setManualSelection] = useState<Record<string, boolean>>({});

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
      setApplyDiscount(false);
      setDiscountMode('shared');
      setDiscountType('sc');
      setGroupSize(1);
      setDiscountCount(1);
      setCustomDiscountRate(20);
      setCustomDiscountIsVatExempt(true);
      setDeliveryPromoMode('fixed');
      setDeliveryPromoAmount(0);
      setDeliveryPromoRate(10);
      setCardHolders([{ name: '', id: '' }]);
      setManualSelection({});
    }
  }, [open, defaultSaleCategory, initialSubStore]);

  // Synchronize cardholder list when count updates
  const updateDiscountCount = useCallback((newCount: number) => {
    const clamped = Math.max(1, newCount);
    setDiscountCount(clamped);
    setManualSelection({});
    setCardHolders(prev => {
      const next = [...prev];
      if (next.length < clamped) {
        while (next.length < clamped) {
          next.push({ name: '', id: '' });
        }
      } else if (next.length > clamped) {
        next.splice(clamped);
      }
      return next;
    });
  }, []);

  const handleDiscountModeChange = (mode: 'shared' | 'itemized') => {
    setDiscountMode(mode);
    setManualSelection({});
  };

  // Flatten the cart into individual units for discount selection
  const flatUnits = useMemo(() => {
    const units: Array<{ id: string; menu_item_id: string; price: number; name: string; notes?: string }> = [];
    cart.forEach(item => {
      for (let q = 0; q < item.quantity; q++) {
        units.push({
          id: `${item.menu_item_id}-${q}`,
          menu_item_id: item.menu_item_id,
          price: item.price,
          name: item.name,
          notes: item.notes
        });
      }
    });
    return units;
  }, [cart]);

  // Automatically select cheapest units when discount settings change in itemized mode,
  // or use manual checked selections capped at discountCount
  const targetUnitIds = useMemo(() => {
    if (!applyDiscount) return new Set<string>();

    const manualKeys = Object.keys(manualSelection).filter(k => manualSelection[k]);
    if (manualKeys.length > 0) {
      return new Set<string>(manualKeys);
    } else {
      const sorted = [...flatUnits].sort((a, b) => a.price - b.price);
      const selected = new Set<string>();
      for (let i = 0; i < Math.min(discountCount, sorted.length); i++) {
        selected.add(sorted[i].id);
      }
      return selected;
    }
  }, [applyDiscount, flatUnits, discountCount, manualSelection]);

  // Comprehensive Philippine BIR-Compliant Discount Calculation Engine
  const discountCalculation = useMemo(() => {
    if (!applyDiscount || discountCount <= 0 || groupSize <= 0) {
      return {
        discountedItems: cart.map(item => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
          price: item.price,
          name: item.name,
          notes: item.notes,
          discount_amount: 0,
          is_vat_exempt: false,
          vatable_sales: (item.price * item.quantity) / 1.12,
          vat_amount: ((item.price * item.quantity) / 1.12) * 0.12,
          vat_exempt_sales: 0,
          net_total: item.price * item.quantity
        })),
        total_amount: cartTotal,
        discount_amount: 0,
        vatable_sales: cartTotal / 1.12,
        vat_amount: (cartTotal / 1.12) * 0.12,
        vat_exempt_sales: 0,
        gross_sales: cartTotal,
        regular_gross: cartTotal,
        sc_gross: 0,
        vat_relief: 0,
        total_savings: 0,
        seniorRatio: 0,
        regularCount: groupSize
      };
    }

    let rate = 0.20;
    let isExempt = true;
    if (discountType === 'sc' || discountType === 'pwd' || discountType === 'mov') {
      rate = 0.20;
      isExempt = true;
    } else if (discountType === 'solo') {
      rate = 0.10;
      isExempt = true;
    } else if (discountType === 'custom') {
      rate = customDiscountRate / 100;
      isExempt = customDiscountIsVatExempt;
    } else if (discountType === 'delivery_promo') {
      isExempt = false;
      if (deliveryPromoMode === 'fixed') {
        const maxVoucher = cartTotal * 0.5;
        const safeAmount = Math.min(maxVoucher, Math.max(0, deliveryPromoAmount));
        rate = cartTotal > 0 ? safeAmount / cartTotal : 0;
      } else {
        const safeRate = Math.min(50, Math.max(0, deliveryPromoRate));
        rate = safeRate / 100;
      }
    }

    const seniorRatio = discountType === 'delivery_promo' ? 1 : Math.min(1, Math.max(0, discountCount / groupSize));
    const regularRatio = 1 - seniorRatio;

    const calculatedUnits = flatUnits.map(unit => {
      const gross_sc = discountMode === 'shared'
        ? unit.price * seniorRatio
        : (targetUnitIds.has(unit.id) ? unit.price : 0);
      const gross_reg = discountMode === 'shared'
        ? unit.price * regularRatio
        : (targetUnitIds.has(unit.id) ? 0 : unit.price);

      let vat_exempt_sales = 0;
      let discount_amount = 0;
      let vatable_sales_disc = 0;
      let vat_amount_disc = 0;

      if (gross_sc > 0) {
        if (isExempt) {
          vat_exempt_sales = gross_sc / 1.12;
          discount_amount = vat_exempt_sales * rate;
        } else {
          const payable_sc = gross_sc * (1 - rate);
          vatable_sales_disc = payable_sc / 1.12;
          vat_amount_disc = vatable_sales_disc * 0.12;
          discount_amount = gross_sc * rate;
        }
      }

      const vatable_sales_reg = gross_reg > 0 ? gross_reg / 1.12 : 0;
      const vat_amount_reg = vatable_sales_reg * 0.12;

      const total_vatable = vatable_sales_reg + vatable_sales_disc;
      const total_vat = vat_amount_reg + vat_amount_disc;
      const net_total = isExempt
        ? (total_vatable + total_vat + vat_exempt_sales - discount_amount)
        : (total_vatable + total_vat);

      return {
        ...unit,
        isDiscounted: gross_sc > 0,
        gross_sc,
        gross_reg,
        discount_amount,
        vatable_sales: total_vatable,
        vat_amount: total_vat,
        vat_exempt_sales,
        is_vat_exempt: isExempt && gross_sc > 0,
        net_total
      };
    });

    const groupedItemsMap: Record<string, GroupedItemCalculation> = {};
    calculatedUnits.forEach(unit => {
      if (!groupedItemsMap[unit.menu_item_id]) {
        groupedItemsMap[unit.menu_item_id] = {
          menu_item_id: unit.menu_item_id,
          quantity: 0,
          price: unit.price,
          name: unit.name,
          notes: unit.notes,
          discount_amount: 0,
          vatable_sales: 0,
          vat_amount: 0,
          vat_exempt_sales: 0,
          is_vat_exempt: false
        };
      }
      const gi = groupedItemsMap[unit.menu_item_id];
      gi.quantity += 1;
      gi.discount_amount += unit.discount_amount;
      gi.vatable_sales += unit.vatable_sales;
      gi.vat_amount += unit.vat_amount;
      gi.vat_exempt_sales += unit.vat_exempt_sales;
      if (unit.is_vat_exempt) {
        gi.is_vat_exempt = true;
      }
    });

    const discountedItems = Object.values(groupedItemsMap);

    let tx_total_amount = 0;
    let tx_discount_amount = 0;
    let tx_vatable_sales = 0;
    let tx_vat_amount = 0;
    let tx_vat_exempt_sales = 0;
    let tx_regular_gross = 0;
    let tx_sc_gross = 0;

    calculatedUnits.forEach(unit => {
      tx_total_amount += unit.net_total;
      tx_discount_amount += unit.discount_amount;
      tx_vatable_sales += unit.vatable_sales;
      tx_vat_amount += unit.vat_amount;
      tx_vat_exempt_sales += unit.vat_exempt_sales;
      tx_regular_gross += unit.gross_reg;
      tx_sc_gross += unit.gross_sc;
    });

    const vat_relief = isExempt ? Math.max(0, tx_sc_gross - tx_vat_exempt_sales) : 0;
    const total_savings = vat_relief + tx_discount_amount;

    return {
      discountedItems,
      total_amount: tx_total_amount,
      discount_amount: tx_discount_amount,
      vatable_sales: tx_vatable_sales,
      vat_amount: tx_vat_amount,
      vat_exempt_sales: tx_vat_exempt_sales,
      gross_sales: cartTotal,
      regular_gross: tx_regular_gross,
      sc_gross: tx_sc_gross,
      vat_relief,
      total_savings,
      seniorRatio,
      regularCount: groupSize - discountCount
    };
  }, [applyDiscount, discountMode, flatUnits, discountCount, groupSize, discountType, customDiscountRate, customDiscountIsVatExempt, targetUnitIds, cart, cartTotal, deliveryPromoAmount, deliveryPromoMode, deliveryPromoRate]);

  const handleToggleUnit = (unitId: string) => {
    setManualSelection(prev => {
      const next = { ...prev };
      next[unitId] = !next[unitId];
      return next;
    });
  };

  // Service charge is NOT applicable to grab and foodpanda sales. It is ONLY on dine in.
  const isDineIn = useMemo(() => {
    if (priceChannel !== 'standard') return false;
    const cat = (saleCategory || '').toLowerCase().trim();
    return cat === 'dine in' || cat === 'dine-in' || cat === 'dine';
  }, [priceChannel, saleCategory]);

  const effectiveSCRate = useMemo(() => {
    if (!isDineIn) return 0;
    if (dialogSubStoreId && dialogSubStoreId !== 'parent') {
      const sub = subStores.find(s => s.id === dialogSubStoreId);
      if (sub && sub.service_charge_rate !== undefined && sub.service_charge_rate !== null) {
        return Number(sub.service_charge_rate);
      }
    }
    return serviceChargeRate;
  }, [isDineIn, dialogSubStoreId, subStores, serviceChargeRate]);

  const serviceChargeAmount = effectiveSCRate > 0 ? Number((cartTotal * (effectiveSCRate / 100)).toFixed(2)) : 0;
  const payableTotal = Number((discountCalculation.total_amount + serviceChargeAmount).toFixed(2));
  const tendered = parseFloat(tenderedStr) || 0;
  const change = method === 'cash' ? tendered - payableTotal : 0;

  const isRefNumRequired = method === 'gcash' || method === 'maya';
  const hasRefNum = !isRefNumRequired || refNumber.trim().length > 0;
  const isCustomCatRequired = saleCategory === 'other';
  const hasCustomCat = !isCustomCatRequired || customCategory.trim().length > 0;
  const isValidCash = method !== 'cash' || tendered >= (payableTotal - 0.009);

  const isDelivery = priceChannel === 'foodpanda' || priceChannel === 'grab' || saleCategory?.toLowerCase().includes('foodpanda') || saleCategory?.toLowerCase().includes('grab');
  const hasModifiedDeliveryPrices = cart.some(ci => ci.original_price && Math.abs(ci.original_price - ci.price) > 0.01);
  const isDeliveryOrderNumRequired = isDelivery && (hasModifiedDeliveryPrices || (applyDiscount && discountType === 'delivery_promo'));
  const hasValidDeliveryOrderNum = !isDeliveryOrderNumRequired || queueNumber.trim().length > 0;

  const canConfirm = isValidCash && hasRefNum && hasCustomCat && hasValidDeliveryOrderNum;

  // Propagate state to parent for customer display sync
  useEffect(() => {
    if (open && onStateChange) {
      onStateChange({
        method,
        tendered: parseFloat(tenderedStr) || 0,
        refNumber,
        applyDiscount,
        discountType,
        discountAmount: applyDiscount ? discountCalculation.discount_amount : 0,
        payableTotal,
        vatRelief: applyDiscount ? discountCalculation.vat_relief : 0,
        serviceChargeAmount
      });
    } else if (!open && onStateChange) {
      onStateChange(null);
    }
  }, [open, method, tenderedStr, refNumber, applyDiscount, discountType, discountCalculation, payableTotal, serviceChargeAmount, onStateChange]);

  const handleConfirm = async () => {
    const tValue = method === 'cash' ? (tendered || null) : null;
    const finalCategory = saleCategory === 'other' ? customCategory.trim() : saleCategory;
    const finalRef = (method === 'gcash' || method === 'maya') ? refNumber.trim() : '';
    const finalSubStoreId = dialogSubStoreId === 'parent' ? null : dialogSubStoreId;

    const finalMetadata = applyDiscount
      ? discountType === 'delivery_promo'
        ? [{
            type: 'DELIVERY_PROMO',
            platform: priceChannel,
            order_id: queueNumber.trim(),
            amount: discountCalculation.discount_amount,
            mode: deliveryPromoMode,
          }]
        : cardHolders.map(ch => ({
            type: discountType.toUpperCase(),
            id: ch.id.trim(),
            name: ch.name.trim()
          }))
      : [];

    await onConfirm(
      method,
      tValue,
      finalCategory,
      finalRef,
      queueNumber.trim(),
      finalSubStoreId,
      applyDiscount ? discountType : null,
      applyDiscount ? discountCalculation.discount_amount : 0,
      finalMetadata,
      discountCalculation.discountedItems,
      payableTotal
    );
  };

  const handleNumpadDigit = (digit: string) => {
    setTenderedStr(prev => {
      if (digit === '.') {
        if (prev.includes('.')) return prev;
        return prev ? `${prev}.` : '0.';
      }
      if (digit === '00') {
        if (!prev || prev === '0') return '0';
        if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
        return `${prev}00`;
      }
      if (prev === '0') return digit;
      if (prev.includes('.') && prev.split('.')[1].length >= 2) return prev;
      return `${prev}${digit}`;
    });
  };

  const handleNumpadBackspace = () => {
    setTenderedStr(prev => (prev.length > 0 ? prev.slice(0, -1) : ''));
  };

  const handleNumpadClear = () => {
    setTenderedStr('');
  };

  const handleAddBill = (val: number) => {
    const cur = parseFloat(tenderedStr) || 0;
    setTenderedStr(String(cur + val));
  };

  const quickAmounts = useMemo(() => QUICK_CASH_AMOUNTS(payableTotal), [payableTotal]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !processing) onClose(); }}>
      <DialogContent className="sm:max-w-3xl lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight">Collect Payment</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Confirm the payment method and tender amount before finalizing the transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] md:max-h-[70vh] pr-1">
          {/* Order Total & Live Visual Discount Breakdown */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gross Cart Total</span>
              <span className="text-sm font-bold text-muted-foreground">{formatPHP(cartTotal)}</span>
            </div>

            {applyDiscount && (
              <div className="pt-2 border-t border-dashed space-y-1 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="font-medium">Calculation Basis:</span>
                  <span className="font-bold text-foreground">
                    {discountMode === 'shared'
                      ? `${groupSize} Pax (${discountCount} ${discountType.toUpperCase()}, ${groupSize - discountCount} Reg) • ${(discountCalculation.seniorRatio * 100).toFixed(0)}% Share`
                      : `Itemized Selection (${targetUnitIds.size} item${targetUnitIds.size === 1 ? '' : 's'})`}
                  </span>
                </div>

                {discountCalculation.regular_gross > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Regular Share ({groupSize - discountCount} Pax):</span>
                    <span>{formatPHP(discountCalculation.regular_gross)}</span>
                  </div>
                )}

                <div className="flex justify-between text-muted-foreground">
                  <span>{discountType.toUpperCase()} Share ({discountCount} Pax Gross):</span>
                  <span>{formatPHP(discountCalculation.sc_gross)}</span>
                </div>

                {discountCalculation.vat_relief > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span>Less: 12% VAT Exemption (Relief):</span>
                    <span>- {formatPHP(discountCalculation.vat_relief)}</span>
                  </div>
                )}

                {discountCalculation.discount_amount > 0 && (
                  <div className="flex justify-between text-rose-500 font-semibold">
                    <span>Less: {discountType.toUpperCase()} Discount ({discountType === 'solo' ? '10%' : discountType === 'custom' ? `${customDiscountRate}%` : '20%'}):</span>
                    <span>- {formatPHP(discountCalculation.discount_amount)}</span>
                  </div>
                )}

                {discountCalculation.total_savings > 0 && (
                  <div className="flex justify-between font-bold text-emerald-600 dark:text-emerald-400 pt-1 border-t border-dashed">
                    <span>Total Customer Savings:</span>
                    <span>- {formatPHP(discountCalculation.total_savings)}</span>
                  </div>
                )}
              </div>
            )}

            {serviceChargeAmount > 0 && (
              <div className="flex justify-between items-center text-xs font-semibold text-foreground pt-1 border-t border-dashed">
                <span>Service Charge:</span>
                <span>+ {formatPHP(serviceChargeAmount)}</span>
              </div>
            )}

            <div className="flex justify-between items-center pt-2 border-t border-primary/20">
              <div>
                <span className="text-xs font-black text-muted-foreground uppercase tracking-wider block">Net Amount Due</span>
                <span className="text-[10px] text-muted-foreground">
                  {applyDiscount
                    ? `VATable: ${formatPHP(discountCalculation.vatable_sales)} | VAT: ${formatPHP(discountCalculation.vat_amount)} | Exempt: ${formatPHP(discountCalculation.vat_exempt_sales)}`
                    : 'Standard 12% VAT Inclusive'}
                </span>
              </div>
              <span className="text-2xl font-black text-primary">{formatPHP(payableTotal)}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-2">
            {/* Left Column: Payment Input */}
            <div className="space-y-4">
              {/* Payment Method - Touch-First 1-Tap Tiles */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Payment Method
                  </Label>
                  <span className="text-[10px] text-muted-foreground font-medium">1-Tap Select</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 select-none">
                  {([
                    { id: 'cash' as const, label: 'Cash', icon: Banknote },
                    { id: 'gcash' as const, label: 'GCash', icon: Smartphone },
                    { id: 'maya' as const, label: 'Maya', icon: Smartphone },
                    { id: 'card' as const, label: 'Card', icon: CreditCard },
                  ]).map(pm => {
                    const Icon = pm.icon;
                    const isSelected = method === pm.id;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setMethod(pm.id)}
                        className={`h-14 rounded-xl border flex flex-col items-center justify-center gap-1 font-bold text-xs transition-all active:scale-95 ${
                          isSelected
                            ? 'bg-primary text-primary-foreground border-primary shadow-md ring-2 ring-primary/20'
                            : 'bg-muted/30 hover:bg-muted/70 text-foreground border-border/80'
                        }`}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span>{pm.label}</span>
                      </button>
                    );
                  })}
                </div>
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
                    className="h-10 text-sm font-semibold"
                  />
                </div>
              )}

              {/* Cash Tendered — Touch-First with On-Screen POS Numpad */}
              {method === 'cash' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                        Amount Tendered (₱)
                      </Label>
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        Min: {formatPHP(payableTotal)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between border-2 rounded-xl px-4 py-2.5 bg-muted/20 border-primary/30">
                      <div className="space-y-0.5">
                        <div className="text-2xl font-black tracking-tight text-foreground flex items-center gap-1">
                          <span className="text-muted-foreground text-lg">₱</span>
                          <span>
                            {tenderedStr
                              ? Number(tenderedStr).toLocaleString('en-PH', {
                                minimumFractionDigits: tenderedStr.includes('.') ? tenderedStr.split('.')[1].length : 0,
                                maximumFractionDigits: 2,
                              })
                              : '0.00'}
                          </span>
                        </div>
                      </div>
                      {tenderedStr ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive font-bold active:scale-95"
                          onClick={handleNumpadClear}
                        >
                          Clear
                        </Button>
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-semibold text-muted-foreground">
                          Exact or Bills
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Smart Philippine Bill Denominations */}
                  <div className="space-y-1.5 select-none">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Quick Bills</p>
                      <span className="text-[10px] text-muted-foreground">Tap bill or add</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        variant={Math.abs(tendered - payableTotal) < 0.01 ? 'default' : 'outline'}
                        className="text-xs font-bold h-9 flex-1 min-w-[70px] rounded-lg active:scale-95"
                        onClick={() => setTenderedStr(payableTotal.toFixed(2))}
                      >
                        Exact
                      </Button>
                      {quickAmounts.map(amt => (
                        <Button
                          key={amt}
                          type="button"
                          size="sm"
                          variant={tendered === amt ? 'default' : 'outline'}
                          className="text-xs font-bold h-9 flex-1 min-w-[65px] rounded-lg active:scale-95"
                          onClick={() => setTenderedStr(String(amt))}
                        >
                          ₱{amt.toLocaleString()}
                        </Button>
                      ))}
                    </div>

                    {/* Quick Additive Bill Buttons */}
                    <div className="flex gap-1.5 pt-0.5">
                      {[50, 100, 500, 1000].map(addVal => (
                        <Button
                          key={addVal}
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="text-xs font-bold h-8 px-2 flex-1 bg-muted/60 hover:bg-muted active:scale-95 transition-all rounded-lg"
                          onClick={() => handleAddBill(addVal)}
                        >
                          +₱{addVal}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* On-Screen Touch Numpad */}
                  <div className="grid grid-cols-3 gap-2 pt-1 select-none">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                      <button
                        key={d}
                        type="button"
                        className="h-12 rounded-xl text-lg font-black bg-background border border-border shadow-sm hover:bg-primary/10 hover:border-primary active:scale-95 transition-transform flex items-center justify-center"
                        onClick={() => handleNumpadDigit(d)}
                      >
                        {d}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="h-12 rounded-xl text-base font-black bg-background border border-border shadow-sm hover:bg-primary/10 hover:border-primary active:scale-95 transition-transform flex items-center justify-center"
                      onClick={() => handleNumpadDigit('00')}
                    >
                      00
                    </button>
                    <button
                      type="button"
                      className="h-12 rounded-xl text-lg font-black bg-background border border-border shadow-sm hover:bg-primary/10 hover:border-primary active:scale-95 transition-transform flex items-center justify-center"
                      onClick={() => handleNumpadDigit('0')}
                    >
                      0
                    </button>
                    <button
                      type="button"
                      className="h-12 rounded-xl text-lg font-black bg-background border border-border shadow-sm hover:bg-primary/10 hover:border-primary active:scale-95 transition-transform flex items-center justify-center"
                      onClick={() => handleNumpadDigit('.')}
                    >
                      .
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-xl text-xs font-black col-span-2 text-destructive border border-destructive/30 hover:bg-destructive/10 active:scale-95 transition-transform flex items-center justify-center tracking-wider"
                      onClick={handleNumpadClear}
                    >
                      CLEAR
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-xl text-base font-bold border border-border hover:bg-muted active:scale-95 transition-transform flex items-center justify-center"
                      onClick={handleNumpadBackspace}
                      title="Backspace"
                    >
                      ⌫
                    </button>
                  </div>

                  {/* Change / Short By banner */}
                  {tendered > 0 && (
                    <div className={`flex justify-between items-center rounded-xl px-4 py-3 border font-black shadow-sm ${change >= 0
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                        : 'bg-destructive/15 border-destructive/40 text-destructive'
                      }`}>
                      <span className="text-xs uppercase tracking-wider">{change >= 0 ? 'Change Due' : 'Short by'}</span>
                      <span className="text-2xl">{formatPHP(Math.abs(change))}</span>
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

            {/* Right Column: Metadata & Attribution & Discounts */}
            <div className="space-y-4">
              {/* Sale Category */}
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Sale Category
                </Label>
                <div className="flex flex-wrap gap-1.5 select-none">
                  {saleCategories.map(cat => (
                    <Button
                      key={cat.value}
                      type="button"
                      variant={saleCategory === cat.value ? 'default' : 'outline'}
                      size="sm"
                      className={`h-9 px-3 text-xs font-bold rounded-lg transition-all active:scale-95 ${
                        saleCategory === cat.value ? 'shadow-sm ring-1 ring-primary/30' : ''
                      }`}
                      onClick={() => setSaleCategory(cat.value)}
                    >
                      {cat.label}
                    </Button>
                  ))}
                </div>
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

              {/* Queue / Table / Order Designation / Platform Order ID */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className={`text-xs uppercase tracking-wider font-semibold ${isDeliveryOrderNumRequired ? 'text-primary font-bold' : 'text-muted-foreground'}`}>
                    {isDelivery ? 'Platform Booking / Order ID' : 'Queue / Table / Order #'} {isDeliveryOrderNumRequired && <span className="text-destructive">*</span>}
                  </Label>
                  {isDelivery ? (
                    <div className="flex gap-1 select-none">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2 font-bold hover:bg-primary/10"
                        onClick={() => {
                          if (!queueNumber.startsWith('GF-')) setQueueNumber('GF-');
                        }}
                      >
                        +GF-
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] px-2 font-bold hover:bg-primary/10"
                        onClick={() => {
                          if (!queueNumber.startsWith('FP-')) setQueueNumber('FP-');
                        }}
                      >
                        +FP-
                      </Button>
                    </div>
                  ) : (
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
                  )}
                </div>
                <Input
                  value={queueNumber}
                  onChange={(e) => setQueueNumber(e.target.value)}
                  placeholder={isDelivery ? 'e.g. GF-8492, FP-1039' : 'e.g. Q-01, Table 5, 8742'}
                  className={`h-10 text-sm font-bold ${isDeliveryOrderNumRequired && !queueNumber.trim() ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {isDeliveryOrderNumRequired && !queueNumber.trim() && (
                  <p className="text-[11px] text-destructive font-semibold">
                    ⚠️ Platform Order ID is required when delivery promos or price modifications are applied.
                  </p>
                )}
              </div>

              {/* Discount Section */}
              <div className="border border-dashed rounded-lg p-3 space-y-3 bg-muted/20">
                <div className="flex items-center justify-between">
                  <Label htmlFor="apply-discount-toggle" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold cursor-pointer">
                    Apply Discount
                  </Label>
                  <input
                    type="checkbox"
                    id="apply-discount-toggle"
                    checked={applyDiscount}
                    onChange={(e) => setApplyDiscount(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </div>

                {applyDiscount && (
                  <div className="space-y-3 pt-2 border-t border-dashed">
                    {/* Mode Toggle (hide in delivery promo mode) */}
                    {discountType !== 'delivery_promo' && (
                      <div className="flex rounded-md bg-muted p-0.5 text-[10px] font-semibold">
                        <button
                          type="button"
                          onClick={() => handleDiscountModeChange('shared')}
                          className={`flex-1 py-1 px-2 rounded text-center transition-all ${discountMode === 'shared'
                              ? 'bg-background text-foreground shadow-sm font-bold'
                              : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                          Shared Table / Pax Split
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscountModeChange('itemized')}
                          className={`flex-1 py-1 px-2 rounded text-center transition-all ${discountMode === 'itemized'
                              ? 'bg-background text-foreground shadow-sm font-bold'
                              : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                          Itemized Dishes Selection
                        </button>
                      </div>
                    )}

                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase text-muted-foreground font-bold">Discount Type</Label>
                      <Select value={discountType} onValueChange={setDiscountType}>
                        <SelectTrigger className="h-9 text-xs font-semibold">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sc">Senior Citizen (20% + VAT Exempt)</SelectItem>
                          <SelectItem value="pwd">PWD (20% + VAT Exempt)</SelectItem>
                          <SelectItem value="mov">Medal of Valor (20% + VAT Exempt)</SelectItem>
                          <SelectItem value="solo">Solo Parent (10% + VAT Exempt)</SelectItem>
                          <SelectItem value="custom">Custom Promo Discount</SelectItem>
                          <SelectItem value="delivery_promo">Platform Delivery Voucher (Grab / Foodpanda)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {discountType === 'delivery_promo' && (
                      <div className="space-y-2.5 pt-1 bg-muted/40 p-2.5 rounded-xl border">
                        <div className="flex rounded-lg bg-muted p-0.5 text-xs font-bold">
                          <button
                            type="button"
                            onClick={() => setDeliveryPromoMode('fixed')}
                            className={`flex-1 py-1 px-2 rounded-md text-center transition-all ${
                              deliveryPromoMode === 'fixed'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Fixed Voucher (₱)
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeliveryPromoMode('percent')}
                            className={`flex-1 py-1 px-2 rounded-md text-center transition-all ${
                              deliveryPromoMode === 'percent'
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            Percentage Promo (%)
                          </button>
                        </div>

                        {deliveryPromoMode === 'fixed' ? (
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                              <span>Voucher Deduction (₱)</span>
                              <span>Max: {formatPHP(cartTotal * 0.5)} (50%)</span>
                            </div>
                            <Input
                              type="number"
                              min="0"
                              max={cartTotal * 0.5}
                              step="1"
                              value={deliveryPromoAmount || ''}
                              onChange={(e) => setDeliveryPromoAmount(Math.min(cartTotal * 0.5, Math.max(0, Number(e.target.value) || 0)))}
                              placeholder="e.g. 50.00"
                              className="h-10 text-sm font-bold bg-background"
                            />
                            {/* Quick Presets */}
                            <div className="flex gap-1.5 pt-1 select-none">
                              {[20, 30, 50, 100].filter(v => v <= cartTotal * 0.5).map(v => (
                                <Button
                                  key={v}
                                  type="button"
                                  variant={deliveryPromoAmount === v ? 'default' : 'outline'}
                                  size="sm"
                                  className="flex-1 h-8 text-xs font-bold rounded-lg"
                                  onClick={() => setDeliveryPromoAmount(v)}
                                >
                                  -₱{v}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold">
                              <span>Promo Rate (%)</span>
                              <span>Max: 50%</span>
                            </div>
                            <Input
                              type="number"
                              min="0"
                              max="50"
                              value={deliveryPromoRate || ''}
                              onChange={(e) => setDeliveryPromoRate(Math.min(50, Math.max(0, Number(e.target.value) || 0)))}
                              placeholder="e.g. 15%"
                              className="h-10 text-sm font-bold bg-background"
                            />
                            {/* Quick Presets */}
                            <div className="flex gap-1.5 pt-1 select-none">
                              {[10, 15, 20, 30].map(r => (
                                <Button
                                  key={r}
                                  type="button"
                                  variant={deliveryPromoRate === r ? 'default' : 'outline'}
                                  size="sm"
                                  className="flex-1 h-8 text-xs font-bold rounded-lg"
                                  onClick={() => setDeliveryPromoRate(r)}
                                >
                                  {r}%
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          💡 Applied across the Grab/Foodpanda order. Capped at 50% to prevent underdeclaration errors.
                        </p>
                      </div>
                    )}

                    {discountType === 'custom' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase text-muted-foreground">Rate (%)</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            className="h-8 text-xs"
                            value={customDiscountRate}
                            onChange={(e) => setCustomDiscountRate(Number(e.target.value) || 0)}
                          />
                        </div>
                        <div className="flex items-center space-x-2 pt-5">
                          <input
                            type="checkbox"
                            id="custom-exempt-toggle"
                            checked={customDiscountIsVatExempt}
                            onChange={(e) => setCustomDiscountIsVatExempt(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-primary"
                          />
                          <Label htmlFor="custom-exempt-toggle" className="text-[10px] uppercase text-muted-foreground cursor-pointer">
                            VAT Exempt
                          </Label>
                        </div>
                      </div>
                    )}

                    {discountType !== 'delivery_promo' && (
                      <>
                        {discountMode === 'shared' ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {/* Total Diners Stepper */}
                              <div className="space-y-1.5">
                                <Label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                  Total Diners (Pax)
                                </Label>
                                <div className="flex items-center border rounded-lg bg-background overflow-hidden h-9 shadow-sm">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-full px-3 rounded-none text-base font-bold hover:bg-muted active:scale-95"
                                    onClick={() => {
                                      const newSize = Math.max(1, groupSize - 1);
                                      setGroupSize(newSize);
                                      if (discountCount > newSize) updateDiscountCount(newSize);
                                    }}
                                    disabled={groupSize <= 1}
                                  >
                                    –
                                  </Button>
                                  <div className="flex-1 text-center font-black text-sm">
                                    {groupSize} <span className="text-[10px] font-normal text-muted-foreground">pax</span>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-full px-3 rounded-none text-base font-bold hover:bg-muted active:scale-95"
                                    onClick={() => setGroupSize(groupSize + 1)}
                                  >
                                    +
                                  </Button>
                                </div>
                                {/* Quick PAX presets */}
                                <div className="flex gap-1">
                                  {[1, 2, 4, 6, 8].map(p => (
                                    <Button
                                      key={p}
                                      type="button"
                                      variant={groupSize === p ? 'default' : 'outline'}
                                      size="sm"
                                      className="h-6 text-[10px] px-1.5 flex-1 font-semibold"
                                      onClick={() => {
                                        setGroupSize(p);
                                        if (discountCount > p) updateDiscountCount(p);
                                      }}
                                    >
                                      {p}
                                    </Button>
                                  ))}
                                </div>
                              </div>

                              {/* No. of ID Cards Stepper */}
                              <div className="space-y-1.5">
                                <div className="flex justify-between items-center">
                                  <Label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                                    ID Cards ({discountType.toUpperCase()})
                                  </Label>
                                  {groupSize > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => updateDiscountCount(groupSize)}
                                      className="text-[9px] text-primary hover:underline font-bold"
                                    >
                                      All ({groupSize})
                                    </button>
                                  )}
                                </div>
                                <div className="flex items-center border rounded-lg bg-background overflow-hidden h-9 shadow-sm">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-full px-3 rounded-none text-base font-bold hover:bg-muted active:scale-95"
                                    onClick={() => updateDiscountCount(Math.max(1, discountCount - 1))}
                                    disabled={discountCount <= 1}
                                  >
                                    –
                                  </Button>
                                  <div className="flex-1 text-center font-black text-sm">
                                    {discountCount} <span className="text-[10px] font-normal text-muted-foreground">card{discountCount > 1 ? 's' : ''}</span>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-full px-3 rounded-none text-base font-bold hover:bg-muted active:scale-95"
                                    onClick={() => updateDiscountCount(Math.min(groupSize, discountCount + 1))}
                                    disabled={discountCount >= groupSize}
                                  >
                                    +
                                  </Button>
                                </div>
                                {/* Quick Card presets */}
                                <div className="flex gap-1">
                                  {[1, 2, 3].filter(c => c <= groupSize).map(c => (
                                    <Button
                                      key={c}
                                      type="button"
                                      variant={discountCount === c ? 'default' : 'outline'}
                                      size="sm"
                                      className="h-6 text-[10px] px-1.5 flex-1 font-semibold"
                                      onClick={() => updateDiscountCount(c)}
                                    >
                                      {c}
                                    </Button>
                                  ))}
                                  {groupSize > 1 && discountCount !== groupSize && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-6 text-[10px] px-1.5 flex-1 font-semibold"
                                      onClick={() => updateDiscountCount(groupSize)}
                                    >
                                      All
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="bg-muted/40 rounded p-1.5 text-[10px] text-muted-foreground">
                              💡 <span className="font-semibold">{groupSize} total diners</span> with <span className="font-semibold">{discountCount} {discountType.toUpperCase()}</span> = <span className="text-primary font-bold">{((discountCount / groupSize) * 100).toFixed(0)}%</span> bill discount share.
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">
                              No. of Cardholders
                            </Label>
                            <div className="flex items-center border rounded-lg bg-background overflow-hidden h-9 shadow-sm max-w-[200px]">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-full px-3 rounded-none text-base font-bold hover:bg-muted active:scale-95"
                                onClick={() => {
                                  const cnt = Math.max(1, discountCount - 1);
                                  updateDiscountCount(cnt);
                                  setGroupSize(cnt);
                                }}
                                disabled={discountCount <= 1}
                              >
                                –
                              </Button>
                              <div className="flex-1 text-center font-black text-sm">
                                {discountCount}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-full px-3 rounded-none text-base font-bold hover:bg-muted active:scale-95"
                                onClick={() => {
                                  const cnt = discountCount + 1;
                                  updateDiscountCount(cnt);
                                  setGroupSize(cnt);
                                }}
                              >
                                +
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Card Holders Details */}
                        <div className="space-y-2 pt-1 border-t border-dashed">
                          <p className="text-[10px] font-bold uppercase text-muted-foreground">Cardholder Details ({cardHolders.length} Card{cardHolders.length === 1 ? '' : 's'})</p>
                          {cardHolders.map((ch, idx) => (
                            <div key={idx} className="grid grid-cols-2 gap-2 pt-0.5">
                              <Input
                                placeholder={`Cardholder #${idx + 1} Name`}
                                className="h-8 text-xs"
                                value={ch.name}
                                onChange={(e) => {
                                  const newCh = [...cardHolders];
                                  newCh[idx].name = e.target.value;
                                  setCardHolders(newCh);
                                }}
                              />
                              <Input
                                placeholder="ID / Booklet #"
                                className="h-8 text-xs font-mono"
                                value={ch.id}
                                onChange={(e) => {
                                  const newCh = [...cardHolders];
                                  newCh[idx].id = e.target.value;
                                  setCardHolders(newCh);
                                }}
                              />
                            </div>
                          ))}
                        </div>

                        {/* Itemized Selection list (Only when itemized mode active) */}
                        {discountMode === 'itemized' && (
                          <div className="space-y-2 pt-2 border-t border-dashed">
                            <div className="flex justify-between items-center">
                              <p className="text-[10px] font-bold uppercase text-muted-foreground">Select Discounted Items</p>
                              <span className="text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-bold">
                                Selected: {targetUnitIds.size} / {flatUnits.length}
                              </span>
                            </div>
                            <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                              {flatUnits.map(unit => (
                                <div key={unit.id} className="flex items-center justify-between p-1.5 hover:bg-muted/50 rounded text-xs">
                                  <span className="truncate max-w-[150px] font-medium">{unit.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">₱{unit.price.toFixed(2)}</span>
                                    <input
                                      type="checkbox"
                                      checked={targetUnitIds.has(unit.id)}
                                      onChange={() => handleToggleUnit(unit.id)}
                                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary"
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="outline" size="lg" onClick={onClose} disabled={processing} className="h-12 px-6 font-bold text-sm">
            Cancel
          </Button>
          <Button
            size="lg"
            onClick={handleConfirm}
            disabled={processing || !canConfirm}
            className="h-12 px-8 font-black text-sm flex-1 sm:flex-initial shadow-md active:scale-98 transition-transform"
          >
            {processing ? 'Processing…' : `Confirm & Pay ${PAYMENT_LABELS[method]} (${formatPHP(payableTotal)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
