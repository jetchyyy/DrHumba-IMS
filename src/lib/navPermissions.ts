export const TAB_FEATURE_KEYS: Record<string, string> = {
  pos: 'pos',
  'queue-caller': 'queue_caller',
  'sales-history': 'sales_history',
  'z-read-history': 'z_read_history',
  inventory: 'inventory',
  'global-inventory': 'global_inventory',
  receiving: 'receiving',
  transfers: 'transfers',
  adjustments: 'adjustments',
  portioning: 'portioning',
  transactions: 'transactions',
  'kitchen-receipts': 'kitchen_receipts',
  recipes: 'recipes',
  branches: 'branches',
  'table-management': 'table_management',
  analytics: 'analytics',
  'audit-logs': 'audit_logs',
  users: 'users',
  settings: 'settings',
  expenses: 'expenses',
};

export interface NavPermissionProfile {
  role_name: string;
  allowed_tabs?: string[] | null;
}

export interface NavPermissionTenant {
  is_restaurant?: boolean | null;
  is_retail?: boolean | null;
  is_service?: boolean | null;
  features?: Record<string, boolean | undefined> | null;
}

/**
 * Computes the ordered list of sidebar tab IDs allowed for a user based on plan feature flags,
 * business type, explicit allowed_tabs overrides, and system role defaults.
 */
export function getAllowedTabIds(
  profile: NavPermissionProfile | null | undefined,
  tenant: NavPermissionTenant | null | undefined
): string[] {
  if (!profile) return [];

  const role = profile.role_name;
  const isRestaurant = tenant?.is_restaurant ?? (tenant?.is_retail || tenant?.is_service ? false : true);
  const features = (tenant?.features ?? {}) as Record<string, boolean | undefined>;

  const tabs: Array<{ id: string; show: boolean }> = [
    { id: 'dashboard', show: true },
    { id: 'pos', show: ['super_admin', 'branch_manager', 'cashier'].includes(role) },
    { id: 'queue-caller', show: ['super_admin', 'branch_manager', 'cashier'].includes(role) },
    { id: 'sales-history', show: true },
    { id: 'z-read-history', show: true },
    { id: 'expenses', show: ['super_admin', 'branch_manager', 'auditor'].includes(role) },
    { id: 'inventory', show: true },
    { id: 'global-inventory', show: ['super_admin', 'inventory_manager', 'auditor'].includes(role) },
    { id: 'receiving', show: ['super_admin', 'inventory_manager'].includes(role) },
    { id: 'transfers', show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'adjustments', show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'portioning', show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'transactions', show: true },
    { id: 'kitchen-receipts', show: isRestaurant },
    { id: 'recipes', show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'branches', show: ['super_admin', 'auditor'].includes(role) },
    { id: 'table-management', show: isRestaurant && ['super_admin', 'branch_manager'].includes(role) },
    { id: 'analytics', show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'audit-logs', show: ['super_admin', 'auditor'].includes(role) },
    { id: 'users', show: ['super_admin'].includes(role) },
    { id: 'settings', show: true },
  ];

  return tabs
    .filter(tab => {
      const key = TAB_FEATURE_KEYS[tab.id];
      if (key === 'table_management') {
        if (!tenant?.features?.table_management) {
          return false;
        }
      } else if (key && tenant?.features && features[key] === false) {
        return false;
      }

      if (profile.allowed_tabs && Array.isArray(profile.allowed_tabs)) {
        return profile.allowed_tabs.includes(tab.id);
      }

      if (['dashboard', 'settings'].includes(tab.id)) return true;
      if (role === 'super_admin') return tab.show;
      return !!tab.show;
    })
    .map(tab => tab.id);
}

/**
 * Ensures the active tab is permitted for the signed-in user, falling back to their first allowed tab.
 */
export function resolveEffectiveTab(currentTab: string, allowedTabIds: string[]): string {
  if (allowedTabIds.length === 0) return '';
  if (allowedTabIds.includes(currentTab)) return currentTab;
  return allowedTabIds[0];
}
