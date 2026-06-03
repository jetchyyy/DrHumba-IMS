import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Store,
  Package,
  Boxes,
  FilePlus,
  ArrowLeftRight,
  ClipboardList,
  ChefHat,
  ShoppingBag,
  BarChart3,
  Bell,
  FileText,
  Users,
  Settings as SettingsIcon,
  LogOut,
  History
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const { profile, selectedBranch, setSelectedBranch, branches, signOut } = useAuth();

  if (!profile) return null;

  const role = profile.role_name;

  // Filter tabs by role permissions
  const tabs = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, show: true },
    { id: 'pos', name: 'POS (Sales)', icon: ShoppingBag, show: ['super_admin', 'branch_manager', 'cashier'].includes(role) },
    { id: 'sales-history', name: 'Sales History', icon: History, show: true },
    { id: 'inventory', name: 'Inventory Items', icon: Package, show: true },
    { id: 'global-inventory', name: 'Overall Stock', icon: Boxes, show: true },
    { id: 'receiving', name: 'Stock Receiving', icon: FilePlus, show: ['super_admin', 'inventory_manager'].includes(role) },
    { id: 'transfers', name: 'Transfers', icon: ArrowLeftRight, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'adjustments', name: 'Adjustments', icon: ClipboardList, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'recipes', name: 'Recipes', icon: ChefHat, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'branches', name: 'Branches', icon: Store, show: ['super_admin', 'auditor'].includes(role) },
    { id: 'analytics', name: 'Analytics', icon: BarChart3, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'notifications', name: 'Notifications', icon: Bell, show: true },
    { id: 'audit-logs', name: 'Audit Logs', icon: FileText, show: ['super_admin', 'auditor'].includes(role) },
    { id: 'users', name: 'Staff Management', icon: Users, show: ['super_admin'].includes(role) },
    { id: 'settings', name: 'Settings', icon: SettingsIcon, show: true },
  ];

  // Filter tabs by role permissions and custom allowed_tabs override
  const filteredTabs = tabs.filter(tab => {
    // Core utility tabs are always visible
    if (['dashboard', 'notifications', 'settings'].includes(tab.id)) {
      return true;
    }
    
    // Super admins always have full access
    if (role === 'super_admin') {
      return true;
    }

    // If a custom allowed_tabs override list exists on the user profile
    if (profile.allowed_tabs && Array.isArray(profile.allowed_tabs)) {
      return profile.allowed_tabs.includes(tab.id);
    }

    // Fall back to role-based defaults
    return tab.show;
  });

  // Check if current role can switch branches
  const canSwitchBranch = ['super_admin', 'inventory_manager', 'auditor'].includes(role);

  return (
    <aside className="w-64 border-r border-slate-800 bg-slate-900 flex flex-col h-screen sticky top-0">
      {/* Title / Logo */}
      <div className="p-6 border-b border-slate-800 flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
          R
        </div>
        <div>
          <h1 className="text-lg font-bold text-white tracking-wide">RestoChain</h1>
          <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider">Inventory System</p>
        </div>
      </div>

      {/* Active Branch Selector / Display */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/40">
        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
          Active Branch Context
        </label>
        {canSwitchBranch ? (
          <select
            value={selectedBranch?.id || ''}
            onChange={(e) => {
              const b = branches.find(branch => branch.id === e.target.value);
              setSelectedBranch(b || null);
            }}
            className="w-full bg-slate-800 text-xs border border-slate-700 text-white rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-sm font-medium text-slate-200 bg-slate-800/50 rounded px-2.5 py-1.5 border border-slate-800/80">
            {selectedBranch?.name || 'No Branch Assigned'}
          </div>
        )}
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {filteredTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}`} />
              <span>{tab.name}</span>
            </button>
          );
        })}
      </nav>

      {/* User Session Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/20 flex flex-col space-y-3">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center font-bold text-indigo-400 border border-slate-700">
            {profile.email.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-200 truncate">{profile.email}</p>
            <p className="text-[10px] text-slate-400 capitalize font-medium">{profile.role_name.replace('_', ' ')}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium border border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-red-400 hover:border-red-500/20 transition-all"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};
