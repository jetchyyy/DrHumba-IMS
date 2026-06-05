import React from 'react';
import { useNetworkStatus } from '../hooks/use-network-status';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';

/**
 * OfflineBanner
 * ─────────────────────────────────────────────────────────────
 * Renders a sticky top banner whenever the Supabase connection
 * is detected as offline (either browser offline or server
 * unreachable).  Stays visible until the connection is restored,
 * then automatically dismisses with a brief "Reconnected" flash.
 */
export const OfflineBanner: React.FC = () => {
  const { status } = useNetworkStatus();
  const [showReconnected, setShowReconnected] = React.useState(false);
  const prevStatus = React.useRef(status);

  React.useEffect(() => {
    if (prevStatus.current === 'offline' && status === 'online') {
      // Was offline, now back online → flash success
      setShowReconnected(true);
      const t = setTimeout(() => setShowReconnected(false), 4000);
      prevStatus.current = status;
      return () => clearTimeout(t);
    }
    prevStatus.current = status;
  }, [status]);

  if (status === 'online' && !showReconnected) return null;

  if (showReconnected) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 bg-emerald-600 text-white text-xs font-semibold py-2 px-4 shadow-lg animate-in slide-in-from-top duration-300"
      >
        <span className="w-2 h-2 rounded-full bg-white animate-pulse inline-block" />
        Connection restored — you are back online.
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 bg-destructive text-destructive-foreground text-xs font-semibold py-2.5 px-4 shadow-lg"
    >
        <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
      <span>
        <strong>No connection detected.</strong> POS operations are paused — please check your network before processing transactions.
      </span>
    </div>
  );
};
