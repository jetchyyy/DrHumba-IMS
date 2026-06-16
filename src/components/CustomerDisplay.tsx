import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { settingsService, DEFAULT_PROMOTIONS } from '../lib/settingsService';
import type { CustomerPromotion } from '../lib/settingsService';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CartItem {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
}

interface Branch {
  id: string;
  name: string;
  is_warehouse: boolean;
  location: string | null;
}

interface POSState {
  cart: CartItem[];
  cartTotal: number;
  cartCount: number;
  paymentOpen: boolean;
  checkingOut: boolean;
  lastSaleResult: {
    id: string;
    change: number;
    method: string;
    sale_category?: string;
    reference_number?: string;
  } | null;
  selectedBranch: Branch | null;
  paymentMethod: string | null;
  tendered: number;
  refNumber: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatPHP = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(n);

export const CustomerDisplay: React.FC = () => {
  const [state, setState] = useState<POSState>({
    cart: [],
    cartTotal: 0,
    cartCount: 0,
    paymentOpen: false,
    checkingOut: false,
    lastSaleResult: null,
    selectedBranch: null,
    paymentMethod: null,
    tendered: 0,
    refNumber: '',
  });

  const [promotions, setPromotions] = useState<CustomerPromotion[]>([...DEFAULT_PROMOTIONS]);
  const [promoIndex, setPromoIndex] = useState(0);

  // Parse cashier/branch context from URL to bind supabase realtime channel
  const params = new URLSearchParams(window.location.search);
  const branchId = params.get('branchId') || state.selectedBranch?.id;
  const cashierId = params.get('cashierId');

  // Load promotions dynamically from settingsService on mount
  const loadPromotions = async () => {
    try {
      const settings = await settingsService.getSettings();
      if (settings.customer_promotions && settings.customer_promotions.length > 0) {
        setPromotions(settings.customer_promotions);
      }
    } catch (err) {
      console.error('Failed to load promotions for customer screen:', err);
    }
  };

  useEffect(() => {
    loadPromotions();
  }, []);

  // Rotate promotions every 8 seconds
  useEffect(() => {
    if (promotions.length <= 1) return;
    const timer = setInterval(() => {
      setPromoIndex((prev) => (prev + 1) % promotions.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [promotions.length]);

  // Sync state handler
  const handleStateUpdate = (payload: any) => {
    if (payload) {
      setState((prev) => {
        // If transitioning from active sale to completed, set completion view
        const nextState = { ...prev, ...payload };
        
        // If a transaction was just completed, start a timeout to reset to idle
        if (payload.lastSaleResult && !prev.lastSaleResult) {
          setTimeout(() => {
            setState((current) => ({
              ...current,
              cart: [],
              cartTotal: 0,
              cartCount: 0,
              paymentOpen: false,
              checkingOut: false,
              lastSaleResult: null,
              paymentMethod: null,
              tendered: 0,
              refNumber: '',
            }));
          }, 8000); // Back to idle after 8 seconds
        }
        return nextState;
      });
    }
  };

  // 1. Setup Local BroadcastChannel Sync
  useEffect(() => {
    try {
      const bc = new BroadcastChannel('drhumba-pos-customer-sync');
      bc.onmessage = (event) => {
        handleStateUpdate(event.data);
      };
      return () => {
        bc.close();
      };
    } catch (e) {
      console.warn('Local BroadcastChannel not supported:', e);
    }
  }, []);

  // 2. Setup Supabase Realtime Remote Sync Channel
  useEffect(() => {
    if (!branchId || !cashierId) return;

    const channelName = `pos-sync:${branchId}:${cashierId}`;
    const channel = supabase.channel(channelName);

    channel
      .on('broadcast', { event: 'pos-state-update' }, ({ payload }) => {
        handleStateUpdate(payload);
      })
      .subscribe((status) => {
        console.log(`Customer Display subscribed to ${channelName} - Status:`, status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [branchId, cashierId]);

  // Derived display views
  const isIdle = state.cart.length === 0 && !state.lastSaleResult;
  const isShopping = state.cart.length > 0 && !state.paymentOpen && !state.lastSaleResult;
  const isCheckout = state.cart.length > 0 && state.paymentOpen && !state.lastSaleResult;
  const isSuccess = !!state.lastSaleResult;

  const currentPromo = promotions[promoIndex];

  // Render GCash/Maya QR code if applicable
  const renderPaymentQR = () => {
    const isDigital = state.paymentMethod === 'gcash' || state.paymentMethod === 'maya';
    if (!isDigital) return null;

    const qrData = `PAYMENT:${(state.paymentMethod || '').toUpperCase()}:AMOUNT:${state.cartTotal}:BRANCH:${state.selectedBranch?.name || 'DrHumba'}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}&color=0-0-0&bgcolor=255-255-255`;

    return (
      <div className="flex flex-col items-center bg-white p-4 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.3)] border border-zinc-200 animate-fade-in">
        <img src={qrUrl} alt="Payment QR Code" className="w-48 h-48 md:w-56 md:h-56" />
        <span className="text-zinc-900 text-xs font-bold mt-3 uppercase tracking-widest flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          Scan to Pay ₱{state.cartTotal.toFixed(2)}
        </span>
      </div>
    );
  };

  return (
    <div className="bg-white text-zinc-800 min-h-screen w-full flex flex-col font-sans select-none overflow-hidden relative">
      {/* Dynamic Background Glows */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-pink-500/5 rounded-full blur-[140px] pointer-events-none animate-pulse duration-10000"></div>
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-primary/5 rounded-full blur-[140px] pointer-events-none animate-pulse duration-7000"></div>

      {/* Top Bar */}
      <header className="px-6 py-5 border-b border-zinc-100 flex justify-between items-center bg-white/85 backdrop-blur-md relative z-10 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-white overflow-hidden shadow-md border border-zinc-100 flex-shrink-0 flex items-center justify-center">
            <img src="/drhumbalogo.jpg" alt="Dr. Humba Logo" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-wider text-zinc-800 uppercase">Dr. Humba</h1>
            <p className="text-[10px] font-bold text-pink-600 uppercase tracking-widest">Customer Terminal</p>
          </div>
        </div>

        {/* Branch Context Indicator */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
            <span className="text-xs font-semibold text-zinc-500">
              Branch: <span className="text-zinc-800 font-bold ml-0.5">{state.selectedBranch?.name || "Dr. Humba Branch"}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Main Screen Content */}
      <main className="flex-1 flex overflow-hidden relative z-10">
        
        {/* VIEW: Idle / Welcome State */}
        {isIdle && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-fade-in">
            <div className="max-w-2xl space-y-8">
              {/* Spinning Logo Icon container */}
              <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-pink-500 to-rose-600 p-1.5 shadow-[0_10px_30px_rgba(236,72,153,0.15)] mx-auto animate-bounce duration-3000">
                <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden">
                  <img src="/drhumbalogo.jpg" alt="Dr. Humba Logo" className="w-24 h-24 object-cover rounded-full" />
                </div>
              </div>

              <div className="space-y-4">
                <h2 className="text-5xl font-black tracking-tight leading-tight text-zinc-800">
                  Welcome to <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-rose-500 to-amber-500">Dr. Humba!</span>
                </h2>
                <p className="text-zinc-500 text-lg md:text-xl font-medium max-w-lg mx-auto leading-relaxed">
                  Please place your order at the counter. The cashier will assist you with menu selections and payments.
                </p>
              </div>

              {/* Dynamic rotating promo card inside idle screen */}
              <div className="bg-zinc-50 border border-zinc-150 rounded-3xl p-6 text-left shadow-lg relative overflow-hidden group max-w-xl mx-auto">
                <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${currentPromo.color} opacity-5 blur-xl`}></div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold bg-pink-500/10 text-pink-600 border border-pink-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider">
                    {currentPromo.image}
                  </span>
                  <span className="text-[10px] text-zinc-400">Dr. Humba Perks</span>
                </div>
                <h4 className="text-lg font-bold text-zinc-800 mb-1.5">{currentPromo.title}</h4>
                <p className="text-sm text-zinc-500 leading-relaxed">{currentPromo.desc}</p>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: Shopping State (Split Screen) */}
        {isShopping && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden animate-fade-in">
            {/* Left Column: Promotion & Branding */}
            <div className="flex-1 flex flex-col justify-center p-8 lg:p-16 border-r border-zinc-100 relative">
              <div className="space-y-8 max-w-md">
                <div>
                  <span className="text-[11px] font-black text-pink-600 uppercase tracking-widest bg-pink-500/10 px-3.5 py-1.5 rounded-full border border-pink-500/25">
                    Order In Progress
                  </span>
                  <h2 className="text-4xl font-extrabold tracking-tight mt-5 text-zinc-800">
                    Reviewing Your Items
                  </h2>
                  <p className="text-zinc-500 text-sm mt-3 leading-relaxed">
                    Check your items on the screen. Let the cashier know if you want to make any changes or add special instructions.
                  </p>
                </div>

                {/* Promotions Slide */}
                <div className="bg-zinc-50 border border-zinc-150 rounded-3xl p-6 relative overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 text-[10px] text-amber-600 font-bold uppercase tracking-widest mb-3">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                    </svg>
                    Special Offer
                  </div>
                  <h4 className="text-md font-bold text-zinc-800">{currentPromo.title}</h4>
                  <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{currentPromo.desc}</p>
                </div>
              </div>
            </div>

            {/* Right Column: Cart items */}
            <div className="w-full lg:w-[480px] bg-zinc-50/25 flex flex-col overflow-hidden h-full">
              {/* Cart Header */}
              <div className="p-6 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Dish Name</span>
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Subtotal</span>
              </div>

              {/* Cart items list */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {state.cart.map((item) => (
                  <div key={item.menu_item_id} className="flex justify-between items-start gap-4 animate-slide-in py-1 border-b border-zinc-100 pb-3">
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-zinc-800">{item.name}</h4>
                      <p className="text-xs text-zinc-500 font-medium">
                        {formatPHP(item.price)} × {item.quantity}
                      </p>
                    </div>
                    <span className="text-sm font-extrabold text-zinc-800">
                      {formatPHP(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total summary footer */}
              <div className="p-6 border-t border-zinc-100 bg-zinc-50/50 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Items</span>
                  <span className="text-sm font-extrabold text-zinc-800">{state.cartCount}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-zinc-100">
                  <span className="text-md font-bold text-zinc-700 uppercase tracking-wider">Grand Total</span>
                  <span className="text-2xl font-black text-pink-600">{formatPHP(state.cartTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: Checkout State */}
        {isCheckout && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden animate-fade-in">
            {/* Left Column: QR Code / Payment Instructions */}
            <div className="flex-1 flex flex-col justify-center items-center p-8 lg:p-16 border-r border-zinc-100 text-center space-y-6">
              <div className="space-y-3 max-w-md">
                <span className="text-[11px] font-black text-amber-600 uppercase tracking-widest bg-amber-500/10 px-3.5 py-1.5 rounded-full border border-amber-500/25">
                  Awaiting Payment
                </span>
                <h2 className="text-4xl font-extrabold tracking-tight mt-5 text-zinc-800">
                  Complete Payment
                </h2>
                <p className="text-zinc-500 text-sm max-w-sm mx-auto leading-relaxed">
                  {state.paymentMethod === 'cash' && "Please hand your cash payment to the cashier."}
                  {state.paymentMethod === 'card' && "Please swipe, tap, or insert your credit/debit card."}
                  {(state.paymentMethod === 'gcash' || state.paymentMethod === 'maya') && "Scan the QR code with your mobile app to complete transaction."}
                  {(!state.paymentMethod || state.paymentMethod === 'other') && "Awaiting cashier to select your payment option."}
                </p>
              </div>

              {/* QR Code Container */}
              {renderPaymentQR()}

              {/* Simple illustrative card for Cash / Cards */}
              {(state.paymentMethod === 'cash' || state.paymentMethod === 'card' || state.paymentMethod === 'other' || !state.paymentMethod) && (
                <div className="w-64 h-40 bg-zinc-50 border border-zinc-150 rounded-3xl flex flex-col justify-center items-center shadow-md relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-tr from-pink-500/5 to-amber-500/5 opacity-100"></div>
                  {state.paymentMethod === 'cash' && (
                    <>
                      <svg className="w-12 h-12 text-emerald-600 mb-2 animate-bounce" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span className="text-sm font-bold text-zinc-700">Hand Cash to Cashier</span>
                    </>
                  )}
                  {state.paymentMethod === 'card' && (
                    <>
                      <svg className="w-12 h-12 text-blue-600 mb-2 animate-pulse" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      <span className="text-sm font-bold text-zinc-700">Insert / Tap Terminal</span>
                    </>
                  )}
                  {(!state.paymentMethod || state.paymentMethod === 'other') && (
                    <>
                      <svg className="w-12 h-12 text-zinc-400 mb-2 animate-pulse" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm font-bold text-zinc-500">Processing...</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right Column: Checkout Breakdown */}
            <div className="w-full lg:w-[480px] bg-zinc-50/20 flex flex-col overflow-hidden h-full">
              <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Order Items</h3>
              </div>

              {/* Items List */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {state.cart.map((item) => (
                  <div key={item.menu_item_id} className="flex justify-between text-xs py-1 border-b border-zinc-100 pb-2">
                    <span className="text-zinc-700 font-semibold">{item.name} × {item.quantity}</span>
                    <span className="text-zinc-500 font-bold">{formatPHP(item.price * item.quantity)}</span>
                  </div>
                ))}
              </div>

              {/* Pricing Breakdown */}
              <div className="p-6 border-t border-zinc-100 bg-zinc-50/50 space-y-3">
                <div className="flex justify-between items-center text-sm font-bold">
                  <span className="text-zinc-500">Total Bill</span>
                  <span className="text-zinc-800">{formatPHP(state.cartTotal)}</span>
                </div>
                {state.paymentMethod === 'cash' && state.tendered > 0 && (
                  <>
                    <div className="flex justify-between items-center text-sm font-bold">
                      <span className="text-zinc-500">Amount Tendered</span>
                      <span className="text-zinc-800">{formatPHP(state.tendered)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t border-zinc-100 text-lg font-black">
                      <span className="text-emerald-600">Change Due</span>
                      <span className="text-emerald-600">{formatPHP(state.tendered - state.cartTotal)}</span>
                    </div>
                  </>
                )}
                {state.paymentMethod && state.paymentMethod !== 'cash' && (
                  <div className="flex justify-between items-center pt-3 border-t border-zinc-100 text-sm font-bold">
                    <span className="text-zinc-500">Method</span>
                    <span className="text-zinc-700 uppercase tracking-wide bg-zinc-100 px-3 py-1 rounded-full border border-zinc-200">
                      {state.paymentMethod}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW: Success / Thank You State */}
        {isSuccess && (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-fade-in bg-white relative z-20">
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none"></div>
            
            <div className="max-w-md space-y-6">
              {/* Success Badge */}
              <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto text-emerald-600 shadow-[0_10px_30px_rgba(16,185,129,0.1)] animate-[bounce_1s_infinite]">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="space-y-2">
                <h2 className="text-4xl font-black tracking-tight text-zinc-800">Sale Completed!</h2>
                <p className="text-zinc-500 text-sm max-w-xs mx-auto">
                  Thank you for ordering at Dr. Humba. Your transaction has been recorded.
                </p>
              </div>

              {/* Transaction details card */}
              <div className="bg-zinc-50 border border-zinc-150 rounded-3xl p-5 text-left space-y-3.5 shadow-sm">
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Reference ID</span>
                  <span className="font-mono text-zinc-700 font-semibold">{state.lastSaleResult?.id.slice(0, 10).toUpperCase()}...</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Payment Method</span>
                  <span className="text-zinc-700 font-bold capitalize">{state.lastSaleResult?.method}</span>
                </div>
                
                {state.lastSaleResult?.method === 'cash' && state.lastSaleResult?.change > 0 ? (
                  <>
                    <div className="border-t border-zinc-100 my-2 pt-2.5 flex justify-between items-center">
                      <span className="text-xs text-zinc-500 font-semibold uppercase">Change Returned</span>
                      <span className="text-xl font-black text-emerald-600">
                        {formatPHP(state.lastSaleResult.change)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="border-t border-zinc-100 my-2 pt-2.5 flex justify-between items-center">
                    <span className="text-xs text-zinc-500 font-semibold uppercase">Total Paid</span>
                    <span className="text-lg font-extrabold text-zinc-700">
                      {formatPHP(state.cartTotal)}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[10px] text-zinc-400 font-medium animate-pulse">
                Terminal screen will return to standby mode shortly...
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer / Copyright */}
      <footer className="px-6 py-4 border-t border-zinc-100 text-center bg-white shrink-0 relative z-10">
        <p className="text-[10px] font-semibold text-zinc-400 tracking-wider">
          © {new Date().getFullYear()} DR. HUMBA SYSTEM. ALL RIGHTS RESERVED.
        </p>
      </footer>
    </div>
  );
};
