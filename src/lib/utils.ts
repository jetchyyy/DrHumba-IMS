import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function cleanQuantity(val: number | null | undefined): number {
  if (val === null || val === undefined || isNaN(val)) return 0;
  if (Math.abs(val) < 0.0001) return 0;
  return Number(val.toFixed(4));
}

export function formatCleanQuantity(val: number | null | undefined, maxDecimals = 3): string {
  const clean = cleanQuantity(val);
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: maxDecimals,
  }).format(clean);
}

export interface BranchInventoryCatalogItem {
  available_branches?: string[] | null;
  category?: string | null;
}

export function getBranchInventoryCatalog<T extends BranchInventoryCatalogItem>(
  items: T[],
  branchId?: string
) {
  const availableItems = items.filter(item =>
    !item.available_branches ||
    item.available_branches.length === 0 ||
    Boolean(branchId && item.available_branches.includes(branchId))
  );

  const categories = Array.from(new Set(
    availableItems
      .map(item => item.category)
      .filter((category): category is string => Boolean(category))
  )).sort();

  return { items: availableItems, categories };
}

export function getInventoryItemsForCategory<T extends BranchInventoryCatalogItem>(
  items: T[],
  category: string
) {
  if (category === 'All') return items;
  return items.filter(item => item.category === category);
}

export interface Branch {
  id: string;
  name: string;
  is_warehouse: boolean;
  location: string | null;
  status?: string;
  parent_id?: string | null;
  service_charge_rate?: number | null;
}

export interface OrganizedBranch extends Branch {
  isSubStore?: boolean;
  parentName?: string;
}

/**
 * Organizes a list of branches into a hierarchical list (parent followed by its sub-stores).
 */
export function getOrganizedBranches(branches: Branch[]): OrganizedBranch[] {
  const parents = branches.filter(b => !b.parent_id);
  const subStores = branches.filter(b => b.parent_id);
  
  const result: OrganizedBranch[] = [];
  
  // Sort parents alphabetically by name
  parents.sort((a, b) => a.name.localeCompare(b.name));
  
  for (const parent of parents) {
    result.push(parent);
    // Find children of this parent and sort them alphabetically
    const children = subStores.filter(c => c.parent_id === parent.id);
    children.sort((a, b) => a.name.localeCompare(b.name));
    
    for (const child of children) {
      result.push({
        ...child,
        isSubStore: true,
        parentName: parent.name
      });
    }
  }
  
  // Append any orphaned sub-stores
  for (const child of subStores) {
    if (!parents.some(p => p.id === child.parent_id)) {
      result.push({
        ...child,
        isSubStore: true,
        parentName: 'Unknown'
      });
    }
  }
  
  return result;
}

export interface BranchPriceOverrideRow {
  branch_id: string;
  menu_item_id?: string | null;
  inventory_item_id?: string | null;
  price?: number | string | null;
  foodpanda_price?: number | string | null;
  grab_price?: number | string | null;
}

export interface BranchPriceOverrideEntry {
  price?: number;
  foodpanda_price?: number;
  grab_price?: number;
}

export type PosBranchPriceMap = Record<string, Record<string, BranchPriceOverrideEntry>>;

export interface PosPricedItem {
  id: string;
  price: number | string;
  foodpanda_price?: number | string | null;
  grab_price?: number | string | null;
  inventory_item_id?: string | null;
  linked_selling_price?: number | string | null;
  linked_foodpanda_price?: number | string | null;
  linked_grab_price?: number | string | null;
}

/**
 * Resolves the initial active POS sub-store without silently switching a parent-branch
 * register into its first child sub-store unless explicitly saved or assigned on the profile.
 */
export function resolveInitialPosSubStore<T extends { id: string; parent_id?: string | null }>(
  kids: T[],
  branches: T[],
  savedSubId: string | null | undefined,
  profileBranchId: string | null | undefined,
  selectedBranchId: string
): T | null {
  if (savedSubId === 'parent') {
    return null;
  }

  if (savedSubId) {
    const savedSub = kids.find(s => s.id === savedSubId);
    if (savedSub) return savedSub;
  }

  if (profileBranchId) {
    const profileBranch = branches.find(b => b.id === profileBranchId);
    if (profileBranch && profileBranch.parent_id === selectedBranchId) {
      const activeKid = kids.find(s => s.id === profileBranch.id);
      if (activeKid) return activeKid;
    }
  }

  return null;
}

/**
 * Builds the branch/sub-store override price map while merging positive values so null fields
 * on inventory-level override rows never overwrite valid menu-item override prices.
 */
export function buildPosBranchPriceMap(
  bpData: BranchPriceOverrideRow[],
  menuItems: Array<{ id: string; inventory_item_id?: string | null }>
): PosBranchPriceMap {
  const bpMap: PosBranchPriceMap = {};

  const parsePositive = (val: number | string | null | undefined): number | undefined => {
    if (val === null || val === undefined || val === '') return undefined;
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : undefined;
  };

  const mergeInto = (branchId: string, key: string, incoming: BranchPriceOverrideEntry, preferIncoming: boolean) => {
    if (!bpMap[branchId]) bpMap[branchId] = {};
    const existing = bpMap[branchId][key] || {};
    bpMap[branchId][key] = {
      price: preferIncoming ? (incoming.price ?? existing.price) : (existing.price ?? incoming.price),
      foodpanda_price: preferIncoming ? (incoming.foodpanda_price ?? existing.foodpanda_price) : (existing.foodpanda_price ?? incoming.foodpanda_price),
      grab_price: preferIncoming ? (incoming.grab_price ?? existing.grab_price) : (existing.grab_price ?? incoming.grab_price),
    };
  };

  for (const bp of bpData) {
    if (!bp?.branch_id) continue;
    const parsed: BranchPriceOverrideEntry = {
      price: parsePositive(bp.price),
      foodpanda_price: parsePositive(bp.foodpanda_price),
      grab_price: parsePositive(bp.grab_price),
    };

    if (bp.menu_item_id) {
      // Menu-item specific overrides take priority over inventory-item overrides
      mergeInto(bp.branch_id, bp.menu_item_id, parsed, true);
    }

    if (bp.inventory_item_id) {
      mergeInto(bp.branch_id, bp.inventory_item_id, parsed, !bp.menu_item_id);
      const linkedMenuItems = menuItems.filter(mi => mi.inventory_item_id === bp.inventory_item_id);
      for (const targetMenuItem of linkedMenuItems) {
        // Only fill missing fields on menu item key unless this row itself targeted menu_item_id
        mergeInto(bp.branch_id, targetMenuItem.id, parsed, bp.menu_item_id === targetMenuItem.id);
      }
    }
  }

  return bpMap;
}

/**
 * Resolves the effective unit price for a POS menu item across sub-store overrides,
 * parent-branch overrides, channel prices, and linked retail catalog fallbacks.
 */
export function resolvePosItemPrice(
  item: PosPricedItem,
  channel: 'standard' | 'foodpanda' | 'grab',
  branchPrices: PosBranchPriceMap,
  selectedBranchId?: string | null,
  selectedSubStoreId?: string | null
): number {
  const getMergedOverride = (branchId?: string | null): BranchPriceOverrideEntry | undefined => {
    if (!branchId || !branchPrices[branchId]) return undefined;
    const byMenu = branchPrices[branchId][item.id];
    const byInv = item.inventory_item_id ? branchPrices[branchId][item.inventory_item_id] : undefined;
    if (!byMenu && !byInv) return undefined;
    return {
      price: byMenu?.price ?? byInv?.price,
      foodpanda_price: byMenu?.foodpanda_price ?? byInv?.foodpanda_price,
      grab_price: byMenu?.grab_price ?? byInv?.grab_price,
    };
  };

  const subBp = getMergedOverride(selectedSubStoreId);
  const parentBp = getMergedOverride(selectedBranchId);

  if (channel === 'foodpanda') {
    if (subBp?.foodpanda_price && subBp.foodpanda_price > 0) return subBp.foodpanda_price;
    if (parentBp?.foodpanda_price && parentBp.foodpanda_price > 0) return parentBp.foodpanda_price;
    if (item.foodpanda_price && Number(item.foodpanda_price) > 0) return Number(item.foodpanda_price);
    if (item.linked_foodpanda_price && Number(item.linked_foodpanda_price) > 0) return Number(item.linked_foodpanda_price);
  }

  if (channel === 'grab') {
    if (subBp?.grab_price && subBp.grab_price > 0) return subBp.grab_price;
    if (parentBp?.grab_price && parentBp.grab_price > 0) return parentBp.grab_price;
    if (item.grab_price && Number(item.grab_price) > 0) return Number(item.grab_price);
    if (item.linked_grab_price && Number(item.linked_grab_price) > 0) return Number(item.linked_grab_price);
  }

  if (subBp?.price && subBp.price > 0) return subBp.price;
  if (parentBp?.price && parentBp.price > 0) return parentBp.price;

  const basePrice = Number(item.price) || 0;
  if (basePrice > 0) return basePrice;

  // Fallback for retail-linked items whose menu_items.price became 0 while inventory_items.selling_price holds a real price (> 0.01 sentinel)
  const linkedPrice = item.linked_selling_price !== null && item.linked_selling_price !== undefined
    ? Number(item.linked_selling_price)
    : 0;
  if (linkedPrice > 0.01) return linkedPrice;

  return basePrice;
}

