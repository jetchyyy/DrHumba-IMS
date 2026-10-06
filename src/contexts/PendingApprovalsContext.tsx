import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export interface PendingCounts {
  transfers: number;       // status IN ('requested', 'pending_receipt_approval')
  adjustments: number;     // status = 'pending'
  portioning: number;      // status = 'pending'
  total: number;
}

const EMPTY_COUNTS: PendingCounts = { transfers: 0, adjustments: 0, portioning: 0, total: 0 };
const APPROVER_ROLES = ['super_admin', 'inventory_manager', 'branch_manager'];

interface PendingApprovalsContextType {
  counts: PendingCounts;
  loading: boolean;
  refetch: () => Promise<void>;
  isApprover: boolean;
}

const PendingApprovalsContext = createContext<PendingApprovalsContextType>({
  counts: EMPTY_COUNTS,
  loading: false,
  refetch: async () => {},
  isApprover: false,
});

export const PendingApprovalsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const [counts, setCounts] = useState<PendingCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(false);

  const isApprover = !!(profile && APPROVER_ROLES.includes(profile.role_name));
  const fetchRef = useRef<() => Promise<void>>(async () => {});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!profile || !APPROVER_ROLES.includes(profile.role_name)) {
      setCounts(EMPTY_COUNTS);
      return;
    }

    setLoading(true);
    try {
      const [transfersRes, adjustmentsRes, portioningRes] = await Promise.all([
        supabase
          .from('transfers')
          .select('id', { count: 'exact' })
          .in('status', ['requested', 'pending_receipt_approval'])
          .limit(1),

        supabase
          .from('adjustments')
          .select('id', { count: 'exact' })
          .eq('status', 'pending')
          .limit(1),

        supabase
          .from('portioning_requests')
          .select('id', { count: 'exact' })
          .eq('status', 'pending')
          .limit(1),
      ]);

      const transfers = transfersRes.count ?? 0;
      const adjustments = adjustmentsRes.count ?? 0;
      const portioning = portioningRes.count ?? 0;

      setCounts({ transfers, adjustments, portioning, total: transfers + adjustments + portioning });
    } catch (err) {
      console.error('[PendingApprovalsProvider] Error fetching counts:', err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, profile?.role_name]);

  useEffect(() => {
    fetchRef.current = fetchCounts;
  }, [fetchCounts]);

  const debouncedFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchRef.current(), 400);
  }, []);

  useEffect(() => {
    if (!isApprover) {
      setCounts(EMPTY_COUNTS);
      return;
    }
    fetchCounts();
  }, [fetchCounts, isApprover]);

  useEffect(() => {
    if (!isApprover || !profile?.id) return;

    const channelId = Math.random().toString(36).substring(2, 9);
    const channelName = `pending-approvals-${profile.id}-${channelId}`;

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfers' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'adjustments' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portioning_requests' }, debouncedFetch)
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [isApprover, profile?.id, debouncedFetch]);

  return (
    <PendingApprovalsContext.Provider value={{ counts, loading, refetch: fetchCounts, isApprover }}>
      {children}
    </PendingApprovalsContext.Provider>
  );
};

export const usePendingApprovalCounts = () => useContext(PendingApprovalsContext);
