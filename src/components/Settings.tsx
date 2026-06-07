import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  GearIcon as SettingsIcon,
  StackIcon as Database,
  CheckCircledIcon as ShieldCheck,
  PersonIcon as UserCheck,
  CodeIcon as Terminal,
  FileTextIcon as FileText,
  ImageIcon,
  CheckIcon as Save,
  ResetIcon as RotateCcw,
  UploadIcon as Upload,
  EyeOpenIcon as Eye,
  TrashIcon as Trash2,
  ReaderIcon as BookOpenIcon
} from '@radix-ui/react-icons';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  settingsService,
  DEFAULT_TRANSFER_SLIP_TEMPLATE,
  DEFAULT_SALES_INVOICE_TEMPLATE
} from '../lib/settingsService';
import type { TransferSlipTemplate, SalesInvoiceTemplate } from '../lib/settingsService';
import { useModal } from '../contexts/ModalContext';

export const Settings: React.FC = () => {
  const { profile } = useAuth();
  const { confirm, showSuccess, showError } = useModal();

  // Navigation active tab
  const [activeSubTab, setActiveSubTab] = useState<'guide' | 'templates'>('templates');

  // Templates States
  const [transferSlip, setTransferSlip] = useState<TransferSlipTemplate>({ ...DEFAULT_TRANSFER_SLIP_TEMPLATE });
  const [salesInvoice, setSalesInvoice] = useState<SalesInvoiceTemplate>({ ...DEFAULT_SALES_INVOICE_TEMPLATE });

  // UI States
  const [loading, setLoading] = useState(true);
  const [savingTransfer, setSavingTransfer] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const settings = await settingsService.getSettings();
      setTransferSlip(settings.transfer_slip);
      setSalesInvoice(settings.sales_invoice);
    } catch (err) {
      console.error('Failed to load settings templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'transfer' | 'sales') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 1.5 * 1024 * 1024) {
      showError('Selected image is too large. Please select an image under 1.5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      if (type === 'transfer') {
        setTransferSlip(prev => ({ ...prev, logo_url: base64 }));
      } else {
        setSalesInvoice(prev => ({ ...prev, logo_url: base64 }));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = (type: 'transfer' | 'sales') => {
    if (type === 'transfer') {
      setTransferSlip(prev => ({ ...prev, logo_url: '' }));
    } else {
      setSalesInvoice(prev => ({ ...prev, logo_url: '' }));
    }
  };

  const handleSaveTransferConfig = async () => {
    setSavingTransfer(true);
    setError('');
    setSuccess('');
    try {
      const ok = await settingsService.saveSettings('transfer_slip', transferSlip, profile?.id);
      if (ok) {
        showSuccess('Transfer Slip template updated successfully in Database!');
      } else {
        showSuccess('Saved successfully to local browser cache! (Database schema update pending)');
      }
    } catch (err: any) {
      showError(err.message || 'Failed to save configuration');
    } finally {
      setSavingTransfer(false);
    }
  };

  const handleSaveInvoiceConfig = async () => {
    setSavingInvoice(true);
    setError('');
    setSuccess('');
    try {
      const ok = await settingsService.saveSettings('sales_invoice', salesInvoice, profile?.id);
      if (ok) {
        showSuccess('Sales Invoice thermal template updated successfully in Database!');
      } else {
        showSuccess('Saved successfully to local browser cache! (Database schema update pending)');
      }
    } catch (err: any) {
      showError(err.message || 'Failed to save configuration');
    } finally {
      setSavingInvoice(false);
    }
  };

  const handleResetTransfer = async () => {
    if (await confirm('Reset Template', 'Reset Transfer Slip template to system defaults?')) {
      setTransferSlip({ ...DEFAULT_TRANSFER_SLIP_TEMPLATE });
      showSuccess('Transfer Slip template reset to defaults locally. Save to apply.');
    }
  };

  const handleResetInvoice = async () => {
    if (await confirm('Reset Template', 'Reset Sales Invoice template to system defaults?')) {
      setSalesInvoice({ ...DEFAULT_SALES_INVOICE_TEMPLATE });
      showSuccess('Sales Invoice template reset to defaults locally. Save to apply.');
    }
  };

  const isEditorRole = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2.5">
            <SettingsIcon className="w-8 h-8 text-primary animate-spin-slow" />
            <span>System Settings</span>
          </h2>
          <p className="text-muted-foreground mt-1">Configure document templates, logo uploads, and read the full user manual for the system.</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-muted p-1 rounded-lg self-start">
          <Button
            variant={activeSubTab === 'templates' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveSubTab('templates')}
            className="text-xs font-bold"
          >
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            Document Templates
          </Button>
          <Button
            variant={activeSubTab === 'guide' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveSubTab('guide')}
            className="text-xs font-bold"
          >
            <BookOpenIcon className="w-3.5 h-3.5 mr-1.5" />
            User Manual
          </Button>
        </div>
      </div>

      {/* Global Alerts */}
      <div className="max-w-7xl mx-auto mb-6">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-lg font-semibold">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs rounded-lg font-semibold">
            {success}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-xs text-muted-foreground animate-pulse">
          Loading templates and settings...
        </div>
      ) : (
        <div className="max-w-7xl mx-auto">
          {activeSubTab === 'guide' ? (
            <div className="max-w-4xl space-y-6">

              {/* Current User Badge */}
              {profile && (
                <Card className="glass-dark border-border/50">
                  <CardContent className="p-6 flex items-center space-x-6">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                      <UserCheck className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Logged In As</p>
                      <h3 className="text-base font-bold">{profile.email}</h3>
                      <Badge variant="outline" className="mt-1.5 text-[10px] uppercase border-primary/50 text-primary bg-primary/5">
                        {profile.role_name.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* INTRO */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="p-6">
                  <h3 className="text-lg font-extrabold tracking-tight mb-1 flex items-center space-x-2">
                    <BookOpenIcon className="w-5 h-5 text-primary" />
                    <span>Dr. Humba — Inventory Management System</span>
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    This manual walks through the full lifecycle of the system — from first-time Super Admin setup, to creating branches, managing staff, running the POS, and reviewing analytics. Follow the sections in order for a smooth onboarding experience.
                  </p>
                </CardContent>
              </Card>

              {/* SECTION 1: Super Admin Provisioning */}
              <Card className="border-emerald-500/20 bg-emerald-500/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                    <span>Step 1 — Super Admin Account Provisioning</span>
                  </CardTitle>
                  <CardDescription className="text-emerald-700/70 dark:text-emerald-400/60 text-xs">
                    Every new user created through the sign-up screen starts as a <code className="font-mono bg-background/50 px-1 rounded">cashier</code> by default.
                    To turn a freshly created account into the primary Super Admin:
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-3">
                    <li>Go to the login screen and <strong className="text-foreground">Sign Up</strong> a new account with your preferred credentials.</li>
                    <li>
                      Open the Supabase dashboard → <strong className="text-foreground">SQL Editor</strong> and run:
                      <pre className="bg-background/80 text-foreground p-3 rounded font-mono text-[11px] mt-2 border select-all overflow-x-auto">{`UPDATE public.profiles
SET role_name = 'super_admin'
WHERE email = 'your-email@example.com';`}</pre>
                      <span className="text-[11px] block mt-1 opacity-70">Replace with the email you signed up with.</span>
                    </li>
                    <li>Refresh the page and log in. You will now have <strong className="text-foreground">full Super Admin</strong> access to all modules.</li>
                  </ol>
                </CardContent>
              </Card>

              {/* SECTION 2: Branch Management */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <Database className="w-5 h-5 text-primary" />
                    <span>Step 2 — Creating Branches</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Branches represent physical locations (e.g. outlets or the central warehouse). At least one branch must exist before you can assign staff or manage inventory.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Navigate to <strong className="text-foreground">Branch Management</strong> from the sidebar (visible to super_admin and inventory_manager).</li>
                    <li>Click <strong className="text-foreground">+ Add Branch</strong>, provide a branch name, and toggle <em>Is Warehouse</em> if this branch is the central supply hub.</li>
                    <li>The <strong className="text-foreground">Warehouse branch</strong> acts as the source for stock transfers to other branches. Only one warehouse should be designated.</li>
                    <li>You can edit or delete branches from the same page. Deleting a branch will restrict all related inventory activity.</li>
                  </ol>
                  <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded text-amber-600 dark:text-amber-400 text-xs">
                    ⚠️ Tip: Create the warehouse branch first so you can immediately load stock into it via Stock Receiving.
                  </div>
                </CardContent>
              </Card>

              {/* SECTION 3: User Management */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <UserCheck className="w-5 h-5 text-primary" />
                    <span>Step 3 — Creating Staff Accounts &amp; Roles</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Each staff member needs a user account with the correct role and branch assignment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Navigate to <strong className="text-foreground">User Management</strong> in the sidebar.</li>
                    <li>Click <strong className="text-foreground">+ Invite User</strong> — enter the staff email. They will receive an invitation to set a password.</li>
                    <li>Once registered, assign them a <strong className="text-foreground">Role</strong> and a <strong className="text-foreground">Branch</strong> from the user list.</li>
                  </ol>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {[
                      { role: 'super_admin', desc: 'Full system access. Manages all branches, users, settings, and reports.' },
                      { role: 'inventory_manager', desc: 'Manages inventory catalog, stock receiving, adjustments, and approvals.' },
                      { role: 'branch_manager', desc: 'Oversees one branch — can approve transfers within their scope.' },
                      { role: 'cashier', desc: 'Operates the POS terminal. Can view their branch sales history.' },
                      { role: 'auditor', desc: 'Read-only access to all transactions, analytics, and reports.' },
                    ].map(({ role, desc }) => (
                      <div key={role} className="p-2.5 bg-muted/40 border rounded">
                        <code className="text-primary font-mono text-[10px] font-bold">{role.replace(/_/g, '_')}</code>
                        <p className="text-[11px] mt-1 text-muted-foreground">{desc}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* SECTION 4: Inventory Catalog */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-primary" />
                    <span>Step 4 — Building the Inventory Catalog</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    The inventory catalog is the master list of all raw ingredients and supplies used across branches.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Go to <strong className="text-foreground">Inventory</strong> in the sidebar.</li>
                    <li>Click <strong className="text-foreground">+ Add Item</strong>. Fill in the item name, base unit (e.g. <em>kg</em>, <em>pcs</em>), purchase unit, and conversion factor.</li>
                    <li>The <strong className="text-foreground">conversion factor</strong> converts between purchase and base units (e.g. 1 sack = 50 kg → factor: 50).</li>
                    <li>Set a <strong className="text-foreground">reorder point</strong> to receive low-stock alerts automatically.</li>
                    <li>Use <strong className="text-foreground">Stock In</strong> directly from an inventory item to receive initial stock into a branch.</li>
                  </ol>
                </CardContent>
              </Card>

              {/* SECTION 5: Recipes & Menu */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <Terminal className="w-5 h-5 text-primary" />
                    <span>Step 5 — Recipes &amp; Menu Mapping</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Link menu items sold at the POS to inventory ingredients for automatic stock deduction per sale.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Navigate to <strong className="text-foreground">Recipes &amp; Menu</strong> in the sidebar.</li>
                    <li>Click <strong className="text-foreground">Create Menu Item</strong>. Enter the dish name, SKU, category, selling price, and availability status.</li>
                    <li>Under <em>Ingredients</em>, add each raw ingredient with the quantity consumed per serving (in base units).</li>
                    <li>The system will automatically display estimated ingredient cost, gross profit, and margin per dish.</li>
                    <li>When a sale is processed through the POS, each ingredient is deducted from the current branch's stock based on the recipe.</li>
                  </ol>
                </CardContent>
              </Card>

              {/* SECTION 6: Stock Transfers */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <Database className="w-5 h-5 text-indigo-400" />
                    <span>Step 6 — Stock Transfers (Warehouse → Branch)</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Stock is moved from the warehouse to branches via the Transfer module.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Go to <strong className="text-foreground">Transfers</strong>. A branch staff member can <strong className="text-foreground">Request Transfer</strong> from the warehouse, or a warehouse manager can <strong className="text-foreground">Dispatch Proactively</strong>.</li>
                    <li>An inventory_manager or branch_manager reviews the request and clicks <strong className="text-foreground">Approve &amp; Dispatch</strong>. Stock is immediately deducted from the source branch.</li>
                    <li>The <strong className="text-foreground">receiving branch staff</strong> (not the sender) must click <strong className="text-foreground">Confirm &amp; Receive Items</strong> to complete the transfer. This is enforced — the sender cannot self-approve receipt.</li>
                    <li>On confirmation, a <strong className="text-foreground">Stock Receiving Transaction</strong> is automatically generated and the destination branch inventory is updated.</li>
                  </ol>
                  <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded text-indigo-400 text-xs">
                    🔒 Maker-Checker Rule: The same person who dispatched cannot be the one who confirms receipt. This ensures accountability.
                  </div>
                </CardContent>
              </Card>

              {/* SECTION 7: Stock Adjustments */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-amber-400" />
                    <span>Step 7 — Stock Adjustments &amp; Waste Logging</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Log physical inventory discrepancies, spoilage, damage, or expiry.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Navigate to <strong className="text-foreground">Adjustments</strong> in the sidebar.</li>
                    <li>Click <strong className="text-foreground">+ Log Adjustment</strong>. Select the reason (Spoilage, Damage, Expired, Lost, Manual Correction) and add the items with their quantities (negative quantities deduct stock).</li>
                    <li>Adjustments are submitted with a <em>Pending</em> status and require approval from an inventory_manager or super_admin.</li>
                    <li>Once <strong className="text-foreground">Approved</strong>, the inventory balance is immediately corrected and a movement ledger entry is committed.</li>
                    <li>Rejected adjustments leave inventory unchanged.</li>
                  </ol>
                </CardContent>
              </Card>

              {/* SECTION 8: POS */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <Terminal className="w-5 h-5 text-emerald-400" />
                    <span>Step 8 — Point of Sale (POS)</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Process customer orders and generate sales invoices.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ol className="list-decimal pl-5 space-y-2">
                    <li>Navigate to <strong className="text-foreground">POS</strong>. Only available to users assigned to a specific branch.</li>
                    <li>Browse menu items by category. Click any item to add it to the cart (specify quantity).</li>
                    <li>Click <strong className="text-foreground">Checkout</strong>, choose a payment method (Cash, Card, GCash, Maya), and confirm.</li>
                    <li>A thermal sales invoice is automatically printed and ingredient stock is deducted from the branch in real-time.</li>
                    <li>Cashiers can reprint invoices from the <strong className="text-foreground">Sales History</strong> page. Void/refund requires manager-level access.</li>
                  </ol>
                </CardContent>
              </Card>

              {/* SECTION 9: Transactions & Reporting */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <Eye className="w-5 h-5 text-purple-400" />
                    <span>Step 9 — Transactions &amp; Reporting</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Review, audit, and export all inventory movement across the business.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ul className="list-disc pl-5 space-y-2">
                    <li><strong className="text-foreground">Transactions</strong> — unified ledger showing Stock In, Adjustments, Transfers, Waste, and Sales Invoices. Filter by type, branch, date, and search by control number. Print any document as PDF.</li>
                    <li><strong className="text-foreground">Sales History</strong> — complete sales log with per-transaction item breakdown, void capability, and thermal invoice reprint.</li>
                    <li><strong className="text-foreground">Analytics</strong> — dashboards showing revenue trends, top-selling items, low-stock alerts, and branch-by-branch comparisons.</li>
                    <li><strong className="text-foreground">Notifications</strong> — real-time alerts for low stock levels, pending transfer requests, and adjustment approvals awaiting review.</li>
                  </ul>
                </CardContent>
              </Card>

              {/* SECTION 10: Document Templates */}
              <Card className="border-slate-700/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-slate-400" />
                    <span>Step 10 — Configuring Print Templates</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Customize the branding on printed documents.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <ul className="list-disc pl-5 space-y-2">
                    <li>Go to <strong className="text-foreground">Settings → Document Templates</strong> tab.</li>
                    <li><strong className="text-foreground">Transfer Slip</strong> — used for Stock Receiving, Adjustments, and Transfer documents. Set header title, subtitle, logo, and signature labels.</li>
                    <li><strong className="text-foreground">Sales Invoice (Thermal)</strong> — used for POS receipts. Set merchant name, address, TIN, contact, paper size (58mm / 80mm), and footer text.</li>
                    <li>All template changes are saved globally and applied immediately to future print jobs.</li>
                  </ul>
                </CardContent>
              </Card>

            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">

              {/* ─── COLUMN 1: TRANSFER SLIP TEMPLATE ─── */}
              <div className="space-y-6">
                <Card>
                  <CardHeader className="border-b pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center space-x-2">
                        <FileText className="w-4 h-4 text-primary" />
                        <span>Transfer Slip Configuration</span>
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleResetTransfer}
                        className="h-8 w-8 text-muted-foreground hover:text-white"
                        title="Reset to Defaults"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <CardDescription className="text-xs">
                      Set titles, custom signature blocks, and logo headers for branch stock transfer vouchers.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-6 space-y-5">
                    {!isEditorRole && (
                      <div className="text-[11px] text-amber-500 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                        ⚠️ Note: Only admins/managers can save configurations to the cloud. Others can edit and save locally in their browser.
                      </div>
                    )}

                    <div className="space-y-4">
                      {/* Header Title */}
                      <div className="space-y-2">
                        <Label htmlFor="ts_header_title" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                          Header Brand Title
                        </Label>
                        <Input
                          id="ts_header_title"
                          type="text"
                          value={transferSlip.header_title}
                          onChange={(e) => setTransferSlip(prev => ({ ...prev, header_title: e.target.value }))}
                          placeholder="e.g. RESTAURANT INVENTORY SYSTEM"
                        />
                      </div>

                      {/* Header Subtitle */}
                      <div className="space-y-2">
                        <Label htmlFor="ts_header_subtitle" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                          Header Brand Subtitle
                        </Label>
                        <Input
                          id="ts_header_subtitle"
                          type="text"
                          value={transferSlip.header_subtitle}
                          onChange={(e) => setTransferSlip(prev => ({ ...prev, header_subtitle: e.target.value }))}
                          placeholder="e.g. Kitchen & Stock Logistics Management"
                        />
                      </div>

                      {/* Logo Image Upload */}
                      <div className="space-y-2">
                        <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                          Voucher Logo Image (PNG / JPG)
                        </Label>
                        <div className="flex items-center space-x-4 p-3 bg-muted/30 border border-dashed rounded-lg">
                          {transferSlip.logo_url ? (
                            <div className="relative w-16 h-16 bg-muted/50 border rounded flex items-center justify-center p-1">
                              <img src={transferSlip.logo_url} className="max-w-full max-h-full object-contain rounded" />
                              <button
                                onClick={() => handleRemoveImage('transfer')}
                                className="absolute -top-1.5 -right-1.5 p-1 bg-destructive rounded-full hover:bg-destructive/90 transition-all text-white shadow"
                                title="Delete logo"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded bg-muted/50 border flex items-center justify-center text-muted-foreground">
                              <ImageIcon className="w-6 h-6" />
                            </div>
                          )}
                          <div className="flex-1">
                            <label className="inline-flex items-center space-x-1.5 bg-background border hover:bg-muted text-foreground px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer">
                              <Upload className="w-3.5 h-3.5" />
                              <span>Select Image File</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => handleImageUpload(e, 'transfer')}
                              />
                            </label>
                            <p className="text-[9px] text-muted-foreground mt-1">Max dimensions: 150x60px. Saved as data URI.</p>
                          </div>
                        </div>
                      </div>

                      {/* Signature Custom Labels */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="ts_sender_label" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Sender Signature Title
                          </Label>
                          <Input
                            id="ts_sender_label"
                            type="text"
                            value={transferSlip.sender_label}
                            onChange={(e) => setTransferSlip(prev => ({ ...prev, sender_label: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ts_receiver_label" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Receiver Signature Title
                          </Label>
                          <Input
                            id="ts_receiver_label"
                            type="text"
                            value={transferSlip.receiver_label}
                            onChange={(e) => setTransferSlip(prev => ({ ...prev, receiver_label: e.target.value }))}
                          />
                        </div>
                      </div>

                      {/* Signatures Toggle */}
                      <div className="flex items-center space-x-2 py-2 border-t border-b border-border/50">
                        <Checkbox
                          id="show_signatures"
                          checked={transferSlip.show_signatures}
                          onCheckedChange={(checked) => setTransferSlip(prev => ({ ...prev, show_signatures: checked === true }))}
                        />
                        <Label htmlFor="show_signatures" className="text-xs select-none cursor-pointer">
                          Render Sender & Receiver Signature Boxes on Receipt
                        </Label>
                      </div>

                      {/* Custom Footer */}
                      <div className="space-y-2">
                        <Label htmlFor="ts_custom_footer" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                          Custom Slip Footer Text
                        </Label>
                        <Input
                          id="ts_custom_footer"
                          type="text"
                          value={transferSlip.custom_footer}
                          onChange={(e) => setTransferSlip(prev => ({ ...prev, custom_footer: e.target.value }))}
                        />
                      </div>
                    </div>

                    <Button
                      onClick={handleSaveTransferConfig}
                      disabled={savingTransfer}
                      className="w-full font-bold shadow"
                    >
                      <Save className="w-4 h-4 mr-1.5" />
                      {savingTransfer ? 'Saving configuration...' : 'Save Transfer Template'}
                    </Button>
                  </CardContent>
                </Card>

                {/* TRANSFER SLIP LIVE PREVIEW */}
                <Card className="bg-muted/5">
                  <CardHeader className="p-4 border-b bg-muted/30">
                    <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex items-center space-x-1.5">
                      <Eye className="w-3.5 h-3.5 text-primary" />
                      <span>Transfer Slip Document Live Preview</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6">
                    <div className="bg-white text-slate-900 p-6 rounded-lg border shadow-xl space-y-4 text-xs select-none">
                      {/* Header */}
                      <div className="flex justify-between items-center border-b-2 border-slate-200 pb-3">
                        <div className="flex items-center space-x-3">
                          {transferSlip.logo_url ? (
                            <img src={transferSlip.logo_url} className="max-h-8 max-w-[80px] object-contain" />
                          ) : (
                            <div className="w-8 h-8 bg-slate-100 border border-slate-200 rounded flex items-center justify-center text-slate-400 font-bold text-[9px]">
                              LOGO
                            </div>
                          )}
                          <div>
                            <div className="font-extrabold text-indigo-650 text-xs uppercase tracking-tight">
                              {transferSlip.header_title || 'RESTAURANT INVENTORY SYSTEM'}
                            </div>
                            <div className="text-[8px] text-slate-500 font-medium mt-0.5">
                              {transferSlip.header_subtitle || 'Kitchen & Stock Logistics Management'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[8px] font-bold text-slate-400 uppercase">Transfer Slip</div>
                          <div className="text-[8px] font-bold text-indigo-500 mt-0.5">STATUS: DISPATCHED</div>
                        </div>
                      </div>

                      {/* Meta information */}
                      <div className="grid grid-cols-2 gap-4 text-[9px] border-b border-slate-105 pb-3 text-slate-600">
                        <div>
                          <span className="text-slate-400 block font-bold uppercase text-[7px]">Control Number</span>
                          <span className="font-bold text-indigo-600 text-[10px]">TS-2026-00042</span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-400 block font-bold uppercase text-[7px]">Issue Date</span>
                          <span className="font-medium">06/06/2026, 11:16 PM</span>
                        </div>
                      </div>

                      {/* Table Placeholder */}
                      <div className="p-3 bg-slate-50 rounded border border-slate-200/60 text-center text-slate-400 font-medium text-[9px] border-dashed">
                        [ Transfer Item Breakdown Table - Rendered Here ]
                      </div>

                      {/* Signatures */}
                      {transferSlip.show_signatures && (
                        <div className="grid grid-cols-2 gap-6 pt-4">
                          <div className="border-t border-slate-350 border-dashed pt-2 text-center">
                            <div className="font-bold text-slate-650 text-[8px]">{transferSlip.sender_label || 'Dispatched By'}</div>
                            <div className="text-[6px] text-slate-400 mt-0.5">Sender Authorized Signature</div>
                          </div>
                          <div className="border-t border-slate-350 border-dashed pt-2 text-center">
                            <div className="font-bold text-slate-650 text-[8px]">{transferSlip.receiver_label || 'Received By'}</div>
                            <div className="text-[6px] text-slate-400 mt-0.5">Receiver Authorized Signature</div>
                          </div>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="text-center text-[8px] text-slate-400 pt-3 border-t border-slate-150 mt-1">
                        {transferSlip.custom_footer || 'Kitchen & Stock Logistics Management'}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* ─── COLUMN 2: SALES INVOICE (THERMAL) TEMPLATE ─── */}
              <div className="space-y-6">
                <Card>
                  <CardHeader className="border-b pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center space-x-2">
                        <FileText className="w-4 h-4 text-emerald-500" />
                        <span>Sales Invoice (Thermal) Configuration</span>
                      </CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleResetInvoice}
                        className="h-8 w-8 text-muted-foreground hover:text-white"
                        title="Reset to Defaults"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <CardDescription className="text-xs">
                      Set store name, address, contact TIN, headers/footers, and paper widths for POS thermal printers.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="p-6 space-y-5">
                    {!isEditorRole && (
                      <div className="text-[11px] text-amber-500 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                        ⚠️ Note: Only admins/managers can save configurations to the cloud. Others can edit and save locally in their browser.
                      </div>
                    )}

                    <div className="space-y-4">
                      {/* Merchant Store Name */}
                      <div className="space-y-2">
                        <Label htmlFor="ti_merchant_name" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                          Merchant Store Name
                        </Label>
                        <Input
                          id="ti_merchant_name"
                          type="text"
                          value={salesInvoice.merchant_name}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_name: e.target.value }))}
                          placeholder="e.g. Dr. Humba"
                        />
                      </div>

                      {/* Address & Contact */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="ti_merchant_address" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Merchant Address
                          </Label>
                          <Input
                            id="ti_merchant_address"
                            type="text"
                            value={salesInvoice.merchant_address}
                            onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_address: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ti_merchant_contact" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Contact / Mobile
                          </Label>
                          <Input
                            id="ti_merchant_contact"
                            type="text"
                            value={salesInvoice.merchant_contact}
                            onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_contact: e.target.value }))}
                          />
                        </div>
                      </div>

                      {/* TIN & Header Title Text */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="ti_merchant_tin" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Merchant TIN
                          </Label>
                          <Input
                            id="ti_merchant_tin"
                            type="text"
                            value={salesInvoice.merchant_tin}
                            onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_tin: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ti_header_text" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Receipt Document Header
                          </Label>
                          <Input
                            id="ti_header_text"
                            type="text"
                            value={salesInvoice.header_text}
                            onChange={(e) => setSalesInvoice(prev => ({ ...prev, header_text: e.target.value }))}
                          />
                        </div>
                      </div>

                      {/* Logo Image Upload (Thermal) */}
                      <div className="space-y-2">
                        <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                          Invoice Logo (PNG / JPG)
                        </Label>
                        <div className="flex items-center space-x-4 p-3 bg-muted/30 border border-dashed rounded-lg">
                          {salesInvoice.logo_url ? (
                            <div className="relative w-16 h-16 bg-muted/50 border rounded flex items-center justify-center p-1">
                              <img src={salesInvoice.logo_url} className="max-w-full max-h-full object-contain rounded" />
                              <button
                                onClick={() => handleRemoveImage('sales')}
                                className="absolute -top-1.5 -right-1.5 p-1 bg-destructive rounded-full hover:bg-destructive/90 transition-all text-white shadow"
                                title="Delete logo"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded bg-muted/50 border flex items-center justify-center text-muted-foreground">
                              <ImageIcon className="w-6 h-6" />
                            </div>
                          )}
                          <div className="flex-1">
                            <label className="inline-flex items-center space-x-1.5 bg-background border hover:bg-muted text-foreground px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer">
                              <Upload className="w-3.5 h-3.5" />
                              <span>Select Image File</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => handleImageUpload(e, 'sales')}
                              />
                            </label>
                            <p className="text-[9px] text-muted-foreground mt-1">Logo image prints in grayscale / black & white.</p>
                          </div>
                        </div>
                      </div>

                      {/* Paper Width & Font Size selector */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Thermal Paper Width
                          </Label>
                          <Select value={salesInvoice.paper_width} onValueChange={(v: any) => setSalesInvoice(prev => ({ ...prev, paper_width: v }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="58mm" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="58mm">58mm (Standard Roll)</SelectItem>
                              <SelectItem value="80mm">80mm (Wide Roll)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                            Receipt Font Size Preset
                          </Label>
                          <Select value={salesInvoice.font_size} onValueChange={(v: any) => setSalesInvoice(prev => ({ ...prev, font_size: v }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="medium" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="small">Small (9px)</SelectItem>
                              <SelectItem value="medium">Medium (12px)</SelectItem>
                              <SelectItem value="large">Large (14px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Footer text */}
                      <div className="space-y-2">
                        <Label htmlFor="ti_footer_text" className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                          Footer Text Notes
                        </Label>
                        <Textarea
                          id="ti_footer_text"
                          rows={2}
                          value={salesInvoice.footer_text}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, footer_text: e.target.value }))}
                          placeholder="Thank you for dining with us!..."
                          className="font-mono text-xs"
                        />
                      </div>
                    </div>

                    <Button
                      onClick={handleSaveInvoiceConfig}
                      disabled={savingInvoice}
                      className="w-full font-bold shadow"
                    >
                      <Save className="w-4 h-4 mr-1.5" />
                      {savingInvoice ? 'Saving configuration...' : 'Save Thermal Invoice Template'}
                    </Button>
                  </CardContent>
                </Card>

                {/* THERMAL INVOICE LIVE PREVIEW */}
                <Card className="bg-muted/5">
                  <CardHeader className="p-4 border-b bg-muted/30">
                    <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest flex items-center space-x-1.5">
                      <Eye className="w-3.5 h-3.5 text-primary" />
                      <span>Thermal Invoice Live Preview (58mm / 80mm Roll)</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 flex justify-center">
                    <div
                      className="bg-white text-slate-950 p-4 border shadow-2xl transition-all duration-300 font-mono relative select-none"
                      style={{
                        width: salesInvoice.paper_width === '58mm' ? '192px' : '272px',
                        fontSize: salesInvoice.font_size === 'small' ? '9px' : salesInvoice.font_size === 'large' ? '12px' : '10px',
                        lineHeight: '1.2'
                      }}
                    >
                      {/* Logo */}
                      {salesInvoice.logo_url ? (
                        <div className="text-center mb-2">
                          <img src={salesInvoice.logo_url} className="max-h-10 max-w-[80px] object-contain mx-auto filter grayscale" />
                        </div>
                      ) : (
                        <div className="text-center text-[7px] text-slate-400 border border-dashed py-1 mb-1.5">
                          [ NO LOGO PLOTTED ]
                        </div>
                      )}

                      {/* Header */}
                      <div className="text-center font-bold uppercase text-[11px]">
                        {salesInvoice.merchant_name || 'Dr. Humba'}
                      </div>
                      <div className="text-center text-[8px] mt-0.5">
                        {salesInvoice.merchant_address || '123 Main St, Metro Manila'}
                      </div>
                      <div className="text-center text-[8px]">
                        {salesInvoice.merchant_contact || '+63 912 345 6789'}
                      </div>
                      <div className="text-center text-[8px] mb-1">
                        {salesInvoice.merchant_tin || 'TIN: 000-123-456-000'}
                      </div>

                      <div className="border-t border-slate-450 border-dashed my-1.5"></div>

                      <div className="text-center font-bold text-[10px] tracking-wide my-1">
                        {salesInvoice.header_text || 'SALES INVOICE'}
                      </div>

                      <div className="border-t border-slate-450 border-dashed my-1.5"></div>

                      {/* Meta */}
                      <div className="space-y-0.5 text-[8px] text-slate-700">
                        <div className="flex justify-between">
                          <span>DATE:</span>
                          <span>06/06/2026, 11:16 PM</span>
                        </div>
                        <div className="flex justify-between">
                          <span>INVOICE:</span>
                          <span>TS-2026-00095</span>
                        </div>
                        <div className="flex justify-between">
                          <span>CASHIER:</span>
                          <span>admin</span>
                        </div>
                      </div>

                      <div className="border-t border-slate-450 border-dashed my-1.5"></div>

                      {/* Items */}
                      <div className="space-y-1 text-[8px] text-slate-800">
                        <div>
                          <div className="font-bold uppercase">CHEESEBURGER DELUXE</div>
                          <div className="flex justify-between">
                            <span>  2 x ₱180.00</span>
                            <span>₱360.00</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-450 border-dashed my-1.5"></div>

                      {/* Total */}
                      <div className="flex justify-between font-bold text-[10px] text-indigo-600">
                        <span>TOTAL:</span>
                        <span>₱360.00</span>
                      </div>

                      <div className="border-t border-slate-450 border-dashed my-1.5"></div>

                      {/* Footer text */}
                      <div className="text-center text-[8px] whitespace-pre-line text-slate-700 italic">
                        {salesInvoice.footer_text || 'Thank you for dining with us!\nCome back again!'}
                      </div>

                      <div className="text-center text-[6.5px] text-slate-400 mt-3 pt-1 border-t border-slate-100">
                        Dr. Humba
                      </div>

                      {/* Thermal receipt jagged bottom decoration */}
                      <div className="absolute left-0 right-0 -bottom-2 h-2 overflow-hidden flex">
                        {Array.from({ length: 30 }).map((_, i) => (
                          <div key={i} className="w-2 h-2 bg-slate-950 rotate-45 transform origin-top-left -mt-1 border-r border-b border-slate-800"></div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
};
