// App modules: top-level areas a user picks after logging in.
// To add a module, add one entry to APP_MODULES with a function that returns
// the tab ids the user may open in it (empty list = module hidden for them).
import {
  getAllowedTabIds,
  getAllowedWorkforceTabIds,
  type NavPermissionProfile,
  type NavPermissionTenant,
} from './navPermissions.ts';

export interface AppModuleDef {
  id: string;
  name: string;
  description: string;
  tabsFor: (profile: NavPermissionProfile | null | undefined, tenant: NavPermissionTenant | null | undefined) => string[];
}

export interface AvailableModule extends AppModuleDef {
  tabs: string[];
}

export const APP_MODULES: AppModuleDef[] = [
  {
    id: 'operations',
    name: 'Operations',
    description: 'POS, inventory, stock transfers, sales and reports.',
    tabsFor: getAllowedTabIds,
  },
  {
    id: 'workforce',
    name: 'Workforce',
    description: 'Staff schedules, time clock, attendance and leave.',
    tabsFor: getAllowedWorkforceTabIds,
  },
];

/** Modules this user can open, in display order, each with its allowed tabs. */
export function getAvailableModules(
  profile: NavPermissionProfile | null | undefined,
  tenant: NavPermissionTenant | null | undefined,
  modules: AppModuleDef[] = APP_MODULES
): AvailableModule[] {
  return modules
    .map(m => ({ ...m, tabs: m.tabsFor(profile, tenant) }))
    .filter(m => m.tabs.length > 0);
}

/** The module a tab belongs to (first match). */
export function moduleForTab(tabId: string, modules: AvailableModule[]): AvailableModule | undefined {
  return modules.find(m => m.tabs.includes(tabId));
}

/** Every tab the user may open, across modules (first module first). */
export function allModuleTabs(modules: AvailableModule[]): string[] {
  return modules.flatMap(m => m.tabs);
}
