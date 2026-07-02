import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useModal } from '../contexts/ModalContext';
import { useTenant } from '../contexts/TenantContext';
import {
  DashboardIcon as LayoutDashboard,
  BoxModelIcon as Store,
  CubeIcon as Package,
  LayersIcon as Boxes,
  FilePlusIcon as FilePlus,
  SymbolIcon as ArrowLeftRight,
  ClipboardIcon as ClipboardList,
  MagicWandIcon as ChefHat,
  BackpackIcon as ShoppingBag,
  BarChartIcon as BarChart3,
  FileTextIcon as FileText,
  GroupIcon as Users,
  GearIcon as SettingsIcon,
  ExitIcon as LogOut,
  CountdownTimerIcon as History,
  SunIcon as Sun,
  MoonIcon as Moon,
  HamburgerMenuIcon as Menu,
  ReloadIcon as Spinner,
  CardStackIcon as ExpensesIcon
} from '@radix-ui/react-icons';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from './ui/sheet';
import { FloatingNotifications } from './FloatingNotifications';
import { getTerminalConfig } from '../lib/offlineService';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

// Feature key map for plan gating
const TAB_FEATURE_KEYS: Record<string, string> = {
  pos: 'pos', 'sales-history': 'sales_history', 'z-read-history': 'pos', inventory: 'inventory',
  'global-inventory': 'global_inventory', receiving: 'receiving',
  transfers: 'transfers', adjustments: 'adjustments', transactions: 'transactions',
  recipes: 'recipes', branches: 'branches', analytics: 'analytics',
  'audit-logs': 'audit_logs', users: 'users', settings: 'settings', expenses: 'expenses',
};

// The shared nav items list — used by both desktop sidebar & mobile components
export const useNavItems = () => {
  const { profile } = useAuth();
  const { tenant } = useTenant();
  if (!profile) return [];
  const role = profile.role_name;
  const isRestaurant = tenant?.is_restaurant ?? true;
  const features = (tenant?.features ?? {}) as Record<string, boolean>;

  const isFeatureLocked = (tabId: string) => {
    const key = TAB_FEATURE_KEYS[tabId];
    if (!key || !tenant?.features) return false;
    return features[key] === false;
  };

  const tabs = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard, show: true },
    { id: 'pos', name: 'POS (Sales)', icon: ShoppingBag, show: ['super_admin', 'branch_manager', 'cashier'].includes(role) },
    { id: 'sales-history', name: 'Sales History', icon: History, show: true },
    { id: 'z-read-history', name: 'Z-Read History', icon: ClipboardList, show: true },
    { id: 'expenses', name: 'Expense Tracker', icon: ExpensesIcon, show: ['super_admin', 'branch_manager', 'auditor'].includes(role) },
    { id: 'inventory', name: 'Inventory Items', icon: Package, show: true },
    { id: 'global-inventory', name: 'Overall Stock', icon: Boxes, show: true },
    { id: 'receiving', name: 'Stock Receiving', icon: FilePlus, show: ['super_admin', 'inventory_manager'].includes(role) },
    { id: 'transfers', name: 'Transfers', icon: ArrowLeftRight, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'adjustments', name: 'Adjustments', icon: ClipboardList, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'transactions', name: 'Transactions', icon: FileText, show: true },
    { id: 'recipes', name: isRestaurant ? 'Recipes' : 'Products & Services', icon: ChefHat, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'branches', name: 'Branches', icon: Store, show: ['super_admin', 'auditor'].includes(role) },
    { id: 'analytics', name: 'Analytics', icon: BarChart3, show: ['super_admin', 'inventory_manager', 'branch_manager', 'auditor'].includes(role) },
    { id: 'audit-logs', name: 'Audit Logs', icon: FileText, show: ['super_admin', 'auditor'].includes(role) },
    { id: 'users', name: 'Staff Management', icon: Users, show: ['super_admin'].includes(role) },
    { id: 'settings', name: 'Settings', icon: SettingsIcon, show: true },
  ];

  // Filter by role/allowed_tabs — locked features are kept but flagged
  const filtered = tabs.filter(tab => {
    if (['dashboard', 'settings'].includes(tab.id)) return true;
    if (role === 'super_admin') return true;
    if (profile.allowed_tabs && Array.isArray(profile.allowed_tabs)) {
      return profile.allowed_tabs.includes(tab.id);
    }
    return tab.show;
  });

  // Attach locked flag so nav can show lock icon
  return filtered.map(tab => ({ ...tab, locked: isFeatureLocked(tab.id) }));
};

// ── Inner nav content (shared between desktop sidebar & mobile sheet) ─────────
const NavContent: React.FC<{ activeTab: string; setActiveTab: (t: string) => void; onNavigate?: () => void }> = ({
  activeTab, setActiveTab, onNavigate
}) => {
  const { profile, selectedBranch, setSelectedBranch, branches, signOut } = useAuth();
  const { tenant } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const { confirm } = useModal();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const navItems = useNavItems();

  const [terminalConfig, setTerminalConfig] = useState<any>(null);

  React.useEffect(() => {
    const checkTerminal = async () => {
      const config = await getTerminalConfig();
      setTerminalConfig(config);
    };
    checkTerminal();
  }, []);

  React.useEffect(() => {
    if (terminalConfig && branches.length > 0) {
      const targetBranch = branches.find(b => b.id === terminalConfig.branch_id);
      if (targetBranch && selectedBranch?.id !== targetBranch.id) {
        setSelectedBranch(targetBranch);
      }
    }
  }, [terminalConfig, branches, selectedBranch]);

  const isTerminalLocked = terminalConfig && profile?.role_name !== 'super_admin' && profile?.role_name !== 'auditor';
  const canSwitchBranch = profile && ['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name) && !isTerminalLocked;

  const handleSignOut = async () => {
    if (await confirm('Sign Out', 'Are you sure you want to log out?')) {
      setIsLoggingOut(true);
      try {
        await signOut();
      } finally {
        setIsLoggingOut(false);
      }
    }
  };

  if (!profile) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-6 border-b flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-white overflow-hidden shadow-lg border border-pink-100 flex-shrink-0">
          <img src={tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/saaslogo.png"} alt="Logo" className="w-full h-full object-cover" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-wide">{tenant?.name || "Dr. Humba"}</h1>
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Inventory System</p>
        </div>
      </div>

      {/* Branch selector */}
      <div className="p-4 border-b bg-muted/20">
        <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block mb-2">
          Active Branch Context
        </label>
        {branches.length === 0 ? (
          /* No branches yet — prompt to create one */
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-1">
            <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">No Branch Configured</p>
            <p className="text-[10px] text-amber-300/80 leading-snug">
              Go to <span className="font-bold">Branches</span> to create your first branch location before using the POS.
            </p>
          </div>
        ) : branches.length === 1 ? (
          /* Single branch — always locked-in, no dropdown needed */
          <div className="flex items-center gap-2 bg-muted/50 rounded px-3 py-2 border">
            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="text-sm font-medium truncate">
              {selectedBranch?.name || branches[0]?.name || 'Loading…'}
            </span>
          </div>
        ) : canSwitchBranch ? (
          <Select
            value={selectedBranch?.id || ''}
            onValueChange={(val) => {
              const b = branches.find(branch => branch.id === val);
              setSelectedBranch(b || null);
            }}
          >
            <SelectTrigger className="w-full text-xs h-8">
              <SelectValue placeholder="Select Branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id} className="text-xs">
                  {b.name} {b.is_warehouse ? '(Warehouse)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-sm font-medium bg-muted/50 rounded px-3 py-2 border">
            {selectedBranch?.name || 'No Branch Assigned'}
          </div>
        )}
      </div>


      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {navItems.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const isLocked = (tab as any).locked;
          return (
            <Button
              key={tab.id}
              variant={isActive ? 'default' : 'ghost'}
              className={`w-full justify-start h-10 px-3 transition-all ${
                isActive ? 'shadow-md' : isLocked
                  ? 'text-muted-foreground/40 hover:bg-muted/30 hover:text-muted-foreground/60'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
              onClick={() => { setActiveTab(tab.id); onNavigate?.(); }}
              title={isLocked ? `${tab.name} — not available in your current plan` : tab.name}
            >
              <Icon className={`mr-3 h-4 w-4 flex-shrink-0 ${
                isActive ? 'text-primary-foreground' : isLocked ? 'text-muted-foreground/40' : 'text-muted-foreground'
              }`} />
              <span className="flex-1 text-left">{tab.name}</span>
              {isLocked && (
                <svg className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </Button>
          );
        })}
      </nav>

      <Separator />

      {/* Footer */}
      <div className="p-4 bg-muted/10 flex flex-col space-y-3">
        {/* Plan Badge */}
        {tenant && (
          <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/20">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Current Plan</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              tenant.plan_type === 'enterprise' ? 'bg-amber-500/20 text-amber-400' :
              tenant.plan_type === 'professional' ? 'bg-emerald-500/20 text-emerald-400' :
              'bg-primary/20 text-primary'
            }`}>{tenant.plan_type}</span>
          </div>
        )}
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center font-bold text-secondary-foreground border">
            {profile.email.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">{profile.email}</p>
            <p className="text-[10px] text-muted-foreground capitalize font-medium">{profile.role_name.replace('_', ' ')}</p>
          </div>
          <FloatingNotifications />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8 text-muted-foreground hover:text-foreground flex-shrink-0"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          disabled={isLoggingOut}
          className="w-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30"
        >
          {isLoggingOut ? (
            <Spinner className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          {isLoggingOut ? 'Signing Out...' : 'Sign Out'}
        </Button>
      </div>
    </div>
  );
};

// ── Desktop Sidebar ───────────────────────────────────────────────────────────
export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const { profile } = useAuth();
  if (!profile) return null;

  return (
    <aside className="w-64 border-r bg-background flex-col h-screen sticky top-0 hidden md:flex">
      <NavContent activeTab={activeTab} setActiveTab={setActiveTab} />
    </aside>
  );
};

// ── Mobile Top Header + Sheet Drawer ─────────────────────────────────────────
export const MobileHeader: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { profile, selectedBranch } = useAuth();
  const { tenant } = useTenant();

  const navItems = useNavItems();
  const currentTab = navItems.find(t => t.id === activeTab);
  const CurrentIcon = currentTab?.icon || LayoutDashboard;
  
  const [terminalConfig, setTerminalConfig] = useState<any>(null);

  React.useEffect(() => {
    const checkTerminal = async () => {
      const config = await getTerminalConfig();
      setTerminalConfig(config);
    };
    checkTerminal();
  }, []);

  const isTerminalLocked = terminalConfig && profile?.role_name !== 'super_admin' && profile?.role_name !== 'auditor';
  const canSwitchBranch = profile && ['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name) && !isTerminalLocked;

  return (
    <div className="md:hidden sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b shadow-sm flex flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        {/* Left: hamburger + current page */}
        <div className="flex items-center space-x-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-72 bg-background">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <SheetDescription className="sr-only">Main application navigation and branch selector</SheetDescription>
            <NavContent
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <div className="flex items-center space-x-2">
          <CurrentIcon className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{currentTab?.name || 'Dashboard'}</span>
        </div>
      </div>

      {/* Right: logo + theme toggle */}
      <div className="flex items-center space-x-2">
        <FloatingNotifications />
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <div className="w-7 h-7 rounded-md bg-white overflow-hidden shadow-sm border border-pink-100 flex-shrink-0">
          <img src={tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/saaslogo.png"} alt="Logo" className="w-full h-full object-cover" />
        </div>
      </div>
      </header>
      
      {/* Mobile Active Branch Indicator integrated into flow */}
      {canSwitchBranch && selectedBranch && (
        <div className="flex items-center justify-center gap-1.5 py-1.5 px-4 bg-muted/40 border-t border-border/50 text-[10px]">
           <span className="relative flex h-2 w-2">
             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
             <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
           </span>
           <Boxes className="w-3.5 h-3.5 opacity-70" />
           <span className="tracking-wide">
             <span className="text-muted-foreground mr-1">Using</span>
             <span className="font-bold">{selectedBranch.name}</span>
             {selectedBranch.is_warehouse && <span className="ml-1 uppercase opacity-75">(Warehouse)</span>}
           </span>
        </div>
      )}
    </div>
  );
};

// ── Mobile Bottom Tab Bar ─────────────────────────────────────────────────────
const BOTTOM_TABS = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Home' },
  { id: 'pos', icon: ShoppingBag, label: 'POS' },
  { id: 'inventory', icon: Package, label: 'Items' },
  { id: 'analytics', icon: BarChart3, label: 'Analytics' },
  { id: 'settings', icon: SettingsIcon, label: 'Settings' },
];

interface MobileBottomNavProps extends SidebarProps {
  isVisible?: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ activeTab, setActiveTab, isVisible = true }) => {
  const navItems = useNavItems();
  // Only show bottom tabs the user has access to
  const visibleBottomTabs = BOTTOM_TABS.filter(bt => navItems.some(n => n.id === bt.id));

  return (
    <nav className={`md:hidden fixed bottom-6 left-4 right-4 z-40 bg-background/95 backdrop-blur-sm border rounded-2xl shadow-lg transition-all duration-300 ${isVisible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-24 opacity-0 pointer-events-none'}`}>
      <div className="flex items-stretch h-16 px-2">
        {visibleBottomTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors ${isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              <Icon className={`h-5 w-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] font-medium">{tab.label}</span>
              {isActive && (
                <span className="absolute top-0 w-8 h-1 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
