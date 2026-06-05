import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { BellIcon as Bell, CheckIcon as Check, ReloadIcon as RefreshCw, ExclamationTriangleIcon as AlertTriangle, SymbolIcon as ArrowRightLeft, ExclamationTriangleIcon as FileWarning, ClockIcon as Clock } from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { useToast } from '../hooks/use-toast';

interface Notification {
  id: string;
  branch_id: string;
  type: 'low_stock' | 'transfer_pending' | 'adjustment_pending' | 'system';
  message: string;
  is_read: boolean;
  created_at: string;
}

export const Notifications: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  const { toast } = useToast();
  
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = async () => {
    setRefreshing(true);
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });

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
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadNotifications();
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
      toast({ title: "Error", description: "Failed to mark as read", variant: "destructive" });
    }
  };

  const handleMarkAllAsRead = async () => {
    if (notifications.length === 0) return;
    try {
      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
      if (unreadIds.length === 0) return;

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('id', unreadIds);

      if (error) throw error;

      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      toast({ title: "Success", description: "All notifications marked as read." });
    } catch (err) {
      console.error(err);
      toast({ title: "Error", description: "Failed to mark all as read", variant: "destructive" });
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'low_stock':
        return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'transfer_pending':
        return <ArrowRightLeft className="w-5 h-5 text-primary" />;
      case 'adjustment_pending':
        return <FileWarning className="w-5 h-5 text-purple-500" />;
      default:
        return <Bell className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2.5">
            <Bell className="w-8 h-8 text-primary" />
            <span>Alerts & Notifications</span>
          </h2>
          <p className="text-muted-foreground mt-1">Receive real-time alerts on low stock levels, pending inventory transfers, and spillage logs.</p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="icon" onClick={loadNotifications}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          
          {unreadCount > 0 && (
            <Button variant="outline" className="text-primary hover:text-primary hover:bg-primary/10" onClick={handleMarkAllAsRead}>
              <Check className="h-4 w-4 mr-2" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-muted-foreground flex justify-center items-center h-48">
          <RefreshCw className="h-6 w-6 animate-spin mr-2" /> Loading notifications...
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {notifications.map(n => (
            <Card
              key={n.id}
              className={`transition-all ${
                n.is_read 
                  ? 'bg-muted/30 border-transparent shadow-none opacity-70' 
                  : 'glass-dark border-border/50 shadow-md'
              }`}
            >
              <CardContent className="p-4 flex items-start justify-between">
                <div className="flex space-x-4">
                  <div className={`p-2 rounded-lg border mt-0.5 ${n.is_read ? 'bg-background border-border/50' : 'bg-background shadow-sm'}`}>
                    {getIcon(n.type)}
                  </div>
                  <div>
                    <p className={`text-sm leading-relaxed ${!n.is_read ? 'font-bold' : 'text-muted-foreground'}`}>
                      {n.message}
                    </p>
                    <span className="text-xs text-muted-foreground flex items-center space-x-1 mt-2">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{new Date(n.created_at).toLocaleString()}</span>
                    </span>
                  </div>
                </div>

                {!n.is_read && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleMarkAsRead(n.id)}
                    className="text-muted-foreground hover:text-primary"
                    title="Mark as Read"
                  >
                    <Check className="w-5 h-5" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}

          {notifications.length === 0 && (
            <div className="text-center p-12 rounded-xl border-dashed border-2 border-border/50 text-muted-foreground">
              No notifications generated for this branch context.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
