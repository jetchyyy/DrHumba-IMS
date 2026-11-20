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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
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
        checked ? 'bg-[#152839]' : 'bg-[#5F6A7C]/50'
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
  plan_type: 'free' | 'starter' | 'professional' | 'enterprise';
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
  plan_type: 'free' | 'starter' | 'professional' | 'enterprise';
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

interface AddOnRecord {
  id: string;
  name: string;
  description: string;
  monthly_price: number;
  unit_label: string;
  is_active: boolean;
  sort_order: number;
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
  const [addOns, setAddOns] = useState<AddOnRecord[]>([]);
  const [savingAddOnId, setSavingAddOnId] = useState<string | null>(null);

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
  
  // Tenant Delete & Export States
  const [deletingTenant, setDeletingTenant] = useState<TenantRecord | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  
  // Tenant Reset States
  const [resettingTenant, setResettingTenant] = useState<TenantRecord | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [editPlan, setEditPlan] = useState<'free' | 'starter' | 'professional' | 'enterprise'>('starter');
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
    queue_caller: 'Queue Caller Display',
    sales_history: 'Sales History Log',
    z_read_history: 'Z-Read Compliance Reports',
    expenses: 'Expense Tracker',
    service_charge_tracker: 'Service Charge Tracker',
    inventory: 'Inventory Catalog',
    global_inventory: 'Global Stock Ledger',
    receiving: 'Receiving Sheets',
    transfers: 'Store Transfers',
    adjustments: 'Stock Adjustments',
    portioning: 'Portioning & Yield Conversions',
    transactions: 'Stock Ledgers',
    kitchen_receipts: 'Kitchen Orders Queue',
    recipes: 'Menu Recipes & Deductions',
    branches: 'Branch Management',
    table_management: 'Table Management & Dining',
    shift_management: 'Shift Control (Morning/Mid/Night)',
    analytics: 'Analytics Charts',
    audit_logs: 'System Audit Logs',
    users: 'Staff Management Tab',
    settings: 'Settings Panels'
  };

  // The console uses the ODYSSEY light theme; dialogs render in a portal, so set it on <html>.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    root.classList.add('light');
    root.classList.remove('dark');
    return () => {
      root.classList.remove('light');
      if (hadDark) root.classList.add('dark');
    };
  }, []);

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

      // Fetch Add-ons
      const { data: addOnData } = await supabase.from('subscription_addons').select('*').order('sort_order', { ascending: true });
      setAddOns((addOnData as AddOnRecord[]) || []);
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

  const toggleTenantFeatureFlag = async (
    tenantItem: TenantRecord,
    featureKey: string,
    label: string,
    currentVal: boolean
  ) => {
    const nextVal = !currentVal;
    const updatedFeatures = {
      ...(tenantItem.features || {}),
      [featureKey]: nextVal,
    };

    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          features: updatedFeatures,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantItem.id);

      if (error) throw error;
      showSuccess(`${label} ${nextVal ? 'enabled' : 'disabled'} for "${tenantItem.name}".`);
      setTenants(prev => prev.map(t => t.id === tenantItem.id ? { ...t, features: updatedFeatures } : t));
    } catch (err: any) {
      console.error(`Failed to toggle ${label} for tenant:`, err);
      showError(err.message || `Failed to toggle ${label}.`);
    }
  };

  // 3a. Quick Toggle Table Management for Tenant
  const handleToggleTenantTableService = (tenantItem: TenantRecord) =>
    toggleTenantFeatureFlag(tenantItem, 'table_management', 'Table Management', Boolean(tenantItem.features?.table_management));

  // 3a.1 Quick Toggle Shift Management for Tenant
  const handleToggleTenantShiftManagement = (tenantItem: TenantRecord) =>
    toggleTenantFeatureFlag(tenantItem, 'shift_management', 'Shift Control', Boolean(tenantItem.features?.shift_management));

  // 3a.2 Quick Toggle Service Charge Tracker for Tenant (enabled by default unless explicitly false)
  const handleToggleTenantServiceCharge = (tenantItem: TenantRecord) =>
    toggleTenantFeatureFlag(tenantItem, 'service_charge_tracker', 'Service Charge Tracker', tenantItem.features?.service_charge_tracker !== false);

  // 3b. Export Tenant Data
  const handleExportTenant = async (tenant: TenantRecord) => {
    try {
      showSuccess(`Exporting all data for ${tenant.name}. Please wait...`);
      const tenantId = tenant.id;
      
      const tables = [
        'tenants', 'branches', 'profiles', 'inventory_items', 'inventory_balances',
        'inventory_movements', 'menu_items', 'recipes', 'recipe_ingredients',
        'stock_receipts', 'stock_receipt_items', 'transfer_requests', 'transfer_items',
        'stock_adjustments', 'stock_adjustment_items', 'sales', 'sale_items',
        'expenses', 'notifications', 'control_number_sequences', 'system_settings',
        'terminal_counters', 'cashier_sessions'
      ];
      
      const exportData: Record<string, any> = {};
      
      for (const table of tables) {
        let query = supabase.from(table).select('*');
        if (table === 'tenants') {
          query = query.eq('id', tenantId);
        } else {
          query = query.eq('tenant_id', tenantId);
        }
        
        const { data, error } = await query;
        if (error) {
          console.warn(`Could not export table ${table}:`, error);
          exportData[table] = [];
        } else {
          exportData[table] = data || [];
        }
      }
      
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(exportData, null, 2)
      )}`;
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonString);
      const safeName = tenant.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const dateStr = new Date().toISOString().split('T')[0];
      downloadAnchor.setAttribute('download', `tenant_export_${safeName}_${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      
      showSuccess(`Successfully exported all data for ${tenant.name}.`);
    } catch (err: any) {
      console.error('Export failed:', err);
      showError(err.message || 'Failed to export tenant data.');
    }
  };

  // 3c. Delete Tenant Data
  const handleDeleteTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletingTenant) return;
    
    const expectedConfirmText = deletingTenant.subdomain || deletingTenant.name || '';
    if (deleteConfirmText.trim().toLowerCase() !== expectedConfirmText.toLowerCase()) {
      showError('Confirmation input does not match. Aborting deletion.');
      return;
    }
    
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_delete_tenant_data', { p_tenant_id: deletingTenant.id });
      if (error) throw error;
      
      showSuccess(`Successfully deleted all data and configuration for ${deletingTenant.name}.`);
      setIsDeleteModalOpen(false);
      setDeletingTenant(null);
      setDeleteConfirmText('');
      await loadAllData();
    } catch (err: any) {
      console.error('Deletion failed:', err);
      showError(err.message || 'Failed to delete tenant data.');
    } finally {
      setSubmitting(false);
    }
  };

  // 3d. Reset Tenant Transactional Data
  const handleResetTenantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resettingTenant) return;
    
    const expectedConfirmText = resettingTenant.subdomain || resettingTenant.name || '';
    if (resetConfirmText.trim().toLowerCase() !== expectedConfirmText.toLowerCase()) {
      showError('Confirmation input does not match. Aborting reset.');
      return;
    }
    
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('fn_reset_tenant_data', { p_tenant_id: resettingTenant.id });
      if (error) throw error;
      
      showSuccess(`Successfully cleared all transactional data for "${resettingTenant.name}". Accounts and branches have been preserved.`);
      setIsResetModalOpen(false);
      setResettingTenant(null);
      setResetConfirmText('');
      await loadAllData();
    } catch (err: any) {
      console.error('Reset failed:', err);
      showError(err.message || 'Failed to reset tenant data.');
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

  const updateAddOnDraft = (id: string, patch: Partial<AddOnRecord>) => {
    setAddOns(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
  };

  const handleSaveAddOn = async (addOn: AddOnRecord) => {
    if (!addOn.name.trim() || !(addOn.monthly_price >= 0)) {
      showError('Add-on needs a name and a price of 0 or more.');
      return;
    }
    setSavingAddOnId(addOn.id);
    try {
      const { error } = await supabase
        .from('subscription_addons')
        .update({
          name: addOn.name.trim(),
          description: addOn.description.trim(),
          monthly_price: addOn.monthly_price,
          unit_label: addOn.unit_label.trim(),
          is_active: addOn.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', addOn.id);
      if (error) throw error;
      showSuccess(`Add-on "${addOn.name}" saved.`);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to save add-on.');
    } finally {
      setSavingAddOnId(null);
    }
  };

  const pendingCount = applications.filter(a => a.status === 'pending').length;
  const navItems: { id: typeof activeSection; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: OverviewIcon },
    { id: 'tenants', label: 'Tenants', icon: TenantsIcon },
    { id: 'applications', label: 'Applications', icon: ApplicationsIcon },
    { id: 'qrcodes', label: 'Payment QR codes', icon: SettingsIcon },
    { id: 'plans', label: 'Subscription plans', icon: OverviewIcon },
  ];

  return (
    <div className="font-odyssey min-h-screen bg-[#F9F8F3] text-[#152839] antialiased flex flex-col md:flex-row selection:bg-[#FF6F07]/25">
      {/* ODYSSEY Console sidebar */}
      <aside className="w-full md:w-64 md:min-h-screen bg-[#152839] text-[#F9F8F3] shrink-0 p-5 md:p-6 flex flex-col gap-6 md:gap-8 justify-between md:sticky md:top-0 md:h-screen">
        <div className="space-y-6 md:space-y-8">
          <div className="space-y-2">
            <img src="/odyssey/logo-horizontal-reverse.svg" alt="ODYSSEY" className="h-7 w-auto" />
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#DCE1E8]">
              <span aria-hidden="true" className="w-4 h-[2px] bg-[#FF6F07]" /> Console
            </p>
          </div>

          <nav aria-label="Console sections" className="flex md:flex-col gap-1 overflow-x-auto -mx-1 px-1 md:mx-0 md:px-0">
            {navItems.map(({ id, label, icon: Icon }) => {
              const active = activeSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveSection(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`relative shrink-0 flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07] ${
                    active ? 'bg-[#F9F8F3]/10 text-[#F9F8F3]' : 'text-[#DCE1E8] hover:text-[#F9F8F3] hover:bg-[#F9F8F3]/5'
                  }`}
                >
                  {active && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[#FF6F07]" />}
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">{label}</span>
                  {id === 'applications' && pendingCount > 0 && (
                    <span className="min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-[#FF6F07] text-[#152839] text-[11px] font-semibold" aria-label={`${pendingCount} pending`}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-4 pt-4 border-t border-[#5F6A7C]/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#F9F8F3] text-[#152839] flex items-center justify-center font-semibold text-xs shrink-0">
              {(profile?.email || 'AD').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{profile?.email}</p>
              <p className="text-[11px] text-[#DCE1E8]">Platform admin</p>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full h-9 inline-flex items-center justify-center gap-2 rounded-lg border border-[#5F6A7C] text-sm font-medium text-[#DCE1E8] hover:text-[#F9F8F3] hover:border-[#F9F8F3] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6F07]"
          >
            <LogOutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 md:p-10">
        {/* SECTION 1: OVERVIEW STATISTICS */}
        {activeSection === 'overview' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-3xl font-odyssey-display font-bold tracking-tight">Platform overview</h2>
              <p className="text-[#45546A] text-xs mt-1">Global statistics, subscription yields, and registry status of your tenant businesses.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-white border-[#DCE1E8] text-[#152839] shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-[#5F6A7C] font-bold">Active Store Tenants</CardDescription>
                  <CardTitle className="text-3xl font-odyssey-display font-bold mt-1">
                    {tenants.filter(t => t.status === 'active' && t.subdomain !== null).length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-[#45546A]">Excludes system tenant accounts.</p>
                </CardContent>
              </Card>

              <Card className="bg-white border-[#DCE1E8] text-[#152839] shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-[#5F6A7C] font-bold">Pending Applications</CardDescription>
                  <CardTitle className="text-3xl font-odyssey-display font-bold text-[#B8470A] mt-1">
                    {applications.filter(a => a.status === 'pending').length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-[#45546A]">Awaiting payment verification.</p>
                </CardContent>
              </Card>

              <Card className="bg-white border-[#DCE1E8] text-[#152839] shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-[#5F6A7C] font-bold">Approx. Monthly MRR</CardDescription>
                  <CardTitle className="text-3xl font-odyssey-display font-bold text-emerald-700 mt-1">
                    {tenants
                      .filter(t => t.status === 'active' && t.subdomain !== null)
                      .reduce((sum, t) => {
                        const price = t.plan_type === 'free' ? 0 : t.plan_type === 'starter' ? 999 : t.plan_type === 'professional' ? 2499 : 7499;
                        return sum + (t.billing_cycle === 'monthly' ? price : price / 12);
                      }, 0)
                      .toLocaleString(undefined, { maximumFractionDigits: 0 })} PHP
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-[#45546A]">Based on dynamic cycle valuations.</p>
                </CardContent>
              </Card>

              <Card className="bg-white border-[#DCE1E8] text-[#152839] shadow-sm">
                <CardHeader className="pb-2">
                  <CardDescription className="text-[10px] uppercase tracking-wider text-[#5F6A7C] font-bold">Suspended Accounts</CardDescription>
                  <CardTitle className="text-3xl font-odyssey-display font-bold mt-1">
                    {tenants.filter(t => t.status === 'suspended').length}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[10px] text-[#45546A]">Portals blocked from logging in.</p>
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
                <h2 className="text-2xl font-odyssey-display font-bold tracking-tight">Active Tenant Organizations</h2>
                <p className="text-[#45546A] text-xs mt-1">Manage active plan scopes, edit branch/user limits, or suspend portal instances.</p>
              </div>

              <Button 
                onClick={() => setIsManualModalOpen(true)}
                className="bg-[#152839] hover:bg-[#1f3a52] text-[#F9F8F3] font-bold text-xs h-10 px-4 rounded-xl flex items-center gap-1.5 self-start sm:self-auto"
              >
                <PlusIcon className="w-4 h-4" />
                Manual Onboard Tenant
              </Button>
            </div>

            <Card className="bg-white border-[#DCE1E8]">
              <Table>
                <TableHeader>
                  <TableRow className="border-[#DCE1E8] hover:bg-[#F9F8F3]">
                    <TableHead className="text-[#45546A]">Tenant Name</TableHead>
                    <TableHead className="text-[#45546A]">Subdomain</TableHead>
                    <TableHead className="text-[#45546A]">Business Model</TableHead>
                    <TableHead className="text-[#45546A]">Plan & Billing</TableHead>
                    <TableHead className="text-[#45546A] text-center">Quotas (Branches/Users)</TableHead>
                    <TableHead className="text-[#45546A] text-center">Table Service</TableHead>
                    <TableHead className="text-[#45546A] text-center">Shift Control</TableHead>
                    <TableHead className="text-[#45546A] text-center">Service Charge</TableHead>
                    <TableHead className="text-[#45546A] text-center">Status</TableHead>
                    <TableHead className="text-[#45546A] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-[#5F6A7C] py-12">Loading tenant registries...</TableCell>
                    </TableRow>
                  ) : tenants.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-[#5F6A7C] py-12">No tenants found.</TableCell>
                    </TableRow>
                  ) : (
                    tenants.map(t => (
                      <TableRow key={t.id} className="border-[#DCE1E8] hover:bg-[#F9F8F3]">
                        <TableCell className="font-bold text-[#152839] py-4">{t.name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {t.subdomain ? (
                            <a 
                              href={getTenantPortalUrl(t.subdomain)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[#B8470A] hover:text-[#B8470A] underline inline-flex items-center gap-1.5"
                            >
                              {t.subdomain}.{import.meta.env.VITE_MAIN_DOMAIN || 'odcph.com'}
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ) : (
                            <span className="text-[#5F6A7C]">Primary (Internal)</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[150px]">
                            {t.is_restaurant && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-emerald-500/20 text-emerald-700 bg-emerald-500/5">
                                Food F&B
                              </Badge>
                            )}
                            {t.is_retail && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-blue-500/20 text-blue-700 bg-blue-500/5">
                                Retail
                              </Badge>
                            )}
                            {t.is_service && (
                              <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-purple-500/20 text-purple-700 bg-purple-500/5">
                                Service
                              </Badge>
                            )}
                            {!t.is_restaurant && !t.is_retail && !t.is_service && (
                              <span className="text-[10px] text-[#5F6A7C]">None</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="outline" className="w-fit text-[9px] uppercase tracking-wider border-[#FF6F07]/50 text-[#B8470A] bg-[#FF6F07]/10">
                              {t.plan_type}
                            </Badge>
                            <span className="text-[10px] text-[#5F6A7C] capitalize">{t.billing_cycle}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-xs font-semibold">
                          {t.max_branches} Locations / {t.max_users} staff
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleTenantTableService(t)}
                            title={`Click to ${t.features?.table_management ? 'disable' : 'enable'} Table Service for ${t.name}`}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                              t.features?.table_management
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/20'
                                : 'bg-white border-[#DCE1E8] text-[#5F6A7C] hover:text-[#152839] hover:border-[#DCE1E8]'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${t.features?.table_management ? 'bg-emerald-400' : 'bg-[#5F6A7C]'}`} />
                            {t.features?.table_management ? 'Enabled' : 'Disabled'}
                          </button>
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleTenantShiftManagement(t)}
                            title={`Click to ${t.features?.shift_management ? 'disable' : 'enable'} Shift Control for ${t.name}`}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                              t.features?.shift_management
                                ? 'bg-[#152839]/5 border-[#152839]/30 text-[#152839] hover:bg-[#152839]/10'
                                : 'bg-white border-[#DCE1E8] text-[#5F6A7C] hover:text-[#152839] hover:border-[#DCE1E8]'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${t.features?.shift_management ? 'bg-[#FF6F07]' : 'bg-[#5F6A7C]'}`} />
                            {t.features?.shift_management ? 'Enabled' : 'Disabled'}
                          </button>
                        </TableCell>
                        <TableCell className="text-center">
                          {(() => {
                            const isServiceChargeEnabled = t.features?.service_charge_tracker !== false;
                            return (
                              <button
                                type="button"
                                onClick={() => handleToggleTenantServiceCharge(t)}
                                title={`Click to ${isServiceChargeEnabled ? 'disable' : 'enable'} Service Charge Tracker for ${t.name}`}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                                  isServiceChargeEnabled
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/20'
                                    : 'bg-white border-[#DCE1E8] text-[#5F6A7C] hover:text-[#152839] hover:border-[#DCE1E8]'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${isServiceChargeEnabled ? 'bg-emerald-400' : 'bg-[#5F6A7C]'}`} />
                                {isServiceChargeEnabled ? 'Enabled' : 'Disabled'}
                              </button>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={t.status === 'suspended' ? "destructive" : "default"} className="uppercase text-[9px] tracking-wider">
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={async () => {
                                if (!profile?.id) return;
                                const { error } = await supabase
                                  .from('profiles')
                                  .update({ tenant_id: t.id })
                                  .eq('id', profile.id);
                                if (!error) {
                                  const targetUrl = t.subdomain ? getTenantPortalUrl(t.subdomain) : window.location.origin;
                                  window.location.href = targetUrl;
                                } else {
                                  showError('Failed to switch tenant: ' + error.message);
                                }
                              }}
                              className="text-[10px] font-bold text-sky-400 hover:text-[#152839] hover:bg-sky-500/10 rounded-lg h-7 px-2"
                            >
                              Enter Tenant
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => openEditTenantModal(t)}
                              className="text-[10px] font-bold text-[#B8470A] hover:text-[#152839] hover:bg-[#FF6F07]/10 rounded-lg h-7 px-2"
                            >
                              Edit Config
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleExportTenant(t)}
                              className="text-xs font-bold text-emerald-700 hover:text-[#152839] hover:bg-emerald-500/10 rounded-lg p-1.5 h-7"
                              title="Export Tenant Data"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => {
                                setResettingTenant(t);
                                setResetConfirmText('');
                                setIsResetModalOpen(true);
                              }}
                              className="text-xs font-bold text-amber-700 hover:text-[#152839] hover:bg-amber-500/10 rounded-lg p-1.5 h-7"
                              title="Reset Transactional Data"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                              </svg>
                            </Button>
                            {t.id !== '00000000-0000-0000-0000-000000000000' && (
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => {
                                  setDeletingTenant(t);
                                  setDeleteConfirmText('');
                                  setIsDeleteModalOpen(true);
                                }}
                                className="text-xs font-bold text-red-700 hover:text-[#152839] hover:bg-red-500/10 rounded-lg p-1.5 h-7"
                                title="Delete Tenant Data"
                              >
                                <TrashIcon className="w-3.5 h-3.5 text-red-700 hover:text-red-800" />
                              </Button>
                            )}
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

        {/* SECTION 3: APPLICATIONS QUEUE */}
        {activeSection === 'applications' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-odyssey-display font-bold tracking-tight">Pending Onboarding Applications</h2>
              <p className="text-[#45546A] text-xs mt-1">Review self-registered tenant application details, verify GCash/Maya reference codes, and approve store portals.</p>
            </div>

            <Card className="bg-white border-[#DCE1E8]">
              <Table>
                <TableHeader>
                  <TableRow className="border-[#DCE1E8] hover:bg-[#F9F8F3]">
                    <TableHead className="text-[#45546A]">Business Name</TableHead>
                    <TableHead className="text-[#45546A]">Subdomain</TableHead>
                    <TableHead className="text-[#45546A]">Business Model</TableHead>
                    <TableHead className="text-[#45546A]">Plan Option</TableHead>
                    <TableHead className="text-[#45546A]">Contact Email</TableHead>
                    <TableHead className="text-[#45546A] text-center">Ref (Last 5)</TableHead>
                    <TableHead className="text-[#45546A] text-center">Receipt</TableHead>
                    <TableHead className="text-[#45546A] text-right">Approve / Reject</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-[#5F6A7C] py-12">Loading applications...</TableCell>
                    </TableRow>
                  ) : applications.filter(a => a.status === 'pending').length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-[#5F6A7C] py-12">No pending applications in queue.</TableCell>
                    </TableRow>
                  ) : (
                    applications
                      .filter(a => a.status === 'pending')
                      .map(app => (
                        <TableRow key={app.id} className="border-[#DCE1E8] hover:bg-[#F9F8F3]">
                          <TableCell className="font-bold text-[#152839] py-4">{app.business_name}</TableCell>
                          <TableCell className="font-mono text-xs">
                            <a 
                              href={getTenantPortalUrl(app.subdomain)} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-[#B8470A] hover:text-[#B8470A] underline inline-flex items-center gap-1.5"
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
                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-emerald-500/20 text-emerald-700 bg-emerald-500/5">
                                  Food F&B
                                </Badge>
                              )}
                              {app.is_retail && (
                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-blue-500/20 text-blue-700 bg-blue-500/5">
                                  Retail
                                </Badge>
                              )}
                              {app.is_service && (
                                <Badge variant="outline" className="text-[9px] uppercase tracking-wider border-purple-500/20 text-purple-700 bg-purple-500/5">
                                  Service
                                </Badge>
                              )}
                              {!app.is_restaurant && !app.is_retail && !app.is_service && (
                                <span className="text-[10px] text-[#5F6A7C]">None</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="capitalize text-xs font-semibold">
                            {app.plan_type} ({app.billing_cycle})
                          </TableCell>
                          <TableCell className="text-xs text-[#45546A]">{app.admin_email}</TableCell>
                          <TableCell className="text-center font-mono font-bold text-[#B8470A] text-sm">
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
                              className="h-8 w-8 text-[#45546A] hover:text-[#152839] hover:bg-[#F9F8F3]"
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
                                className="bg-emerald-600 hover:bg-emerald-700 text-[#F9F8F3] font-bold text-xs h-8 px-2.5 rounded-lg flex items-center gap-1"
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
                <h2 className="text-2xl font-odyssey-display font-bold tracking-tight">Onboarding Payment Methods CMS</h2>
                <p className="text-[#45546A] text-xs mt-1">Configure active payment QR codes and instruction accounts displayed during application.</p>
              </div>

              <Button 
                onClick={() => setIsQrModalOpen(true)}
                className="bg-[#152839] hover:bg-[#1f3a52] text-[#F9F8F3] font-bold text-xs h-10 px-4 rounded-xl flex items-center gap-1.5 self-start sm:self-auto"
              >
                <PlusIcon className="w-4 h-4" />
                Add Payment Channel
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {loading ? (
                <p className="text-[#5F6A7C] text-xs">Loading payment methods...</p>
              ) : qrCodes.length === 0 ? (
                <p className="text-[#5F6A7C] text-xs col-span-full">No payment methods configured. Click Add to create one.</p>
              ) : (
                qrCodes.map(qc => (
                  <Card key={qc.id} className="bg-white border-[#DCE1E8] relative overflow-hidden flex flex-col justify-between">
                    <CardHeader className="pb-3 flex flex-row justify-between items-start">
                      <div>
                        <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider bg-[#FF6F07]/10 text-[#B8470A] border-[#FF6F07]/50">
                          {qc.payment_method}
                        </Badge>
                        <CardTitle className="text-sm font-bold text-[#152839] mt-1.5 truncate">{qc.account_name}</CardTitle>
                        <CardDescription className="text-xs text-[#45546A] font-mono mt-0.5">{qc.account_number}</CardDescription>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteQRCode(qc.id)}
                        className="text-[#5F6A7C] hover:text-destructive hover:bg-destructive/10 h-7 w-7 rounded-md"
                        title="Delete Channel"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </CardHeader>
                    <CardContent className="py-2 flex items-center justify-center bg-[#F9F8F3] border-y border-[#DCE1E8] h-40">
                      <img 
                        src={qc.qr_code_url} 
                        alt="QR code" 
                        className="max-h-full max-w-full object-contain p-2" 
                        onError={(e) => { e.currentTarget.src = "https://placehold.co/150?text=Scan+To+Pay"; }}
                      />
                    </CardContent>
                    <CardContent className="pt-4 pb-4 flex justify-between items-center bg-white">
                      <span className="text-[10px] text-[#45546A] font-semibold">Active in Onboarding?</span>
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
            <div className="flex justify-between items-center border-b border-[#DCE1E8] pb-5">
              <div>
                <h1 className="text-xl font-odyssey-display font-bold tracking-tight text-[#152839] uppercase">Subscription Plans CMS</h1>
                <p className="text-[10px] text-[#5F6A7C] font-semibold uppercase tracking-wider mt-1">Configure pricing and limits for customer tiers</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {loading ? (
                <p className="text-[#5F6A7C] text-xs font-semibold">Loading subscription plans...</p>
              ) : plans.length === 0 ? (
                <p className="text-[#5F6A7C] text-xs col-span-full">No subscription plans found in the database. Please run migrations.</p>
              ) : (
                plans.map(plan => (
                  <Card key={plan.id} className="bg-white border-[#DCE1E8] relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute top-0 left-0 w-full h-1 bg-[#152839]" />
                    
                    <CardHeader className="pb-3">
                      <div className="flex justify-between items-start">
                        <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider bg-[#FF6F07]/10 text-[#B8470A] border-[#FF6F07]/50">
                          {plan.id}
                        </Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditPlanModal(plan)}
                          className="h-7 px-2.5 text-[10px] font-bold text-[#B8470A] border-[#FF6F07]/50 hover:bg-[#FF6F07]/10 rounded-md"
                        >
                          Modify Plan
                        </Button>
                      </div>
                      <CardTitle className="text-base font-odyssey-display font-bold text-[#152839] mt-3 uppercase">{plan.name}</CardTitle>
                    </CardHeader>

                    <CardContent className="py-3 border-y border-[#DCE1E8] bg-[#F9F8F3] space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-[#5F6A7C] uppercase font-semibold">Monthly Price</span>
                        <span className="text-sm font-extrabold text-[#152839]">{Number(plan.monthly_price).toLocaleString()} PHP</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-[#5F6A7C] uppercase font-semibold">Yearly Price</span>
                        <span className="text-sm font-extrabold text-[#B8470A]">{Number(plan.yearly_price).toLocaleString()} PHP</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-[#5F6A7C] uppercase font-semibold">Max Branches</span>
                        <span className="text-xs font-bold text-[#152839]">{plan.max_branches}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-[#5F6A7C] uppercase font-semibold">Max Users</span>
                        <span className="text-xs font-bold text-[#152839]">{plan.max_users}</span>
                      </div>
                    </CardContent>

                    <CardContent className="pt-4 pb-4 space-y-2">
                      <span className="text-[9px] text-[#5F6A7C] uppercase font-bold tracking-wider block">Features Enabled:</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(plan.features || {}).map(([featKey, isEnabled]) => (
                          <div key={featKey} className="flex items-center gap-1">
                            <div className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-emerald-500' : 'bg-[#DCE1E8]'}`} />
                            <span className="text-[9px] text-[#45546A] truncate" title={FEATURE_LABELS[featKey] || featKey}>
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

            {/* Add-ons CMS */}
            <div className="border-t border-[#DCE1E8] pt-6 space-y-4">
              <div>
                <h2 className="text-base font-odyssey-display font-bold tracking-tight text-[#152839] uppercase">Add-ons</h2>
                <p className="text-[10px] text-[#5F6A7C] font-semibold uppercase tracking-wider mt-1">Extra branches and staff sold on top of a plan. Shown on the landing page when active.</p>
              </div>
              {addOns.length === 0 ? (
                <p className="text-[#5F6A7C] text-xs">No add-ons found. Run the subscription_addons migration.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {addOns.map(addOn => (
                    <Card key={addOn.id} className="bg-white border-[#DCE1E8]">
                      <CardContent className="p-5 space-y-3">
                        <div className="flex justify-between items-center">
                          <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider bg-[#FF6F07]/10 text-[#B8470A] border-[#FF6F07]/50">
                            {addOn.id}
                          </Badge>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[#5F6A7C] uppercase font-semibold">Show on landing page</span>
                            <InlineSwitch checked={addOn.is_active} onChange={(checked: boolean) => updateAddOnDraft(addOn.id, { is_active: checked })} />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Name</Label>
                          <Input value={addOn.name} onChange={(e) => updateAddOnDraft(addOn.id, { name: e.target.value })} className="bg-white border-[#DCE1E8]" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Description</Label>
                          <Input value={addOn.description} onChange={(e) => updateAddOnDraft(addOn.id, { description: e.target.value })} className="bg-white border-[#DCE1E8]" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Monthly Price (PHP)</Label>
                            <Input type="number" min={0} value={addOn.monthly_price} onChange={(e) => updateAddOnDraft(addOn.id, { monthly_price: Number(e.target.value) })} className="bg-white border-[#DCE1E8]" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Unit Label</Label>
                            <Input value={addOn.unit_label} onChange={(e) => updateAddOnDraft(addOn.id, { unit_label: e.target.value })} className="bg-white border-[#DCE1E8]" />
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button onClick={() => handleSaveAddOn(addOn)} disabled={savingAddOnId === addOn.id} className="bg-[#152839] hover:bg-[#1f3a52] text-[#F9F8F3] font-bold h-9">
                            {savingAddOnId === addOn.id ? 'Saving...' : 'Save Add-on'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* DIALOG 1: MANUAL ONBOARD MODAL */}
      <Dialog open={isManualModalOpen} onOpenChange={setIsManualModalOpen}>
        <DialogContent className="max-w-md bg-white border-[#DCE1E8] text-[#152839] p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-[#DCE1E8]">
            <DialogTitle>Manual Tenant Onboarding</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleManualOnboardSubmit} className="space-y-4 p-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-[#45546A] uppercase tracking-wider">Business Name</Label>
              <Input
                type="text"
                required
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="e.g. Odyssey Coffee"
                className="bg-white border-[#DCE1E8] text-[#152839] h-10 rounded-lg focus-visible:ring-[#FF6F07]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-[#45546A] uppercase tracking-wider">Subdomain</Label>
              <div className="relative">
                <Input
                  type="text"
                  required
                  value={manualSubdomain}
                  onChange={(e) => setManualSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="odysseycoffee"
                  className="bg-white border-[#DCE1E8] text-[#152839] h-10 rounded-lg focus-visible:ring-[#FF6F07] pr-24"
                />
                <span className="absolute right-3 top-2.5 text-xs text-[#5F6A7C] font-semibold">.{import.meta.env.VITE_MAIN_DOMAIN || 'odcph.com'}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[#45546A] uppercase tracking-wider">Plan</Label>
                <Select value={manualPlan} onValueChange={(val) => setManualPlan(val as any)}>
                  <SelectTrigger className="bg-white border-[#DCE1E8]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-[#152839] border-[#DCE1E8]">
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[#45546A] uppercase tracking-wider">Cycle</Label>
                <Select value={manualCycle} onValueChange={(val) => setManualCycle(val as any)}>
                  <SelectTrigger className="bg-white border-[#DCE1E8]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-[#152839] border-[#DCE1E8]">
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5 border-t border-[#DCE1E8] pt-3">
              <Label className="text-xs font-bold text-[#B8470A] uppercase tracking-wider">Admin Email Account</Label>
              <Input
                type="email"
                required
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="admin@odysseycoffee.com"
                className="bg-white border-[#DCE1E8] text-[#152839] h-10 rounded-lg focus-visible:ring-[#FF6F07]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-[#B8470A] uppercase tracking-wider">Admin Password</Label>
              <Input
                type="password"
                required
                value={manualPassword}
                onChange={(e) => setManualPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-white border-[#DCE1E8] text-[#152839] h-10 rounded-lg focus-visible:ring-[#FF6F07]"
              />
            </div>

            <DialogFooter className="pt-4 border-t border-[#DCE1E8]">
              <Button type="button" variant="outline" onClick={() => setIsManualModalOpen(false)} className="border-[#DCE1E8] text-[#152839]">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-[#152839] hover:bg-[#1f3a52] text-[#F9F8F3] font-bold">
                {submitting ? "Provisioning..." : "Onboard Tenant"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: EDIT TENANT MODAL */}
      <Dialog open={isEditModalOpen} onOpenChange={(open) => { if (!open) { setIsEditModalOpen(false); setEditingTenant(null); } }}>
        <DialogContent className="max-w-lg bg-white border-[#DCE1E8] text-[#152839] p-0 overflow-hidden max-h-[90vh] flex flex-col">
          <DialogHeader className="p-6 border-b border-[#DCE1E8] shrink-0">
            <DialogTitle>Edit Tenant: {editingTenant?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditTenantSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Business Name</Label>
              <Input
                type="text"
                required
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-white border-[#DCE1E8] text-[#152839]"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Plan</Label>
                <Select value={editPlan} onValueChange={(val) => setEditPlan(val as any)}>
                  <SelectTrigger className="bg-white border-[#DCE1E8]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-[#152839] border-[#DCE1E8]">
                    <SelectItem value="free">Free Trial</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Cycle</Label>
                <Select value={editCycle} onValueChange={(val) => setEditCycle(val as any)}>
                  <SelectTrigger className="bg-white border-[#DCE1E8]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-[#152839] border-[#DCE1E8]">
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Status</Label>
                <Select value={editStatus} onValueChange={(val) => setEditStatus(val as any)}>
                  <SelectTrigger className="bg-white border-[#DCE1E8]"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-white text-[#152839] border-[#DCE1E8]">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-[#DCE1E8] pt-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#B8470A]">Max Branches Quota</Label>
                <Input
                  type="number"
                  min={1}
                  required
                  value={editMaxBranches}
                  onChange={(e) => setEditMaxBranches(parseInt(e.target.value) || 1)}
                  className="bg-white border-[#DCE1E8] text-[#152839]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#B8470A]">Max Users Quota</Label>
                <Input
                  type="number"
                  min={1}
                  required
                  value={editMaxUsers}
                  onChange={(e) => setEditMaxUsers(parseInt(e.target.value) || 1)}
                  className="bg-white border-[#DCE1E8] text-[#152839]"
                />
              </div>
            </div>

            <div className="space-y-3 border-t border-[#DCE1E8] pt-3">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#B8470A]">Business Model Configuration</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-[#F9F8F3] p-3 rounded-lg border border-[#DCE1E8]">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-[#5F6A7C] font-bold uppercase">Restaurant F&B</span>
                  <InlineSwitch
                    checked={editIsRestaurant}
                    onChange={setEditIsRestaurant}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-[#5F6A7C] font-bold uppercase">Retail Store</span>
                  <InlineSwitch
                    checked={editIsRetail}
                    onChange={setEditIsRetail}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-[#5F6A7C] font-bold uppercase">Service Repair</span>
                  <InlineSwitch
                    checked={editIsService}
                    onChange={setEditIsService}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t border-[#DCE1E8] pt-3">
              <div className="p-3.5 rounded-xl border border-[#FF6F07]/50 bg-[#FF6F07]/10 flex items-center justify-between">
                <div className="space-y-0.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#152839]">Table Management & Running Bills</span>
                    <Badge variant="outline" className={`text-[9px] font-bold uppercase tracking-wider ${
                      editFeatures.table_management ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10' : 'border-[#DCE1E8] text-[#5F6A7C]'
                    }`}>
                      {editFeatures.table_management ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[#45546A] leading-relaxed">
                    Allow this tenant to configure floor tables, seating capacities, and handle dine-in running bills.
                  </p>
                </div>
                <InlineSwitch
                  checked={Boolean(editFeatures.table_management)}
                  onChange={(checked: boolean) => setEditFeatures({ ...editFeatures, table_management: checked })}
                />
              </div>

              <div className="p-3.5 rounded-xl border border-[#DCE1E8] bg-[#F9F8F3] flex items-center justify-between">
                <div className="space-y-0.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#152839]">Shift Management & Tracking</span>
                    <Badge variant="outline" className={`text-[9px] font-bold uppercase tracking-wider ${
                      editFeatures.shift_management ? 'border-emerald-500/40 text-emerald-700 bg-emerald-500/10' : 'border-[#DCE1E8] text-[#5F6A7C]'
                    }`}>
                      {editFeatures.shift_management ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[#45546A] leading-relaxed">
                    Allow cashiers to select Morning, Mid, or Night shifts when opening register and track shift assignments on X/Z reads.
                  </p>
                </div>
                <InlineSwitch
                  checked={Boolean(editFeatures.shift_management)}
                  onChange={(checked: boolean) => setEditFeatures({ ...editFeatures, shift_management: checked })}
                />
              </div>

              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Other Feature Access Flags</Label>
              <div className="grid grid-cols-2 gap-3 p-4 border border-[#DCE1E8] rounded-xl bg-[#F9F8F3] max-h-48 overflow-y-auto">
                {Object.keys(FEATURE_LABELS).filter(k => k !== 'table_management' && k !== 'shift_management').map(key => {
                  const isEnabled = editFeatures[key] !== false; // default true if not configured
                  return (
                    <div key={key} className="flex items-center justify-between bg-white p-2 rounded-lg border border-[#DCE1E8]">
                      <span className="text-[10px] font-medium text-[#152839]">{FEATURE_LABELS[key]}</span>
                      <InlineSwitch
                        checked={isEnabled}
                        onChange={(checked: boolean) => setEditFeatures({ ...editFeatures, [key]: checked })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-[#DCE1E8] shrink-0">
              <Button type="button" variant="outline" onClick={() => { setIsEditModalOpen(false); setEditingTenant(null); }} className="border-[#DCE1E8] text-[#152839]">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-[#152839] hover:bg-[#1f3a52] text-[#F9F8F3] font-bold">
                {submitting ? "Saving..." : "Save Configuration"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: RECEIPT VIEW MODAL */}
      <Dialog open={isReceiptModalOpen} onOpenChange={setIsReceiptModalOpen}>
        <DialogContent className="max-w-md bg-white border-[#DCE1E8] text-[#152839] p-4">
          <DialogHeader>
            <DialogTitle>Proof of Payment Receipt</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center border border-[#DCE1E8] bg-white rounded-xl p-2 h-96 overflow-hidden">
            <img 
              src={selectedReceiptUrl} 
              alt="Receipt proof" 
              className="max-h-full max-w-full object-contain" 
              onError={(e) => { e.currentTarget.src = "https://placehold.co/300?text=Receipt+Proof+Unavailable"; }}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => setIsReceiptModalOpen(false)} className="bg-[#ECE7DE] hover:bg-[#DCE1E8] text-[#152839] w-full font-bold">
              Close Viewer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 4: ADD QR CODE CHANNEL MODAL */}
      <Dialog open={isQrModalOpen} onOpenChange={setIsQrModalOpen}>
        <DialogContent className="max-w-md bg-white border-[#DCE1E8] text-[#152839] p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-[#DCE1E8]">
            <DialogTitle>Add Onboarding Payment QR Code</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddQRCode} className="space-y-4 p-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Payment Channel Method</Label>
              <Select value={qrMethod} onValueChange={setQrMethod}>
                <SelectTrigger className="bg-white border-[#DCE1E8]"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white text-[#152839] border-[#DCE1E8]">
                  <SelectItem value="GCash">GCash</SelectItem>
                  <SelectItem value="Maya">Maya</SelectItem>
                  <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Account Name</Label>
              <Input
                type="text"
                required
                value={qrName}
                onChange={(e) => setQrName(e.target.value)}
                placeholder="e.g. Odyssey Inc."
                className="bg-white border-[#DCE1E8]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Account Number</Label>
              <Input
                type="text"
                required
                value={qrNumber}
                onChange={(e) => setQrNumber(e.target.value)}
                placeholder="e.g. 0917-XXX-XXXX or Bank account"
                className="bg-white border-[#DCE1E8]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">QR Code Image</Label>
              <div className="relative h-20 border border-dashed border-[#DCE1E8] rounded-lg hover:border-[#152839] hover:bg-[#FF6F07]/10 transition-all flex flex-col items-center justify-center cursor-pointer group">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleQRUpload} 
                  required
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                />
                <UploadIcon className="w-4 h-4 text-[#5F6A7C] group-hover:text-[#B8470A] transition-colors" />
                <span className="text-[10px] text-[#45546A] mt-1.5 font-medium">
                  {qrFileName || "Upload QR screenshot (PNG, JPG)"}
                </span>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-[#DCE1E8]">
              <Button type="button" variant="outline" onClick={() => setIsQrModalOpen(false)} className="border-[#DCE1E8] text-[#152839]">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-[#152839] hover:bg-[#1f3a52] text-[#F9F8F3] font-bold">
                {submitting ? "Saving..." : "Add Payment Channel"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 5: EDIT SUBSCRIPTION PLAN MODAL */}
      <Dialog open={isPlanModalOpen} onOpenChange={setIsPlanModalOpen}>
        <DialogContent className="max-w-md bg-white border-[#DCE1E8] text-[#152839] p-0 overflow-hidden flex flex-col max-h-[85vh]">
          <DialogHeader className="p-6 border-b border-[#DCE1E8] shrink-0">
            <DialogTitle>Edit Plan: {editPlanName}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditPlanSubmit} className="flex-1 overflow-y-auto space-y-4 p-6">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Monthly Price (PHP)</Label>
              <Input
                type="number"
                required
                min={0}
                value={editPlanMonthlyPrice}
                onChange={(e) => setEditPlanMonthlyPrice(Number(e.target.value))}
                className="bg-white border-[#DCE1E8]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Yearly Price (PHP)</Label>
              <Input
                type="number"
                required
                min={0}
                value={editPlanYearlyPrice}
                onChange={(e) => setEditPlanYearlyPrice(Number(e.target.value))}
                className="bg-white border-[#DCE1E8]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Max Branches</Label>
                <Input
                  type="number"
                  required
                  min={1}
                  value={editPlanMaxBranches}
                  onChange={(e) => setEditPlanMaxBranches(Number(e.target.value))}
                  className="bg-white border-[#DCE1E8]"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Max Users</Label>
                <Input
                  type="number"
                  required
                  min={1}
                  value={editPlanMaxUsers}
                  onChange={(e) => setEditPlanMaxUsers(Number(e.target.value))}
                  className="bg-white border-[#DCE1E8]"
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-[#DCE1E8] pt-4">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#45546A]">Feature Permissions</Label>
              <div className="grid grid-cols-1 gap-2.5 max-h-48 overflow-y-auto pr-1">
                {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                  const isEnabled = key === 'service_charge_tracker'
                    ? editPlanFeatures[key] !== false
                    : !!editPlanFeatures[key];
                  return (
                    <div key={key} className="flex justify-between items-center bg-[#F9F8F3] p-2 rounded-lg border border-[#DCE1E8]">
                      <span className="text-xs text-[#152839]">{label}</span>
                      <InlineSwitch
                        checked={isEnabled}
                        onChange={(checked: boolean) => setEditPlanFeatures({ ...editPlanFeatures, [key]: checked })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-[#DCE1E8] shrink-0">
              <Button type="button" variant="outline" onClick={() => { setIsPlanModalOpen(false); setEditingPlan(null); }} className="border-[#DCE1E8] text-[#152839]">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-[#152839] hover:bg-[#1f3a52] text-[#F9F8F3] font-bold">
                {submitting ? "Saving Plan..." : "Save Plan Configurations"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 6: CONFIRM DELETE TENANT MODAL */}
      <Dialog open={isDeleteModalOpen} onOpenChange={(open) => { if (!open) { setIsDeleteModalOpen(false); setDeletingTenant(null); } }}>
        <DialogContent className="max-w-md bg-white border-[#DCE1E8] text-[#152839] p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-red-700 font-odyssey-display font-bold text-lg">⚠️ CRITICAL ACTION: Delete Tenant Data</DialogTitle>
            <DialogDescription className="text-[#45546A] text-xs mt-2">
              This action will permanently delete all branches, staff profiles, menu items, sales, inventory, and transaction history for <span className="font-bold text-[#152839] font-mono bg-white px-1 py-0.5 rounded">{deletingTenant?.name}</span>.
              <br /><br />
              This action <span className="font-bold text-red-700">CANNOT</span> be undone. It is isolated and will not affect any other tenants.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDeleteTenantSubmit} className="space-y-4">
            <div className="space-y-2 bg-[#F9F8F3] p-3 rounded-lg border border-[#DCE1E8]">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-[#45546A]">
                To confirm, type the tenant's identifier: <span className="font-bold text-[#B8470A] font-mono select-all">{(deletingTenant?.subdomain || deletingTenant?.name || '').toLowerCase()}</span>
              </Label>
              <Input
                type="text"
                required
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type name/subdomain here..."
                className="bg-white border-[#DCE1E8] focus:border-red-500 focus:ring-red-500 text-xs"
              />
            </div>

            <DialogFooter className="pt-4 border-t border-[#DCE1E8]">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => { setIsDeleteModalOpen(false); setDeletingTenant(null); }} 
                className="border-[#DCE1E8] text-[#152839]"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={submitting || deleteConfirmText.trim().toLowerCase() !== (deletingTenant?.subdomain || deletingTenant?.name || '').toLowerCase()} 
                className="bg-red-650 hover:bg-red-700 text-[#F9F8F3] font-bold text-xs"
              >
                {submitting ? "Deleting Tenant..." : "Permanently Delete Data"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG 7: CONFIRM RESET TENANT MODAL */}
      <Dialog open={isResetModalOpen} onOpenChange={(open) => { if (!open) { setIsResetModalOpen(false); setResettingTenant(null); } }}>
        <DialogContent className="max-w-md bg-white border-[#DCE1E8] text-[#152839] p-6">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-amber-700 font-odyssey-display font-bold text-lg">⚠️ RESET TRANSACTIONAL DATA</DialogTitle>
            <DialogDescription className="text-[#45546A] text-xs mt-2">
              This action will erase all sales history, cashier sessions, inventory movements/balances, stock adjustments, transfers, expenses, menu items, recipes, settings, and sequences for <span className="font-bold text-[#152839] font-mono bg-white px-1 py-0.5 rounded">{resettingTenant?.name}</span> to start from scratch.
              <br /><br />
              All **user accounts, staff profiles, and physical branch structures** will be preserved.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleResetTenantSubmit} className="space-y-4">
            <div className="space-y-2 bg-[#F9F8F3] p-3 rounded-lg border border-[#DCE1E8]">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-[#45546A]">
                To confirm, type the tenant's identifier: <span className="font-bold text-[#B8470A] font-mono select-all">{(resettingTenant?.subdomain || resettingTenant?.name || '').toLowerCase()}</span>
              </Label>
              <Input
                type="text"
                required
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="Type name/subdomain here..."
                className="bg-white border-[#DCE1E8] focus:border-amber-500 focus:ring-amber-500 text-xs"
              />
            </div>

            <DialogFooter className="pt-4 border-t border-[#DCE1E8]">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => { setIsResetModalOpen(false); setResettingTenant(null); }} 
                className="border-[#DCE1E8] text-[#152839]"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={submitting || resetConfirmText.trim().toLowerCase() !== (resettingTenant?.subdomain || resettingTenant?.name || '').toLowerCase()} 
                className="bg-amber-600 hover:bg-amber-700 text-[#F9F8F3] font-bold text-xs"
              >
                {submitting ? "Resetting Data..." : "Confirm Reset Transactional Data"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
