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
  'service-charge': 'service_charge_tracker',
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
    { id: 'service-charge', show: ['super_admin', 'branch_manager', 'auditor'].includes(role) },
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

// ── Workforce module (staff scheduling + time clock) ─────────────────────────
// Kept separate from getAllowedTabIds so the Operations sidebar is unchanged.
// Hidden entirely unless the tenant has features.staff_scheduling === true.

export const WORKFORCE_TAB_IDS = [
  'wf-time-clock',
  'wf-kiosk',
  'wf-my-schedule',
  'wf-my-leave',
  'wf-schedule',
  'wf-attendance',
  'wf-leave',
  'wf-staff',
  'wf-shift-templates',
  'wf-settings',
  'wf-audit',
] as const;

/**
 * Stored in profiles.allowed_tabs once an admin customises a user's Workforce
 * access, so "no Workforce screens" can be told apart from "use role defaults".
 */
export const WORKFORCE_CUSTOM_MARKER = 'wf-custom';

export function isWorkforceTab(tabId: string): boolean {
  return tabId.startsWith('wf-');
}

export function isWorkforceEnabled(tenant: NavPermissionTenant | null | undefined): boolean {
  return Boolean(tenant?.features?.staff_scheduling);
}

const WORKFORCE_ROLE_DEFAULTS: Record<string, string[]> = {
  'wf-kiosk': ['super_admin', 'branch_manager', 'cashier'],
  'wf-leave': ['super_admin', 'branch_manager', 'auditor'],
  'wf-schedule': ['super_admin', 'branch_manager', 'auditor'],
  'wf-attendance': ['super_admin', 'branch_manager', 'auditor'],
  'wf-staff': ['super_admin', 'branch_manager'],
  'wf-shift-templates': ['super_admin', 'branch_manager'],
  'wf-settings': ['super_admin', 'branch_manager'],
  'wf-audit': ['super_admin', 'branch_manager', 'auditor'],
};
const WORKFORCE_SELF_SERVICE = new Set(['wf-time-clock', 'wf-my-schedule', 'wf-my-leave']);

/** Workforce tabs a role gets when the admin has not customised access. */
export function getWorkforceRoleDefaults(role: string): string[] {
  return WORKFORCE_TAB_IDS.filter(id =>
    WORKFORCE_SELF_SERVICE.has(id) || (WORKFORCE_ROLE_DEFAULTS[id]?.includes(role) ?? false)
  );
}

/** True when the admin has set this user's Workforce access by hand. */
export function hasCustomWorkforceAccess(allowedTabs: string[] | null | undefined): boolean {
  return Array.isArray(allowedTabs) && allowedTabs.some(isWorkforceTab);
}

/**
 * Ordered Workforce tab IDs for the user. With no customisation, everyone gets
 * the self-service tabs (time clock, own schedule, own leave) plus their role's
 * management tabs. Once an admin customises access in Staff Management, the user
 * gets exactly the ticked tabs. Super Admins always get everything.
 */
export function getAllowedWorkforceTabIds(
  profile: NavPermissionProfile | null | undefined,
  tenant: NavPermissionTenant | null | undefined
): string[] {
  if (!profile || !isWorkforceEnabled(tenant)) return [];
  const role = profile.role_name;
  if (role !== 'super_admin' && hasCustomWorkforceAccess(profile.allowed_tabs)) {
    const picked = new Set(profile.allowed_tabs!);
    return WORKFORCE_TAB_IDS.filter(id => picked.has(id));
  }
  return getWorkforceRoleDefaults(role);
}
