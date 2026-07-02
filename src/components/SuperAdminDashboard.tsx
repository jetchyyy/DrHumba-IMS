import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useModal } from '../contexts/ModalContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  DashboardIcon as OverviewIcon,
  GroupIcon as TenantsIcon,
  FilePlusIcon as ApplicationsIcon,
  PlusIcon,
  GearIcon as SettingsIcon,
  ExitIcon as LogOutIcon,
  UploadIcon,
  TrashIcon,
  EyeOpenIcon
} from '@radix-ui/react-icons';

const InlineSwitch: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        checked ? 'bg-pink-500' : 'bg-slate-800'
      }`}
    >
      <span
        className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
};

interface TenantRecord {
  id: string;
  name: string;
  subdomain: string | null;
  plan_type: 'starter' | 'professional' | 'enterprise';
  billing_cycle: 'monthly' | 'yearly';
  status: 'pending' | 'active' | 'suspended';
  max_branches: number;
  max_users: number;
  features: Record<string, boolean>;
  logo_url: string | null;
  created_at: string;
  is_restaurant?: boolean;
  is_retail?: boolean;
  is_service?: boolean;
}

interface ApplicationRecord {
  id: string;
  business_name: string;
  subdomain: string;
  admin_email: string;
  plan_type: 'starter' | 'professional' | 'enterprise';
  billing_cycle: 'monthly' | 'yearly';
  payment_reference: string;
  payment_receipt_url: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  is_restaurant?: boolean;
  is_retail?: boolean;
  is_service?: boolean;
}

interface QRCodeRecord {
  id: string;
  payment_method: string;
  account_name: string;
  account_number: string;
  qr_code_url: string;
  is_active: boolean;
}

interface PlanRecord {
  id: string;
  name: string;
  monthly_price: number;
  yearly_price: number;
  max_branches: number;
  max_users: number;
  features: Record<string, boolean>;
  updated_at?: string;
}

export const SuperAdminDashboard: React.FC = () => {
  const { signOut, profile } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  const [activeSection, setActiveSection] = useState<'overview' | 'tenants' | 'applications' | 'qrcodes' | 'plans'>('overview');

  // Loading States
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Data States
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [qrCodes, setQrCodes] = useState<QRCodeRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);

  // Dialog Modals
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [selectedReceiptUrl, setSelectedReceiptUrl] = useState('');
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);

  // Plan Editing State
  const [editingPlan, setEditingPlan] = useState<PlanRecord | null>(null);
  const [editPlanName, setEditPlanName] = useState('');
  const [editPlanMonthlyPrice, setEditPlanMonthlyPrice] = useState(0);
  const [editPlanYearlyPrice, setEditPlanYearlyPrice] = useState(0);
  const [editPlanMaxBranches, setEditPlanMaxBranches] = useState(1);
  const [editPlanMaxUsers, setEditPlanMaxUsers] = useState(3);
  const [editPlanFeatures, setEditPlanFeatures] = useState<Record<string, boolean>>({});

  // Manual Onboarding Form State
  const [manualName, setManualName] = useState('');
  const [manualSubdomain, setManualSubdomain] = useState('');
  const [manualPlan, setManualPlan] = useState<'starter' | 'professional' | 'enterprise'>('starter');
  const [manualCycle, setManualCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPassword, setManualPassword] = useState('');

  // Tenant Editing State
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editPlan, setEditPlan] = useState<'starter' | 'professional' | 'enterprise'>('starter');
  const [editCycle, setEditCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>('active');
  const [editMaxBranches, setEditMaxBranches] = useState(3);
  const [editMaxUsers, setEditMaxUsers] = useState(10);
  const [editFeatures, setEditFeatures] = useState<Record<string, boolean>>({});
  const [editIsRestaurant, setEditIsRestaurant] = useState(true);
  const [editIsRetail, setEditIsRetail] = useState(false);
  const [editIsService, setEditIsService] = useState(false);

  const getTenantPortalUrl = (subdomain: string) => {
    const host = window.location.host;
    const protocol = window.location.protocol;
    if (host.includes('localhost')) {
      const port = host.split(':')[1] || '5173';
      return `${protocol}//${subdomain}.lvh.me:${port}`;
    }
    const envMainDomain = import.meta.env.VITE_MAIN_DOMAIN;
    if (envMainDomain) {
      return `${protocol}//${subdomain}.${envMainDomain}`;
    }
    const parts = host.split('.');
    if (parts.length >= 2) {
      const baseDomain = parts.slice(-2).join('.');
      return `${protocol}//${subdomain}.${baseDomain}`;
    }
    return `${protocol}//${subdomain}.${host}`;
  };

  // QR Code Form State
  const [qrMethod, setQrMethod] = useState('GCash');
  const [qrName, setQrName] = useState('');
  const [qrNumber, setQrNumber] = useState('');
  const [qrBase64, setQrBase64] = useState('');
  const [qrFileName, setQrFileName] = useState('');

  const FEATURE_LABELS: Record<string, string> = {
    pos: 'Point of Sale (POS)',
    sales_history: 'Sales History Log',
    inventory: 'Inventory Catalog',
    global_inventory: 'Global Stock Ledger',
    receiving: 'Receiving Sheets',
    transfers: 'Store Transfers',
    adjustments: 'Stock Adjustments',
    transactions: 'Stock Ledgers',
    recipes: 'Menu Recipes & Deductions',
    branches: 'Branch Management',
    analytics: 'Analytics Charts',
    audit_logs: 'System Audit Logs',
    users: 'Staff Management Tab',
    settings: 'Settings Panels'
  };

  useEffect(() => {
    // Flag this session as a Platform Admin context
    const setContext = async () => {
      const { data } = await supabase.from('profiles').select('is_platform_admin').eq('id', (await supabase.auth.getUser()).data.user?.id).single();
      if (data?.is_platform_admin) {
        // Platform admin verified
      }
    };
    setContext();
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // Fetch Tenants
      const { data: tenantData } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
      setTenants((tenantData as TenantRecord[]) || []);

      // Fetch Applications
      const { data: appData } = await supabase.from('tenant_applications').select('*').order('created_at', { ascending: false });
      setApplications((appData as ApplicationRecord[]) || []);

      // Fetch QR Codes
      const { data: qrData } = await supabase.from('payment_qr_codes').select('*').order('created_at', { ascending: false });
      setQrCodes((qrData as QRCodeRecord[]) || []);

      // Fetch Subscription Plans
      const { data: plansData } = await supabase.from('subscription_plans').select('*').order('monthly_price', { ascending: true });
      setPlans((plansData as PlanRecord[]) || []);
    } catch (err) {
      console.error('Error loading admin portal data:', err);
    } finally {
      setLoading(false);
    }
  };

  // 1. Manual Tenant Onboarding
  const handleManualOnboardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName.trim() || !manualSubdomain.trim() || !manualEmail.trim() || !manualPassword.trim()) {
      showError('Please fill in all manual onboarding details.');
      return;
    }
    if (manualPassword.length < 6) {
      showError('Admin password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_create_tenant_manually', {
        p_name: manualName.trim(),
        p_subdomain: manualSubdomain.trim().toLowerCase(),
        p_plan: manualPlan,
        p_cycle: manualCycle,
        p_email: manualEmail.trim(),
        p_password: manualPassword,
      });

      if (error) throw error;
      showSuccess(`Manually provisioned tenant "${manualName}" successfully!`);
      setIsManualModalOpen(false);
      setManualName('');
      setManualSubdomain('');
      setManualEmail('');
      setManualPassword('');
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to manually onboard tenant.');
    } finally {
      setSubmitting(false);
    }
  };

  // 2. Application Approvals / Rejections
  const handleApproveApplication = async (appId: string, businessName: string) => {
    if (!await confirm('Approve Application', `Are you sure you want to approve and provision "${businessName}"? This creates their database portal and administrative user.`)) return;

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_approve_tenant_application', {
        p_app_id: appId
      });

      if (error) throw error;
      showSuccess(`Application for "${businessName}" approved and active!`);
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to approve onboarding application.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectApplication = async (appId: string, businessName: string) => {
    if (!await confirm('Reject Application', `Are you sure you want to reject the application for "${businessName}"?`)) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('tenant_applications')
        .update({ status: 'rejected' })
        .eq('id', appId);

      if (error) throw error;
      showSuccess(`Application for "${businessName}" rejected.`);
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to reject application.');
    } finally {
      setSubmitting(false);
    }
  };

  // 3. Edit Tenant Features & Limits
  const openEditTenantModal = (t: TenantRecord) => {
    setEditingTenant(t);
    setEditName(t.name);
    setEditPlan(t.plan_type);
    setEditCycle(t.billing_cycle);
    setEditStatus(t.status === 'suspended' ? 'suspended' : 'active');
    setEditMaxBranches(t.max_branches);
    setEditMaxUsers(t.max_users);
    setEditFeatures(t.features || {});
    setEditIsRestaurant(t.is_restaurant ?? true);
    setEditIsRetail(t.is_retail ?? false);
    setEditIsService(t.is_service ?? false);
    setIsEditModalOpen(true);
  };

  const handleEditTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;

    if (!editIsRestaurant && !editIsRetail && !editIsService) {
      showError('Please select at least one Business Model Tier.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          name: editName,
          plan_type: editPlan,
          billing_cycle: editCycle,
          status: editStatus,
          max_branches: editMaxBranches,
          max_users: editMaxUsers,
          features: editFeatures,
          is_restaurant: editIsRestaurant,
          is_retail: editIsRetail,
          is_service: editIsService,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingTenant.id);

      if (error) throw error;
      showSuccess(`Tenant configurations updated for "${editName}"!`);
      setIsEditModalOpen(false);
      setEditingTenant(null);
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to update tenant configs.');
    } finally {
      setSubmitting(false);
    }
  };

  // 4. QR Code CMS
  const handleQRUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setQrFileName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        setQrBase64(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddQRCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qrName.trim() || !qrNumber.trim() || !qrBase64) {
      showError('Please complete the payment channel fields and upload a QR screenshot.');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('payment_qr_codes').insert({
        payment_method: qrMethod,
        account_name: qrName.trim(),
        account_number: qrNumber.trim(),
        qr_code_url: qrBase64,
        is_active: true
      });

      if (error) throw error;
      showSuccess('New payment channel added to onboarding portals!');
      setIsQrModalOpen(false);
      setQrName('');
      setQrNumber('');
      setQrBase64('');
      setQrFileName('');
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to save payment channel.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleQRCodeActive = async (id: string, active: boolean) => {
    try {
      const { error } = await supabase
        .from('payment_qr_codes')
        .update({ is_active: active })
        .eq('id', id);
      if (error) throw error;
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError('Failed to toggle active state.');
    }
  };

  const handleDeleteQRCode = async (id: string) => {
    if (!await confirm('Delete Payment QR', 'Are you sure you want to permanently delete this payment channel? Existing applications will lose access to this QR view.')) return;
    try {
      const { error } = await supabase.from('payment_qr_codes').delete().eq('id', id);
      if (error) throw error;
      showSuccess('Payment channel removed.');
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError('Failed to delete payment channel.');
    }
  };

  // ── 5. Edit Subscription Plans CMS ─────────────────────────────────────────
  const openEditPlanModal = (plan: PlanRecord) => {
    setEditingPlan(plan);
    setEditPlanName(plan.name);
    setEditPlanMonthlyPrice(plan.monthly_price);
    setEditPlanYearlyPrice(plan.yearly_price);
    setEditPlanMaxBranches(plan.max_branches);
    setEditPlanMaxUsers(plan.max_users);
    setEditPlanFeatures(plan.features || {});
    setIsPlanModalOpen(true);
  };

  const handleEditPlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPlan) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from('subscription_plans')
        .update({
          monthly_price: editPlanMonthlyPrice,
          yearly_price: editPlanYearlyPrice,
          max_branches: editPlanMaxBranches,
          max_users: editPlanMaxUsers,
          features: editPlanFeatures,
          updated_at: new Date().toISOString()
        })
        .eq('id', editingPlan.id);

      if (error) throw error;
      showSuccess(`Subscription plan "${editPlanName}" configurations updated successfully!`);
      setIsPlanModalOpen(false);
      setEditingPlan(null);
      loadAllData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to update plan configurations.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col md:flex-row selection:bg-pink-500/30 selection:text-white">
      {/* Platform Superadmin Sidebar */}
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-900 bg-slate-950 shrink-0 p-6 flex flex-col gap-8 justify-between">
        <div className="space-y-8">
          {/* Platform Identity */}
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-pink-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg">
              Ω
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">SaaS Superadmin</h2>
              <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">ODC Platform CMS</p>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col gap-1.5">
            <Button
              variant={activeSection === 'overview' ? 'default' : 'ghost'}
              onClick={() => setActiveSection('overview')}
              className={`w-full justify-start h-10 px-3 rounded-lg font-bold text-xs ${
                activeSection === 'overview' ? 'bg-pink-500 hover:bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
            >
              <OverviewIcon className="mr-3 h-4 w-4" />
              SaaS Overview
            </Button>

            <Button
              variant={activeSection === 'tenants' ? 'default' : 'ghost'}
              onClick={() => setActiveSection('tenants')}
              className={`w-full justify-start h-10 px-3 rounded-lg font-bold text-xs ${
                activeSection === 'tenants' ? 'bg-pink-500 hover:bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
            >
              <TenantsIcon className="mr-3 h-4 w-4" />
              Tenant Registry
            </Button>

            <Button
              variant={activeSection === 'applications' ? 'default' : 'ghost'}
              onClick={() => setActiveSection('applications')}
              className={`w-full justify-start h-10 px-3 rounded-lg font-bold text-xs relative ${
                activeSection === 'applications' ? 'bg-pink-500 hover:bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
            >
              <ApplicationsIcon className="mr-3 h-4 w-4" />
              Applications Queue
              {applications.filter(a => a.status === 'pending').length > 0 && (
                <span className="absolute right-3 bg-pink-500 text-white font-extrabold text-[9px] w-5 h-5 flex items-center justify-center rounded-full border border-slate-950">
                  {applications.filter(a => a.status === 'pending').length}
                </span>
              )}
            </Button>

            <Button
              variant={activeSection === 'qrcodes' ? 'default' : 'ghost'}
              onClick={() => setActiveSection('qrcodes')}
              className={`w-full justify-start h-10 px-3 rounded-lg font-bold text-xs ${
                activeSection === 'qrcodes' ? 'bg-pink-500 hover:bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
            >
              <SettingsIcon className="mr-3 h-4 w-4" />
              Payment QR CMS
            </Button>

            <Button
              variant={activeSection === 'plans' ? 'default' : 'ghost'}
              onClick={() => setActiveSection('plans')}
              className={`w-full justify-start h-10 px-3 rounded-lg font-bold text-xs ${
                activeSection === 'plans' ? 'bg-pink-500 hover:bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
              }`}
            >
              <OverviewIcon className="mr-3 h-4 w-4" />
              Subscription Plans CMS
            </Button>
          </nav>
        </div>

        {/* Footer Admin Controls */}
        <div className="space-y-4 pt-4 border-t border-slate-900">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center border font-bold text-xs text-pink-400">
              AD
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold truncate">{profile?.email}</p>
              <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">System Operator</p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={signOut}
            className="w-full text-xs font-bold border-slate-900 bg-slate-950 text-slate-400 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/30 rounded-lg"
          >
            <LogOutIcon className="mr-2 h-4 w-4" />
            Platform Logout
          </Button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="flex-1 p-6 md:p-8 overflow-y-auto max-h-screen">
        {/* SECTION 1: OVERVIEW STATISTICS */}
        {activeSection === 'overview' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-black tracking-tight">ODC Platform Overview</h2>
              <p className="text-slate-400 text-xs mt-1">Global statistics, subscription yields, and registry status of your tenant businesses.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-slate-900/60 border-slate-800 text-white shadow-xl">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Active Store Tenants</CardDescription>
                  <CardTitle className="text-3xl font-black mt-1">
                    {tenants.filter(t => t.status === 'active' && t.subdomain !== null).length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-slate-400">Excludes system tenant accounts.</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900/60 border-slate-800 text-white shadow-xl">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Pending Applications</CardDescription>
                  <CardTitle className="text-3xl font-black text-pink-400 mt-1">
                    {applications.filter(a => a.status === 'pending').length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-slate-400">Awaiting payment verification.</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900/60 border-slate-800 text-white shadow-xl">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Approx. Monthly MRR</CardDescription>
                  <CardTitle className="text-3xl font-black text-emerald-400 mt-1">
                    {tenants
                      .filter(t => t.status === 'active' && t.subdomain !== null)
                      .reduce((sum, t) => {
                        const price = t.plan_type === 'starter' ? 999 : t.plan_type === 'professional' ? 2499 : 7499;
                        return sum + (t.billing_cycle === 'monthly' ? price : price / 12);
                      }, 0)
                      .toLocaleString(undefined, { maximumFractionDigits: 0 })} PHP
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-slate-400">Based on dynamic cycle valuations.</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900/60 border-slate-800 text-white shadow-xl">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Suspended Accounts</CardDescription>
                  <CardTitle className="text-3xl font-black mt-1">
                    {tenants.filter(t => t.status === 'suspended').length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-slate-400">Portals blocked from logging in.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* SECTION 2: TENANTS REGISTRY */}
        {activeSection === 'tenants' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black tracking-tight">Active Tenant Organizations</h2>
                <p className="text-slate-400 text-xs mt-1">Manage active plan scopes, edit branch/user limits, or suspend portal instances.</p>
              </div>

              <Button 
                onClick={() => setIsManualModalOpen(true)}
                className="bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs h-10 px-4 rounded-xl flex items-center gap-1.5 self-start sm:self-auto"
              >
                <PlusIcon className="w-4 h-4" />
                Manual Onboard Tenant
              </Button>
            </div>

            <Card className="bg-slate-900/40 border-slate-800/80">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-slate-900/20">
                    <TableHead className="text-slate-400">Tenant Name</TableHead>
                    <TableHead className="text-slate-400">Subdomain</TableHead>
                    <TableHead className="text-slate-400">Business Model</TableHead>
                    <TableHead className="text-slate-400">Plan & Billing</TableHead>
                    <TableHead className="text-slate-400 text-center">Quotas (Branches/Users)</TableHead>
                    <TableHead className="text-slate-400 text-center">Status</TableHead>
                    <TableHead className="text-slate-400 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500 py-12">Loading tenant registries...</TableCell>
                    </TableRow>
                  ) : tenants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-slate-500 py-12">No tenants found.</TableCell>
                    </TableRow>
                  ) : (
                    tenants.map(t => (
                      <TableRow key={t.id} className="border-slate-850 hover:bg-slate-900/30">
                        <TableCell className="font-bold text-white py-4">{t.name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {t.subdomain ? (
                            <a 
                              href={getTenantPortalUrl(t.subdomain)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-pink-400 hover:text-pink-300 underline inline-flex items-center gap-1.5"
                            >
                              {t.subdomain}.{import.meta.env.VITE_MAIN_DOMAIN || 'odcph.com'}
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ) : (
                            <span className="text-slate-500">Primary (Internal)</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[150px]">
                            {t.is_restaurant && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-emerald-500/20 text-emerald-400 bg-emerald-500/5">
                                Food F&B
                              </Badge>
                            )}
                            {t.is_retail && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-blue-500/20 text-blue-400 bg-blue-500/5">
                                Retail
                              </Badge>
                            )}
                            {t.is_service && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-purple-500/20 text-purple-400 bg-purple-500/5">
                                Service
                              </Badge>
                            )}
                            {!t.is_restaurant && !t.is_retail && !t.is_service && (
                              <span className="text-[10px] text-slate-500">None</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="outline" className="w-fit text-[9px] uppercase tracking-wider border-pink-500/30 text-pink-400 bg-pink-500/5">
                              {t.plan_type}
                            </Badge>
                            <span className="text-[10px] text-slate-500 capitalize">{t.billing_cycle}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-xs font-semibold">
                          {t.max_branches} Locations / {t.max_users} staff
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={t.status === 'suspended' ? "destructive" : "default"} className="uppercase text-[9px] tracking-wider">
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => openEditTenantModal(t)}
                            className="text-xs font-bold text-pink-400 hover:text-white hover:bg-pink-500/10 rounded-lg"
                          >
                            Edit Portal Config
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {/* SECTION 3: APPLICATIONS QUEUE */}
        {activeSection === 'applications' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-black tracking-tight">Pending Onboarding Applications</h2>
              <p className="text-slate-400 text-xs mt-1">Review self-registered tenant application details, verify GCash/Maya reference codes, and approve store portals.</p>
            </div>

            <Card className="bg-slate-900/40 border-slate-800/80">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-slate-900/20">
                    <TableHead className="text-slate-400">Business Name</TableHead>
                    <TableHead className="text-slate-400">Subdomain</TableHead>
                    <TableHead className="text-slate-400">Business Model</TableHead>
                    <TableHead className="text-slate-400">Plan Option</TableHead>
                    <TableHead className="text-slate-400">Contact Email</TableHead>
                    <TableHead className="text-slate-400 text-center">Ref (Last 5)</TableHead>
                    <TableHead className="text-slate-400 text-center">Receipt</TableHead>
                    <TableHead className="text-slate-400 text-right">Approve / Reject</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-slate-500 py-12">Loading applications...</TableCell>
                    </TableRow>
                  ) : applications.filter(a => a.status === 'pending').length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-slate-500 py-12">No pending applications in queue.</TableCell>
                    </TableRow>
                  ) : (
                    applications
                      .filter(a => a.status === 'pending')
                      .map(app => (
                        <TableRow key={app.id} className="border-slate-850 hover:bg-slate-900/30">
                          <TableCell className="font-bold text-white py-4">{app.business_name}</TableCell>
                          <TableCell className="font-mono text-xs">
                            <a 
                              href={getTenantPortalUrl(app.subdomain)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-pink-400 hover:text-pink-300 underline inline-flex items-center gap-1.5"
                            >
                              {app.subdomain}.{import.meta.env.VITE_MAIN_DOMAIN || 'odcph.com'}
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1 max-w-[150px]">
                              {app.is_restaurant && (
                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-emerald-500/20 text-emerald-450 bg-emerald-500/5">
                                  Food F&B
                                </Badge>
                              )}
                              {app.is_retail && (
                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-blue-500/20 text-blue-400 bg-blue-500/5">
                                  Retail
                                </Badge>
                              )}
                              {app.is_service && (
                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-purple-500/20 text-purple-400 bg-purple-500/5">
                                  Service
                                </Badge>
                              )}
                              {!app.is_restaurant && !app.is_retail && !app.is_service && (
                                <span className="text-[10px] text-slate-500">None</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="capitalize text-xs font-semibold">
                            {app.plan_type} ({app.billing_cycle})
                          </TableCell>
                          <TableCell className="text-xs text-slate-400">{app.admin_email}</TableCell>
                          <TableCell className="text-center font-mono font-bold text-pink-400 text-sm">
                            {app.payment_reference}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedReceiptUrl(app.payment_receipt_url);
                                setIsReceiptModalOpen(true);
                              }}
                              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-slate-900"
                              title="View Proof of Payment Screenshot"
                            >
                              <EyeOpenIcon className="w-4 h-4" />
                            </Button>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                size="sm"
                                disabled={submitting}
                                onClick={() => handleApproveApplication(app.id, app.business_name)}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-8 px-2.5 rounded-lg flex items-center gap-1"
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={submitting}
                                onClick={() => handleRejectApplication(app.id, app.business_name)}
                                className="border-destructive/30 hover:bg-destructive/10 text-destructive font-bold text-xs h-8 px-2.5 rounded-lg"
                              >
                                Reject
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {/* SECTION 4: PAYMENT QR CODES CMS */}
        {activeSection === 'qrcodes' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black tracking-tight">Onboarding Payment Methods CMS</h2>
                <p className="text-slate-400 text-xs mt-1">Configure active payment QR codes and instruction accounts displayed during application.</p>
              </div>

              <Button 
                onClick={() => setIsQrModalOpen(true)}
                className="bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs h-10 px-4 rounded-xl flex items-center gap-1.5 self-start sm:self-auto"
              >
                <PlusIcon className="w-4 h-4" />
                Add Payment Channel
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {loading ? (
                <p className="text-slate-500 text-xs">Loading payment methods...</p>
              ) : qrCodes.length === 0 ? (
                <p className="text-slate-500 text-xs col-span-full">No payment methods configured. Click Add to create one.</p>
              ) : (
                qrCodes.map(qc => (
                  <Card key={qc.id} className="bg-slate-900 border-slate-800 relative overflow-hidden flex flex-col justify-between">
                    <CardHeader className="pb-3 flex flex-row justify-between items-start">
                      <div>
                        <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider bg-pink-500/10 text-pink-400 border-pink-500/20">
                          {qc.payment_method}
                        </Badge>
                        <CardTitle className="text-sm font-bold text-white mt-1.5 truncate">{qc.account_name}</CardTitle>
                        <CardDescription className="text-xs text-slate-400 font-mono mt-0.5">{qc.account_number}</CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteQRCode(qc.id)}
                        className="text-slate-500 hover:text-destructive hover:bg-destructive/10 h-7 w-7 rounded-md"
                        title="Delete Channel"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </CardHeader>
                    <CardContent className="py-2 flex items-center justify-center bg-slate-950/40 border-y border-slate-850 h-40">
                      <img 
                        src={qc.qr_code_url} 
                        alt="QR code" 
                        className="max-h-full max-w-full object-contain p-2" 
                        onError={(e) => { e.currentTarget.src = "https://placehold.co/150?text=Scan+To+Pay"; }}
                      />
                    </CardContent>
                    <CardContent className="pt-4 pb-4 flex justify-between items-center bg-slate-900">
                      <span className="text-[10px] text-slate-400 font-semibold">Active in Onboarding?</span>
                      <InlineSwitch
                        checked={qc.is_active}
                        onChange={(checked: boolean) => handleToggleQRCodeActive(qc.id, checked)}
                      />
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}

        {activeSection === 'plans' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b border-slate-900 pb-5">
              <div>
                <h1 className="text-xl font-black tracking-tight text-white uppercase">Subscription Plans CMS</h1>
                <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-1">Configure pricing and limits for customer tiers</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {loading ? (
                <p className="text-slate-500 text-xs font-semibold">Loading subscription plans...</p>
              ) : plans.length === 0 ? (
                <p className="text-slate-500 text-xs col-span-full">No subscription plans found in the database. Please run migrations.</p>
              ) : (
                plans.map(plan => (
                  <Card key={plan.id} className="bg-slate-900 border-slate-800 relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-500 to-indigo-500" />
                    
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider bg-pink-500/10 text-pink-400 border-pink-500/20">
                          {plan.id}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditPlanModal(plan)}
                          className="h-7 px-2.5 text-[10px] font-bold text-pink-400 border-pink-500/20 hover:bg-pink-500/10 rounded-md"
                        >
                          Modify Plan
                        </Button>
                      </div>
                      <CardTitle className="text-base font-black text-white mt-3 uppercase">{plan.name}</CardTitle>
                    </CardHeader>

                    <CardContent className="py-3 border-y border-slate-850 bg-slate-950/40 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Monthly Price</span>
                        <span className="text-sm font-extrabold text-white">{Number(plan.monthly_price).toLocaleString()} PHP</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Yearly Price</span>
                        <span className="text-sm font-extrabold text-pink-400">{Number(plan.yearly_price).toLocaleString()} PHP</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Max Branches</span>
                        <span className="text-xs font-bold text-white">{plan.max_branches}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Max Users</span>
                        <span className="text-xs font-bold text-white">{plan.max_users}</span>
                      </div>
                    </CardContent>

                    <CardContent className="pt-4 pb-4 space-y-2">
                      <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider block">Features Enabled:</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(plan.features || {}).map(([featKey, isEnabled]) => (
                          <div key={featKey} className="flex items-center gap-1">
                            <div className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`} />
                            <span className="text-[9px] text-slate-400 truncate" title={FEATURE_LABELS[featKey] || featKey}>
                              {FEATURE_LABELS[featKey] || featKey}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* DIALOG 1: MANUAL ONBOARD MODAL */}
      <Dialog open={isManualModalOpen} onOpenChange={setIsManualModalOpen}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-slate-800">
            <DialogTitle>Manual Tenant Onboarding</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualOnboardSubmit} className="space-y-4 p-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-450 uppercase tracking-wider">Business Name</Label>
              <Input
                type="text"
                required
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="e.g. Odyssey Coffee"
                className="bg-slate-950 border-slate-800 text-white h-10 rounded-lg focus-visible:ring-pink-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-450 uppercase tracking-wider">Subdomain</Label>
              <div className="relative">
                <Input
                  type="text"
                  required
                  value={manualSubdomain}
                  onChange={(e) => setManualSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="odysseycoffee"
                  className="bg-slate-950 border-slate-800 text-white h-10 rounded-lg focus-visible:ring-pink-500 pr-24"
                />
                <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-semibold">.{import.meta.env.VITE_MAIN_DOMAIN || 'odcph.com'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-455 uppercase tracking-wider">Plan</Label>
                <Select value={manualPlan} onValueChange={(val) => setManualPlan(val as any)}>
                  <SelectTrigger className="bg-slate-950 border-slate-800"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 text-white border-slate-800">
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-455 uppercase tracking-wider">Cycle</Label>
                <Select value={manualCycle} onValueChange={(val) => setManualCycle(val as any)}>
                  <SelectTrigger className="bg-slate-950 border-slate-800"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 text-white border-slate-800">
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5 border-t border-slate-850 pt-3">
              <Label className="text-xs font-bold text-pink-400 uppercase tracking-wider">Admin Email Account</Label>
              <Input
                type="email"
                required
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="admin@odysseycoffee.com"
                className="bg-slate-950 border-slate-800 text-white h-10 rounded-lg focus-visible:ring-pink-500"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-pink-400 uppercase tracking-wider">Admin Password</Label>
              <Input
                type="password"
                required
                value={manualPassword}
                onChange={(e) => setManualPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-slate-950 border-slate-800 text-white h-10 rounded-lg focus-visible:ring-pink-500"
              />
            </div>

            <DialogFooter className="pt-4 border-t border-slate-850">
              <Button type="button" variant="outline" onClick={() => setIsManualModalOpen(false)} className="border-slate-800 text-slate-300">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-pink-500 hover:bg-pink-600 text-white font-bold">
                {submitting ? "Provisioning..." : "Onboard Tenant"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: EDIT TENANT MODAL */}
      <Dialog open={isEditModalOpen} onOpenChange={(open) => { if (!open) { setIsEditModalOpen(false); setEditingTenant(null); } }}>
        <DialogContent className="max-w-lg bg-slate-900 border-slate-800 text-white p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <DialogHeader className="p-6 border-b border-slate-800 shrink-0">
            <DialogTitle>Edit Tenant: {editingTenant?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditTenantSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Business Name</Label>
              <Input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-slate-950 border-slate-800 text-white"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Plan</Label>
                <Select value={editPlan} onValueChange={(val) => setEditPlan(val as any)}>
                  <SelectTrigger className="bg-slate-950 border-slate-800"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 text-white border-slate-800">
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Cycle</Label>
                <Select value={editCycle} onValueChange={(val) => setEditCycle(val as any)}>
                  <SelectTrigger className="bg-slate-950 border-slate-800"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 text-white border-slate-800">
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Status</Label>
                <Select value={editStatus} onValueChange={(val) => setEditStatus(val as any)}>
                  <SelectTrigger className="bg-slate-950 border-slate-800"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 text-white border-slate-800">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-slate-850 pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-pink-400">Max Branches Quota</Label>
                <Input
                  type="number"
                  min={1}
                  required
                  value={editMaxBranches}
                  onChange={(e) => setEditMaxBranches(parseInt(e.target.value) || 1)}
                  className="bg-slate-950 border-slate-800 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-pink-400">Max Users Quota</Label>
                <Input
                  type="number"
                  min={1}
                  required
                  value={editMaxUsers}
                  onChange={(e) => setEditMaxUsers(parseInt(e.target.value) || 1)}
                  className="bg-slate-950 border-slate-800 text-white"
                />
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-850 pt-3">
              <Label className="text-xs font-bold uppercase tracking-wider text-pink-400">Business Model Configuration</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-950/40 p-3 rounded-lg border border-slate-850">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Restaurant F&B</span>
                  <InlineSwitch
                    checked={editIsRestaurant}
                    onChange={setEditIsRestaurant}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Retail Store</span>
                  <InlineSwitch
                    checked={editIsRetail}
                    onChange={setEditIsRetail}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Service Repair</span>
                  <InlineSwitch
                    checked={editIsService}
                    onChange={setEditIsService}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-850 pt-3">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Feature Access Flags (Switch Enable/Disable)</Label>
              <div className="grid grid-cols-2 gap-3 p-4 border border-slate-800 rounded-xl bg-slate-950/40 max-h-48 overflow-y-auto">
                {Object.keys(FEATURE_LABELS).map(key => {
                  const isEnabled = editFeatures[key] !== false; // default true if not configured
                  return (
                    <div key={key} className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-900">
                      <span className="text-[10px] font-medium text-slate-300">{FEATURE_LABELS[key]}</span>
                      <InlineSwitch
                        checked={isEnabled}
                        onChange={(checked: boolean) => setEditFeatures({ ...editFeatures, [key]: checked })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-slate-800 shrink-0">
              <Button type="button" variant="outline" onClick={() => { setIsEditModalOpen(false); setEditingTenant(null); }} className="border-slate-800 text-slate-300">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-pink-500 hover:bg-pink-600 text-white font-bold">
                {submitting ? "Saving..." : "Save Configuration"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: RECEIPT VIEW MODAL */}
      <Dialog open={isReceiptModalOpen} onOpenChange={setIsReceiptModalOpen}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white p-4">
          <DialogHeader>
            <DialogTitle>Proof of Payment Receipt</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center border border-slate-850 bg-slate-950/80 rounded-xl p-2 h-96 overflow-hidden">
            <img 
              src={selectedReceiptUrl} 
              alt="Receipt proof" 
              className="max-h-full max-w-full object-contain" 
              onError={(e) => { e.currentTarget.src = "https://placehold.co/300?text=Receipt+Proof+Unavailable"; }}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => setIsReceiptModalOpen(false)} className="bg-slate-800 hover:bg-slate-700 text-white w-full font-bold">
              Close Viewer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 4: ADD QR CODE CHANNEL MODAL */}
      <Dialog open={isQrModalOpen} onOpenChange={setIsQrModalOpen}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-slate-800">
            <DialogTitle>Add Onboarding Payment QR Code</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddQRCode} className="space-y-4 p-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Payment Channel Method</Label>
              <Select value={qrMethod} onValueChange={setQrMethod}>
                <SelectTrigger className="bg-slate-950 border-slate-800"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-900 text-white border-slate-800">
                  <SelectItem value="GCash">GCash</SelectItem>
                  <SelectItem value="Maya">Maya</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Account Name</Label>
              <Input
                type="text"
                required
                value={qrName}
                onChange={(e) => setQrName(e.target.value)}
                placeholder="e.g. Odyssey Inc."
                className="bg-slate-950 border-slate-800"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Account Number</Label>
              <Input
                type="text"
                required
                value={qrNumber}
                onChange={(e) => setQrNumber(e.target.value)}
                placeholder="e.g. 0917-XXX-XXXX or Bank account"
                className="bg-slate-950 border-slate-800"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">QR Code Image</Label>
              <div className="relative h-20 border border-dashed border-slate-800 rounded-lg hover:border-pink-500/50 hover:bg-pink-500/5 transition-all flex flex-col items-center justify-center cursor-pointer group">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleQRUpload} 
                  required
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                />
                <UploadIcon className="w-4 h-4 text-slate-500 group-hover:text-pink-400 transition-colors" />
                <span className="text-[10px] text-slate-400 mt-1.5 font-medium">
                  {qrFileName || "Upload QR screenshot (PNG, JPG)"}
                </span>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-slate-850">
              <Button type="button" variant="outline" onClick={() => setIsQrModalOpen(false)} className="border-slate-800 text-slate-300">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-pink-500 hover:bg-pink-600 text-white font-bold">
                {submitting ? "Saving..." : "Add Payment Channel"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 5: EDIT SUBSCRIPTION PLAN MODAL */}
      <Dialog open={isPlanModalOpen} onOpenChange={setIsPlanModalOpen}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-800 text-white p-0 overflow-hidden flex flex-col max-h-[85vh]">
          <DialogHeader className="p-6 border-b border-slate-800 shrink-0">
            <DialogTitle>Edit Plan: {editPlanName}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditPlanSubmit} className="flex-1 overflow-y-auto space-y-4 p-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Monthly Price (PHP)</Label>
              <Input
                type="number"
                required
                min={0}
                value={editPlanMonthlyPrice}
                onChange={(e) => setEditPlanMonthlyPrice(Number(e.target.value))}
                className="bg-slate-950 border-slate-800"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Yearly Price (PHP)</Label>
              <Input
                type="number"
                required
                min={0}
                value={editPlanYearlyPrice}
                onChange={(e) => setEditPlanYearlyPrice(Number(e.target.value))}
                className="bg-slate-950 border-slate-800"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Max Branches</Label>
                <Input
                  type="number"
                  required
                  min={1}
                  value={editPlanMaxBranches}
                  onChange={(e) => setEditPlanMaxBranches(Number(e.target.value))}
                  className="bg-slate-950 border-slate-800"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Max Users</Label>
                <Input
                  type="number"
                  required
                  min={1}
                  value={editPlanMaxUsers}
                  onChange={(e) => setEditPlanMaxUsers(Number(e.target.value))}
                  className="bg-slate-950 border-slate-800"
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-850 pt-4">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Feature Permissions</Label>
              <div className="grid grid-cols-1 gap-2.5 max-h-48 overflow-y-auto pr-1">
                {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                  const isEnabled = !!editPlanFeatures[key];
                  return (
                    <div key={key} className="flex justify-between items-center bg-slate-950/40 p-2 rounded-lg border border-slate-850">
                      <span className="text-xs text-slate-350">{label}</span>
                      <InlineSwitch
                        checked={isEnabled}
                        onChange={(checked: boolean) => setEditPlanFeatures({ ...editPlanFeatures, [key]: checked })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-slate-850 shrink-0">
              <Button type="button" variant="outline" onClick={() => { setIsPlanModalOpen(false); setEditingPlan(null); }} className="border-slate-800 text-slate-300">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-pink-500 hover:bg-pink-600 text-white font-bold">
                {submitting ? "Saving Plan..." : "Save Plan Configurations"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
