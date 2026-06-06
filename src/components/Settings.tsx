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
  TrashIcon as Trash2
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
    <div className="flex-1 p-4 md:p-8 overflow-y-auto bg-slate-950 text-slate-100">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2.5">
            <SettingsIcon className="w-8 h-8 text-primary animate-spin-slow" />
            <span>System Settings</span>
          </h2>
          <p className="text-muted-foreground mt-1">Configure document templates, logo uploads, and view database setup guides.</p>
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
            <Database className="w-3.5 h-3.5 mr-1.5" />
            System Setup Guide
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
            <div className="max-w-3xl space-y-6">
              {/* User Role Card */}
              {profile && (
                <Card className="glass-dark border-primary/20">
                  <CardContent className="p-6 flex items-center space-x-6">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                      <UserCheck className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Your Assigned Profile</p>
                      <h3 className="text-lg font-bold">{profile.email}</h3>
                      <Badge variant="outline" className="mt-2 text-[10px] uppercase border-primary/50 text-primary bg-primary/5">
                        Role: {profile.role_name.replace('_', ' ')}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Database setup instructions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center space-x-2">
                    <Database className="w-5 h-5 text-primary" />
                    <span>Database Schema & Migration Guide</span>
                  </CardTitle>
                  <CardDescription>
                    All system business logic is executed in the database layer via PostgreSQL triggers, functions, and RLS policies.
                    Ensure you run the schema migration and data seeding commands in your Supabase **SQL Editor**.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-muted/50 border rounded-lg space-y-2">
                    <h4 className="text-sm font-bold flex items-center space-x-2">
                      <Terminal className="w-4 h-4 text-primary" />
                      <span>Step 1: Execute Schema Migration</span>
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Open the Supabase dashboard, navigate to the **SQL Editor**, and copy-paste the entire contents of the schema file:
                    </p>
                    <code className="text-[11px] text-primary/80 bg-background px-2 py-1 rounded block mt-2 border">
                      supabase/migrations/20260603000000_schema.sql
                    </code>
                  </div>

                  <div className="p-4 bg-muted/50 border rounded-lg space-y-2">
                    <h4 className="text-sm font-bold flex items-center space-x-2">
                      <Terminal className="w-4 h-4 text-primary" />
                      <span>Step 2: Seed Demo Inventory Sandbox</span>
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Immediately after the schema is created, execute the seeding file to populate branches, recipes, and warehouse inventory:
                    </p>
                    <code className="text-[11px] text-primary/80 bg-background px-2 py-1 rounded block mt-2 border">
                      supabase/migrations/20260603000001_seed.sql
                    </code>
                  </div>

                  <div className="p-4 bg-muted/50 border rounded-lg space-y-2">
                    <h4 className="text-sm font-bold flex items-center space-x-2">
                      <Terminal className="w-4 h-4 text-primary" />
                      <span>Step 3: Enable Template Customization Table</span>
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Execute the newly created system settings SQL script to support persistent document logo uploads and receipt templates:
                    </p>
                    <code className="text-[11px] text-primary/80 bg-background px-2 py-1 rounded block mt-2 border">
                      supabase/migrations/20260603000008_system_settings.sql
                    </code>
                  </div>
                </CardContent>
              </Card>

              {/* First admin provision instruction */}
              <Card className="border-emerald-500/20 bg-emerald-500/5">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center space-x-2 text-emerald-600 dark:text-emerald-455">
                    <ShieldCheck className="w-5 h-5" />
                    <span>Super Admin Provisioning (First-time Setup)</span>
                  </CardTitle>
                  <CardDescription className="text-emerald-700/70 dark:text-emerald-400/70">
                    By default, new users created in Supabase Auth are mapped to the lowest tier (`cashier`).
                    To register your primary Super Admin account:
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-4">
                    <li>
                      Go to the login screen and <strong className="text-foreground">Sign Up</strong> a new user account with your desired credentials.
                    </li>
                    <li>
                      Open your Supabase <strong className="text-foreground">SQL Editor</strong> and run the following script to elevate this account:
                      <pre className="bg-background/80 text-foreground p-3 rounded font-mono text-[11px] mt-2 border select-all overflow-x-auto">
                        {`UPDATE public.profiles 
SET role_name = 'super_admin' 
WHERE email = 'your-admin-email@example.com';`}
                      </pre>
                      <span className="text-[11px] block mt-2 opacity-80">
                        *(Replace <code className="text-primary font-mono bg-background px-1 rounded">your-admin-email@example.com</code> with the email address you signed up).*
                      </span>
                    </li>
                    <li>
                      Refresh the page and log in. You will have full Super Admin control, allowing you to create other staff, manage inventory, view analytics, and approve transfers!
                    </li>
                  </ol>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">

              {/* ─── COLUMN 1: TRANSFER SLIP TEMPLATE ─── */}
              <div className="space-y-6">
                <Card className="border-slate-800/80 bg-slate-900/10">
                  <CardHeader className="border-b border-slate-800/60 pb-4">
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
                        <div className="flex items-center space-x-4 p-3 bg-slate-950 border border-slate-800 border-dashed rounded-lg">
                          {transferSlip.logo_url ? (
                            <div className="relative w-16 h-16 bg-slate-900 border border-slate-800 rounded flex items-center justify-center p-1">
                              <img src={transferSlip.logo_url} className="max-w-full max-h-full object-contain rounded" />
                              <button
                                onClick={() => handleRemoveImage('transfer')}
                                className="absolute -top-1.5 -right-1.5 p-1 bg-red-650 rounded-full hover:bg-red-500 transition-all text-white shadow"
                                title="Delete logo"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
                              <ImageIcon className="w-6 h-6" />
                            </div>
                          )}
                          <div className="flex-1">
                            <label className="inline-flex items-center space-x-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer">
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
                      <div className="flex items-center space-x-2 py-2 border-t border-b border-slate-800/40">
                        <Checkbox
                          id="show_signatures"
                          checked={transferSlip.show_signatures}
                          onCheckedChange={(checked) => setTransferSlip(prev => ({ ...prev, show_signatures: checked === true }))}
                        />
                        <Label htmlFor="show_signatures" className="text-xs text-slate-300 select-none cursor-pointer">
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
                <Card className="border-slate-800/50 bg-slate-900/5">
                  <CardHeader className="p-4 border-b border-slate-800/50 bg-slate-900/30">
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
                <Card className="border-slate-800/80 bg-slate-900/10">
                  <CardHeader className="border-b border-slate-800/60 pb-4">
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
                        <div className="flex items-center space-x-4 p-3 bg-slate-950 border border-slate-800 border-dashed rounded-lg">
                          {salesInvoice.logo_url ? (
                            <div className="relative w-16 h-16 bg-slate-900 border border-slate-800 rounded flex items-center justify-center p-1">
                              <img src={salesInvoice.logo_url} className="max-w-full max-h-full object-contain rounded" />
                              <button
                                onClick={() => handleRemoveImage('sales')}
                                className="absolute -top-1.5 -right-1.5 p-1 bg-red-655 rounded-full hover:bg-red-500 transition-all text-white shadow"
                                title="Delete logo"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
                              <ImageIcon className="w-6 h-6" />
                            </div>
                          )}
                          <div className="flex-1">
                            <label className="inline-flex items-center space-x-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer">
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
                <Card className="border-slate-800/50 bg-slate-900/5">
                  <CardHeader className="p-4 border-b border-slate-800/50 bg-slate-900/30">
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
