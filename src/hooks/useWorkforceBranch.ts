import { useSyncExternalStore } from 'react';
import { useAuth, type Branch } from '../contexts/AuthContext';

// "All branches" is a Workforce-only view, shared by every Workforce screen.
// Picking a single branch uses the app's Active Branch Context, so the
// sidebar and every screen always agree on which branch is shown.
const ALL_KEY = 'wf_branch_filter_all';

function readAll(): boolean {
  try { return sessionStorage.getItem(ALL_KEY) === '1'; } catch { return false; }
}

let allMode = readAll();
const listeners = new Set<() => void>();

function setAllMode(value: boolean) {
  allMode = value;
  try { sessionStorage.setItem(ALL_KEY, value ? '1' : '0'); } catch { /* storage unavailable */ }
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWorkforceBranch() {
  const { selectedBranch, setSelectedBranch, branches, profile } = useAuth();
  const role = profile?.role_name || '';
  const isGlobal = ['super_admin', 'auditor', 'inventory_manager'].includes(role);
  // Only roles that can read every branch's Workforce data get "All branches".
  const canAll = role === 'super_admin' || role === 'auditor';
  const storedAll = useSyncExternalStore(subscribe, () => allMode, () => false);
  const isAll = canAll && storedAll;

  // Main branches only (sub-stores share their parent's staff).
  const options: Branch[] = isGlobal
    ? branches.filter(b => !b.parent_id)
    : branches.filter(b => b.id === profile?.branch_id);

  const setBranchId = (id: string) => {
    if (id === 'all') {
      if (canAll) setAllMode(true);
      return;
    }
    setAllMode(false);
    const b = branches.find(x => x.id === id);
    if (b && b.id !== selectedBranch?.id) setSelectedBranch(b);
  };

  const branchName = (id: string | null | undefined) =>
    (id && branches.find(b => b.id === id)?.name) || 'No branch';

  return {
    /** The single branch being shown, or null when "All branches" is selected. */
    branch: isAll ? null : selectedBranch,
    /** 'all' or a branch id. */
    branchId: isAll ? 'all' : (selectedBranch?.id || ''),
    /** The Active Branch Context even while "All branches" is shown (for single-branch screens). */
    selectedBranch,
    isAll,
    isGlobal,
    canAll,
    options,
    setBranchId,
    branchName,
  };
}
