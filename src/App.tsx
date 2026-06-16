import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ModalProvider } from './contexts/ModalContext';
import { supabase } from './lib/supabase';
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
import { Transactions } from './components/Transactions';
import { Recipes } from './components/Recipes';
import { BranchManagement } from './components/BranchManagement';
import { Analytics } from './components/Analytics';
import { AuditLogs } from './components/AuditLogs';
import { UserManagement } from './components/UserManagement';
import { Settings } from './components/Settings';
import { SalesHistory } from './components/SalesHistory';
import { ActiveBranchSplashScreen } from './components/ActiveBranchSplashScreen';
import { ActiveBranchPill } from './components/ActiveBranchPill';
import { Pig404 } from './components/Pig404';
import { CustomerDisplay } from './components/CustomerDisplay';
import { EnvelopeClosedIcon as Mail, LockClosedIcon as Key, ReloadIcon as RefreshCw, ExclamationTriangleIcon as ShieldAlert, EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Toaster } from './components/ui/toaster';
import { Alert, AlertDescription } from './components/ui/alert';

const AppContent: React.FC = () => {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();

  // Check if this is the customer display screen
  const isCustomerDisplay = 
    window.location.pathname === '/customer-display' || 
    window.location.search.includes('view=customer-display');

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
        if ((window.screen as any).orientation?.lock) {
          await (window.screen as any).orientation.lock('landscape').catch((err: any) => {
            console.warn('Orientation lock failed:', err);
          });
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
    if (window.location.pathname !== '/' && !isCustomerPath) {
      setIs404(true);
    }
    
    const loadAssets = async () => {
      const img = new Image();
      img.src = '/drhumbalogo.jpg';
      
      const imgPromise = new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve; // proceed even if image fails to load
      });

      // Minimum splash screen duration (e.g., 1.5 seconds)
      const minDelay = new Promise(resolve => setTimeout(resolve, 1500));

      await Promise.all([imgPromise, minDelay]);
      setAssetsLoaded(true);
    };

    loadAssets();
  }, []);

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
      setAuthSuccess('Sign in successful!');
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Failed to sign in. Please verify credentials.');
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading || !assetsLoaded) {
    return <SplashScreen />;
  }

  if (is404) {
    return <Pig404 />;
  }

  if (isCustomerDisplay) {
    return <CustomerDisplay />;
  }

  // Render Login / Signup if user is not authenticated
  if (!user) {
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
              <img src="/drhumbalogo.jpg" alt="Dr. Humba Logo" className="w-full h-full object-cover rounded-full transform group-hover:scale-105 transition-transform duration-300" />
            </div>
            <div>
              <CardTitle className="text-3xl font-black text-slate-900 tracking-tight">DR. HUMBA</CardTitle>
              <CardDescription className="text-sm font-semibold text-pink-600 uppercase tracking-widest mt-1">
                Management System
              </CardDescription>
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
                    placeholder="name@drhumba.com"
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
             <p className="text-xs font-medium text-slate-500">
               © {new Date().getFullYear()} Dr. Humba. All rights reserved.
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

  // Render Page Content based on selected tab
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard setActiveTab={setActiveTab} />;
      case 'pos':
        return <POS isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen} />;
      case 'sales-history':
        return <SalesHistory />;
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
      case 'transactions':
        return <Transactions />;
      case 'recipes':
        return <Recipes />;
      case 'branches':
        return <BranchManagement />;
      case 'analytics':
        return <Analytics />;
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

  const shouldHideSidebar = isFullscreen && activeTab === 'pos';

  return (
    <div className="min-h-screen flex bg-background text-foreground selection:bg-primary/30">
      <OfflineBanner />
      {/* Desktop Sidebar */}
      {!shouldHideSidebar && <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />}

      {/* Mobile Top Header */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!shouldHideSidebar && <MobileHeader activeTab={activeTab} setActiveTab={setActiveTab} />}

        {/* Main Content Area — pb-28 leaves room for mobile floating bottom nav */}
        <main 
          onScroll={handleScroll}
          className={`flex-1 flex flex-col overflow-y-auto overflow-x-hidden ${shouldHideSidebar ? 'pb-0' : 'pb-28 md:pb-0'}`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      {!shouldHideSidebar && <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} isVisible={showMobileNav} />}

      <ActiveBranchSplashScreen />
      {!shouldHideSidebar && <ActiveBranchPill />}
      <Toaster />
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ModalProvider>
          <AppContent />
        </ModalProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
