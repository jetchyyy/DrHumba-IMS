import { supabase } from './supabase';

/**
 * Pack sizes (pieces per pack) each item has actually been portioned into,
 * taken from approved portioning requests. Keyed by inventory item id,
 * sorted ascending. Items never portioned in pack mode are absent.
 */
export type PortionPackSizes = Record<string, number[]>;

export const fetchPortionPackSizes = async (): Promise<PortionPackSizes> => {
  const { data, error } = await supabase
    .from('portioning_requests')
    .select('target_item_id, pieces_per_pack')
    .eq('status', 'approved')
    .not('pieces_per_pack', 'is', null);

  if (error) {
    console.error('Failed to load portion pack sizes:', error);
    return {};
  }

  const sets: Record<string, Set<number>> = {};
  ((data as { target_item_id: string; pieces_per_pack: number | string }[]) || []).forEach(row => {
    const size = Number(row.pieces_per_pack);
    if (!row.target_item_id || !(size > 0)) return;
    (sets[row.target_item_id] ||= new Set()).add(size);
  });

  const result: PortionPackSizes = {};
  Object.entries(sets).forEach(([itemId, sizes]) => {
    result[itemId] = Array.from(sizes).sort((a, b) => a - b);
  });
  return result;
};

/** e.g. "Packs of 5 / 10 pcs" */
export const formatPackSizes = (sizes: number[], unit: string) =>
  `Packs of ${sizes.join(' / ')} ${unit === 'pack' ? 'pcs' : unit}`;

/**
 * Pack size options for an item. Portioned items offer every size they were
 * packed in (plus the catalog standard, if any); other items fall back to the
 * catalog's fixed conversion factor.
 */
export const getPackSizeOptions = (
  item: { id: string; conversion_factor?: number | null } | undefined,
  portionPackSizes: PortionPackSizes
): number[] => {
  if (!item) return [];
  const sizes = new Set(portionPackSizes[item.id] || []);
  const factor = Number(item.conversion_factor);
  if (factor > 1) sizes.add(factor);
  return Array.from(sizes).sort((a, b) => a - b);
};
