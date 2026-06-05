import { useEffect, useState, useRef } from 'react';

export type NetworkStatus = 'online' | 'offline' | 'unstable';

/**
 * useNetworkStatus
 * ──────────────────────────────────────────────────────────────
 * Monitors connectivity via three signals:
 *  1. navigator.onLine (instant browser event)
 *  2. Periodic lightweight fetch to Supabase health endpoint
 *     to catch "connected to router but no internet" scenarios
 *  3. Supabase Realtime disconnect events (future-ready)
 *
 * Returns: { status, isOnline, lastChecked }
 */

const HEALTH_URL = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/health`;
const POLL_INTERVAL_MS = 15_000; // check every 15s
const TIMEOUT_MS       = 5_000;  // consider offline if no response in 5s

async function pingHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    const headers: Record<string, string> = {};
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (anonKey) {
      headers['apikey'] = anonKey;
    }

    const res = await fetch(HEALTH_URL, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

export function useNetworkStatus() {
  const [status, setStatus] = useState<NetworkStatus>('online');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = async () => {
    const alive = await pingHealth();
    setLastChecked(new Date());

    if (!navigator.onLine || !alive) {
      setStatus('offline');
    } else {
      setStatus('online');
    }
  };

  useEffect(() => {
    // Immediate check on mount
    check();

    // Periodic polling
    intervalRef.current = setInterval(check, POLL_INTERVAL_MS);

    // Browser-level online/offline events (instant)
    const handleOnline  = () => check();
    const handleOffline = () => setStatus('offline');

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    status,
    isOnline: status === 'online',
    lastChecked,
  };
}
