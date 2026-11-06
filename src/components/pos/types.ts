export type PriceChannel = 'standard' | 'foodpanda' | 'grab';

export type PaymentMethod = 'cash' | 'card' | 'gcash' | 'maya' | 'other';

export interface MenuItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  is_available: boolean;
  foodpanda_price?: number | null;
  grab_price?: number | null;
}

export interface CartItem {
  menu_item_id: string;
  name: string;
  price: number;
  original_price?: number;
  quantity: number;
  needsAdjustment?: boolean;
  notes?: string;
  price_adjustment_reason?: string;
}

export interface ItemAvailability {
  stockAvailable: boolean;
  hasSufficientStock: boolean;
}

export interface PaymentState {
  method: PaymentMethod;
  tendered: number;
  refNumber: string;
  applyDiscount?: boolean;
  discountType?: string;
  discountAmount?: number;
  payableTotal?: number;
  vatRelief?: number;
  serviceChargeAmount?: number;
}

export interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  cartTotal: number;
  cart: CartItem[];
  onConfirm: (
    method: PaymentMethod,
    tendered: number | null,
    saleCategory: string,
    referenceNumber: string,
    queueNumber: string,
    subStoreId: string | null,
    discountType: string | null,
    discountAmount: number,
    discountMetadata: any[],
    discountedItems: any[],
    payableTotal?: number
  ) => Promise<void>;
  processing: boolean;
  onStateChange?: (state: PaymentState | null) => void;
  saleCategories: Array<{ value: string; label: string }>;
  defaultSaleCategory: string;
  subStores: any[];
  initialSubStore: any | null;
  serviceChargeRate?: number;
  priceChannel?: PriceChannel;
}

export interface LastSaleResult {
  id: string;
  change: number;
  method: string;
  sale_category?: string;
  reference_number?: string;
  control_number?: string;
  queue_number?: string | null;
  notes?: string | null;
  items?: any[];
  branch_name?: string;
  cashier_email?: string;
  total_amount?: number;
  created_at?: string;
  service_charge_rate?: number;
  service_charge_amount?: number;
  discount_amount?: number;
  discount_type?: string | null;
  discount_metadata?: any;
  vatable_sales?: number;
  vat_amount?: number;
  vat_exempt_sales?: number;
}

export interface EditingPriceItem {
  menu_item_id: string;
  name: string;
  currentPrice: number;
  catalogPrice: number;
}

export const COMMON_ITEM_NOTES = [
  'No Veggies',
  'No Onions',
  'No Ice',
  'Less Ice',
  'Extra Spicy',
  'Less Spicy',
  'Separate Sauce',
  'Extra Sauce',
  'No Mayo',
  'Well Done'
];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Credit / Debit Card',
  gcash: 'GCash',
  maya: 'Maya',
  other: 'Other',
};

export const formatPHP = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(n);

export const QUICK_CASH_AMOUNTS = (total: number): number[] => {
  const ceil50 = Math.ceil(total / 50) * 50;
  const ceil100 = Math.ceil(total / 100) * 100;
  const suggestions = new Set<number>();

  if (ceil50 >= total) suggestions.add(ceil50);
  if (ceil100 >= total) suggestions.add(ceil100);

  // Common Philippine denominations
  if (total <= 500) suggestions.add(500);
  if (total <= 1000) suggestions.add(1000);
  if (total > 1000) {
    suggestions.add(Math.ceil(total / 500) * 500);
    suggestions.add(Math.ceil(total / 1000) * 1000);
  }

  return Array.from(suggestions)
    .filter(v => v >= total)
    .sort((a, b) => a - b)
    .slice(0, 4);
};
