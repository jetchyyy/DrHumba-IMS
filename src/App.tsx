import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ModalProvider, useModal } from './contexts/ModalContext';
import { PendingApprovalsProvider } from './contexts/PendingApprovalsContext';
import { supabase } from './lib/supabase';
import { useTenant } from './contexts/TenantContext';
import { TenantSuspendedPage, TenantNotFoundPage, UnauthorizedTenantPage, PlatformAdminTenantMismatchPage, SaaSLandingPage } from './components/SaaSCommon';
import { OnboardingPage } from './components/OnboardingPage';
import { TermsPage, PrivacyPage } from './components/odyssey/LegalPages';
import { SuperAdminDashboard } from './components/SuperAdminDashboard';
import { Sidebar, MobileHeader, MobileBottomNav } from './components/Sidebar';
import { OfflineBanner } from './components/OfflineBanner';
import { SplashScreen } from './components/SplashScreen';
import { Dashboard } from './components/Dashboard';
import { POS } from './components/POS';
import { Inventory } from './components/Inventory';
import { GlobalInventory } from './components/GlobalInventory';
import { StockReceiving } from './components/StockReceiving';
import { Transfers } from './components/Transfers';
import { Adjustments } from './components/Adjustments';
import { Portioning } from './components/Portioning';
import { Transactions } from './components/Transactions';
import { Recipes } from './components/Recipes';
import { BranchManagement } from './components/BranchManagement';
import { Analytics } from './components/Analytics';
import { AuditLogs } from './components/AuditLogs';
import { UserManagement } from './components/UserManagement';
import { Settings } from './components/Settings';
import { SalesHistory } from './components/SalesHistory';
import { ZReadHistory } from './components/ZReadHistory';
import { Expenses } from './components/Expenses';
import { ServiceChargeTracker } from './components/ServiceChargeTracker';
import { ActiveBranchSplashScreen } from './components/ActiveBranchSplashScreen';
import { KitchenReceipts } from './components/KitchenReceipts';
import { TableManagement } from './components/TableManagement';
import { isPosLocked as readPosLockedState } from './lib/posLock';
import { getAllowedTabIds, resolveEffectiveTab } from './lib/navPermissions';
import { PosLockDialog } from './components/pos/PosLockDialog';
import { useNetworkStatus } from './hooks/use-network-status';
import { Pig404 } from './components/Pig404';
import { CustomerDisplay } from './components/CustomerDisplay';
import { QueueCaller } from './components/QueueCaller';
import { QueueTvScreen } from './components/QueueTvScreen';
import { EnvelopeClosedIcon as Mail, LockClosedIcon as Key, ReloadIcon as RefreshCw, ExclamationTriangleIcon as ShieldAlert, EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Toaster } from './components/ui/toaster';
import { Alert, AlertDescription } from './components/ui/alert';

const AppContent: React.FC = () => {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const { tenant, tenantLoading, tenantError, isSingleTenantMode } = useTenant();
  const { showSuccess } = useModal();
  const { isOnline } = useNetworkStatus();

  // Check if this is the customer display screen
  const isCustomerDisplay = 
    window.location.pathname === '/customer-display' || 
    window.location.search.includes('view=customer-display');

  // Check if this is the queue TV screen
  const isQueueTv = 
    window.location.pathname === '/queue-tv' || 
    window.location.search.includes('view=queue-tv');

  // App Kiosk Lock state (persisted across reloads and account switches)
  const [isPosLocked, setIsPosLocked] = useState<boolean>(() => readPosLockedState());
  const [lockDialogMode, setLockDialogMode] = useState<'lock' | 'unlock' | null>(null);

  // Navigation active state
  const [activeTab, setActiveTab] = useState('dashboard');

  // Authentication states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Scroll tracking state for mobile navigation
  const [showMobileNav, setShowMobileNav] = useState(true);
  const lastScrollY = React.useRef(0);
  const scrollTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preload assets for SplashScreen
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [is404, setIs404] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!isPosLocked) return;

    // Trap repeated Android/browser Back button presses inside the PWA so WebAPK never exits to a frozen splash screen
    if (!window.history.state?.kioskGuard) {
      window.history.pushState({ kioskGuard: true }, '', window.location.href);
    }

    const handlePopState = () => {
      window.history.pushState({ kioskGuard: true }, '', window.location.href);
    };
    window.addEventListener('popstate', handlePopState);

    // Only attach beforeunload on non-standalone desktop tabs; Android standalone WebAPKs can freeze on splash when beforeunload fires on back-exit
    const isStandalonePwa =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      Boolean((window.navigator as any).standalone);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    if (!isStandalonePwa) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (!isStandalonePwa) {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
    };
  }, [isPosLocked]);

  const allowedTabIds = React.useMemo(
    () => getAllowedTabIds(profile, tenant),
    [profile, tenant]
  );

  const effectiveTab = profile ? resolveEffectiveTab(activeTab, allowedTabIds) : activeTab;

  useEffect(() => {
    if (!user) {
      setActiveTab('dashboard');
      return;
    }
    if (profile && effectiveTab && effectiveTab !== activeTab) {
      setActiveTab(effectiveTab);
    }
  }, [user, profile, effectiveTab, activeTab]);

  const handlePosLocked = () => {
    setIsPosLocked(true);
  };

  const handlePosUnlocked = () => {
    setIsPosLocked(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch((err) => {
          console.warn('Browser fullscreen request failed, using app-level fallback:', err);
        });
        // Fallback if browser fullscreen request is blocked/unsupported
        if (!document.fullscreenElement) {
          setIsFullscreen(true);
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen().catch((err) => {
            console.warn('Browser exit fullscreen failed:', err);
          });
        }
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('Fullscreen toggle error:', err);
      setIsFullscreen(prev => !prev);
    }
  };

  useEffect(() => {
    const isCustomerPath = window.location.pathname === '/customer-display';
    const isQueuePath = window.location.pathname === '/queue-tv';
    const isSaaSRoute = ['/apply', '/odc', '/terms', '/privacy'].includes(window.location.pathname);
    if (window.location.pathname !== '/' && !isCustomerPath && !isQueuePath && !isSaaSRoute) {
      setIs404(true);
    }
    
    const loadAssets = async () => {
      const img = new Image();
      
      const imgPromise = new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve; // proceed even if image fails to load
      });

      img.src = tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || '/saaslogo.png';

      // Minimum splash screen duration (e.g., 1.5 seconds)
      const minDelay = new Promise(resolve => setTimeout(resolve, 1500));

      await Promise.all([imgPromise, minDelay]);
      setAssetsLoaded(true);
    };

    loadAssets();
  }, [tenant]);

  useEffect(() => {
    if (user && profile?.is_platform_admin) {
      if (tenant && profile.tenant_id !== tenant.id) {
        const syncTenant = async () => {
          const { error } = await supabase
            .from('profiles')
            .update({ tenant_id: tenant.id })
            .eq('id', user.id);
          if (!error) {
            refreshProfile();
          }
        };
        syncTenant();
      } else if (!tenant && window.location.pathname === '/odc' && profile.tenant_id !== '00000000-0000-0000-0000-000000000000') {
        const resetTenant = async () => {
          const { error } = await supabase
            .from('profiles')
            .update({ tenant_id: '00000000-0000-0000-0000-000000000000' })
            .eq('id', user.id);
          if (!error) {
            refreshProfile();
          }
        };
        resetTenant();
      }
    }
  }, [user, profile, tenant, refreshProfile]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setAuthLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;
      setEmail('');
      setPassword('');
      setAuthSuccess('');
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Failed to sign in. Please verify credentials.');
    } finally {
      setAuthLoading(false);
    }
  };


  if (loading || tenantLoading || !assetsLoaded) {
    return <SplashScreen />;
  }

  // 0. ODYSSEY legal pages (root domain and every non-main tenant subdomain)
  if (!isSingleTenantMode && window.location.pathname === '/terms') {
    return <TermsPage />;
  }
  if (!isSingleTenantMode && window.location.pathname === '/privacy') {
    return <PrivacyPage />;
  }

  // 1. Tenant Error Handlers
  if (tenantError === 'not_found') {
    return <TenantNotFoundPage />;
  }
  if (tenantError === 'suspended') {
    return <TenantSuspendedPage tenantName={tenant?.name || 'Workspace'} />;
  }

  // 2. Root Domain Routing (No Subdomain resolved)
  if (!isSingleTenantMode && tenant === null) {
    if (window.location.pathname === '/apply') {
      return <OnboardingPage />;
    }
    if (window.location.pathname === '/odc') {
      if (!user) {
        // Fall through to show the login screen
      } else if (!profile || !profile.is_platform_admin) {
        return <UnauthorizedTenantPage tenantName="Platform Superadmin" signOut={signOut} />;
      } else {
        return <SuperAdminDashboard />;
      }
    } else {
      return <SaaSLandingPage />;
    }
  }

  // 3. Authenticated Tenant Verification (prevent cross-tenant logins).
  // RLS scopes data by profiles.tenant_id, so a mismatch would show another tenant's data
  // under this portal's branding. Platform admins included: they get the option to switch.
  if (user && profile && profile.tenant_id !== tenant?.id) {
    if (profile.is_platform_admin && tenant) {
      return (
        <PlatformAdminTenantMismatchPage
          profileId={profile.id}
          tenantId={tenant.id}
          tenantName={tenant.name}
          signOut={signOut}
        />
      );
    }
    return <UnauthorizedTenantPage tenantName={tenant?.name || 'Workspace'} signOut={signOut} />;
  }

  if (is404) {
    return <Pig404 />;
  }

  if (isCustomerDisplay) {
    return <CustomerDisplay />;
  }

  if (isQueueTv) {
    return <QueueTvScreen />;
  }

  // Render Login / Signup if user is not authenticated
  if (!user) {
    const showDrHumbaTheme = isSingleTenantMode || (tenant && tenant.subdomain === null);

    if (!showDrHumbaTheme) {
      // ── Non-main tenants + Superadmin console: ODYSSEY brand sign-in ──
      const isConsole = window.location.pathname === '/odc';
      const brandLogo = isConsole ? '/odyssey/monogram.svg' : (tenant?.logo_url || '/odyssey/monogram.svg');
      const inputCls = "h-12 bg-white border-[#DCE1E8] text-[#152839] placeholder:text-[#5F6A7C] rounded-lg focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-0 focus-visible:border-[#152839]";
      return (
        <div className="font-odyssey min-h-screen bg-[#F9F8F3] text-[#152839] flex flex-col items-center justify-center px-4 py-10 antialiased">
          <div className="w-full max-w-md">
            <div className="rounded-[24px] bg-[#152839] p-[8px] shadow-[0_24px_60px_-30px_rgba(21,40,57,0.6)]">
              <div className="rounded-[18px] border-[3px] border-[#FF6F07] bg-white px-6 sm:px-8 pt-8 pb-8">
                <div className="flex flex-col items-center text-center">
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center overflow-hidden ${isConsole || !tenant?.logo_url ? 'bg-[#F9F8F3] p-3' : 'bg-white border border-[#DCE1E8]'}`}>
                    <img src={brandLogo} alt={isConsole ? 'ODYSSEY' : `${tenant?.name || 'Workspace'} logo`} className={isConsole || !tenant?.logo_url ? 'w-full h-auto' : 'w-full h-full object-cover'} />
                  </div>
                  <h1 className="font-odyssey-display font-bold text-[26px] leading-[34px] mt-4">
                    {isConsole ? 'ODYSSEY Console' : (tenant?.name || 'Workspace')}
                  </h1>
                  <p className="text-sm text-[#45546A] mt-1">
                    {isConsole ? 'Platform administration' : 'Sign in to your workspace'}
                  </p>
                  {isPosLocked && (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-800 text-xs font-semibold">
                      POS Kiosk Lock Active — Sign in to continue to POS
                    </div>
                  )}
                </div>

                {authError && (
                  <Alert variant="destructive" className="mt-6 border-red-200 bg-red-50 text-red-800">
                    <AlertDescription className="font-medium text-sm">{authError}</AlertDescription>
                  </Alert>
                )}
                {authSuccess && (
                  <Alert className="mt-6 border-[#DCE1E8] bg-[#ECE7DE] text-[#152839]">
                    <AlertDescription className="font-medium text-sm">{authSuccess}</AlertDescription>
                  </Alert>
                )}

                <form onSubmit={handleSignIn} className="space-y-5 mt-7">
                  <div className="space-y-2">
                    <Label htmlFor="odc-email" className="text-sm font-medium text-[#152839]">Email address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[#5F6A7C] pointer-events-none" />
                      <Input
                        id="odc-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={tenant?.subdomain ? `admin@${tenant.subdomain}.com` : "admin@domain.com"}
                        className={`pl-10 ${inputCls}`}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="odc-password" className="text-sm font-medium text-[#152839]">Password</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[#5F6A7C] pointer-events-none" />
                      <Input
                        id="odc-password"
                        type={showPassword ? "text" : "password"}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className={`pl-10 pr-11 ${inputCls}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5F6A7C] hover:text-[#152839] focus:outline-none"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOpenIcon className="h-5 w-5" /> : <EyeClosedIcon className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-12 text-[15px] font-semibold bg-[#152839] text-[#F9F8F3] hover:bg-[#1f3a52] rounded-lg border-0 focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-2"
                    disabled={authLoading}
                  >
                    {authLoading ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Signing in...
                      </span>
                    ) : (
                      "Sign in"
                    )}
                  </Button>
                </form>
              </div>
            </div>

            {!isPosLocked && (
              <>
                <div className="flex items-center justify-center gap-2 mt-8 text-xs text-[#5F6A7C]">
                  <span>Powered by</span>
                  <a href={`https://${import.meta.env.VITE_MAIN_DOMAIN || 'erp.odysseyph.com'}`} aria-label="ODYSSEY">
                    <img src="/odyssey/logo-horizontal.svg" alt="ODYSSEY" className="h-6 w-auto" />
                  </a>
                </div>
                <div className="flex items-center justify-center gap-4 mt-3 text-xs text-[#45546A]">
                  <a href="/terms" className="hover:text-[#152839] underline-offset-4 hover:underline">Terms &amp; Conditions</a>
                  <span aria-hidden="true">·</span>
                  <a href="/privacy" className="hover:text-[#152839] underline-offset-4 hover:underline">Data Privacy</a>
                </div>
              </>
            )}
          </div>
        </div>
      );
    }

    // ── Dr. Humba (Default): Original Pink Styled Playful Splash Screen ──
    return (
      <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-pink-50 via-pink-100 to-pink-200 flex items-center justify-center p-4">
        {/* Background shapes */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
        <div className="absolute top-[20%] right-[-10%] w-80 h-80 bg-pink-400 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>
        <div className="absolute bottom-[-20%] left-[20%] w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-4000"></div>
        
        {/* Playful shapes */}
        <svg className="absolute w-24 h-24 text-pink-500/20 top-1/4 left-1/4 animate-[spin_10s_linear_infinite]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 22h20L12 2z" />
        </svg>
        <svg className="absolute w-32 h-32 text-pink-400/20 bottom-1/4 right-1/4 animate-[bounce_4s_infinite]" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="10" />
        </svg>

        <Card className="w-full max-w-md shadow-[0_20px_50px_rgba(236,72,153,0.3)] bg-white/90 backdrop-blur-xl border-white border-2 relative z-10 overflow-hidden">
          {/* Card top decorative accent */}
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-pink-400 via-pink-500 to-pink-600"></div>
          
          <CardHeader className="text-center space-y-4 pt-8">
            <div className="mx-auto w-32 h-32 bg-white rounded-full p-2 shadow-xl border-4 border-pink-100 relative group overflow-hidden flex items-center justify-center">
              <div className="absolute inset-0 bg-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity z-10"></div>
              <img src={window.location.pathname === '/odc' ? (import.meta.env.VITE_DEFAULT_LOGO || "/drhumbalogo.jpg") : (tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/drhumbalogo.jpg")} alt="Logo" className="w-full h-full object-cover rounded-full transform group-hover:scale-105 transition-transform duration-300" />
            </div>
            <div>
              <CardTitle className="text-3xl font-black text-slate-900 tracking-tight uppercase">
                {window.location.pathname === '/odc' ? "SaaS Superadmin" : (tenant?.name || import.meta.env.VITE_DEFAULT_APP_NAME || "DR. HUMBA")}
              </CardTitle>
              <CardDescription className="text-sm font-semibold text-pink-600 uppercase tracking-widest mt-1">
                {window.location.pathname === '/odc' ? "Console Administration" : "Management System"}
              </CardDescription>
              {isPosLocked && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-800 text-xs font-semibold">
                  POS Kiosk Lock Active — Sign in to continue to POS
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="px-8 pb-8">
            {authError && (
              <Alert variant="destructive" className="mb-6 border-red-200 bg-red-50 text-red-900">
                <AlertDescription className="font-medium text-sm">{authError}</AlertDescription>
              </Alert>
            )}
            {authSuccess && (
              <Alert className="mb-6 border-pink-500/50 bg-pink-50 text-pink-900">
                <AlertDescription className="font-medium text-sm">{authSuccess}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSignIn} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Email Address</Label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-pink-400 group-focus-within:text-pink-600 transition-colors" />
                  </div>
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={tenant?.subdomain ? `admin@${tenant.subdomain}.com` : "admin@domain.com"}
                    className="pl-10 h-12 bg-white border-slate-200 text-slate-900 focus-visible:ring-pink-500 focus-visible:border-pink-500 rounded-xl transition-all shadow-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-700">Password</Label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key className="h-5 w-5 text-pink-400 group-focus-within:text-pink-600 transition-colors" />
                  </div>
                  <Input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10 pr-10 h-12 bg-white border-slate-200 text-slate-900 focus-visible:ring-pink-500 focus-visible:border-pink-500 rounded-xl transition-all shadow-sm"
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-400 hover:text-pink-600 focus:outline-none transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOpenIcon className="h-5 w-5" /> : <EyeClosedIcon className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base font-bold text-white bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 shadow-lg hover:shadow-pink-500/30 rounded-xl transition-all active:scale-[0.98]"
                disabled={authLoading}
              >
                {authLoading ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Authenticating...
                  </span>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>
          </CardContent>
          
          <div className="bg-slate-50 py-4 px-8 border-t border-slate-100 text-center">
             <p className="text-xs font-medium text-slate-550">
               © {new Date().getFullYear()} {tenant?.name || import.meta.env.VITE_DEFAULT_APP_NAME || "Dr. Humba"}. All rights reserved.
             </p>
          </div>
        </Card>
      </div>
    );
  }

  // If logged in but trigger hasn't finished public.profiles creation yet
  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Provisioning profile record from database trigger...
            </p>
            <Button onClick={refreshProfile} className="w-full font-bold">
              Refresh Profile
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render blockade page if profile is suspended
  if (profile.status === 'suspended') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center border-destructive/50 shadow-2xl shadow-destructive/10">
          <CardContent className="pt-8 space-y-6">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/20 mx-auto text-destructive">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-wide">Account Suspended</h2>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Your staff user credentials have been suspended by the system administrator.
                You are currently blockaded from accessing dashboard registries.
              </p>
            </div>
            <Button variant="outline" onClick={signOut} className="w-full font-bold">
              Sign Out & Return
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    const currentScrollY = e.currentTarget.scrollTop;
    
    // Always show if at the very top
    if (currentScrollY <= 10) {
      setShowMobileNav(true);
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      lastScrollY.current = currentScrollY;
      return;
    }

    if (currentScrollY < lastScrollY.current) {
      // Scrolling up
      setShowMobileNav(true);
      
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => {
        // If not at the very top, hide after scrolling stops
        if (lastScrollY.current > 10) {
          setShowMobileNav(false);
        }
      }, 2000); // Wait 2 seconds after stopping before hiding
    } else if (currentScrollY > lastScrollY.current) {
      // Scrolling down
      setShowMobileNav(false);
      if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    }
    
    lastScrollY.current = currentScrollY;
  };

  // ── Plan feature gate ────────────────────────────────────────────────────────
  // Map tab IDs → feature flag keys in tenant.features
  const TAB_FEATURE_MAP: Record<string, string> = {
    pos:              'pos',
    'sales-history':  'sales_history',
    inventory:        'inventory',
    'global-inventory': 'global_inventory',
    receiving:        'receiving',
    transfers:        'transfers',
    adjustments:      'adjustments',
    portioning:       'portioning',
    transactions:     'transactions',
    recipes:          'recipes',
    branches:         'branches',
    'table-management': 'table_management',
    analytics:        'analytics',
    'audit-logs':     'audit_logs',
    users:            'users',
    settings:         'settings',
    expenses:         'expenses',
    'service-charge': 'service_charge_tracker',
  };

  const isFeatureAllowed = (tabId: string): boolean => {
    // dashboard is always allowed; platform admins bypass
    if (tabId === 'dashboard') return true;
    if (tabId === 'table-management') {
      return Boolean(tenant?.features?.table_management);
    }
    if (!tenant?.features) return true; // single-tenant / no restriction
    const key = TAB_FEATURE_MAP[tabId];
    if (!key) return true;
    return (tenant.features as Record<string, boolean>)[key] !== false;
  };

  const PlanUpgradeWall: React.FC<{ tabId: string }> = ({ tabId }) => {
    const featureLabel = tabId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const plan = tenant?.plan_type ?? 'starter';
    const nextPlan = plan === 'starter' ? 'Professional' : 'Enterprise';
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{featureLabel} Locked</h2>
            <p className="text-muted-foreground mt-2 leading-relaxed">
              This feature is not included in your current <span className="font-semibold capitalize text-primary">{plan}</span> plan.
              Upgrade to <span className="font-semibold">{nextPlan}</span> or higher to unlock it.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Your Plan Limits</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="grid grid-cols-2 gap-3 text-left">
            <div className="bg-muted/30 rounded-xl p-4 border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Max Branches</p>
              <p className="text-2xl font-bold">{tenant?.max_branches ?? 1}</p>
            </div>
            <div className="bg-muted/30 rounded-xl p-4 border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Max Staff</p>
              <p className="text-2xl font-bold">{tenant?.max_users ?? 3}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Contact your platform administrator to upgrade your subscription plan.
          </p>
        </div>
      </div>
    );
  };

  // Render Page Content based on selected tab — plan-gated & role-gated
  const renderContent = () => {
    if (profile && allowedTabIds.length === 0) {
      return (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-2">
            <h2 className="text-xl font-bold">No Modules Permitted</h2>
            <p className="text-sm text-muted-foreground">
              Your account currently has no enabled tabs. Contact your administrator to grant access.
            </p>
          </div>
        </div>
      );
    }
    if (!isFeatureAllowed(effectiveTab)) {
      return <PlanUpgradeWall tabId={effectiveTab} />;
    }
    switch (effectiveTab) {
      case 'dashboard':
        return <Dashboard setActiveTab={setActiveTab} />;
      case 'pos':
        return (
          <POS
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            isPosLocked={isPosLocked}
            onOpenLockDialog={setLockDialogMode}
          />
        );
      case 'queue-caller':
        return <QueueCaller />;
      case 'sales-history':
        return <SalesHistory />;
      case 'z-read-history':
        return <ZReadHistory />;
      case 'inventory':
        return <Inventory />;
      case 'global-inventory':
        return <GlobalInventory />;
      case 'receiving':
        return <StockReceiving />;
      case 'transfers':
        return <Transfers />;
      case 'adjustments':
        return <Adjustments />;
      case 'portioning':
        return <Portioning />;
      case 'transactions':
        return <Transactions />;
      case 'kitchen-receipts':
        return <KitchenReceipts />;
      case 'recipes':
        return <Recipes />;
      case 'branches':
        return <BranchManagement />;
      case 'table-management':
        return <TableManagement />;
      case 'analytics':
        return <Analytics />;
      case 'expenses':
        return <Expenses />;
      case 'service-charge':
        return <ServiceChargeTracker />;
      case 'audit-logs':
        return <AuditLogs />;
      case 'users':
        return <UserManagement />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard setActiveTab={setActiveTab} />;
    }
  };

  const shouldHideSidebar = isFullscreen && effectiveTab === 'pos';

  return (
    <div className={`min-h-screen ${effectiveTab === 'pos' ? 'h-screen overflow-hidden' : ''} flex bg-background text-foreground selection:bg-primary/30`}>
      <OfflineBanner />
      {/* Desktop Sidebar */}
      {!shouldHideSidebar && (
        <Sidebar
          activeTab={effectiveTab}
          setActiveTab={setActiveTab}
          isAppLocked={isPosLocked}
          onOpenLockDialog={setLockDialogMode}
        />
      )}

      {/* Mobile Top Header */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!shouldHideSidebar && (
          <MobileHeader
            activeTab={effectiveTab}
            setActiveTab={setActiveTab}
            isAppLocked={isPosLocked}
            onOpenLockDialog={setLockDialogMode}
          />
        )}

        {/* Main Content Area — pb-28 leaves room for mobile floating bottom nav */}
        <main 
          onScroll={handleScroll}
          className={`flex-1 flex flex-col min-w-0 ${
            effectiveTab === 'pos'
              ? 'h-full overflow-hidden'
              : 'overflow-y-auto overflow-x-hidden'
          } ${shouldHideSidebar ? 'pb-0' : 'pb-28 md:pb-0'}`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      {!shouldHideSidebar && <MobileBottomNav activeTab={effectiveTab} setActiveTab={setActiveTab} isVisible={showMobileNav} />}

      <PosLockDialog
        open={lockDialogMode !== null}
        mode={lockDialogMode || 'lock'}
        isOnline={isOnline}
        userEmail={profile?.email}
        onClose={() => setLockDialogMode(null)}
        onLocked={() => {
          handlePosLocked();
          showSuccess('App locked in Kiosk Mode.');
        }}
        onUnlocked={() => {
          handlePosUnlocked();
          showSuccess('App Kiosk Lock removed.');
        }}
      />

      <ActiveBranchSplashScreen />
      <Toaster />
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PendingApprovalsProvider>
          <ModalProvider>
            <AppContent />
          </ModalProvider>
        </PendingApprovalsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
