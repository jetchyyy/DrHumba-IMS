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
  inventory_item_id?: string | null;
  linked_selling_price?: number | null;
  linked_foodpanda_price?: number | null;
  linked_grab_price?: number | null;
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
  tab_item_id?: string;
  round_number?: number;
  kitchen_status?: 'pending' | 'sent' | 'served' | 'cancelled';
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
  initialDiscountType?: string | null;
  initialDiscountAmount?: number;
  initialDiscountMetadata?: any[];
  initialGroupSize?: number;
  initialQueueNumber?: string;
}

export interface LastSaleResult {
  id: string;
  change: number;
  change_given?: number | null;
  method: string;
  payment_method?: string;
  amount_tendered?: number | null;
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

export interface RestaurantTable {
  id: string;
  tenant_id?: string;
  branch_id: string;
  table_number: string;
  zone: string;
  capacity: number;
  status: 'available' | 'occupied' | 'billed_out' | 'cleaning' | 'reserved';
  is_active: boolean;
  current_tab_id?: string | null;
  created_at?: string;
}

export interface PosTab {
  id: string;
  tenant_id?: string;
  branch_id: string;
  table_id: string;
  server_id?: string | null;
  server_name?: string | null;
  pax_count: number;
  status: 'open' | 'billed_out' | 'settled' | 'cancelled';
  notes?: string | null;
  discount_type?: string | null;
  discount_amount?: number;
  discount_metadata?: any[];
  sale_id?: string | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
}

export interface PosTabItem {
  id?: string;
  tab_id?: string;
  menu_item_id: string;
  quantity: number;
  price: number;
  notes?: string | null;
  round_number: number;
  kitchen_status: 'pending' | 'sent' | 'served' | 'cancelled';
  name?: string;
}

export interface KitchenOrderSentPayload {
  id: string;
  table_number: string;
  round_number: number;
  server_name: string;
  cashier_name?: string;
  cashier_email?: string;
  items: Array<{ item_name: string; quantity: number; notes?: string }>;
  notes?: string;
  created_at: string;
  control_number: string;
  sale_category: string;
  branch_name?: string;
}

export type { RunningBillSlipData } from '../../lib/printService';

