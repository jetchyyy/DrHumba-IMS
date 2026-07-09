import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/use-toast';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { 
  Megaphone, 
  Play, 
  CheckCircle, 
  XCircle, 
  ExternalLink, 
  Volume2, 
  VolumeX, 
  Loader2,
  Clock,
  UtensilsCrossed
} from 'lucide-react';

interface QueueItem {
  id: string;
  queue_number: string;
  queue_status: 'preparing' | 'serving';
  queue_updated_at: string;
  control_number: string;
  created_at: string;
  items_summary?: string;
}

export const QueueCaller: React.FC = () => {
  const { selectedBranch } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [manualNumber, setManualNumber] = useState('');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [callingId, setCallingId] = useState<string | null>(null);

  // Load active queue items
  const loadQueue = async () => {
    if (!selectedBranch) return;
    setLoading(true);
    try {
      // Fetch queue items using RPC (safe, contains item details optionally)
      const { data, error } = await supabase.rpc('fn_get_active_queue', {
        p_branch_id: selectedBranch.id
      });

      if (error) throw error;

      // For active items, fetch summaries of sold items to show the staff what was ordered
      const itemsList = (data || []) as QueueItem[];
      
      if (itemsList.length > 0) {
        const saleIds = itemsList.map(item => item.id);
        const { data: salesDetails } = await supabase
          .from('sales')
          .select(`
            id,
            sale_items (
              quantity,
              menu_items (name)
            )
          `)
          .in('id', saleIds);

        if (salesDetails) {
          const summaryMap = new Map<string, string>();
          salesDetails.forEach((s: any) => {
            const itemsStr = s.sale_items
              .map((si: any) => `${si.quantity}x ${si.menu_items?.name || 'Dish'}`)
              .join(', ');
            summaryMap.set(s.id, itemsStr);
          });

          itemsList.forEach(item => {
            item.items_summary = summaryMap.get(item.id) || 'No details available';
          });
        }
      }

      setQueueItems(itemsList);
    } catch (err: any) {
      console.error('Failed to load queue:', err);
      toast({
        variant: 'destructive',
        title: 'Error loading queue',
        description: err.message || 'Could not fetch active queue items.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, [selectedBranch]);

  // Subscribe to real-time changes on the sales table for this branch
  useEffect(() => {
    if (!selectedBranch) return;

    const channel = supabase.channel(`queue-caller-sync:${selectedBranch.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales',
          filter: `branch_id=eq.${selectedBranch.id}`
        },
        () => {
          // Re-fetch queue state when database records change
          loadQueue();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedBranch]);

  // Voice announcement (Text-to-Speech)
  const announceNumber = (queueNum: string) => {
    if (!ttsEnabled) return;
    
    // Stop any ongoing speech
    window.speechSynthesis?.cancel();

    const cleanNum = queueNum.replace('-', ' ');
    const text = `Now serving order number ${cleanNum}. Please proceed to the counter.`;
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Find a good local voice if possible
    const voices = window.speechSynthesis?.getVoices() || [];
    const englishVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    if (englishVoice) utterance.voice = englishVoice;
    
    utterance.rate = 0.9; // Slightly slower for clarity
    window.speechSynthesis?.speak(utterance);
  };

  // Update status (e.g. Preparing -> Serving, or Serving -> Completed)
  const updateQueueStatus = async (saleId: string, queueNum: string, newStatus: 'serving' | 'completed' | 'cancelled') => {
    setCallingId(saleId);
    try {
      const { error } = await supabase
        .from('sales')
        .update({ queue_status: newStatus })
        .eq('id', saleId);

      if (error) throw error;

      toast({
        title: `Order #${queueNum} Status Updated`,
        description: `Marked as ${newStatus}.`
      });

      if (newStatus === 'serving') {
        announceNumber(queueNum);
      }
    } catch (err: any) {
      console.error('Failed to update status:', err);
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: err.message
      });
    } finally {
      setCallingId(null);
    }
  };

  // Manual Call Number (creates an audit log or triggers broadcast call)
  const handleManualCall = () => {
    if (!manualNumber.trim()) return;
    announceNumber(manualNumber.trim());
    toast({
      title: `Announcing Number`,
      description: `Calling "${manualNumber}" manually.`
    });
    setManualNumber('');
  };

  const preparingOrders = queueItems.filter(item => item.queue_status === 'preparing');
  const servingOrders = queueItems.filter(item => item.queue_status === 'serving');

  if (!selectedBranch) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <UtensilsCrossed className="w-16 h-16 text-muted-foreground animate-pulse" />
        <h2 className="text-xl font-bold">No Branch Selected</h2>
        <p className="text-muted-foreground max-w-sm">
          Please select an active branch context in the sidebar to load the queue calling dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 md:p-8 space-y-6 max-w-7xl mx-auto w-full">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-card p-6 rounded-2xl border shadow-sm">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Megaphone className="w-8 h-8 text-indigo-500" />
            QUEUE CALLER
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Active branch context: <span className="font-semibold text-foreground">{selectedBranch.name}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* TTS Audio toggle */}
          <Button
            variant={ttsEnabled ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className="font-bold flex items-center gap-2"
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {ttsEnabled ? 'Voice Announcements ON' : 'Voice Announcements OFF'}
          </Button>

          {/* TV Link */}
          <a
            href={`/queue-tv?branchId=${selectedBranch.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="default" size="sm" className="font-bold flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-600 dark:hover:bg-indigo-700">
              <ExternalLink className="w-4 h-4" />
              Open TV Display Screen
            </Button>
          </a>
        </div>
      </div>

      {/* Quick Manual Caller Grid */}
      <Card className="border-indigo-150/40 bg-indigo-50/10 dark:bg-indigo-950/5">
        <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-3">
          <div className="flex-1 w-full space-y-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-650 dark:text-indigo-400">
              Quick Manual Announcement / Call
            </h4>
            <p className="text-xs text-muted-foreground">
              Type any table or custom order number to announce it immediately over TTS.
            </p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto shrink-0">
            <Input
              placeholder="e.g. Table 4, Q-25"
              value={manualNumber}
              onChange={(e) => setManualNumber(e.target.value)}
              className="bg-background max-w-xs h-10 font-bold"
              onKeyDown={(e) => e.key === 'Enter' && handleManualCall()}
            />
            <Button onClick={handleManualCall} className="font-bold bg-indigo-600 hover:bg-indigo-700 text-white">
              Announce / Call
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Main Caller Interface */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">Loading queue registry...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* NOW PREPARING CARD */}
          <Card className="border-amber-100 dark:border-amber-950/20">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <Clock className="w-5 h-5 animate-pulse" />
                  Preparing Orders
                </CardTitle>
                <CardDescription className="text-xs">
                  Orders currently in the kitchen. Click Call to Serve.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="font-bold text-xs bg-amber-100 text-amber-800 dark:bg-amber-955/20 dark:text-amber-400">
                {preparingOrders.length} Pending
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {preparingOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-center">
                    <p className="text-sm font-semibold">No orders are preparing</p>
                    <p className="text-xs mt-1">New POS sales with queue numbers will appear here.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {preparingOrders.map(order => (
                      <div key={order.id} className="p-4 hover:bg-muted/40 transition-colors flex justify-between items-start gap-4">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-black text-foreground">{order.queue_number}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">({order.control_number})</span>
                          </div>
                          <p className="text-xs font-medium text-muted-foreground truncate" title={order.items_summary}>
                            {order.items_summary}
                          </p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Placed: {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={callingId === order.id}
                          onClick={() => updateQueueStatus(order.id, order.queue_number, 'serving')}
                          className="font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1 shrink-0 h-9"
                        >
                          {callingId === order.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4 fill-current" />
                          )}
                          Call / Serve
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* NOW SERVING CARD */}
          <Card className="border-emerald-100 dark:border-emerald-950/20">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <Megaphone className="w-5 h-5" />
                  Currently Serving
                </CardTitle>
                <CardDescription className="text-xs">
                  Ready at the counter. Click Done to complete.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="font-bold text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-955/20 dark:text-emerald-400">
                {servingOrders.length} Active
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[500px]">
                {servingOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-center">
                    <p className="text-sm font-semibold">No active calls</p>
                    <p className="text-xs mt-1">Orders ready for pickup will be listed here.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {servingOrders.map(order => (
                      <div key={order.id} className="p-4 hover:bg-muted/40 transition-colors flex justify-between items-start gap-4">
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-black text-foreground">{order.queue_number}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">({order.control_number})</span>
                          </div>
                          <p className="text-xs font-medium text-muted-foreground truncate" title={order.items_summary}>
                            {order.items_summary}
                          </p>
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Called: {new Date(order.queue_updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            title="Recall number"
                            onClick={() => announceNumber(order.queue_number)}
                            className="font-bold h-9 px-3 hover:bg-secondary border-emerald-250 text-emerald-700 dark:text-emerald-400"
                          >
                            <Volume2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            disabled={callingId === order.id}
                            onClick={() => updateQueueStatus(order.id, order.queue_number, 'completed')}
                            className="font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 h-9"
                          >
                            {callingId === order.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <CheckCircle className="w-4 h-4" />
                            )}
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Cancel Call"
                            onClick={() => updateQueueStatus(order.id, order.queue_number, 'cancelled')}
                            className="h-9 px-2 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
