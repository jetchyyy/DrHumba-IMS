import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ReloadIcon as Spinner, CheckIcon, ChevronRightIcon as ChevronRight, UploadIcon as Upload } from '@radix-ui/react-icons';

interface QRCodeConfig {
  payment_method: string;
  account_name: string;
  account_number: string;
  qr_code_url: string;
}

export const OnboardingPage: React.FC = () => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Step 1: Business Details
  const [businessName, setBusinessName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [subdomainChecking, setSubdomainChecking] = useState(false);
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean | null>(null);

  // Business Model Features
  const [isRestaurant, setIsRestaurant] = useState(true);
  const [isRetail, setIsRetail] = useState(false);
  const [isService, setIsService] = useState(false);

  // Step 2: Plan Selection
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'professional' | 'enterprise'>('starter');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [plans, setPlans] = useState<any[]>([]);

  // Step 3: Payment Verification
  const [paymentReference, setPaymentReference] = useState('');
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState('');
  const [qrCodes, setQrCodes] = useState<QRCodeConfig[]>([]);
  const [activeQrIndex, setActiveQrIndex] = useState(0);

  // Helper to resolve dynamically configured plan prices with hardcoded fallbacks
  const getPlanPrice = (planId: string, cycle: 'monthly' | 'yearly'): number => {
    const dbPlan = plans.find(p => p.id === planId);
    if (dbPlan) {
      return cycle === 'monthly' ? Number(dbPlan.monthly_price) : Number(dbPlan.yearly_price);
    }
    const fallbacks: Record<string, number> = {
      starter_monthly: 999,
      starter_yearly: 9990,
      professional_monthly: 2499,
      professional_yearly: 24990,
      enterprise_monthly: 7499,
      enterprise_yearly: 74990
    };
    return fallbacks[`${planId}_${cycle}`] || 0;
  };

  useEffect(() => {
    // Fetch active payment QR codes and subscription plans
    const fetchInitialData = async () => {
      try {
        const { data: qrData } = await supabase
          .from('payment_qr_codes')
          .select('payment_method, account_name, account_number, qr_code_url')
          .eq('is_active', true);
        if (qrData && qrData.length > 0) {
          setQrCodes(qrData);
        }

        const { data: planData } = await supabase
          .from('subscription_plans')
          .select('*')
          .order('monthly_price', { ascending: true });
        if (planData && planData.length > 0) {
          setPlans(planData);
        }
      } catch (err) {
        console.error('Error fetching onboarding configs:', err);
      }
    };
    fetchInitialData();
  }, []);

  // Validate Subdomain Availability
  const handleCheckSubdomain = async () => {
    if (!subdomain || subdomain.length < 3) {
      setErrorMsg('Subdomain must be at least 3 characters.');
      setSubdomainAvailable(false);
      return;
    }
    const cleanSubdomain = subdomain.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (cleanSubdomain !== subdomain) {
      setErrorMsg('Subdomains can only contain lowercase letters, numbers, and dashes.');
      setSubdomainAvailable(false);
      return;
    }

    setSubdomainChecking(true);
    setErrorMsg('');
    try {
      // 1. Check existing tenants
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('id')
        .eq('subdomain', cleanSubdomain);

      // 2. Check pending applications
      const { data: appData } = await supabase
        .from('tenant_applications')
        .select('id')
        .eq('subdomain', cleanSubdomain);

      const isTaken = (tenantData && tenantData.length > 0) || (appData && appData.length > 0);
      setSubdomainAvailable(!isTaken);
      if (isTaken) {
        setErrorMsg(`Subdomain "${cleanSubdomain}" is already taken.`);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Error checking subdomain availability.');
    } finally {
      setSubdomainChecking(false);
    }
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setErrorMsg('Receipt image must be under 2MB.');
        return;
      }
      setReceiptFileName(file.name);
      setErrorMsg('');

      const reader = new FileReader();
      reader.onloadend = () => {
        setReceiptBase64(reader.result as string);
      };
      reader.onerror = () => {
        setErrorMsg('Failed to read receipt file.');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmitApplication = async () => {
    setErrorMsg('');
    
    // Strict Reference Verification: Last 5 digits required
    const cleanRef = paymentReference.trim();
    if (!cleanRef || cleanRef.length !== 5 || !/^\d+$/.test(cleanRef)) {
      setErrorMsg('Please input exactly the last 5 digits of your payment reference number.');
      return;
    }

    if (!receiptBase64) {
      setErrorMsg('Please upload a copy/screenshot of your proof of payment.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('tenant_applications').insert({
        business_name: businessName.trim(),
        subdomain: subdomain.trim().toLowerCase(),
        admin_email: adminEmail.trim(),
        admin_password_hash: adminPassword,
        plan_type: selectedPlan,
        billing_cycle: billingCycle,
        payment_reference: cleanRef,
        payment_receipt_url: receiptBase64,
        status: 'pending',
        is_restaurant: isRestaurant,
        is_retail: isRetail,
        is_service: isService
      });

      if (error) throw error;
      setStep(4);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to submit application. Please verify details.');
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    setErrorMsg('');
    if (step === 1) {
      if (!businessName.trim() || !subdomain.trim() || !adminEmail.trim() || !adminPassword.trim()) {
        setErrorMsg('Please fill in all business credentials.');
        return;
      }
      if (!subdomainAvailable) {
        setErrorMsg('Please check and confirm subdomain availability first.');
        return;
      }
      if (adminPassword.length < 6) {
        setErrorMsg('Password must be at least 6 characters.');
        return;
      }
      if (!isRestaurant && !isRetail && !isService) {
        setErrorMsg('Please select at least one Business Model Tier to enable.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4 selection:bg-pink-500/30 selection:text-white">
      {/* Background radial effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(244,63,94,0.08),transparent_50%)] pointer-events-none" />

      <Card className="w-full max-w-xl shadow-[0_20px_50px_rgba(244,63,94,0.15)] bg-slate-900/90 border-slate-800 backdrop-blur-xl relative z-10 overflow-hidden">
        {/* Top Gradient Ribbon */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500"></div>

        {/* Step Indicator Header */}
        <CardHeader className="text-center pt-8 border-b border-slate-800/80">
          <div className="flex justify-center items-center space-x-2 text-xs font-semibold text-pink-500 uppercase tracking-widest mb-2">
            <span>Step {step} of 4</span>
          </div>
          <CardTitle className="text-2xl font-black text-white tracking-tight">
            {step === 1 && "Create Your Store Workspace"}
            {step === 2 && "Select Subscription Plan"}
            {step === 3 && "Secure Payment Deposit"}
            {step === 4 && "Application Submitted"}
          </CardTitle>
          <CardDescription className="text-slate-400">
            {step === 1 && "Provide your store name and desired subdomain domain."}
            {step === 2 && "Choose a workspace scope matching your business size."}
            {step === 3 && "Scan GCash or Maya to pay. Enter the last 5 reference digits."}
            {step === 4 && "Your subscription is currently being verified."}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-8">
          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-xs font-medium mb-6">
              {errorMsg}
            </div>
          )}

          {/* STEP 1: BUSINESS SETUP */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="biz-name" className="text-xs font-bold uppercase tracking-wider text-slate-400">Business Name</Label>
                <Input
                  id="biz-name"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Odyssey Burgers"
                  className="bg-slate-950 border-slate-800 text-white h-11 focus-visible:ring-pink-500 focus-visible:border-pink-500 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="subdomain" className="text-xs font-bold uppercase tracking-wider text-slate-400">Workspace Subdomain</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="subdomain"
                      type="text"
                      value={subdomain}
                      onChange={(e) => {
                        setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                        setSubdomainAvailable(null);
                      }}
                      placeholder="odyssey"
                      className="bg-slate-950 border-slate-800 text-white h-11 focus-visible:ring-pink-500 focus-visible:border-pink-500 rounded-xl pr-28"
                    />
                    <span className="absolute right-3 top-3 text-xs text-slate-500 font-semibold select-none">
                      .odcph.com
                    </span>
                  </div>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={handleCheckSubdomain}
                    disabled={subdomainChecking || !subdomain}
                    className="h-11 px-4 border-slate-800 bg-slate-950 text-xs font-bold rounded-xl text-slate-300 hover:text-white"
                  >
                    {subdomainChecking ? <Spinner className="w-4 h-4 animate-spin" /> : "Check"}
                  </Button>
                </div>
                {subdomainAvailable === true && (
                  <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 mt-1">
                    <CheckIcon className="w-3.5 h-3.5" /> Subdomain is available!
                  </p>
                )}
              </div>

              <div className="space-y-1.5 pt-2">
                <Label htmlFor="admin-email" className="text-xs font-bold uppercase tracking-wider text-slate-400">Admin Email Account</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@odysseyburgers.com"
                  className="bg-slate-950 border-slate-800 text-white h-11 focus-visible:ring-pink-500 focus-visible:border-pink-500 rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-pass" className="text-xs font-bold uppercase tracking-wider text-slate-400">Admin Account Password</Label>
                <Input
                  id="admin-pass"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="••••••••"
                  className="bg-slate-950 border-slate-800 text-white h-11 focus-visible:ring-pink-500 focus-visible:border-pink-500 rounded-xl"
                />
              </div>

              <div className="space-y-2 pt-4 border-t border-slate-800/80">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-300">Business Model Tiers</Label>
                <p className="text-[10px] text-slate-400">Select what features your shop will support. You can select multiple.</p>
                <div className="grid grid-cols-1 gap-2.5 mt-2">
                  <label className="flex items-center gap-3 p-3 bg-slate-950/40 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 select-none transition-colors">
                    <input
                      type="checkbox"
                      checked={isRestaurant}
                      onChange={(e) => setIsRestaurant(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-800 text-pink-500 focus:ring-pink-500/20"
                    />
                    <div>
                      <span className="text-xs font-bold block text-slate-100">Restaurant & F&B Features</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Ingredients tracking, recipes management, table service POS.</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-slate-950/40 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 select-none transition-colors">
                    <input
                      type="checkbox"
                      checked={isRetail}
                      onChange={(e) => setIsRetail(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-800 text-pink-500 focus:ring-pink-500/20"
                    />
                    <div>
                      <span className="text-xs font-bold block text-slate-100">Retail Store & Parts Sales</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Direct 1-to-1 barcode scanning & stock control, spare parts catalog.</span>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-slate-950/40 border border-slate-800 rounded-xl cursor-pointer hover:border-slate-700 select-none transition-colors">
                    <input
                      type="checkbox"
                      checked={isService}
                      onChange={(e) => setIsService(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-800 text-pink-500 focus:ring-pink-500/20"
                    />
                    <div>
                      <span className="text-xs font-bold block text-slate-100">Service & Repair Shop</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">Labor costs catalog, maintenance services catalog (zero inventory impact).</span>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PLANS SELECTION */}
          {step === 2 && (
            <div className="space-y-6">
              {/* Billing Cycle Switch */}
              <div className="flex justify-center bg-slate-950 p-1 border border-slate-850 rounded-xl max-w-xs mx-auto">
                <button
                  type="button"
                  onClick={() => setBillingCycle('monthly')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    billingCycle === 'monthly' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycle('yearly')}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                    billingCycle === 'yearly' ? 'bg-pink-500 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Yearly (Save 15%)
                </button>
              </div>

              {/* Pricing Cards */}
              <div className="grid grid-cols-1 gap-4">
                {[
                  { id: 'starter', name: 'Starter Plan', limit: '1 Branch • 3 Users • POS & Inventory' },
                  { id: 'professional', name: 'Professional Plan', limit: '3 Branches • 10 Users • Full Recipes & Transfers' },
                  { id: 'enterprise', name: 'Enterprise Plan', limit: '10 Branches • 30 Users • Analytics & Audits' },
                ].map((plan) => {
                  const price = getPlanPrice(plan.id, billingCycle);
                  return (
                    <div
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan.id as any)}
                      className={`p-4 border rounded-xl cursor-pointer flex justify-between items-center transition-all ${
                        selectedPlan === plan.id
                          ? 'border-pink-500 bg-pink-500/5'
                          : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <h4 className="text-sm font-bold">{plan.name}</h4>
                        <p className="text-[10px] text-slate-400 mt-1">{plan.limit}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-extrabold text-pink-400">{price.toLocaleString()} PHP</span>
                        <span className="text-[9px] text-slate-500 block">/{billingCycle === 'monthly' ? 'mo' : 'yr'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: PAYMENT & SUBMISSION */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl space-y-4">
                <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                  <span className="text-xs text-slate-400 font-semibold">Total Invoice Amount:</span>
                  <span className="text-lg font-black text-pink-400">
                    {getPlanPrice(selectedPlan, billingCycle).toLocaleString()} PHP
                  </span>
                </div>

                {qrCodes.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No active payment channels loaded. Please upload receipt and enter transaction ID.</p>
                ) : (
                  <div className="space-y-4">
                    {/* Method Tabs */}
                    <div className="flex gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
                      {qrCodes.map((qc, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveQrIndex(idx)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            activeQrIndex === idx ? 'bg-pink-500/10 text-pink-400 border border-pink-500/20' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {qc.payment_method}
                        </button>
                      ))}
                    </div>

                    {/* QR Code details */}
                    <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
                      <div className="w-32 h-32 bg-white rounded-lg p-2 flex-shrink-0 flex items-center justify-center shadow-lg">
                        <img 
                          src={qrCodes[activeQrIndex].qr_code_url} 
                          alt="QR Code" 
                          className="w-full h-full object-contain" 
                          onError={(e) => {
                            // Fallback if image fails to load
                            e.currentTarget.src = "https://placehold.co/150?text=Scan+To+Pay";
                          }}
                        />
                      </div>
                      <div className="space-y-2 text-center sm:text-left">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Account Details</h4>
                        <p className="text-sm font-semibold">{qrCodes[activeQrIndex].payment_method}</p>
                        <p className="text-xs text-slate-300">Name: <span className="font-semibold">{qrCodes[activeQrIndex].account_name}</span></p>
                        <p className="text-xs text-slate-300">Number: <span className="font-mono font-semibold bg-slate-900 border px-1.5 py-0.5 rounded">{qrCodes[activeQrIndex].account_number}</span></p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Reference and Proof Upload */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="payment-ref" className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Last 5 Digits of Reference Number *
                  </Label>
                  <Input
                    id="payment-ref"
                    type="text"
                    maxLength={5}
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 54321"
                    className="bg-slate-950 border-slate-800 text-white h-11 focus-visible:ring-pink-500 focus-visible:border-pink-500 rounded-xl font-mono text-center text-lg tracking-widest"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Upload Receipt Screenshot *</Label>
                  <div className="relative h-24 border-2 border-dashed border-slate-800 rounded-xl hover:border-pink-500/50 hover:bg-pink-500/5 transition-all flex flex-col items-center justify-center cursor-pointer group">
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleReceiptUpload} 
                      className="absolute inset-0 opacity-0 cursor-pointer" 
                    />
                    <Upload className="w-5 h-5 text-slate-500 group-hover:text-pink-400 transition-colors" />
                    <span className="text-xs text-slate-400 group-hover:text-slate-300 mt-2 font-medium">
                      {receiptFileName || "Click to browse files (PNG, JPG)"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: SUBMITTED CONFIRMATION */}
          {step === 4 && (
            <div className="text-center py-8 space-y-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckIcon className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-white">Application Successfully Queued</h3>
                <p className="text-sm text-slate-400 leading-relaxed max-w-md mx-auto">
                  Our systems have received your registration under subdomain <strong>{subdomain.toLowerCase()}.odcph.com</strong>.
                  We are currently verifying reference <strong>{paymentReference}</strong>. Once approved, you can access your portal immediately.
                </p>
              </div>
              <Button 
                variant="outline" 
                onClick={() => { window.location.pathname = '/'; }}
                className="border-slate-800 bg-slate-900/50 hover:bg-slate-950 font-bold rounded-xl"
              >
                Back to Homepage
              </Button>
            </div>
          )}
        </CardContent>

        {step < 4 && (
          <CardFooter className="p-8 border-t border-slate-800/80 flex justify-between bg-slate-900/30">
            {step > 1 ? (
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setStep(step - 1)}
                className="border-slate-800 text-slate-300 hover:text-white rounded-xl"
              >
                Back
              </Button>
            ) : (
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => { window.location.pathname = '/'; }}
                className="text-slate-500 hover:text-white"
              >
                Cancel
              </Button>
            )}

            {step < 3 ? (
              <Button 
                type="button" 
                onClick={nextStep}
                className="bg-pink-500 hover:bg-pink-600 text-white font-bold rounded-xl"
              >
                Continue
                <ChevronRight className="w-4 h-4 ml-1.5" />
              </Button>
            ) : (
              <Button 
                type="button" 
                onClick={handleSubmitApplication}
                disabled={loading}
                className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white font-bold rounded-xl"
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <Spinner className="w-4 h-4 animate-spin" />
                    Submitting...
                  </span>
                ) : (
                  "Submit Payment"
                )}
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
    </div>
  );
};
