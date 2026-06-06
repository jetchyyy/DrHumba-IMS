import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BellIcon as Bell, CheckIcon as Check, ExclamationTriangleIcon as AlertTriangle, SymbolIcon as ArrowRightLeft, ExclamationTriangleIcon as FileWarning, ClockIcon as Clock } from '@radix-ui/react-icons';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { useModal } from '../contexts/ModalContext';

interface Notification {
  id: string;
  branch_id: string;
  type: 'low_stock' | 'transfer_pending' | 'adjustment_pending' | 'system';
  message: string;
  is_read: boolean;
  created_at: string;
}

export const FloatingNotifications: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  const { showSuccess, showError } = useModal();
  
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const loadNotifications = async () => {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (profile && !['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name)) {
        if (profile.branch_id) {
          query = query.eq('branch_id', profile.branch_id);
        }
      } else if (selectedBranch) {
        query = query.eq('branch_id', selectedBranch.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setNotifications(data || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  // Poll for notifications or reload when branch changes
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [selectedBranch, profile]);

  const handleMarkAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (error) throw error;
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error(err);
      showError("Failed to mark as read");
    }
  };

  const handleMarkAllAsRead = async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('id', unreadIds);

      if (error) throw error;
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      showSuccess("All notifications marked as read.");
    } catch (err) {
      console.error(err);
      showError("Failed to mark all as read");
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'low_stock':
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'transfer_pending':
        return <ArrowRightLeft className="w-4 h-4 text-primary" />;
      case 'adjustment_pending':
        return <FileWarning className="w-4 h-4 text-purple-500" />;
      default:
        return <Bell className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (!profile) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 mr-4 mt-1 bg-background/95 backdrop-blur-md border-border shadow-xl z-50">
        <div className="flex items-center justify-between p-4 border-b">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-primary hover:text-primary/80" onClick={handleMarkAllAsRead}>
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center">
              <Bell className="w-8 h-8 opacity-20 mb-2" />
              No new notifications
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map(n => (
                <div key={n.id} className={`flex items-start gap-3 p-4 border-b last:border-0 transition-colors ${n.is_read ? 'opacity-60' : 'bg-muted/20'}`}>
                  <div className={`mt-0.5 p-1.5 rounded-md border ${n.is_read ? 'bg-background' : 'bg-background shadow-sm'}`}>
                    {getIcon(n.type)}
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className={`text-xs ${!n.is_read ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                      {n.message}
                    </p>
                    <p className="text-[10px] text-muted-foreground flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!n.is_read && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-primary" onClick={() => handleMarkAsRead(n.id)}>
                      <Check className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
