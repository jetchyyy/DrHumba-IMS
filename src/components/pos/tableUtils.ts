export interface TableLabelItem {
  table_number: string;
}

export interface TableCapacityItem {
  capacity?: number | null;
}

export interface MergeSelectableTable {
  id: string;
  table_number: string;
  capacity: number;
  active_tab?: {
    id: string;
    status: string;
  } | null;
}

export type MergeSelectionClassification<T extends MergeSelectableTable = MergeSelectableTable> =
  | { mode: 'empty'; hint: string }
  | { mode: 'open_merged'; tables: T[]; totalCapacity: number }
  | { mode: 'attach_to_tab'; targetTabId: string; vacantTables: T[] }
  | { mode: 'merge_tabs'; targetTabId: string; sourceTabId: string }
  | { mode: 'invalid'; hint: string };

/**
 * Formats one or more merged tables into a consistent display label (e.g. "1 + 2").
 */
export function formatTableGroupLabel(
  tables?: TableLabelItem[] | null,
  fallback?: string
): string {
  if (tables && tables.length > 0) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const tbl of tables) {
      const label = (tbl.table_number || '').trim();
      if (label && !seen.has(label)) {
        seen.add(label);
        names.push(label);
      }
    }
    if (names.length > 0) {
      return names.join(' + ');
    }
  }
  return (fallback || '').trim();
}

/**
 * Sums the seating capacity of a group of tables.
 */
export function getCombinedTableCapacity(
  tables?: TableCapacityItem[] | null,
  fallback = 4
): number {
  if (!tables || tables.length === 0) return fallback;
  const sum = tables.reduce((acc, tbl) => acc + Math.max(0, Number(tbl.capacity || 0)), 0);
  return sum > 0 ? sum : fallback;
}

/**
 * Builds a compact kitchen control number from a table group label and round number.
 */
export function buildKitchenControlNumber(tableLabel: string, roundNumber: number): string {
  const compact = (tableLabel || '')
    .trim()
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, '');
  return `T${compact}-R${roundNumber}`;
}

/**
 * Classifies the currently selected tables in Merge Mode into an actionable operation or hint.
 */
export function classifyMergeSelection<T extends MergeSelectableTable>(
  selectedTables: T[]
): MergeSelectionClassification<T> {
  if (selectedTables.length === 0) {
    return {
      mode: 'empty',
      hint: 'Select 2+ vacant tables to open together, 1 active tab + vacant tables to expand, or 2 active tabs to combine bills.',
    };
  }

  const vacantTables = selectedTables.filter(t => !t.active_tab);
  const occupiedTables = selectedTables.filter(t => Boolean(t.active_tab));

  // Preserve selection order for distinct active tab IDs
  const distinctTabIds: string[] = [];
  for (const tbl of occupiedTables) {
    const tabId = tbl.active_tab?.id;
    if (tabId && !distinctTabIds.includes(tabId)) {
      distinctTabIds.push(tabId);
    }
  }

  if (distinctTabIds.length === 0) {
    if (vacantTables.length < 2) {
      return {
        mode: 'invalid',
        hint: 'Select at least 1 more vacant table (or an active tab) to merge.',
      };
    }
    return {
      mode: 'open_merged',
      tables: vacantTables,
      totalCapacity: getCombinedTableCapacity(vacantTables),
    };
  }

  if (distinctTabIds.length === 1) {
    if (vacantTables.length === 0) {
      return {
        mode: 'invalid',
        hint: 'Select vacant table(s) to attach, or select a second active tab to combine bills.',
      };
    }
    return {
      mode: 'attach_to_tab',
      targetTabId: distinctTabIds[0],
      vacantTables,
    };
  }

  if (distinctTabIds.length === 2) {
    if (vacantTables.length > 0) {
      return {
        mode: 'invalid',
        hint: 'Merge 2 active tabs first before attaching extra vacant tables.',
      };
    }
    return {
      mode: 'merge_tabs',
      targetTabId: distinctTabIds[0],
      sourceTabId: distinctTabIds[1],
    };
  }

  return {
    mode: 'invalid',
    hint: 'Select at most 2 active tabs to merge at a time.',
  };
}

/**
 * Returns a unique identifier for a cart row so merged tab items with identical menu_item_id never collide.
 */
export function resolveCartItemKey(item: { tab_item_id?: string; menu_item_id: string }): string {
  return item.tab_item_id ? `tab:${item.tab_item_id}` : `unsent:${item.menu_item_id}`;
}

export interface DiscountCartRowInput {
  menu_item_id: string;
  tab_item_id?: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

export interface FlatDiscountUnit {
  id: string;
  rowKey: string;
  menu_item_id: string;
  price: number;
  name: string;
  notes?: string;
}

export interface DiscountedUnitInput extends FlatDiscountUnit {
  discount_amount: number;
  vatable_sales: number;
  vat_amount: number;
  vat_exempt_sales: number;
  is_vat_exempt: boolean;
}

export interface GroupedDiscountItem {
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

/**
 * Expands cart rows into per-unit entries using unique row keys so merged rows sharing menu_item_id never collide.
 */
export function buildFlatDiscountUnits(cart: DiscountCartRowInput[]): FlatDiscountUnit[] {
  const units: FlatDiscountUnit[] = [];
  cart.forEach((item, idx) => {
    const rowKey = item.tab_item_id ? `tab:${item.tab_item_id}` : `row:${idx}:${item.menu_item_id}`;
    for (let q = 0; q < item.quantity; q++) {
      units.push({
        id: `${rowKey}-${q}`,
        rowKey,
        menu_item_id: item.menu_item_id,
        price: item.price,
        name: item.name,
        notes: item.notes,
      });
    }
  });
  return units;
}

/**
 * Re-aggregates unit-level discount calculations by cart row key, preserving per-row notes and prices.
 */
export function groupDiscountedUnitResults(units: DiscountedUnitInput[]): GroupedDiscountItem[] {
  const groupedMap: Record<string, GroupedDiscountItem> = {};
  for (const unit of units) {
    if (!groupedMap[unit.rowKey]) {
      groupedMap[unit.rowKey] = {
        menu_item_id: unit.menu_item_id,
        quantity: 0,
        price: unit.price,
        name: unit.name,
        notes: unit.notes,
        discount_amount: 0,
        vatable_sales: 0,
        vat_amount: 0,
        vat_exempt_sales: 0,
        is_vat_exempt: false,
      };
    }
    const gi = groupedMap[unit.rowKey];
    gi.quantity += 1;
    gi.discount_amount += unit.discount_amount;
    gi.vatable_sales += unit.vatable_sales;
    gi.vat_amount += unit.vat_amount;
    gi.vat_exempt_sales += unit.vat_exempt_sales;
    if (unit.is_vat_exempt) {
      gi.is_vat_exempt = true;
    }
  }
  return Object.values(groupedMap);
}

/**
 * Returns true once an order line has been sent to the kitchen (either 'sent' or 'served').
 */
export function isKitchenSubmitted(item: { kitchen_status?: string }): boolean {
  return item.kitchen_status === 'sent' || item.kitchen_status === 'served';
}

export interface OrderRoundItemLike {
  menu_item_id: string;
  tab_item_id?: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  round_number?: number;
  kitchen_status?: string;
}

export interface GroupedOrderRound<T extends OrderRoundItemLike = OrderRoundItemLike> {
  roundNumber: number;
  items: T[];
}

export interface GroupedOrderSummary<T extends OrderRoundItemLike = OrderRoundItemLike> {
  rounds: GroupedOrderRound<T>[];
  unsentItems: T[];
  servedCount: number;
  submittedCount: number;
}

/**
 * Groups table order items by kitchen round while separating local unsent items and tracking served counts.
 */
export function groupOrderItemsByRound<T extends OrderRoundItemLike>(
  cart: T[]
): GroupedOrderSummary<T> {
  const unsentItems: T[] = [];
  const roundsMap = new Map<number, T[]>();
  let servedCount = 0;
  let submittedCount = 0;

  for (const item of cart) {
    if (!isKitchenSubmitted(item)) {
      unsentItems.push(item);
      continue;
    }
    submittedCount += 1;
    if (item.kitchen_status === 'served') {
      servedCount += 1;
    }
    const roundNum = Math.max(1, Number(item.round_number || 1));
    const bucket = roundsMap.get(roundNum);
    if (bucket) {
      bucket.push(item);
    } else {
      roundsMap.set(roundNum, [item]);
    }
  }

  const rounds: GroupedOrderRound<T>[] = Array.from(roundsMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([roundNumber, items]) => ({ roundNumber, items }));

  return {
    rounds,
    unsentItems,
    servedCount,
    submittedCount,
  };
}

export interface SortableTableLike {
  id?: string;
  table_number: string;
  display_order?: number | null;
}

/**
 * Sorts restaurant tables by explicit display_order first, then naturally by table_number (1, 2, ..., 9, 10).
 */
export function sortRestaurantTables<T extends SortableTableLike>(tables: T[]): T[] {
  return [...tables].sort((a, b) => {
    const hasA = typeof a.display_order === 'number' && Number.isFinite(a.display_order);
    const hasB = typeof b.display_order === 'number' && Number.isFinite(b.display_order);

    if (hasA && hasB && a.display_order !== b.display_order) {
      return (a.display_order as number) - (b.display_order as number);
    }
    if (hasA && !hasB) return -1;
    if (!hasA && hasB) return 1;

    return (a.table_number || '').localeCompare(b.table_number || '', undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  });
}

/**
 * Moves a table up or down by one slot and renumbers display_order sequentially from 1.
 */
export function moveTableInOrder<T extends { id: string; display_order?: number | null }>(
  tables: T[],
  tableId: string,
  direction: 'up' | 'down'
): T[] {
  const index = tables.findIndex(t => t.id === tableId);
  if (index === -1) return tables;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= tables.length) {
    return tables;
  }

  const next = [...tables];
  const [moved] = next.splice(index, 1);
  next.splice(targetIndex, 0, moved);
  return next.map((tbl, idx) => ({ ...tbl, display_order: idx + 1 }));
}
