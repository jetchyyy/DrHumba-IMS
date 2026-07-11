import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface Profile {
  id: string;
  email: string;
  role_name: 'super_admin' | 'inventory_manager' | 'branch_manager' | 'cashier' | 'auditor';
  branch_id: string | null;
  allowed_tabs: string[] | null;
  status: 'active' | 'suspended';
  is_platform_admin: boolean;
  tenant_id: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  name: string;
  is_warehouse: boolean;
  location: string | null;
  status?: string;
  parent_id?: string | null;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  selectedBranch: Branch | null;
  setSelectedBranch: (branch: Branch | null) => void;
  branches: Branch[];
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranchState] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBranches = async () => {
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .order('name');
      if (error) throw error;
      setBranches(data || []);
      return data || [];
    } catch (err) {
      console.error('Error fetching branches in AuthContext:', err);
      return [];
    }
  };

  const fetchProfile = async (userId: string, currentBranches: Branch[]) => {
    try {
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Profile not found, user might not have public.profile row yet:', error);
        setProfile(null);
        return;
      }

      setProfile(profileData);

      // Auto-select branch: prefer user's assigned branch, then warehouse, then first available.
      // For single-branch tenants (e.g. Starter plan) this ensures POS always has context.
      if (profileData.branch_id) {
        const branchObj = currentBranches.find(b => b.id === profileData.branch_id);
        let userBranch = branchObj;
        if (branchObj && branchObj.parent_id) {
          const parent = currentBranches.find(p => p.id === branchObj.parent_id);
          if (parent) userBranch = parent;
        }
        setSelectedBranchState(userBranch || currentBranches[0] || null);
      } else if (currentBranches.length > 0) {
        // For super admins / corporate roles with no fixed branch:
        // pick warehouse first, otherwise fall back to first branch
        const warehouse = currentBranches.filter(b => !b.parent_id).find(b => b.is_warehouse);
        setSelectedBranchState(warehouse || currentBranches.filter(b => !b.parent_id)[0] || currentBranches[0]);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      setProfile(null);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      const currentBranches = await fetchBranches();
      await fetchProfile(user.id, currentBranches);
    }
  };

  // 1. Listen for auth changes and fetch initial session
  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    }).catch(err => {
      console.error('Error getting initial session:', err);
      setUser(null);
      setLoading(false);
    });

    // Listen for subsequent changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // 2. Fetch profile and branches when user changes
  useEffect(() => {
    let active = true;

    const loadData = async () => {
      if (!user) {
        if (active) {
          setProfile(null);
          setSelectedBranchState(null);
          setLoading(false);
        }
        return;
      }

      if (active) {
        setLoading(true);
      }

      try {
        const currentBranches = await fetchBranches();
        if (active) {
          await fetchProfile(user.id, currentBranches);
        }
      } catch (err) {
        console.error('Error loading auth profile data:', err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      active = false;
    };
  }, [user?.id]);

  // 3. Safety fail-safe timeout to prevent infinite loading screen
  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      setLoading(false);
      console.warn('Auth initialization took too long. Force-resolved loading state to prevent hang.');
    }, 8000);

    return () => clearTimeout(safetyTimeout);
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const setSelectedBranch = (branch: Branch | null) => {
    // Only allow setting a different branch if role allows it
    if (profile?.role_name === 'super_admin' || profile?.role_name === 'inventory_manager' || profile?.role_name === 'auditor') {
      setSelectedBranchState(branch);
    } else {
      console.warn('Unauthorized: Branch can only be selected by admins, managers, or auditors.');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        selectedBranch,
        setSelectedBranch,
        branches,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
