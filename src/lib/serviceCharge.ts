export interface BranchRateLike {
  id: string;
  name: string;
  is_warehouse?: boolean;
  parent_id?: string | null;
  service_charge_rate?: number | null;
}

export interface JoinedNameRel {
  name?: string | null;
}

export interface ServiceChargeSaleRow {
  id: string;
  control_number: string | null;
  branch_id: string;
  sub_store_id?: string | null;
  cashier_id: string | null;
  total_amount: number;
  service_charge_rate?: number | null;
  service_charge_amount?: number | null;
  sale_category?: string | null;
  status?: string | null;
  created_at: string;
  branches?: JoinedNameRel | JoinedNameRel[] | null;
  sub_stores?: JoinedNameRel | JoinedNameRel[] | null;
}

export interface BranchServiceChargeBreakdown {
  branchId: string;
  branchName: string;
  parentName: string | null;
  isSubStore: boolean;
  configuredRate: number;
  orderCount: number;
  salesTotal: number;
  serviceChargeTotal: number;
  sharePercent: number;
}

export interface ServiceChargeSummary {
  totalServiceCharge: number;
  orderCount: number;
  salesTotal: number;
  averageServiceCharge: number;
  branchBreakdown: BranchServiceChargeBreakdown[];
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Safely normalizes Supabase relational joins that may return either an object or an array of objects.
 */
export function normalizeJoinedName(
  rel: JoinedNameRel | JoinedNameRel[] | null | undefined
): string | null {
  if (!rel) return null;
  const item = Array.isArray(rel) ? rel[0] : rel;
  return item?.name ?? null;
}

export interface BranchServiceChargeDetails {
  rate: number;
  source: 'branch' | 'parent' | 'tenant';
  parentName: string | null;
}

/**
 * Resolves the effective service charge rate (%) and inheritance source for a branch or sub-store,
 * honoring explicit 0% exemptions without falling back to the tenant default.
 */
export function resolveBranchServiceChargeDetails(
  branch: BranchRateLike | null | undefined,
  branches: BranchRateLike[],
  tenantDefaultRate?: number | null
): BranchServiceChargeDetails {
  if (branch?.service_charge_rate !== null && branch?.service_charge_rate !== undefined) {
    return { rate: Number(branch.service_charge_rate), source: 'branch', parentName: null };
  }
  if (branch?.parent_id) {
    const parent = branches.find(b => b.id === branch.parent_id);
    if (parent?.service_charge_rate !== null && parent?.service_charge_rate !== undefined) {
      return {
        rate: Number(parent.service_charge_rate),
        source: 'parent',
        parentName: parent.name,
      };
    }
  }
  return { rate: Number(tenantDefaultRate ?? 0), source: 'tenant', parentName: null };
}

/**
 * Resolves the effective service charge rate (%) for a branch or sub-store,
 * honoring explicit 0% exemptions without falling back to the tenant default.
 */
export function resolveBranchServiceChargeRate(
  branch: BranchRateLike | null | undefined,
  branches: BranchRateLike[],
  tenantDefaultRate?: number | null
): number {
  return resolveBranchServiceChargeDetails(branch, branches, tenantDefaultRate).rate;
}

/**
 * Checks whether a sale row belongs to the active branch/sub-store filter.
 * Selecting a parent branch matches both its direct sales and its sub-stores' sales.
 */
export function matchesServiceChargeBranchFilter(
  sale: Pick<ServiceChargeSaleRow, 'branch_id' | 'sub_store_id'>,
  filterBranchId: string,
  branches: BranchRateLike[]
): boolean {
  if (!filterBranchId || filterBranchId === 'ALL') return true;
  const target = branches.find(b => b.id === filterBranchId);
  if (target?.parent_id) {
    return sale.sub_store_id === filterBranchId;
  }
  return sale.branch_id === filterBranchId || sale.sub_store_id === filterBranchId;
}

/**
 * Aggregates completed service-charge sales overall and by branch/sub-store.
 */
export function aggregateServiceCharge(
  sales: ServiceChargeSaleRow[],
  branches: BranchRateLike[],
  tenantDefaultRate?: number | null,
  filterBranchId = 'ALL'
): ServiceChargeSummary {
  const branchById = new Map<string, BranchRateLike>();
  for (const branch of branches) {
    branchById.set(branch.id, branch);
  }

  const buckets = new Map<string, BranchServiceChargeBreakdown>();

  const ensureBucket = (
    targetId: string,
    fallbackName?: string | null,
    parentBranchId?: string | null
  ): BranchServiceChargeBreakdown => {
    const existing = buckets.get(targetId);
    if (existing) return existing;

    const branch = branchById.get(targetId);
    const resolvedParentId = branch?.parent_id ?? (parentBranchId && parentBranchId !== targetId ? parentBranchId : null);
    const parent = resolvedParentId ? branchById.get(resolvedParentId) : undefined;
    const isSubStore = Boolean(resolvedParentId);

    const created: BranchServiceChargeBreakdown = {
      branchId: targetId,
      branchName: branch?.name || fallbackName || 'Unknown Branch',
      parentName: parent?.name ?? null,
      isSubStore,
      configuredRate: resolveBranchServiceChargeRate(branch, branches, tenantDefaultRate),
      orderCount: 0,
      salesTotal: 0,
      serviceChargeTotal: 0,
      sharePercent: 0,
    };
    buckets.set(targetId, created);
    return created;
  };

  if (filterBranchId === 'ALL') {
    for (const branch of branches) {
      if (!branch.is_warehouse) {
        ensureBucket(branch.id);
      }
    }
  } else {
    const selected = branchById.get(filterBranchId);
    if (selected) {
      ensureBucket(selected.id);
      if (!selected.parent_id) {
        for (const child of branches) {
          if (child.parent_id === selected.id && !child.is_warehouse) {
            ensureBucket(child.id);
          }
        }
      }
    }
  }

  let totalServiceCharge = 0;
  let orderCount = 0;
  let salesTotal = 0;

  for (const sale of sales) {
    if (sale.status && sale.status !== 'completed') continue;
    const scAmount = Number(sale.service_charge_amount ?? 0);
    if (!(scAmount > 0)) continue;
    if (!matchesServiceChargeBranchFilter(sale, filterBranchId, branches)) continue;

    const saleTotal = Number(sale.total_amount ?? 0);
    const targetBranchId = sale.sub_store_id || sale.branch_id;
    const joinedName = sale.sub_store_id
      ? normalizeJoinedName(sale.sub_stores)
      : normalizeJoinedName(sale.branches);
    const bucket = ensureBucket(targetBranchId, joinedName, sale.branch_id);

    bucket.orderCount += 1;
    bucket.salesTotal = round2(bucket.salesTotal + saleTotal);
    bucket.serviceChargeTotal = round2(bucket.serviceChargeTotal + scAmount);

    orderCount += 1;
    salesTotal = round2(salesTotal + saleTotal);
    totalServiceCharge = round2(totalServiceCharge + scAmount);
  }

  const branchBreakdown = Array.from(buckets.values())
    .map(entry => ({
      ...entry,
      sharePercent:
        totalServiceCharge > 0
          ? round2((entry.serviceChargeTotal / totalServiceCharge) * 100)
          : 0,
    }))
    .sort((a, b) => {
      if (b.serviceChargeTotal !== a.serviceChargeTotal) {
        return b.serviceChargeTotal - a.serviceChargeTotal;
      }
      return a.branchName.localeCompare(b.branchName);
    });

  return {
    totalServiceCharge,
    orderCount,
    salesTotal,
    averageServiceCharge: orderCount > 0 ? round2(totalServiceCharge / orderCount) : 0,
    branchBreakdown,
  };
}

export type ServiceChargeDatePreset = 'today' | '7days' | '30days' | 'month' | 'custom' | 'all';

function parseLocalDateInput(value: string): Date | null {
  const parts = value.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

/**
 * Resolves inclusive UTC ISO timestamp bounds for a service-charge date preset using local calendar boundaries.
 */
export function resolveDatePresetBounds(
  preset: ServiceChargeDatePreset,
  customStart = '',
  customEnd = '',
  now: Date = new Date()
): { from?: string; to?: string } {
  if (preset === 'all') return {};

  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (preset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return { from: start.toISOString(), to: endOfToday.toISOString() };
  }

  if (preset === '7days') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    return { from: start.toISOString(), to: endOfToday.toISOString() };
  }

  if (preset === '30days') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
    return { from: start.toISOString(), to: endOfToday.toISOString() };
  }

  if (preset === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { from: start.toISOString(), to: endOfToday.toISOString() };
  }

  const fromDate = customStart ? parseLocalDateInput(customStart) : null;
  const toDate = customEnd ? parseLocalDateInput(customEnd) : null;
  if (fromDate) fromDate.setHours(0, 0, 0, 0);
  if (toDate) toDate.setHours(23, 59, 59, 999);

  return {
    from: fromDate?.toISOString(),
    to: toDate?.toISOString(),
  };
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats service-charge sale rows into an RFC-4180 CSV string for accounting/payout export.
 */
export function buildServiceChargeCsv(
  rows: ServiceChargeSaleRow[],
  branchNameById: Record<string, string>,
  cashierLabelById: Record<string, string>
): string {
  const header = [
    'Date & Time',
    'Control Number',
    'Branch',
    'Sub-Store',
    'Cashier',
    'Order Total',
    'SC Rate (%)',
    'Service Charge',
  ].join(',');

  const lines = rows.map(row => {
    const branchName = branchNameById[row.branch_id] || normalizeJoinedName(row.branches) || row.branch_id;
    const subStoreName = row.sub_store_id
      ? branchNameById[row.sub_store_id] || normalizeJoinedName(row.sub_stores) || row.sub_store_id
      : '';
    const cashier = row.cashier_id
      ? cashierLabelById[row.cashier_id] || row.cashier_id
      : 'Deleted Staff';

    return [
      escapeCsvCell(row.created_at),
      escapeCsvCell(row.control_number || row.id.slice(0, 8)),
      escapeCsvCell(branchName),
      escapeCsvCell(subStoreName),
      escapeCsvCell(cashier),
      escapeCsvCell(Number(row.total_amount ?? 0).toFixed(2)),
      escapeCsvCell(Number(row.service_charge_rate ?? 0).toFixed(2)),
      escapeCsvCell(Number(row.service_charge_amount ?? 0).toFixed(2)),
    ].join(',');
  });

  return [header, ...lines].join('\n');
}
