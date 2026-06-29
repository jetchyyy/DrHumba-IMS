import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { ExclamationTriangleIcon as ShieldAlert, CubeIcon as Package, ShadowOuterIcon as Layers, BarChartIcon as BarChart3, GroupIcon as Users } from '@radix-ui/react-icons';

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
            className="w-full bg-primary hover:bg-primary/95 text-white font-bold" 
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
    if (p.id === 'starter') {
      featuresList = [
        `${p.max_branches} Branch Location`,
        `Up to ${p.max_users} Staff Accounts`,
        'Real-time Sales & POS',
        'Basic Inventory Sync',
        'Direct Stock Receiving'
      ];
    } else if (p.id === 'professional') {
      featuresList = [
        `Up to ${p.max_branches} Branch Locations`,
        `Up to ${p.max_users} Staff Accounts`,
        'Advanced Stock Transfers',
        'Direct Stock Adjustments',
        'Menu Recipes & Deductions',
        'Analytics Dashboard',
        'Audit Logs Access'
      ];
    } else {
      featuresList = [
        `Up to ${p.max_branches} Branch Locations`,
        `Up to ${p.max_users} Staff Accounts`,
        'Unlimited Stock Ledgers',
        'Formula Ingredient Recipes',
        'Custom Allowed Tabs Per User',
        'Advanced Sales Analytics',
        'Dedicated Support channel'
      ];
    }
    return {
      name: p.name,
      price: `₱${Number(p.monthly_price).toLocaleString()}`,
      features: featuresList,
      popular: p.id === 'professional',
    };
  }) : [
    {
      name: 'Starter',
      price: '₱999',
      features: ['1 Branch Location', 'Up to 3 Staff Accounts', 'Real-time Sales & POS', 'Basic Inventory Sync', 'Direct Stock Receiving'],
      popular: false,
    },
    {
      name: 'Professional',
      price: '₱2,499',
      features: ['Up to 3 Branch Locations', 'Up to 10 Staff Accounts', 'Advanced Stock Transfers', 'Direct Stock Adjustments', 'Menu Recipes & Deductions', 'Analytics Dashboard', 'Audit Logs Access'],
      popular: true,
    },
    {
      name: 'Enterprise',
      price: '₱7,499',
      features: ['Up to 10 Branch Locations', 'Up to 30 Staff Accounts', 'Unlimited Stock Ledgers', 'Formula Ingredient Recipes', 'Custom Allowed Tabs Per User', 'Advanced Sales Analytics', 'Dedicated Support channel'],
      popular: false,
    },
  ];

  const coreFeatures = [
    { title: 'Point of Sale (POS)', desc: 'Fast, secure cashier terminal with dynamic ingredient recipe deduction.', icon: Package },
    { title: 'Multi-Branch Transfers', desc: 'Transfer stock between warehouses and retail branches with verification flows.', icon: Layers },
    { title: 'Advanced Analytics', desc: 'Monitor top-selling categories, stock valuation, and operational profit.', icon: BarChart3 },
    { title: 'Staff Roster & Roles', desc: 'Permission-based access control with audit trails and custom allowed tabs.', icon: Users },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-pink-500/30 selection:text-white">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-[600px] bg-gradient-to-b from-pink-900/10 to-transparent pointer-events-none" />
      <div className="absolute top-1/4 right-0 w-96 h-96 bg-purple-900/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-pink-500 to-purple-600 flex items-center justify-center shadow-lg shadow-pink-500/20">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">ERP<span className="text-pink-500">SaaS</span></h1>
            <p className="text-[9px] uppercase tracking-wider text-slate-500">Smart Operations</p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <Button 
            className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold"
            onClick={() => { window.location.pathname = '/apply'; }}
          >
            Apply Now
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-20 pb-24 text-center space-y-8">
        <div className="inline-flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-full px-4 py-1.5 text-xs text-pink-400 font-medium">
          <span>✨ Standardizing Restaurant & Inventory Systems</span>
        </div>
        <h1 className="text-5xl md:text-6xl font-black tracking-tight leading-tight max-w-4xl mx-auto">
          The Intelligent Multi-Tenant <span className="bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500">ERP & POS</span> System.
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto font-medium">
          Scale your business across multiple branch locations with real-time stock transfer flows, granular permissions, receipt auditing, and POS integration.
        </p>
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-4">
          <Button 
            size="lg" 
            className="w-full sm:w-auto h-13 px-8 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold text-base shadow-lg shadow-pink-500/20 rounded-xl"
            onClick={() => { window.location.pathname = '/apply'; }}
          >
            Start Onboarding
          </Button>
          <Button 
            size="lg" 
            variant="outline" 
            className="w-full sm:w-auto h-13 px-8 border-slate-800 bg-slate-900/50 hover:bg-slate-900 text-white hover:text-white rounded-xl"
            onClick={() => {
              const el = document.getElementById('pricing');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            View Pricing
          </Button>
        </div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-900">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl font-bold tracking-tight">Full-Stack ERP Capabilities</h2>
          <p className="text-slate-400 max-w-xl mx-auto">All of our core management modules are dynamically enabled depending on your business requirements.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {coreFeatures.map((f, i) => {
            const Icon = f.icon;
            return (
              <Card key={i} className="bg-slate-900/60 border-slate-800/80 shadow-xl hover:border-slate-700 transition-all duration-300">
                <CardHeader className="space-y-3 pb-3">
                  <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center border border-pink-500/20 text-pink-500">
                    <Icon className="w-5 h-5" />
                  </div>
                  <CardTitle className="text-lg font-bold text-white">{f.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Pricing Grid */}
      <section id="pricing" className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-900">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl font-bold tracking-tight">Flexible SaaS Subscription Plans</h2>
          <p className="text-slate-400 max-w-xl mx-auto">Select a subscription structure fitting your operation scale. Upgrade or downgrade anytime.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {displayPlans.map((p, i) => (
            <Card 
              key={i} 
              className={`bg-slate-900/80 border-slate-800/80 shadow-2xl relative overflow-hidden flex flex-col justify-between ${
                p.popular ? 'border-pink-500/50 shadow-pink-500/5' : ''
              }`}
            >
              {p.popular && (
                <div className="absolute top-0 right-0 bg-pink-500 text-white font-bold text-[9px] uppercase tracking-wider px-3 py-1 rounded-bl">
                  Most Popular
                </div>
              )}
              
              <CardHeader className="pb-4">
                <CardDescription className="text-xs uppercase tracking-wider text-pink-400 font-semibold">{p.name}</CardDescription>
                <div className="flex items-baseline space-x-1 mt-2">
                  <span className="text-4xl font-extrabold text-white">{p.price}</span>
                  <span className="text-slate-500 text-xs font-semibold">/month</span>
                </div>
              </CardHeader>

              <CardContent className="flex-1 pb-6">
                <ul className="space-y-3">
                  {p.features.map((feat, idx) => (
                    <li key={idx} className="flex items-center space-x-2 text-xs text-slate-300">
                      <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                      </svg>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <div className="p-6 pt-0 mt-auto">
                <Button 
                  className={`w-full font-bold h-11 rounded-lg ${
                    p.popular 
                      ? 'bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white' 
                      : 'bg-slate-800 hover:bg-slate-700 text-white'
                  }`}
                  onClick={() => { window.location.pathname = '/apply'; }}
                >
                  Onboard Tenant
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 py-12 px-6 border-t border-slate-900 text-center text-xs text-slate-500 relative z-10">
        <p>© {new Date().getFullYear()} ERPSaaS. All rights reserved. Built for oddysey.com / odcph.com systems.</p>
      </footer>
    </div>
  );
};
