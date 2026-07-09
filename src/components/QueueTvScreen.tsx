import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Volume2, VolumeX, UtensilsCrossed, Sun, Moon, Maximize, Minimize } from 'lucide-react';
import { Button } from './ui/button';
import { useTenant } from '../contexts/TenantContext';

interface QueueItem {
  id: string;
  queue_number: string;
  queue_status: 'preparing' | 'serving';
  queue_updated_at: string;
  control_number: string;
  created_at: string;
}

export const QueueTvScreen: React.FC = () => {
  const { tenant, isSingleTenantMode } = useTenant();
  const isDrHumba = isSingleTenantMode || !tenant || tenant.subdomain === null;
  const logoUrl = tenant?.logo_url || (isDrHumba ? "/drhumbalogo.jpg" : "/saaslogo.png");
  const appName = tenant?.name || (isDrHumba ? "Dr. Humba" : "ERPSaaS");

  const [loading, setLoading] = useState(true);
  const [branchName, setBranchName] = useState('Main Branch');
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [lastCalledNum, setLastCalledNum] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [audioChimeEnabled, setAudioChimeEnabled] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const previousServingRef = useRef<string[]>([]);

  // Parse branchId from URL
  const params = new URLSearchParams(window.location.search);
  const branchId = params.get('branchId');

  // Track browser native fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch((err) => {
          console.warn('Fullscreen request failed:', err);
        });
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      }
    } catch (e) {
      console.error('Fullscreen toggle exception:', e);
    }
  };

  // Synthesize a beautiful double-beep chime
  const playChime = () => {
    if (!audioChimeEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      // Tone 1: D5 (587.33 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
      gain1.gain.setValueAtTime(0.15, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.35);
      
      // Tone 2: A5 (880 Hz) played slightly later
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12);
      gain2.gain.setValueAtTime(0.15, ctx.currentTime + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
      osc2.start(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.50);
    } catch (e) {
      console.warn('AudioContext not allowed or failed:', e);
    }
  };

  // TTS Speech Announcement
  const speakAnnouncement = (num: string) => {
    if (!ttsEnabled) return;
    window.speechSynthesis?.cancel();
    const cleanNum = num.replace('-', ' ');
    const utterance = new SpeechSynthesisUtterance(`Now serving, order number ${cleanNum}`);
    const voices = window.speechSynthesis?.getVoices() || [];
    const englishVoice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    if (englishVoice) utterance.voice = englishVoice;
    utterance.rate = 0.85;
    window.speechSynthesis?.speak(utterance);
  };

  // Clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch branch details
  const loadBranchDetails = async () => {
    if (!branchId) return;
    try {
      const { data, error } = await supabase
        .from('branches')
        .select('name')
        .eq('id', branchId)
        .single();
      if (error) throw error;
      if (data) setBranchName(data.name);
    } catch (err) {
      console.error('Failed to load branch name:', err);
    }
  };

  // Fetch queue items
  const loadQueueItems = async (isInitial = false) => {
    if (!branchId) return;
    if (isInitial) setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_get_active_queue', {
        p_branch_id: branchId
      });

      if (error) throw error;
      const items = (data || []) as QueueItem[];
      setQueueItems(items);

      // Identify if any new number transitioned to 'serving'
      const currentServing = items
        .filter(i => i.queue_status === 'serving')
        .map(i => i.queue_number);

      const prevServing = previousServingRef.current;
      const newlyServing = currentServing.filter(num => !prevServing.includes(num));

      if (newlyServing.length > 0) {
        const latestNum = newlyServing[newlyServing.length - 1];
        setLastCalledNum(latestNum);
        
        // Only sound/speak if it's not the initial page load
        if (!isInitial) {
          playChime();
          // Delay announcement slightly for chime to finish
          setTimeout(() => {
            speakAnnouncement(latestNum);
          }, 600);
        }
      }

      previousServingRef.current = currentServing;
    } catch (err) {
      console.error('Failed to load active queue:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    loadBranchDetails();
    loadQueueItems(true);
  }, [branchId]);

  // Subscribe to real-time updates on sales
  useEffect(() => {
    if (!branchId) return;

    const channel = supabase.channel(`queue-tv-sync:${branchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales',
          filter: `branch_id=eq.${branchId}`
        },
        () => {
          loadQueueItems(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [branchId]);

  // Fallback poll every 10s
  useEffect(() => {
    const timer = setInterval(() => {
      loadQueueItems(false);
    }, 10000);
    return () => clearInterval(timer);
  }, [branchId]);

  // Clear flash highlight after 10 seconds
  useEffect(() => {
    if (lastCalledNum) {
      const timer = setTimeout(() => {
        setLastCalledNum(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [lastCalledNum]);

  if (!branchId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-8 text-center">
        <UtensilsCrossed className="w-16 h-16 text-indigo-500 mb-4 animate-bounce" />
        <h2 className="text-2xl font-black">TV Queue Board Error</h2>
        <p className="text-slate-400 mt-2 max-w-md text-sm">
          Missing branch identification query parameter in the URL.
          Please open this screen from the Queue Caller page inside the dashboard.
        </p>
      </div>
    );
  }

  const preparing = queueItems.filter(item => item.queue_status === 'preparing');
  const serving = queueItems.filter(item => item.queue_status === 'serving');

  return (
    <div className={`min-h-screen font-sans flex flex-col overflow-hidden select-none transition-colors duration-300 ${
      isDarkMode ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'
    }`}>
      
      {/* TV Top Header Bar */}
      <header className={`border-b px-8 py-5 flex items-center justify-between shadow-2xl shrink-0 transition-colors duration-300 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
      }`}>
        <div className="flex items-center gap-4">
          <div className="bg-indigo-600/10 p-1 rounded-2xl border border-indigo-500/20 w-16 h-16 flex items-center justify-center overflow-hidden bg-white shrink-0">
            <img src={logoUrl} alt="Logo" className="w-full h-full object-contain rounded-xl" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight uppercase">{appName}</h1>
            <p className={`text-xs font-bold tracking-wider uppercase ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
              {branchName} — Order Display Board
            </p>
          </div>
        </div>

        {/* Live Clock / Calendar & Mode Selector */}
        <div className="flex items-center gap-6">
          <div className={`flex items-center gap-2 p-1.5 rounded-xl border transition-colors duration-300 ${
            isDarkMode ? 'bg-slate-950 border-slate-850' : 'bg-slate-100 border-slate-200'
          }`}>
            {/* Fullscreen Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              className={`h-8 w-8 p-0 rounded-lg transition-colors ${
                isDarkMode ? 'text-slate-400 hover:text-slate-350' : 'text-slate-500 hover:text-slate-700'
              }`}
              title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>

            {/* Dark Mode Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`h-8 w-8 p-0 rounded-lg transition-colors ${
                isDarkMode ? 'text-yellow-450 hover:text-yellow-400' : 'text-indigo-600 hover:text-indigo-850'
              }`}
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Chime Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAudioChimeEnabled(!audioChimeEnabled)}
              className={`h-8 w-8 p-0 rounded-lg transition-colors ${
                audioChimeEnabled 
                  ? isDarkMode ? 'text-indigo-450 hover:text-indigo-400' : 'text-indigo-650 hover:text-indigo-800'
                  : 'text-slate-400'
              }`}
              title={audioChimeEnabled ? 'Chime ON' : 'Chime OFF'}
            >
              {audioChimeEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>

            {/* TTS Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTtsEnabled(!ttsEnabled);
                if (!ttsEnabled && window.speechSynthesis) {
                  const u = new SpeechSynthesisUtterance('Voice activated');
                  window.speechSynthesis.speak(u);
                }
              }}
              className={`h-8 px-2 text-[10px] font-bold rounded-lg transition-colors ${
                ttsEnabled 
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' 
                  : 'text-slate-405 hover:text-slate-500'
              }`}
            >
              VOICE
            </Button>
          </div>

          <div className="text-right">
            <div className={`text-2xl font-black tracking-widest font-mono ${isDarkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
            </div>
            <div className={`text-[10px] font-bold tracking-wider uppercase ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
              {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid View */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-500" />
          <p className="text-slate-450 font-bold uppercase tracking-wider text-sm">Syncing queue registry...</p>
        </div>
      ) : (
        <div className={`flex-1 grid grid-cols-2 divide-x-4 overflow-hidden ${
          isDarkMode ? 'divide-slate-900' : 'divide-slate-200'
        }`}>
          
          {/* NOW PREPARING COLUMN */}
          <div className={`flex flex-col h-full overflow-hidden p-8 transition-colors duration-300 ${
            isDarkMode ? 'bg-slate-950/40' : 'bg-slate-100/40'
          }`}>
            <div className={`flex items-center justify-between pb-6 border-b shrink-0 ${
              isDarkMode ? 'border-slate-900' : 'border-slate-200'
            }`}>
              <h2 className="text-3xl font-black tracking-tight text-amber-500 uppercase flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-amber-500 animate-ping inline-block shrink-0" />
                Preparing
              </h2>
              <span className={`text-sm font-bold uppercase font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-450'}`}>
                {preparing.length} Items
              </span>
            </div>

            <div className="flex-1 overflow-y-auto py-8">
              {preparing.length === 0 ? (
                <div className={`h-full flex items-center justify-center font-bold uppercase text-lg ${
                  isDarkMode ? 'text-slate-700' : 'text-slate-350'
                }`}>
                  Kitchen is clear
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-6">
                  {preparing.map(item => (
                    <div 
                      key={item.id} 
                      className={`border rounded-2xl p-6 text-center shadow-lg transition-transform duration-300 font-mono ${
                        isDarkMode ? 'bg-slate-900/60 border-slate-850' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className={`text-4xl font-black tracking-tight ${isDarkMode ? 'text-slate-300' : 'text-slate-755'}`}>
                        {item.queue_number}
                      </div>
                      <div className={`text-[10px] font-bold mt-1 font-sans ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>
                        IN PREPARATION
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* NOW SERVING COLUMN */}
          <div className="flex flex-col h-full overflow-hidden p-8">
            <div className={`flex items-center justify-between pb-6 border-b shrink-0 ${
              isDarkMode ? 'border-slate-900' : 'border-slate-200'
            }`}>
              <h2 className="text-3xl font-black tracking-tight text-emerald-500 uppercase flex items-center gap-3">
                <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 animate-pulse inline-block shrink-0" />
                Now Serving
              </h2>
              <span className={`text-sm font-bold uppercase font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-450'}`}>
                {serving.length} Ready
              </span>
            </div>

            <div className="flex-1 overflow-y-auto py-8">
              {serving.length === 0 ? (
                <div className={`h-full flex items-center justify-center font-bold uppercase text-lg ${
                  isDarkMode ? 'text-slate-700' : 'text-slate-350'
                }`}>
                  Waiting for orders
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-8">
                  {serving.map(item => {
                    const isNewestCall = item.queue_number === lastCalledNum;
                    return (
                      <div 
                        key={item.id} 
                        className={`rounded-3xl p-8 text-center border font-mono shadow-2xl transition-all duration-500 ${
                          isNewestCall 
                            ? 'bg-emerald-600 border-emerald-400 text-white animate-pulse scale-105 shadow-emerald-900/30' 
                            : isDarkMode
                              ? 'bg-slate-900 border-slate-800 text-emerald-400'
                              : 'bg-white border-slate-200 text-emerald-600'
                        }`}
                      >
                        <div className={`text-6xl font-black tracking-tight ${
                          isNewestCall ? 'text-white' : isDarkMode ? 'text-emerald-400' : 'text-emerald-600'
                        }`}>
                          {item.queue_number}
                        </div>
                        <div className={`text-[11px] font-black tracking-widest mt-2 font-sans ${
                          isNewestCall ? 'text-emerald-250' : isDarkMode ? 'text-slate-500' : 'text-slate-400'
                        }`}>
                          PROCEED TO COUNTER
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* TV Screen Footer Disclaimer */}
      <footer className={`border-t px-8 py-3 text-center text-[10px] font-bold tracking-wider uppercase shrink-0 transition-colors duration-300 ${
        isDarkMode ? 'bg-slate-950 border-slate-900 text-slate-600' : 'bg-slate-100 border-slate-250 text-slate-400'
      }`}>
        Please verify order receipt number with store personnel before claiming food.
      </footer>

    </div>
  );
};
