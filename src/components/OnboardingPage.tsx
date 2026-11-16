import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { OdysseyHeader, OdysseyFooter } from './odyssey/OdysseyChrome';
import { ODYSSEY_LINKS } from './odyssey/brand';
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
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'starter' | 'professional' | 'enterprise'>('free');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [plans, setPlans] = useState<any[]>([]);

  // Step 3: Payment Verification
  const [paymentReference, setPaymentReference] = useState('');
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState('');
  const [qrCodes, setQrCodes] = useState<QRCodeConfig[]>([]);
  const [agreed, setAgreed] = useState(false);
  const [activeQrIndex, setActiveQrIndex] = useState(0);

  // Helper to resolve dynamically configured plan prices with hardcoded fallbacks
  const getPlanPrice = (planId: string, cycle: 'monthly' | 'yearly'): number => {
    const dbPlan = plans.find(p => p.id === planId);
    if (dbPlan) {
      return cycle === 'monthly' ? Number(dbPlan.monthly_price) : Number(dbPlan.yearly_price);
    }
    const fallbacks: Record<string, number> = {
      free_monthly: 0,
      free_yearly: 0,
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

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

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

    if (!agreed) {
      setErrorMsg('Please agree to the Terms & Conditions and Data Privacy notice to continue.');
      return;
    }
    
    let cleanRef = 'FREE';
    let cleanReceipt = 'FREE';

    if (selectedPlan !== 'free') {
      cleanRef = paymentReference.trim();
      if (!cleanRef || cleanRef.length !== 5 || !/^\d+$/.test(cleanRef)) {
        setErrorMsg('Please input exactly the last 5 digits of your payment reference number.');
        return;
      }

      if (!receiptBase64) {
        setErrorMsg('Please upload a copy/screenshot of your proof of payment.');
        return;
      }
      cleanReceipt = receiptBase64;
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
        payment_receipt_url: cleanReceipt,
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

  const domain = import.meta.env.VITE_MAIN_DOMAIN || 'odysseyph.com';
  const inputCls = "h-11 bg-white border-[#DCE1E8] text-[#152839] placeholder:text-[#5F6A7C] rounded-lg focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-0 focus-visible:border-[#152839]";
  const labelCls = "text-sm font-medium text-[#152839]";
  const navyBtn = "h-11 px-5 rounded-lg bg-[#152839] text-[#F9F8F3] hover:bg-[#1f3a52] font-semibold text-[15px] border-0 focus-visible:ring-2 focus-visible:ring-[#FF6F07] focus-visible:ring-offset-2";
  const outlineBtn = "h-11 px-5 rounded-lg border-2 border-[#152839] bg-transparent text-[#152839] hover:bg-[#152839]/5 hover:text-[#152839] font-semibold text-[15px]";
  const stepLabels = ['Business', 'Plan', 'Payment', 'Done'];
  const businessTypes = [
    { checked: isRestaurant, set: setIsRestaurant, title: 'Restaurant and food service', desc: 'Ingredient tracking, recipes and table service.' },
    { checked: isRetail, set: setIsRetail, title: 'Retail store and parts sales', desc: 'Barcode scanning, stock control and a spare parts catalog.' },
    { checked: isService, set: setIsService, title: 'Service and repair shop', desc: 'Labor and maintenance services catalog with no inventory impact.' },
  ];
  const planOptions = [
    { id: 'free', name: 'Free Trial', limit: '1 branch · 2 users · Online checkout (100 sales a month)' },
    { id: 'starter', name: 'Starter', limit: '1 branch · 3 users · Offline sales and device binding' },
    { id: 'professional', name: 'Professional', limit: '3 branches · 10 users · Recipes, transfers and audit logs' },
    { id: 'enterprise', name: 'Enterprise', limit: '10 branches · 30 users · Advanced analytics and priority support' },
  ];

  return (
    <div className="font-odyssey min-h-screen bg-[#F9F8F3] text-[#152839] antialiased flex flex-col">
      <OdysseyHeader>
        <a href="/" className="text-[15px] font-medium text-[#45546A] hover:text-[#152839]">Back to home</a>
      </OdysseyHeader>

      <main className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#B8470A]">Inventory Management System by ODYSSEY</p>
        <h1 className="font-odyssey-display font-bold text-[30px] leading-[38px] sm:text-[34px] sm:leading-[42px] mt-2">
          {step === 1 && 'Create your workspace'}
          {step === 2 && 'Choose a plan'}
          {step === 3 && 'Confirm and pay'}
          {step === 4 && 'Application submitted'}
        </h1>
        <p className="text-[16px] leading-[26px] text-[#45546A] mt-2">
          {step === 1 && 'Tell us your business name and pick the web address your team will use.'}
          {step === 2 && 'Pick the plan that fits your number of branches and staff. You can change it later.'}
          {step === 3 && (selectedPlan === 'free' ? 'No payment is needed for the free trial.' : 'Pay with GCash or Maya, then enter the last 5 digits of the reference number.')}
          {step === 4 && 'We have your details. Here is what happens next.'}
        </p>

        {/* Linked step indicator: shared walls, current step in orange */}
        <ol className="grid grid-cols-4 mt-6" aria-label={`Step ${step} of 4`}>
          {stepLabels.map((label, i) => {
            const n = i + 1;
            const state = n < step ? 'done' : n === step ? 'current' : 'todo';
            return (
              <li
                key={label}
                aria-current={state === 'current' ? 'step' : undefined}
                className={`h-10 flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold border-2 border-[#152839] ${i > 0 ? '-ml-[2px]' : 'rounded-l-lg'} ${i === 3 ? 'rounded-r-lg' : ''} ${
                  state === 'current' ? 'bg-[#FF6F07] text-[#152839]' : state === 'done' ? 'bg-[#152839] text-[#F9F8F3]' : 'bg-white text-[#45546A]'
                }`}
              >
                {state === 'done' ? <CheckIcon className="w-4 h-4" /> : <span>{n}</span>}
                <span className="hidden sm:inline">{label}</span>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 rounded-[22px] bg-[#152839] p-[6px]">
          <div className="rounded-[17px] border-[3px] border-[#FF6F07] bg-white">
            <div className="p-6 sm:p-8">
              {errorMsg && (
                <div role="alert" className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-lg text-sm font-medium mb-6">
                  {errorMsg}
                </div>
              )}

              {/* STEP 1: BUSINESS SETUP */}
              {step === 1 && (
                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="biz-name" className={labelCls}>Business name</Label>
                    <Input id="biz-name" type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Odyssey Burgers" className={inputCls} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subdomain" className={labelCls}>Workspace address</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1 min-w-0">
                        <Input
                          id="subdomain"
                          type="text"
                          value={subdomain}
                          onChange={(e) => {
                            setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                            setSubdomainAvailable(null);
                          }}
                          placeholder="yourstore"
                          className={`${inputCls} pr-28`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#5F6A7C] select-none truncate max-w-[45%]">.{domain}</span>
                      </div>
                      <Button type="button" variant="outline" onClick={handleCheckSubdomain} disabled={subdomainChecking || !subdomain} className={`${outlineBtn} px-4`}>
                        {subdomainChecking ? <Spinner className="w-4 h-4 animate-spin" /> : 'Check'}
                      </Button>
                    </div>
                    {subdomainAvailable === true && (
                      <p className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                        <CheckIcon className="w-4 h-4" /> {subdomain}.{domain} is available.
                      </p>
                    )}
                    <p className="text-xs text-[#5F6A7C]">Lowercase letters, numbers and dashes. At least 3 characters.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-email" className={labelCls}>Admin email</Label>
                    <Input id="admin-email" type="email" autoComplete="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="you@yourbusiness.com" className={inputCls} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-pass" className={labelCls}>Admin password</Label>
                    <Input id="admin-pass" type="password" autoComplete="new-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="At least 6 characters" className={inputCls} />
                  </div>

                  <fieldset className="space-y-3 pt-5 border-t border-[#DCE1E8]">
                    <legend className="text-sm font-medium text-[#152839]">Type of business</legend>
                    <p className="text-sm text-[#45546A] -mt-1">Choose all that apply. This turns on the matching modules.</p>
                    <div className="grid gap-2.5">
                      {businessTypes.map((bt) => (
                        <label
                          key={bt.title}
                          className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer select-none transition-colors ${bt.checked ? 'border-[#152839] bg-[#F9F8F3]' : 'border-[#DCE1E8] bg-white hover:border-[#5F6A7C]'}`}
                        >
                          <input type="checkbox" checked={bt.checked} onChange={(e) => bt.set(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#152839]" />
                          <span>
                            <span className="text-sm font-semibold block">{bt.title}</span>
                            <span className="text-sm text-[#45546A] block mt-0.5">{bt.desc}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}

              {/* STEP 2: PLANS SELECTION */}
              {step === 2 && (
                <div className="space-y-6">
                  <div className="flex bg-[#ECE7DE] p-1 rounded-lg max-w-xs mx-auto" role="radiogroup" aria-label="Billing cycle">
                    {(['monthly', 'yearly'] as const).map((cycle) => (
                      <button
                        key={cycle}
                        type="button"
                        role="radio"
                        aria-checked={billingCycle === cycle}
                        onClick={() => setBillingCycle(cycle)}
                        className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${billingCycle === cycle ? 'bg-[#152839] text-[#F9F8F3]' : 'text-[#45546A] hover:text-[#152839]'}`}
                      >
                        {cycle === 'monthly' ? 'Monthly' : 'Yearly (save 15%)'}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-3" role="radiogroup" aria-label="Plan">
                    {planOptions.map((plan) => {
                      const price = getPlanPrice(plan.id, billingCycle);
                      const selected = selectedPlan === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setSelectedPlan(plan.id as any)}
                          className={`text-left p-4 rounded-lg border-2 flex justify-between items-center gap-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07] ${selected ? 'border-[#152839] bg-[#F9F8F3]' : 'border-[#DCE1E8] bg-white hover:border-[#5F6A7C]'}`}
                        >
                          <span className="flex items-start gap-3">
                            <span className={`mt-1 w-4 h-4 rounded-full border-2 border-[#152839] flex items-center justify-center shrink-0`}>
                              {selected && <span className="w-2 h-2 rounded-full bg-[#FF6F07]" />}
                            </span>
                            <span>
                              <span className="font-odyssey-display font-medium text-[17px] block">{plan.name}</span>
                              <span className="text-sm text-[#45546A] block mt-0.5">{plan.limit}</span>
                            </span>
                          </span>
                          <span className="text-right shrink-0">
                            <span className="font-odyssey-display font-bold text-lg block">{price === 0 ? 'Free' : `₱${price.toLocaleString()}`}</span>
                            {price !== 0 && <span className="text-xs text-[#5F6A7C]">/{billingCycle === 'monthly' ? 'month' : 'year'}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 3: PAYMENT & SUBMISSION */}
              {step === 3 && (
                <div className="space-y-6">
                  {selectedPlan === 'free' ? (
                    <div className="bg-[#F9F8F3] p-6 border border-[#DCE1E8] rounded-lg text-center space-y-3">
                      <div className="w-12 h-12 rounded-full bg-[#152839] text-[#F9F8F3] flex items-center justify-center mx-auto">
                        <CheckIcon className="w-6 h-6" />
                      </div>
                      <h3 className="font-odyssey-display font-medium text-[18px]">No payment needed</h3>
                      <p className="text-sm text-[#45546A] leading-[22px]">
                        You chose the Free Trial. We create your workspace once our team approves the application.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="bg-[#F9F8F3] p-4 sm:p-5 border border-[#DCE1E8] rounded-lg space-y-4">
                        <div className="flex justify-between items-center border-b border-[#DCE1E8] pb-3">
                          <span className="text-sm text-[#45546A] font-medium">Amount due</span>
                          <span className="font-odyssey-display font-bold text-xl">₱{getPlanPrice(selectedPlan, billingCycle).toLocaleString()}</span>
                        </div>

                        {qrCodes.length === 0 ? (
                          <p className="text-sm text-[#45546A] text-center py-4">Payment channels could not be loaded. You can still upload your receipt and enter the reference digits below.</p>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex gap-2 overflow-x-auto" role="tablist">
                              {qrCodes.map((qc, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  role="tab"
                                  aria-selected={activeQrIndex === idx}
                                  onClick={() => setActiveQrIndex(idx)}
                                  className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${activeQrIndex === idx ? 'bg-[#152839] text-[#F9F8F3]' : 'text-[#45546A] hover:text-[#152839] bg-white border border-[#DCE1E8]'}`}
                                >
                                  {qc.payment_method}
                                </button>
                              ))}
                            </div>
                            <div className="flex flex-col sm:flex-row items-center gap-6">
                              <div className="w-36 h-36 bg-white rounded-lg p-2 border border-[#DCE1E8] shrink-0 flex items-center justify-center">
                                <img
                                  src={qrCodes[activeQrIndex].qr_code_url}
                                  alt={`${qrCodes[activeQrIndex].payment_method} QR code`}
                                  className="w-full h-full object-contain"
                                  onError={(e) => { e.currentTarget.src = "https://placehold.co/150?text=Scan+To+Pay"; }}
                                />
                              </div>
                              <div className="space-y-1.5 text-center sm:text-left">
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#5F6A7C]">Account details</p>
                                <p className="font-semibold">{qrCodes[activeQrIndex].payment_method}</p>
                                <p className="text-sm text-[#45546A]">Name: <span className="font-semibold text-[#152839]">{qrCodes[activeQrIndex].account_name}</span></p>
                                <p className="text-sm text-[#45546A]">Number: <span className="font-mono font-semibold text-[#152839] bg-white border border-[#DCE1E8] px-1.5 py-0.5 rounded">{qrCodes[activeQrIndex].account_number}</span></p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-5">
                        <div className="space-y-2">
                          <Label htmlFor="payment-ref" className={labelCls}>Last 5 digits of the reference number</Label>
                          <Input
                            id="payment-ref"
                            type="text"
                            inputMode="numeric"
                            maxLength={5}
                            value={paymentReference}
                            onChange={(e) => setPaymentReference(e.target.value.replace(/\D/g, ''))}
                            placeholder="e.g. 54321"
                            className={`${inputCls} font-mono text-center text-lg tracking-widest`}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="receipt-file" className={labelCls}>Screenshot of your receipt</Label>
                          <div className="relative h-24 border-2 border-dashed border-[#DCE1E8] rounded-lg hover:border-[#152839] hover:bg-[#F9F8F3] transition-colors flex flex-col items-center justify-center cursor-pointer group">
                            <input id="receipt-file" type="file" accept="image/*" onChange={handleReceiptUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                            <Upload className="w-5 h-5 text-[#5F6A7C] group-hover:text-[#152839]" />
                            <span className="text-sm text-[#45546A] mt-2 font-medium px-4 truncate max-w-full">{receiptFileName || 'Choose an image (PNG or JPG, under 2 MB)'}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  <label className="flex items-start gap-3 pt-5 border-t border-[#DCE1E8] cursor-pointer select-none">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 w-4 h-4 accent-[#152839] shrink-0" />
                    <span className="text-sm text-[#45546A] leading-[22px]">
                      I have read and agree to the{' '}
                      <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#B8470A] font-medium underline underline-offset-2">Terms &amp; Conditions</a>{' '}
                      and the{' '}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#B8470A] font-medium underline underline-offset-2">Data Privacy notice</a>, and I consent to ODYSSEY processing the details above to review my application, in line with the Data Privacy Act of 2012.
                    </span>
                  </label>
                </div>
              )}

              {/* STEP 4: SUBMITTED CONFIRMATION */}
              {step === 4 && (
                <div className="text-center py-4 space-y-6">
                  <img src="/odyssey/ody-systems-happy.webp" alt="" className="w-24 h-auto mx-auto select-none" draggable={false} />
                  {selectedPlan === 'free' ? (
                    <div className="space-y-4">
                      <h2 className="font-odyssey-display font-medium text-[22px] leading-[30px]">Your application is in.</h2>
                      <p className="text-[16px] leading-[26px] text-[#45546A] max-w-md mx-auto">Once our team approves it, your workspace will be at:</p>
                      <div className="bg-[#F9F8F3] p-4 border border-[#DCE1E8] rounded-lg font-mono text-sm select-all font-semibold max-w-sm mx-auto break-all">
                        {`https://${subdomain.toLowerCase()}.${domain}`}
                      </div>
                      <p className="text-sm text-[#45546A]">You will sign in with <strong className="text-[#152839]">{adminEmail}</strong>.</p>
                      <p className="text-sm text-[#5F6A7C]">
                        Questions? Email <a href={`mailto:${ODYSSEY_LINKS.helloEmail}`} className="text-[#B8470A] font-medium underline underline-offset-2">{ODYSSEY_LINKS.helloEmail}</a>.
                      </p>
                      <Button variant="outline" onClick={() => { window.location.pathname = '/'; }} className={`${outlineBtn} mt-2`}>
                        Back to home
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <h2 className="font-odyssey-display font-medium text-[22px] leading-[30px]">Your application is in.</h2>
                      <p className="text-[16px] leading-[26px] text-[#45546A] max-w-md mx-auto">
                        We are checking payment reference <strong className="text-[#152839]">{paymentReference}</strong> for{' '}
                        <strong className="text-[#152839]">{subdomain.toLowerCase()}.{domain}</strong>. Once it is approved, you can sign in right away.
                      </p>
                      <p className="text-sm text-[#5F6A7C]">
                        Questions? Email <a href={`mailto:${ODYSSEY_LINKS.helloEmail}`} className="text-[#B8470A] font-medium underline underline-offset-2">{ODYSSEY_LINKS.helloEmail}</a>.
                      </p>
                      <Button variant="outline" onClick={() => { window.location.pathname = '/'; }} className={`${outlineBtn} mt-2`}>
                        Back to home
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {step < 4 && (
              <div className="px-6 sm:px-8 py-5 border-t border-[#DCE1E8] flex justify-between gap-3 bg-[#F9F8F3] rounded-b-[14px]">
                {step > 1 ? (
                  <Button type="button" variant="outline" onClick={() => setStep(step - 1)} className={outlineBtn}>Back</Button>
                ) : (
                  <Button type="button" variant="ghost" onClick={() => { window.location.pathname = '/'; }} className="h-11 px-4 text-[#45546A] hover:text-[#152839] hover:bg-transparent font-semibold">Cancel</Button>
                )}

                {step < 3 ? (
                  <Button type="button" onClick={nextStep} className={navyBtn}>
                    Continue <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                ) : (
                  <Button type="button" onClick={handleSubmitApplication} disabled={loading || !agreed} className={navyBtn}>
                    {loading ? (
                      <span className="flex items-center gap-1.5"><Spinner className="w-4 h-4 animate-spin" /> Submitting...</span>
                    ) : selectedPlan === 'free' ? 'Submit application' : 'Submit payment'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <OdysseyFooter />
    </div>
  );
};
