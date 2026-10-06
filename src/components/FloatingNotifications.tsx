import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  BellIcon as Bell,
  CheckIcon as Check,
  ExclamationTriangleIcon as AlertTriangle,
  SymbolIcon as ArrowRightLeft,
  ExclamationTriangleIcon as FileWarning,
  ClockIcon as Clock,
  ArrowRightIcon as ArrowRight,
  MagicWandIcon as ChefHat,
  SpeakerOffIcon as VolumeX,
  SpeakerLoudIcon as Volume2,
} from '@radix-ui/react-icons';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { useModal } from '../contexts/ModalContext';
import { usePendingApprovalCounts } from '../hooks/usePendingApprovalCounts';
import {
  playNotificationSound,
  sendBrowserNotification,
  getNotificationPermission,
  requestNotificationPermission,
  isNotificationMuted,
  setNotificationMuted,
  shouldPromptForPermission,
} from '../lib/notificationService';

interface Notification {
  id: string;
  branch_id: string;
  type: 'low_stock' | 'transfer_pending' | 'adjustment_pending' | 'portioning_pending' | 'system';
  message: string;
  is_read: boolean;
  created_at: string;
}

interface FloatingNotificationsProps {
  onNavigate?: (tab: string) => void;
}

export type NotificationFilter = 'all' | 'unread' | 'transfers' | 'adjustments' | 'portioning' | 'low_stock';

export const FloatingNotifications: React.FC<FloatingNotificationsProps> = ({ onNavigate }) => {
  const { profile, selectedBranch } = useAuth();
  const { showSuccess, showError } = useModal();
  const { counts, isApprover } = usePendingApprovalCounts();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [open, setOpen] = useState(false);
  const [bellRinging, setBellRinging] = useState(false);
  const [muted, setMuted] = useState(isNotificationMuted());
  const [permissionState, setPermissionState] = useState(getNotificationPermission());
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);
  const prevCountRef = useRef(0);
  const isFirstLoad = useRef(true);

  // ── Load initial notifications ──────────────────────────────────────────────
  const loadNotifications = useCallback(async () => {
    if (!profile) return;
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);

      if (!['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name)) {
        if (profile.branch_id) query = query.eq('branch_id', profile.branch_id);
      } else if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('[FloatingNotifications] Error fetching notifications:', err);
    }
  }, [profile?.id, profile?.role_name, selectedBranch?.id]);

  // ── Realtime subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!profile) return;

    loadNotifications();

    const channelId = Math.random().toString(36).substring(2, 9);
    const channelName = `notifications-realtime:${profile.id}-${channelId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);

          // Ring bell + sound (skip first-load)
          if (!isFirstLoad.current) {
            setBellRinging(true);
            playNotificationSound();

            // Browser push notification
            const isApprovalType =
              newNotif.type === 'transfer_pending' ||
              newNotif.type === 'adjustment_pending' ||
              newNotif.type === 'portioning_pending';

            sendBrowserNotification(
              isApprovalType ? '⚡ Approval Required' : '🔔 New Notification',
              {
                body: newNotif.message,
                tag: `notif-${newNotif.id}`,
                onClickNavigate: () => {
                  if (isApprovalType && onNavigate) {
                    const tabMap: Record<string, string> = {
                      transfer_pending: 'transfers',
                      adjustment_pending: 'adjustments',
                      portioning_pending: 'portioning',
                    };
                    onNavigate(tabMap[newNotif.type] || 'notifications');
                  }
                },
              }
            );

            setTimeout(() => setBellRinging(false), 900);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        (payload) => {
          const updated = payload.new as Notification;
          setNotifications((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        }
      )
      .subscribe(() => {
        isFirstLoad.current = false;
      });

    // Fallback poll every 60s (Realtime is primary)
    const fallback = setInterval(loadNotifications, 60000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(fallback);
    };
  }, [profile?.id, selectedBranch?.id]); // ← stable primitive deps only


  // ── Animate bell when pending approval count changes ───────────────────────
  useEffect(() => {
    if (isFirstLoad.current) return;
    if (counts.total > prevCountRef.current) {
      setBellRinging(true);
      setTimeout(() => setBellRinging(false), 900);
    }
    prevCountRef.current = counts.total;
  }, [counts.total]);

  // ── Show permission prompt on mount (deferred) ─────────────────────────────
  useEffect(() => {
    if (isApprover && shouldPromptForPermission()) {
      const t = setTimeout(() => setShowPermissionPrompt(true), 3000);
      return () => clearTimeout(t);
    }
  }, [isApprover]);

  // ── Mark as read ───────────────────────────────────────────────────────────
  const handleMarkAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);
      if (error) throw error;
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch {
      showError('Failed to mark as read');
    }
  };

  const handleMarkAllAsRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('id', unreadIds);
      if (error) throw error;
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      showSuccess('All notifications marked as read.');
    } catch {
      showError('Failed to mark all as read');
    }
  };

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    setPermissionState(getNotificationPermission());
    setShowPermissionPrompt(false);
    if (granted) showSuccess('Desktop notifications enabled!');
  };

  const toggleMute = () => {
    const newMuted = !muted;
    setMuted(newMuted);
    setNotificationMuted(newMuted);
  };

  // ── Icons ──────────────────────────────────────────────────────────────────
  const getIcon = (type: string, size = 'w-4 h-4') => {
    switch (type) {
      case 'low_stock':
        return <AlertTriangle className={`${size} text-amber-500`} />;
      case 'transfer_pending':
        return <ArrowRightLeft className={`${size} text-blue-400`} />;
      case 'adjustment_pending':
        return <FileWarning className={`${size} text-purple-500`} />;
      case 'portioning_pending':
        return <ChefHat className={`${size} text-emerald-500`} />;
      default:
        return <Bell className={`${size} text-muted-foreground`} />;
    }
  };

  const matchesFilter = (n: Notification, filter: NotificationFilter): boolean => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !n.is_read;

    const t = (n.type || '').toLowerCase();
    const m = (n.message || '').toLowerCase();

    if (filter === 'transfers') {
      return (
        t.includes('transfer') ||
        t.includes('shipment') ||
        m.includes('transfer') ||
        m.includes('shipment') ||
        m.includes('trf-')
      );
    }
    if (filter === 'adjustments') {
      return (
        t.includes('adjustment') ||
        m.includes('adjustment') ||
        m.includes('adj-')
      );
    }
    if (filter === 'portioning') {
      return (
        t.includes('portion') ||
        m.includes('portion') ||
        m.includes('por-')
      );
    }
    if (filter === 'low_stock') {
      return (
        t.includes('stock') ||
        t === 'low_stock' ||
        m.includes('low stock') ||
        m.includes('reorder level')
      );
    }
    return true;
  };

  const filteredNotifications = notifications.filter((n) => matchesFilter(n, activeFilter));

  const filterCounts: Record<NotificationFilter, number> = {
    all: notifications.length,
    unread: notifications.filter((n) => !n.is_read).length,
    transfers: notifications.filter((n) => matchesFilter(n, 'transfers')).length,
    adjustments: notifications.filter((n) => matchesFilter(n, 'adjustments')).length,
    portioning: notifications.filter((n) => matchesFilter(n, 'portioning')).length,
    low_stock: notifications.filter((n) => matchesFilter(n, 'low_stock')).length,
  };

  const filterOptions: { id: NotificationFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'transfers', label: 'Transfers' },
    { id: 'adjustments', label: 'Adjustments' },
    { id: 'portioning', label: 'Portioning' },
    { id: 'low_stock', label: 'Stock Alerts' },
  ];

  const getNotificationTargetTab = (n: Notification): string | null => {
    const t = (n.type || '').toLowerCase();
    const m = (n.message || '').toLowerCase();
    if (t.includes('transfer') || m.includes('transfer') || m.includes('shipment') || m.includes('trf-')) return 'transfers';
    if (t.includes('adjustment') || m.includes('adjustment') || m.includes('adj-')) return 'adjustments';
    if (t.includes('portion') || m.includes('portion') || m.includes('por-')) return 'portioning';
    if (t.includes('stock') || m.includes('low stock')) return 'inventory';
    return null;
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  // Total badge: combine unread notifications + pending approvals (de-duped by using unread as base)
  const badgeCount = Math.max(unreadCount, counts.total);

  if (!profile) return null;

  return (
    <>
      {/* ── Permission Prompt Toast ── */}
      {showPermissionPrompt && permissionState === 'default' && (
        <div className="fixed bottom-20 right-4 z-50 max-w-xs bg-card border border-border shadow-xl rounded-xl p-3 animate-slide-down">
          <p className="text-xs font-semibold text-foreground mb-1">Enable Desktop Notifications?</p>
          <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">
            Get notified about pending approvals even when you're on another tab.
          </p>
          <div className="flex gap-2">
            <Button size="sm" className="text-xs h-7 flex-1" onClick={handleRequestPermission}>
              Enable
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 flex-1"
              onClick={() => setShowPermissionPrompt(false)}
            >
              Not now
            </Button>
          </div>
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="notification-bell-btn"
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
            title={badgeCount > 0 ? `${badgeCount} notifications pending` : 'Notifications'}
          >
            {/* Bell icon with ring animation */}
            <Bell className={`h-5 w-5 ${bellRinging ? 'animate-bell-ring' : ''}`} />

            {/* Numeric badge */}
            {badgeCount > 0 && (
              <span
                key={badgeCount} // re-mount to re-trigger pop animation on count change
                className={`animate-badge-pop absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none border border-background ${
                  counts.total > 0
                    ? 'bg-red-500 text-white'
                    : 'bg-amber-500 text-white'
                }`}
              >
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-96 p-0 mr-4 mt-1 bg-background/98 backdrop-blur-md border-border shadow-2xl z-50 overflow-hidden"
          align="end"
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <h4 className="font-semibold text-sm">Notifications</h4>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-primary/20 text-primary border-primary/30">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {/* Sound toggle */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                title={muted ? 'Unmute notification sounds' : 'Mute notification sounds'}
                onClick={toggleMute}
              >
                {muted
                  ? <VolumeX className="h-3 w-3" />
                  : <Volume2 className="h-3 w-3" />
                }
              </Button>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-xs text-primary hover:text-primary/80"
                  onClick={handleMarkAllAsRead}
                >
                  Mark all read
                </Button>
              )}
            </div>
          </div>

          {/* ── Pending Approvals Summary (Phase 3) ── */}
          {isApprover && counts.total > 0 && (
            <div className="p-3 bg-amber-500/5 border-b border-amber-500/20 animate-slide-down">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-500">
                  ⚡ {counts.total} Pending Approval{counts.total !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="space-y-1">
                {counts.transfers > 0 && (
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-colors group"
                    onClick={() => { onNavigate?.('transfers'); setOpen(false); }}
                  >
                    <div className="flex items-center gap-2">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-xs font-medium text-blue-400">Transfers</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-blue-400">{counts.transfers} pending</span>
                      <ArrowRight className="w-3 h-3 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                )}
                {counts.adjustments > 0 && (
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-colors group"
                    onClick={() => { onNavigate?.('adjustments'); setOpen(false); }}
                  >
                    <div className="flex items-center gap-2">
                      <FileWarning className="w-3.5 h-3.5 text-purple-500" />
                      <span className="text-xs font-medium text-purple-400">Adjustments</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-purple-400">{counts.adjustments} pending</span>
                      <ArrowRight className="w-3 h-3 text-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                )}
                {counts.portioning > 0 && (
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors group"
                    onClick={() => { onNavigate?.('portioning'); setOpen(false); }}
                  >
                    <div className="flex items-center gap-2">
                      <ChefHat className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-xs font-medium text-emerald-400">Portioning</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-emerald-400">{counts.portioning} pending</span>
                      <ArrowRight className="w-3 h-3 text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Transaction Type / Category Filter Bar ── */}
          <div className="px-3 py-2 border-b bg-muted/10">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {filterOptions.map((f) => {
                const count = filterCounts[f.id];
                const isActive = activeFilter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setActiveFilter(f.id)}
                    className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] transition-all font-medium border ${
                      isActive
                        ? 'bg-primary text-primary-foreground border-primary shadow-xs font-semibold'
                        : 'bg-background hover:bg-muted/60 text-muted-foreground hover:text-foreground border-border/60'
                    }`}
                  >
                    <span>{f.label}</span>
                    <span
                      className={`text-[9px] px-1 py-0.2 rounded-full ${
                        isActive
                          ? 'bg-primary-foreground/20 text-primary-foreground font-bold'
                          : 'bg-muted text-muted-foreground font-medium'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <ScrollArea className="h-72">
            {filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <Bell className="w-8 h-8 opacity-20" />
                <span>
                  {notifications.length === 0
                    ? 'No notifications yet'
                    : `No ${filterOptions.find(f => f.id === activeFilter)?.label.toLowerCase()} notifications`}
                </span>
                {notifications.length > 0 && activeFilter !== 'all' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary h-7 mt-1"
                    onClick={() => setActiveFilter('all')}
                  >
                    Show all notifications
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col pb-2">
                {filteredNotifications.map((n) => {
                  const targetTab = getNotificationTargetTab(n);
                  return (
                    <div
                      key={n.id}
                      className={`group flex items-start gap-3 px-4 py-3 border-b last:border-0 transition-colors hover:bg-muted/20 ${
                        n.is_read ? 'opacity-60' : 'bg-muted/10'
                      }`}
                    >
                      <div className={`mt-0.5 p-1.5 rounded-md border flex-shrink-0 ${n.is_read ? 'bg-background' : 'bg-background shadow-sm'}`}>
                        {getIcon(n.type)}
                      </div>
                      <div
                        className={`flex-1 space-y-1 min-w-0 ${targetTab && onNavigate ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if (targetTab && onNavigate) {
                            onNavigate(targetTab);
                            setOpen(false);
                          }
                        }}
                      >
                        <p className={`text-xs leading-snug ${!n.is_read ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                          {n.message}
                        </p>
                        <div className="flex items-center gap-2">
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            {new Date(n.created_at).toLocaleString()}
                          </p>
                          {targetTab && onNavigate && (
                            <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 font-medium">
                              View <ArrowRight className="w-2.5 h-2.5 inline" />
                            </span>
                          )}
                        </div>
                      </div>
                      {!n.is_read && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkAsRead(n.id);
                          }}
                          title="Mark as read"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* ── Footer: push notification state ── */}
          {isApprover && permissionState !== 'granted' && (
            <div className="p-3 border-t bg-muted/20">
              {permissionState === 'denied' ? (
                <p className="text-[10px] text-muted-foreground text-center">
                  Desktop notifications blocked. Enable in browser settings.
                </p>
              ) : (
                <button
                  className="w-full text-[10px] text-primary hover:text-primary/80 font-medium transition-colors"
                  onClick={handleRequestPermission}
                >
                  🔔 Enable desktop push notifications →
                </button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
};
