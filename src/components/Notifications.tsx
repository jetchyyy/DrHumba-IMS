import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Bell, Check, RefreshCw, AlertTriangle, ArrowRightLeft, FileWarning, Clock } from 'lucide-react';

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

      // If user is restricted to a branch (branch manager/cashier), filter to their branch
      if (profile && !['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name)) {
        if (profile.branch_id) {
          query = query.eq('branch_id', profile.branch_id);
        }
      } else if (selectedBranch) {
        // For admin/manager, they can see notifications for their selected branch context
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
    } catch (err) {
      console.error(err);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'low_stock':
        return <AlertTriangle className="w-5 h-5 text-amber-500" />;
      case 'transfer_pending':
        return <ArrowRightLeft className="w-5 h-5 text-indigo-400" />;
      case 'adjustment_pending':
        return <FileWarning className="w-5 h-5 text-purple-400" />;
      default:
        return <Bell className="w-5 h-5 text-slate-400" />;
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2.5">
            <Bell className="w-6 h-6 text-indigo-500" />
            <span>Alerts & Notifications</span>
          </h2>
          <p className="text-sm text-slate-400">Receive real-time alerts on low stock levels, pending inventory transfers, and spillage logs.</p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={loadNotifications}
            className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="flex items-center space-x-1.5 bg-slate-900 border border-slate-850 hover:bg-slate-850 text-indigo-400 hover:text-white px-3 py-2 rounded-lg text-xs font-bold transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-slate-500 text-center p-8">Loading notifications...</div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {notifications.map(n => (
            <div
              key={n.id}
              className={`p-4 rounded-xl border flex items-start justify-between transition-all ${
                n.is_read 
                  ? 'bg-slate-900/30 border-slate-900/60 opacity-60' 
                  : 'bg-slate-900/80 border-slate-800/80 shadow-md'
              }`}
            >
              <div className="flex space-x-4">
                <div className="p-2 bg-slate-950 rounded-lg border border-slate-850 mt-0.5">
                  {getIcon(n.type)}
                </div>
                <div>
                  <p className={`text-xs font-medium text-slate-200 leading-relaxed ${!n.is_read ? 'font-bold' : ''}`}>
                    {n.message}
                  </p>
                  <span className="text-[10px] text-slate-500 flex items-center space-x-1 mt-2">
                    <Clock className="w-3 h-3 text-slate-600" />
                    <span>{new Date(n.created_at).toLocaleString()}</span>
                  </span>
                </div>
              </div>

              {!n.is_read && (
                <button
                  onClick={() => handleMarkAsRead(n.id)}
                  className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition-all"
                  title="Mark as Read"
                >
                  <Check className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}

          {notifications.length === 0 && (
            <div className="text-center p-12 glass rounded-xl border-dashed border-2 border-slate-800/60 text-slate-500 text-xs">
              No notifications generated for this branch context.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
