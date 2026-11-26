import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { canApproveVoids } from '../lib/voidApproval';

export interface PendingCounts {
  transfers: number;       // status IN ('requested', 'pending_receipt_approval')
  adjustments: number;     // status = 'pending'
  portioning: number;      // status = 'pending'
  voids: number;           // void_requests.status = 'pending'
  total: number;
}

const EMPTY_COUNTS: PendingCounts = { transfers: 0, adjustments: 0, portioning: 0, voids: 0, total: 0 };
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

  const isInventoryApprover = !!(profile && (
    APPROVER_ROLES.includes(profile.role_name) ||
    profile.is_platform_admin ||
    profile.allowed_tabs?.includes('transfers_dispatch')
  ));
  const isVoidApprover = canApproveVoids(profile);
  const isApprover = isInventoryApprover || isVoidApprover;
  const fetchRef = useRef<() => Promise<void>>(async () => {});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!profile || !isApprover) {
      setCounts(EMPTY_COUNTS);
      return;
    }

    setLoading(true);
    try {
      const [transfersRes, adjustmentsRes, portioningRes, voidsRes] = await Promise.all([
        supabase
          .from('transfer_requests')
          .select('id', { count: 'exact' })
          .in('status', ['requested', 'pending_receipt_approval'])
          .limit(1),

        supabase
          .from('stock_adjustments')
          .select('id', { count: 'exact' })
          .eq('status', 'pending')
          .limit(1),

        supabase
          .from('portioning_requests')
          .select('id', { count: 'exact' })
          .eq('status', 'pending')
          .limit(1),

        isVoidApprover
          ? supabase
              .from('void_requests')
              .select('id', { count: 'exact' })
              .eq('status', 'pending')
              .limit(1)
          : Promise.resolve({ count: 0, error: null }),
      ]);

      const queryError = transfersRes.error || adjustmentsRes.error || portioningRes.error;
      if (queryError) throw queryError;

      const canApproveAdjustments =
        profile.role_name === 'super_admin' ||
        profile.is_platform_admin ||
        (profile.role_name === 'inventory_manager' && !profile.allowed_tabs?.includes('restrict_adjustment_edits'));

      const transfers = isInventoryApprover ? (transfersRes.count ?? 0) : 0;
      const adjustments = canApproveAdjustments ? (adjustmentsRes.count ?? 0) : 0;
      const portioning = isInventoryApprover ? (portioningRes.count ?? 0) : 0;
      // void_requests may not exist until its migration is applied; don't fail the other counts
      const voids = voidsRes.error ? 0 : (voidsRes.count ?? 0);

      setCounts({ transfers, adjustments, portioning, voids, total: transfers + adjustments + portioning + voids });
    } catch (err) {
      console.error('[PendingApprovalsProvider] Error fetching counts:', err);
    } finally {
      setLoading(false);
    }
  }, [profile?.id, isApprover, isInventoryApprover, isVoidApprover]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transfer_requests' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_adjustments' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portioning_requests' }, debouncedFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'void_requests' }, debouncedFetch)
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
