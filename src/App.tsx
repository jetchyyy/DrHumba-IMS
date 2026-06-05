import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { supabase } from './lib/supabase';
import { Sidebar, MobileHeader, MobileBottomNav } from './components/Sidebar';
import { OfflineBanner } from './components/OfflineBanner';
import { Dashboard } from './components/Dashboard';
import { POS } from './components/POS';
import { Inventory } from './components/Inventory';
import { GlobalInventory } from './components/GlobalInventory';
import { StockReceiving } from './components/StockReceiving';
import { Transfers } from './components/Transfers';
import { Adjustments } from './components/Adjustments';
import { Recipes } from './components/Recipes';
import { BranchManagement } from './components/BranchManagement';
import { Analytics } from './components/Analytics';
import { Notifications } from './components/Notifications';
import { AuditLogs } from './components/AuditLogs';
import { UserManagement } from './components/UserManagement';
import { Settings } from './components/Settings';
import { SalesHistory } from './components/SalesHistory';
import { EnvelopeClosedIcon as Mail, LockClosedIcon as Key, BoxModelIcon as Store, ReloadIcon as RefreshCw, ExclamationTriangleIcon as ShieldAlert } from '@radix-ui/react-icons';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card';
import { Toaster } from './components/ui/toaster';
import { Alert, AlertDescription } from './components/ui/alert';

const AppContent: React.FC = () => {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();

  // Navigation active state
  const [activeTab, setActiveTab] = useState('dashboard');

  // Authentication states
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signupBranchId, setSignupBranchId] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Local list of branches for registration selection
  const [branches, setBranches] = useState<any[]>([]);

  useEffect(() => {
    // Load branches for signup dropdown selection
    supabase
      .from('branches')
      .select('id, name')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setBranches(data);
          setSignupBranchId(data[0].id);
        }
      });
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setAuthLoading(true);

    try {
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            role_name: 'cashier', // Default role for new users
            branch_id: signupBranchId || null
          }
        }
      });

      if (error) throw error;

      setAuthSuccess(
        'Sign up successful! Your account is created. Note: Go to settings to view how to elevate this account to Super Admin.'
      );
      setEmail('');
      setPassword('');
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || 'Failed to sign up.');
    } finally {
      setAuthLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <RefreshCw className="w-8 h-8 text-primary animate-spin" />
          <p className="text-muted-foreground text-xs tracking-widest font-semibold uppercase animate-pulse">
            Connecting to DATABASE...
          </p>
        </div>
      </div>
    );
  }

  // Render Login / Signup if user is not authenticated
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-2xl glass-dark border-border/50">
          <CardHeader className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center font-black text-primary-foreground shadow-lg mx-auto text-xl mb-2">
              R
            </div>
            <CardTitle className="text-2xl font-bold tracking-wide">RESTOChain</CardTitle>
            <CardDescription className="text-xs">
              Multi-Branch Restaurant Inventory System
            </CardDescription>
          </CardHeader>

          <CardContent>
            {authError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            )}
            {authSuccess && (
              <Alert className="mb-4 border-emerald-500/50 text-emerald-500">
                <AlertDescription>{authSuccess}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Email Address</Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@restaurant.com"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
                <div className="relative">
                  <Key className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                  <Input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-10"
                  />
                </div>
              </div>

              {isSignUp && branches.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Default Branch Assignment</Label>
                  <div className="relative">
                    <Store className="w-4 h-4 text-muted-foreground absolute left-3 top-3 z-10" />
                    <Select value={signupBranchId} onValueChange={setSignupBranchId}>
                      <SelectTrigger className="pl-10">
                        <SelectValue placeholder="Select a branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map(b => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                className="w-full font-bold shadow-lg"
                disabled={authLoading}
              >
                {authLoading
                  ? 'Processing...'
                  : isSignUp
                    ? 'Register Account'
                    : 'Sign In to Dashboard'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <Button
              variant="link"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setAuthError('');
                setAuthSuccess('');
              }}
              className="text-xs text-muted-foreground hover:text-primary transition-all"
            >
              {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
            </Button>
          </CardFooter>
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

  // Render Page Content based on selected tab
  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard setActiveTab={setActiveTab} />;
      case 'pos':
        return <POS />;
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
      case 'recipes':
        return <Recipes />;
      case 'branches':
        return <BranchManagement />;
      case 'analytics':
        return <Analytics />;
      case 'notifications':
        return <Notifications />;
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

  return (
    <div className="min-h-screen flex bg-background text-foreground selection:bg-primary/30">
      <OfflineBanner />
      {/* Desktop Sidebar */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Mobile Top Header */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <MobileHeader activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Main Content Area — pb-28 leaves room for mobile floating bottom nav */}
        <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden pb-28 md:pb-0">
          {renderContent()}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />

      <Toaster />
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
