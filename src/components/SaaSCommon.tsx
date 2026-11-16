import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { ExclamationTriangleIcon as ShieldAlert } from '@radix-ui/react-icons';
import { OdysseyHeader, OdysseyFooter } from './odyssey/OdysseyChrome';
import { ReceiptText, ArrowRightLeft, ChartColumn, Users, Check, ShieldCheck, WifiOff, Store, ArrowRight } from 'lucide-react';

// 1. Tenant Suspended Screen
export const TenantSuspendedPage: React.FC<{ tenantName: string }> = ({ tenantName }) => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center border-destructive/50 shadow-2xl shadow-destructive/10">
        <CardContent className="pt-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/20 mx-auto text-destructive">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-wide">{tenantName} Suspended</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              This organization's portal has been temporarily suspended by the platform administrator. 
              Please contact the billing representative or billing@odcph.com.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// 2. Tenant Not Found Screen
export const TenantNotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center bg-slate-900/90 border-slate-700 shadow-2xl shadow-black/50 backdrop-blur-md">
        <CardContent className="pt-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20 mx-auto text-amber-500">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-wide text-white">Workspace Not Found</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              The subdomain you entered does not match any registered workspace. 
              Please verify the address or register a new store portal.
            </p>
          </div>
          <Button 
            className="w-full bg-primary hover:bg-primary/95 text-primary-foreground font-bold" 
            onClick={() => {
              // Redirect to main domain /apply page
              const mainDomain = import.meta.env.VITE_MAIN_DOMAIN || 'localhost:5173';
              window.location.href = `http://${mainDomain}/apply`;
            }}
          >
            Create Your Workspace
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

// 3. Unauthorized Tenant Access Screen
export const UnauthorizedTenantPage: React.FC<{ tenantName: string; signOut: () => void }> = ({ tenantName, signOut }) => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center border-destructive/50 shadow-2xl shadow-destructive/10">
        <CardContent className="pt-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/20 mx-auto text-destructive">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-wide">Access Denied</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Your account does not have permission to access the workspace for <strong>{tenantName}</strong>. 
              Each tenant workspace requires dedicated credentials.
            </p>
          </div>
          <Button variant="outline" onClick={signOut} className="w-full font-bold">
            Sign Out & Return
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

// 3b. Platform admin whose active tenant differs from this portal's tenant.
// Data access follows profiles.tenant_id, so the admin must switch before entering.
export const PlatformAdminTenantMismatchPage: React.FC<{
  profileId: string;
  tenantId: string;
  tenantName: string;
  signOut: () => void;
}> = ({ profileId, tenantId, tenantName, signOut }) => {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = async () => {
    setSwitching(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ tenant_id: tenantId })
      .eq('id', profileId);
    if (updateError) {
      setError(updateError.message);
      setSwitching(false);
      return;
    }
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center border-amber-500/50 shadow-2xl shadow-amber-500/10">
        <CardContent className="pt-8 space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20 mx-auto text-amber-500">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-wide">Different Workspace Active</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Your platform admin account is currently working in another tenant. Switch to
              {' '}<strong>{tenantName}</strong> to view this workspace's data.
            </p>
            {error && <p className="text-xs text-destructive mt-2">{error}</p>}
          </div>
          <div className="space-y-2">
            <Button onClick={handleSwitch} disabled={switching} className="w-full font-bold">
              {switching ? 'Switching...' : `Switch to ${tenantName}`}
            </Button>
            <Button variant="outline" onClick={signOut} disabled={switching} className="w-full font-bold">
              Sign Out & Return
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// 4. Gorgeous Premium SaaS Landing Page
export const SaaSLandingPage: React.FC = () => {
  const [dbPlans, setDbPlans] = useState<any[]>([]);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const { data, error } = await supabase
          .from('subscription_plans')
          .select('*')
          .order('monthly_price');
        if (!error && data) {
          setDbPlans(data);
        }
      } catch (err) {
        console.error('Error loading plans for landing page:', err);
      }
    };
    fetchPlans();
  }, []);

  const displayPlans = dbPlans.length > 0 ? dbPlans.map(p => {
    let featuresList: string[] = [];
    if (p.id === 'free') {
      featuresList = [
        '1 Branch Location',
        'Up to 2 Staff Accounts',
        'Online Checkout Only',
        'Basic Inventory (30 Items Max)',
        '30-Day Data Retention'
      ];
    } else if (p.id === 'starter') {
      featuresList = [
        '1 Branch Location',
        `Up to ${p.max_users} Staff Accounts`,
        'Offline Store-and-Forward Sales',
        'Device Terminal Binding',
        'Direct Stock Receiving',
        '10-Year Data Retention (BIR Compliant)'
      ];
    } else if (p.id === 'professional') {
      featuresList = [
        `Up to ${p.max_branches} Branch Locations`,
        `Up to ${p.max_users} Staff Accounts`,
        'Offline Sales & Device Binding',
        'Compliance Audit Logs (Immutable)',
        'Consecutive Invoice Series',
        'Shift Control (X & Z-Read Reports)',
        'Menu Recipes & Deductions'
      ];
    } else {
      featuresList = [
        `Up to ${p.max_branches} Branch Locations`,
        `Up to ${p.max_users} Staff Accounts`,
        'Everything in Professional Plan',
        'Custom Roles & Permission Tabs',
        'Advanced Sales Analytics Dashboard',
        'Priority Technical Integration Support'
      ];
    }
    return {
      name: p.name,
      price: p.monthly_price === 0 || p.monthly_price === '0' ? 'Free' : `₱${Number(p.monthly_price).toLocaleString()}`,
      features: featuresList,
      popular: p.id === 'professional',
    };
  }) : [
    {
      name: 'Free Trial',
      price: 'Free',
      features: ['1 Branch Location', 'Up to 2 Staff Accounts', 'Online Checkout Only', 'Basic Inventory (30 Items Max)', '30-Day Data Retention'],
      popular: false,
    },
    {
      name: 'Starter',
      price: '₱999',
      features: ['1 Branch Location', 'Up to 3 Staff Accounts', 'Offline Store-and-Forward Sales', 'Device Terminal Binding', 'Direct Stock Receiving', '10-Year Data Retention (BIR Compliant)'],
      popular: false,
    },
    {
      name: 'Professional',
      price: '₱2,499',
      features: ['Up to 3 Branch Locations', 'Up to 10 Staff Accounts', 'Offline Sales & Device Binding', 'Compliance Audit Logs (Immutable)', 'Consecutive Invoice Series', 'Shift Control (X & Z-Read Reports)', 'Menu Recipes & Deductions'],
      popular: true,
    },
    {
      name: 'Enterprise',
      price: '₱7,499',
      features: ['Up to 10 Branch Locations', 'Up to 30 Staff Accounts', 'Everything in Professional Plan', 'Custom Roles & Permission Tabs', 'Advanced Sales Analytics Dashboard', 'Priority Technical Integration Support'],
      popular: false,
    },
  ];

  const coreFeatures = [
    { title: 'Sales and checkout', desc: 'A cashier screen that keeps recording sales when the internet drops, and deducts ingredients by recipe.', icon: ReceiptText },
    { title: 'Inventory and transfers', desc: 'Receive stock, move it between branches, and see every adjustment with who made it.', icon: ArrowRightLeft },
    { title: 'Reports you can act on', desc: 'Sales by shift, top items and stock value, ready for the end-of-day count.', icon: ChartColumn },
    { title: 'Staff and permissions', desc: 'Give each role only the screens it needs. Every change is logged.', icon: Users },
  ];

  const steps = [
    { n: '1', title: 'Apply', desc: 'Tell us about your business and pick a plan.' },
    { n: '2', title: 'Set up', desc: 'Add branches, menu items and staff accounts.' },
    { n: '3', title: 'Start selling', desc: 'Record your first sale and track stock from day one.' },
  ];

  const goApply = () => { window.location.pathname = '/apply'; };
  const goPricing = () => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="font-odyssey min-h-screen bg-[#F9F8F3] text-[#152839] antialiased selection:bg-[#FF6F07]/25">
      <OdysseyHeader>
        <nav className="hidden md:flex items-center gap-8 text-[15px] font-medium text-[#45546A]">
          <a href="#features" className="hover:text-[#152839] transition-colors">Features</a>
          <a href="#how" className="hover:text-[#152839] transition-colors">How it works</a>
          <a href="#pricing" className="hover:text-[#152839] transition-colors">Pricing</a>
        </nav>
        <button
          onClick={goApply}
          className="h-10 px-4 sm:px-5 rounded-lg bg-[#152839] text-[#F9F8F3] text-[15px] font-semibold hover:bg-[#1f3a52] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F3]"
        >
          Start free trial
        </button>
      </OdysseyHeader>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-16 md:pt-20 md:pb-24 grid md:grid-cols-12 gap-10 items-center">
        <div className="md:col-span-7 space-y-6">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#B8470A]">Inventory Management System by ODYSSEY</p>
          <h1 className="font-odyssey-display font-bold text-[36px] leading-[44px] sm:text-[44px] sm:leading-[52px] tracking-[-0.01em] max-w-xl">
            One system for every branch you run.
          </h1>
          <p className="text-[18px] leading-[29px] text-[#45546A] max-w-xl">
            Sell, count stock and close the day in one place. Built for restaurants and retail stores
            in the Philippines, with BIR-ready receipts and reports.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={goApply}
              className="h-12 px-6 rounded-lg bg-[#152839] text-[#F9F8F3] font-semibold text-[15px] inline-flex items-center justify-center gap-2 hover:bg-[#1f3a52] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F3]"
            >
              Start free trial <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={goPricing}
              className="h-12 px-6 rounded-lg border-2 border-[#152839] text-[#152839] font-semibold text-[15px] hover:bg-[#152839]/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-2"
            >
              See pricing
            </button>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-2 text-sm text-[#5F6A7C]">
            <li className="inline-flex items-center gap-2"><WifiOff className="w-4 h-4 text-[#152839]" /> Works offline</li>
            <li className="inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#152839]" /> Audit trail on every change</li>
            <li className="inline-flex items-center gap-2"><Store className="w-4 h-4 text-[#152839]" /> Up to 10 branches</li>
          </ul>
        </div>

        {/* Ody + illustrative interface in a counter frame */}
        <div className="md:col-span-5 flex justify-center md:justify-end">
          <div className="flex items-end">
            <img
              src="/odyssey/ody-systems-happy.webp"
              alt="Ody, the ODYSSEY guide"
              className="relative z-10 w-24 sm:w-32 h-auto -mr-4 sm:-mr-6 mb-[-12px] select-none pointer-events-none shrink-0"
              draggable={false}
            />
            <div className="w-[260px] sm:w-[320px] rounded-[28px] bg-[#152839] p-[10px] shadow-[0_24px_60px_-28px_rgba(21,40,57,0.55)]">
              <div className="rounded-[20px] border-[3px] border-[#FF6F07] bg-white p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#5F6A7C]">Today · Main branch</p>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="rounded-xl bg-[#ECE7DE] p-3"><p className="font-odyssey-display font-bold text-xl">86</p><p className="text-xs text-[#45546A]">Orders</p></div>
                  <div className="rounded-xl bg-[#ECE7DE] p-3"><p className="font-odyssey-display font-bold text-xl">₱42k</p><p className="text-xs text-[#45546A]">Sales</p></div>
                  <div className="rounded-xl bg-[#152839] text-[#F9F8F3] p-3"><p className="font-odyssey-display font-bold text-xl text-[#FF6F07]">3</p><p className="text-xs">Low stock</p></div>
                </div>
                <div className="flex items-end gap-1.5 h-20 mt-4" aria-hidden="true">
                  {[38, 52, 44, 68, 58, 86, 62].map((h, i) => (
                    <div key={i} className={`flex-1 rounded-t-md ${i === 5 ? 'bg-[#FF6F07]' : 'bg-[#152839]'}`} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <p className="text-[11px] text-[#5F6A7C] mt-3">Illustrative interface, sample data</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-white border-y border-[#DCE1E8]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 md:py-20">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#B8470A]">What you get</p>
            <h2 className="font-odyssey-display font-medium text-[26px] leading-[34px] mt-2">Everything the shop floor and the back office share.</h2>
            <p className="text-[16px] leading-[26px] text-[#45546A] mt-3">Turn modules on as you need them. Your data stays in one place as you add branches.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {coreFeatures.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="rounded-2xl border border-[#DCE1E8] bg-[#F9F8F3] p-6">
                  <div className="w-11 h-11 rounded-xl bg-white border border-[#DCE1E8] flex items-center justify-center">
                    <Icon className="w-6 h-6 text-[#152839]" strokeWidth={2} />
                  </div>
                  <h3 className="font-odyssey-display font-medium text-[20px] leading-[28px] mt-4">{f.title}</h3>
                  <p className="text-sm leading-[22px] text-[#45546A] mt-2">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works: linked steps, last step in orange */}
      <section id="how" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 md:py-20">
        <div className="max-w-2xl mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#B8470A]">How it works</p>
          <h2 className="font-odyssey-display font-medium text-[26px] leading-[34px] mt-2">Up and running in three steps.</h2>
        </div>
        <ol className="grid md:grid-cols-3 gap-4 md:gap-0">
          {steps.map((st, i) => {
            const last = i === steps.length - 1;
            return (
              <li
                key={st.n}
                className={`p-6 border-[3px] border-[#152839] rounded-2xl md:rounded-none ${i === 0 ? 'md:rounded-l-2xl' : ''} ${last ? 'md:rounded-r-2xl bg-[#FF6F07]' : 'bg-white'} ${i > 0 ? 'md:-ml-[3px]' : ''}`}
              >
                <span className="font-odyssey-display font-bold text-sm text-[#152839]">Step {st.n}</span>
                <h3 className="font-odyssey-display font-medium text-[20px] leading-[28px] mt-1">{st.title}</h3>
                <p className={`text-sm leading-[22px] mt-1 ${last ? 'text-[#152839]' : 'text-[#45546A]'}`}>{st.desc}</p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-[#ECE7DE]/60 border-t border-[#DCE1E8]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 md:py-20">
          <div className="max-w-2xl mb-12">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#B8470A]">Pricing</p>
            <h2 className="font-odyssey-display font-medium text-[26px] leading-[34px] mt-2">Plans that grow with your branches.</h2>
            <p className="text-[16px] leading-[26px] text-[#45546A] mt-3">Monthly pricing in pesos. Change plans when your needs change.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {displayPlans.map((p) => (
              <div
                key={p.name}
                className={`rounded-2xl p-6 flex flex-col ${p.popular ? 'bg-[#152839] text-[#F9F8F3] ring-[3px] ring-[#FF6F07]' : 'bg-white border border-[#DCE1E8]'}`}
              >
                <div className="min-h-[22px]">
                  {p.popular && (
                    <span className="inline-block text-[11px] font-semibold rounded-full bg-[#FF6F07] text-[#152839] px-2.5 py-0.5">Most popular</span>
                  )}
                </div>
                <p className={`text-xs font-semibold uppercase tracking-[0.12em] mt-2 ${p.popular ? 'text-[#F9F8F3]' : 'text-[#45546A]'}`}>{p.name}</p>
                <div className="flex items-baseline gap-1 mt-3">
                  <span className="font-odyssey-display font-bold text-[34px] leading-[42px]">{p.price}</span>
                  {p.price !== 'Free' && <span className={`text-sm ${p.popular ? 'text-[#DCE1E8]' : 'text-[#5F6A7C]'}`}>/month</span>}
                </div>
                <ul className="space-y-2.5 mt-5 flex-1">
                  {p.features.map((feat) => (
                    <li key={feat} className={`flex items-start gap-2 text-sm leading-[22px] ${p.popular ? 'text-[#F9F8F3]' : 'text-[#45546A]'}`}>
                      <Check className={`w-4 h-4 mt-[3px] shrink-0 ${p.popular ? 'text-[#FF6F07]' : 'text-[#152839]'}`} strokeWidth={2.5} />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={goApply}
                  className={`mt-6 h-11 rounded-lg font-semibold text-[15px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-2 ${
                    p.popular
                      ? 'bg-[#FF6F07] text-[#152839] hover:bg-[#ff8530] focus-visible:ring-offset-[#152839]'
                      : 'bg-[#152839] text-[#F9F8F3] hover:bg-[#1f3a52]'
                  }`}
                >
                  Choose {p.name}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <OdysseyFooter
        cta={
          <button
            onClick={goApply}
            className="h-11 px-5 rounded-lg bg-[#FF6F07] text-[#152839] font-semibold text-[15px] hover:bg-[#ff8530] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F9F8F3] focus-visible:ring-offset-2 focus-visible:ring-offset-[#152839]"
          >
            Start free trial
          </button>
        }
      />
    </div>
  );
};
