import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { supabase } from './lib/supabase';
import { Sidebar } from './components/Sidebar';
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
import { Mail, Key, Store, RefreshCw, ShieldAlert } from 'lucide-react';

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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-slate-400 text-xs tracking-widest font-semibold uppercase animate-pulse">
            Connecting to SUPABASE...
          </p>
        </div>
      </div>
    );
  }

  // Render Login / Signup if user is not authenticated
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="glass max-w-md w-full rounded-2xl overflow-hidden shadow-2xl p-8 space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-white shadow-lg shadow-indigo-500/20 mx-auto text-xl mb-4">
              R
            </div>
            <h1 className="text-xl font-bold text-white tracking-wide">RESTOChain</h1>
            <p className="text-xs text-slate-400 mt-1">Multi-Branch Restaurant Inventory System</p>
          </div>

          {authError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded text-center">
              {authError}
            </div>
          )}
          {authSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded text-center">
              {authSuccess}
            </div>
          )}

          <form onSubmit={isSignUp ? handleSignUp : handleSignIn} className="space-y-4">
            <div>
              <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@restaurant.com"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                Password
              </label>
              <div className="relative">
                <Key className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {isSignUp && branches.length > 0 && (
              <div>
                <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                  Default Branch Assignment
                </label>
                <div className="relative">
                  <Store className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                  <select
                    value={signupBranchId}
                    onChange={(e) => setSignupBranchId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-10 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-xs font-bold shadow-lg shadow-indigo-600/15 transition-all disabled:opacity-50"
            >
              {authLoading 
                ? 'Processing...' 
                : isSignUp 
                ? 'Register Account' 
                : 'Sign In to Dashboard'}
            </button>
          </form>

          <div className="text-center pt-2">
            <button
              onClick={() => {
                setIsSignUp(!isSignUp);
                setAuthError('');
                setAuthSuccess('');
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-all"
            >
              {isSignUp ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If logged in but trigger hasn't finished public.profiles creation yet
  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="glass max-w-md w-full rounded-2xl p-6 text-center space-y-4">
          <p className="text-sm text-slate-300">
            Provisioning profile record from database trigger...
          </p>
          <button
            onClick={refreshProfile}
            className="bg-indigo-600 text-xs font-bold text-white px-4 py-2 rounded-lg"
          >
            Refresh Profile
          </button>
        </div>
      </div>
    );
  }

  // Render blockade page if profile is suspended
  if (profile.status === 'suspended') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="glass max-w-md w-full rounded-2xl p-8 text-center space-y-6 border border-rose-500/20 shadow-2xl shadow-rose-500/5">
          <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center border border-rose-500/20 mx-auto text-rose-500">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide">Account Suspended</h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Your staff user credentials have been suspended by the system administrator. 
              You are currently blockaded from accessing dashboard registries.
            </p>
          </div>
          <button
            onClick={signOut}
            className="w-full bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white py-2.5 rounded-lg text-xs font-bold transition-all"
          >
            Sign Out & Return
          </button>
        </div>
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
    <div className="min-h-screen flex bg-slate-950 text-slate-100">
      {/* Sidebar Navigation */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {renderContent()}
      </main>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
