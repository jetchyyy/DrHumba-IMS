import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  Settings as SettingsIcon, 
  Database, 
  ShieldCheck, 
  UserCheck, 
  Terminal, 
  FileText, 
  Printer, 
  Image as ImageIcon, 
  Save, 
  RotateCcw,
  Upload,
  Eye,
  Trash2
} from 'lucide-react';
import { 
  settingsService, 
  DEFAULT_TRANSFER_SLIP_TEMPLATE,
  DEFAULT_SALES_INVOICE_TEMPLATE
} from '../lib/settingsService';
import type { TransferSlipTemplate, SalesInvoiceTemplate } from '../lib/settingsService';

export const Settings: React.FC = () => {
  const { profile } = useAuth();
  
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
      setError('Selected image is too large. Please select an image under 1.5MB.');
      setTimeout(() => setError(''), 5000);
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
        setSuccess('Transfer Slip template updated successfully in Database!');
      } else {
        setSuccess('Saved successfully to local browser cache! (Database schema update pending)');
      }
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
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
        setSuccess('Sales Invoice thermal template updated successfully in Database!');
      } else {
        setSuccess('Saved successfully to local browser cache! (Database schema update pending)');
      }
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setSavingInvoice(false);
    }
  };

  const handleResetTransfer = () => {
    if (window.confirm('Reset Transfer Slip template to system defaults?')) {
      setTransferSlip({ ...DEFAULT_TRANSFER_SLIP_TEMPLATE });
    }
  };

  const handleResetInvoice = () => {
    if (window.confirm('Reset Sales Invoice template to system defaults?')) {
      setSalesInvoice({ ...DEFAULT_SALES_INVOICE_TEMPLATE });
    }
  };

  const isEditorRole = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2.5">
            <SettingsIcon className="w-6 h-6 text-indigo-500" />
            <span>System Settings</span>
          </h2>
          <p className="text-sm text-slate-400">Configure receipt templates, logo uploads, and explore database instructions.</p>
        </div>

        {/* Tab Controls */}
        <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-lg mt-4 md:mt-0 self-start">
          <button
            onClick={() => setActiveSubTab('templates')}
            className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeSubTab === 'templates'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Document Templates</span>
          </button>
          <button
            onClick={() => setActiveSubTab('guide')}
            className={`flex items-center space-x-1.5 px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
              activeSubTab === 'guide'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>System Setup Guide</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      <div className="max-w-7xl mx-auto mb-6">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex items-center">
            <span className="font-semibold">{error}</span>
          </div>
        )}
        {success && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center">
            <span className="font-semibold">{success}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20 text-xs text-slate-500 animate-pulse">
          Loading templates and settings...
        </div>
      ) : (
        <div className="max-w-7xl mx-auto">
          {activeSubTab === 'guide' ? (
            <div className="max-w-3xl space-y-6">
              {/* User Role Card */}
              {profile && (
                <div className="glass p-5 rounded-xl flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 text-indigo-400">
                    <UserCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Assigned Profile</p>
                    <h3 className="text-sm font-bold text-slate-100 mt-1">{profile.email}</h3>
                    <p className="text-[10px] text-indigo-400 font-semibold uppercase mt-0.5 tracking-wider">
                      Role: {profile.role_name.replace('_', ' ')}
                    </p>
                  </div>
                </div>
              )}

              {/* Database setup instructions */}
              <div className="glass p-6 rounded-xl border-slate-800 space-y-4">
                <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                  <Database className="w-4 h-4 text-indigo-500" />
                  <span>Database Schema & Migration Guide</span>
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  All system business logic is executed in the database layer via PostgreSQL triggers, functions, and RLS policies.
                  Ensure you run the schema migration and data seeding commands in your Supabase **SQL Editor**.
                </p>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Step 1: Execute Schema Migration</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Open the Supabase dashboard, navigate to the **SQL Editor**, and copy-paste the entire contents of the schema file:
                    <br />
                    <code className="text-[10px] text-indigo-300 mt-1 block">supabase/migrations/20260603000000_schema.sql</code>
                  </p>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Step 2: Seed Demo Inventory Sandbox</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Immediately after the schema is created, execute the seeding file to populate branches, recipes, and warehouse inventory:
                    <br />
                    <code className="text-[10px] text-indigo-300 mt-1 block">supabase/migrations/20260603000001_seed.sql</code>
                  </p>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Step 3: Enable Template Customization Table</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Execute the newly created system settings SQL script to support persistent document logo uploads and receipt templates:
                    <br />
                    <code className="text-[10px] text-indigo-300 mt-1 block">supabase/migrations/20260603000008_system_settings.sql</code>
                  </p>
                </div>
              </div>

              {/* First admin provision instruction */}
              <div className="glass p-6 rounded-xl border-indigo-500/20 bg-indigo-500/[0.01] space-y-4">
                <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Super Admin Provisioning (First-time Setup)</span>
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  By default, new users created in Supabase Auth are mapped to the lowest tier (`cashier`).
                  To register your primary Super Admin account:
                </p>

                <ol className="list-decimal pl-5 text-xs text-slate-400 space-y-2.5">
                  <li>
                    Go to the login screen and **Sign Up** a new user account with your desired credentials.
                  </li>
                  <li>
                    Open your Supabase **SQL Editor** and run the following script to elevate this account:
                    <pre className="bg-slate-900/90 text-indigo-300 p-3 rounded font-mono text-[10px] mt-1.5 border border-slate-800 select-all">
{`UPDATE public.profiles 
SET role_name = 'super_admin' 
WHERE email = 'your-admin-email@example.com';`}
                    </pre>
                    *(Replace <code className="text-indigo-400">your-admin-email@example.com</code> with the email address you signed up).*
                  </li>
                  <li>
                    Refresh the page and log in. You will have full Super Admin control, allowing you to create other staff, manage inventory, view analytics, and approve transfers!
                  </li>
                </ol>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              
              {/* --- COLUMN 1: TRANSFER SLIP TEMPLATE --- */}
              <div className="space-y-6">
                <div className="glass p-6 rounded-xl border-slate-800 space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                      <FileText className="w-4 h-4 text-indigo-500" />
                      <span>Transfer Slip Template Setup</span>
                    </h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleResetTransfer}
                        className="p-1 bg-slate-900 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-all"
                        title="Reset defaults"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {!isEditorRole && (
                    <div className="text-[11px] text-amber-400 bg-amber-500/5 p-2 rounded border border-amber-500/10">
                      ⚠️ Note: Only Super Admins and Inventory Managers can save configurations permanently to the database. Edits will save locally to your browser cache.
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Header Title */}
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Header Brand Title
                      </label>
                      <input
                        type="text"
                        value={transferSlip.header_title}
                        onChange={(e) => setTransferSlip(prev => ({ ...prev, header_title: e.target.value }))}
                        placeholder="e.g. RESTAURANT INVENTORY SYSTEM"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    {/* Header Subtitle */}
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Header Brand Subtitle
                      </label>
                      <input
                        type="text"
                        value={transferSlip.header_subtitle}
                        onChange={(e) => setTransferSlip(prev => ({ ...prev, header_subtitle: e.target.value }))}
                        placeholder="e.g. Kitchen & Stock Logistics Management"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    {/* Logo Image Upload */}
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Transfer Slip Logo (PNG/JPG)
                      </label>
                      <div className="mt-1 flex items-center space-x-4 p-3 bg-slate-950 border border-slate-800 border-dashed rounded-lg">
                        {transferSlip.logo_url ? (
                          <div className="relative w-16 h-16 bg-slate-900 border border-slate-800 rounded flex items-center justify-center p-1">
                            <img src={transferSlip.logo_url} className="max-w-full max-h-full object-contain rounded" />
                            <button
                              onClick={() => handleRemoveImage('transfer')}
                              className="absolute -top-1.5 -right-1.5 p-1 bg-red-600 rounded-full hover:bg-red-500 transition-all text-white"
                              title="Delete logo"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-650">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                        )}
                        <div className="flex-1">
                          <label className="inline-flex items-center space-x-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <span>Upload Image</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleImageUpload(e, 'transfer')}
                            />
                          </label>
                          <p className="text-[10px] text-slate-500 mt-1">Recommended size: max 120x60px, fits top-left.</p>
                        </div>
                      </div>
                    </div>

                    {/* Signature Settings */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Sender Signature Label
                        </label>
                        <input
                          type="text"
                          value={transferSlip.sender_label}
                          onChange={(e) => setTransferSlip(prev => ({ ...prev, sender_label: e.target.value }))}
                          placeholder="e.g. Dispatched By"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Receiver Signature Label
                        </label>
                        <input
                          type="text"
                          value={transferSlip.receiver_label}
                          onChange={(e) => setTransferSlip(prev => ({ ...prev, receiver_label: e.target.value }))}
                          placeholder="e.g. Received By"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Show signatures & Footer */}
                    <div className="flex items-center justify-between py-2 border-t border-b border-slate-900">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-200">Show Signature Lines</span>
                        <span className="text-[10px] text-slate-500">Render sender and receiver physical sign boxes</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={transferSlip.show_signatures}
                          onChange={(e) => setTransferSlip(prev => ({ ...prev, show_signatures: e.target.checked }))}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-300 after:border-slate-350 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Custom Receipt Footer Text
                      </label>
                      <input
                        type="text"
                        value={transferSlip.custom_footer}
                        onChange={(e) => setTransferSlip(prev => ({ ...prev, custom_footer: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveTransferConfig}
                    disabled={savingTransfer}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-xs font-bold shadow transition-all flex items-center justify-center space-x-1.5"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingTransfer ? 'Saving Transfer Config...' : 'Save Transfer Settings'}</span>
                  </button>
                </div>

                {/* TRANSFER SLIP LIVE PREVIEW */}
                <div className="glass p-5 rounded-xl border-slate-850 space-y-4">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center space-x-1.5">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Live Transfer Slip Preview (A4/PDF Header)</span>
                  </h4>
                  
                  <div className="bg-white text-slate-900 p-6 rounded-lg border border-slate-800 shadow-xl space-y-5 text-xs select-none">
                    {/* Header */}
                    <div className="flex justify-between items-center border-b-2 border-slate-200 pb-3">
                      <div className="flex items-center space-x-3">
                        {transferSlip.logo_url ? (
                          <img src={transferSlip.logo_url} className="max-h-8 max-w-[80px] object-contain" />
                        ) : (
                          <div className="w-8 h-8 bg-slate-100 border border-slate-200 rounded flex items-center justify-center text-slate-400 font-bold text-[10px]">
                            LOGO
                          </div>
                        )}
                        <div>
                          <div className="font-extrabold text-indigo-600 text-sm uppercase tracking-tight">
                            {transferSlip.header_title || 'RESTAURANT INVENTORY SYSTEM'}
                          </div>
                          <div className="text-[9px] text-slate-500 font-medium mt-0.5">
                            {transferSlip.header_subtitle || 'Kitchen & Stock Logistics Management'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] font-bold text-slate-400 uppercase">Transfer Slip</div>
                        <div className="text-[9px] font-bold text-indigo-500 mt-0.5">STATUS: DISPATCHED</div>
                      </div>
                    </div>

                    {/* Meta information */}
                    <div className="grid grid-cols-2 gap-4 text-[10px] border-b border-slate-100 pb-3">
                      <div>
                        <span className="text-slate-400 block font-bold uppercase text-[8px]">Control Number</span>
                        <span className="font-bold text-indigo-600 text-[11px]">TS-2026-00042</span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 block font-bold uppercase text-[8px]">Issue Date</span>
                        <span className="font-medium text-slate-700">06/04/2026, 1:24 PM</span>
                      </div>
                    </div>

                    {/* Table Placeholder */}
                    <div className="p-3 bg-slate-50 rounded border border-slate-100 text-center text-slate-400 font-medium text-[10px] border-dashed">
                      [ Transfer Item Breakdown Table - Plotted Here ]
                    </div>

                    {/* Signatures */}
                    {transferSlip.show_signatures && (
                      <div className="grid grid-cols-2 gap-6 pt-5">
                        <div className="border-t border-slate-300 border-dashed pt-2 text-center">
                          <div className="font-bold text-slate-600 text-[9px]">{transferSlip.sender_label || 'Dispatched By'}</div>
                          <div className="text-[7px] text-slate-400 mt-0.5">Sender Authorized Signature</div>
                        </div>
                        <div className="border-t border-slate-300 border-dashed pt-2 text-center">
                          <div className="font-bold text-slate-600 text-[9px]">{transferSlip.receiver_label || 'Received By'}</div>
                          <div className="text-[7px] text-slate-400 mt-0.5">Receiver Authorized Signature</div>
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="text-center text-[9px] text-slate-400 pt-3 border-t border-slate-100 mt-2">
                      {transferSlip.custom_footer || 'Kitchen & Stock Logistics Management'}
                    </div>
                  </div>
                </div>
              </div>

              {/* --- COLUMN 2: SALES INVOICE (THERMAL) TEMPLATE --- */}
              <div className="space-y-6">
                <div className="glass p-6 rounded-xl border-slate-800 space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2">
                      <Printer className="w-4 h-4 text-emerald-500" />
                      <span>Sales Invoice (Thermal) Setup</span>
                    </h3>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={handleResetInvoice}
                        className="p-1 bg-slate-900 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-all"
                        title="Reset defaults"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {!isEditorRole && (
                    <div className="text-[11px] text-amber-400 bg-amber-500/5 p-2 rounded border border-amber-500/10">
                      ⚠️ Note: Only Super Admins and Inventory Managers can save configurations permanently to the database. Edits will save locally to your browser cache.
                    </div>
                  )}

                  <div className="space-y-4">
                    {/* Merchant Name */}
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Merchant Store Name
                      </label>
                      <input
                        type="text"
                        value={salesInvoice.merchant_name}
                        onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_name: e.target.value }))}
                        placeholder="e.g. DR HUMBA FOODS INC"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    {/* Merchant Details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Merchant Address
                        </label>
                        <input
                          type="text"
                          value={salesInvoice.merchant_address}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_address: e.target.value }))}
                          placeholder="e.g. 123 Main St, Manila"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Contact / Telephone
                        </label>
                        <input
                          type="text"
                          value={salesInvoice.merchant_contact}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_contact: e.target.value }))}
                          placeholder="e.g. +63 912 345 6789"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Merchant TIN & Header Text */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Tax Identification No. (TIN)
                        </label>
                        <input
                          type="text"
                          value={salesInvoice.merchant_tin}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, merchant_tin: e.target.value }))}
                          placeholder="e.g. TIN: 123-456-789-000"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Receipt Header Title Text
                        </label>
                        <input
                          type="text"
                          value={salesInvoice.header_text}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, header_text: e.target.value }))}
                          placeholder="e.g. SALES INVOICE"
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Logo Image Upload (Thermal) */}
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Invoice Logo (PNG/JPG/SVG)
                      </label>
                      <div className="mt-1 flex items-center space-x-4 p-3 bg-slate-950 border border-slate-800 border-dashed rounded-lg">
                        {salesInvoice.logo_url ? (
                          <div className="relative w-16 h-16 bg-slate-900 border border-slate-800 rounded flex items-center justify-center p-1">
                            <img src={salesInvoice.logo_url} className="max-w-full max-h-full object-contain rounded" />
                            <button
                              onClick={() => handleRemoveImage('sales')}
                              className="absolute -top-1.5 -right-1.5 p-1 bg-red-600 rounded-full hover:bg-red-500 transition-all text-white"
                              title="Delete logo"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-650">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                        )}
                        <div className="flex-1">
                          <label className="inline-flex items-center space-x-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer">
                            <Upload className="w-3.5 h-3.5" />
                            <span>Upload Image</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => handleImageUpload(e, 'sales')}
                            />
                          </label>
                          <p className="text-[10px] text-slate-500 mt-1">Logo prints in greyscale on thermal receipts.</p>
                        </div>
                      </div>
                    </div>

                    {/* Formatting presets */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Paper Width Profile
                        </label>
                        <select
                          value={salesInvoice.paper_width}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, paper_width: e.target.value as any }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                          <option value="58mm">58 mm (Standard Receipt)</option>
                          <option value="80mm">80 mm (Wide Receipt)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                          Font Size Presets
                        </label>
                        <select
                          value={salesInvoice.font_size}
                          onChange={(e) => setSalesInvoice(prev => ({ ...prev, font_size: e.target.value as any }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                        >
                          <option value="small">Small (9px)</option>
                          <option value="medium">Medium (12px)</option>
                          <option value="large">Large (14px)</option>
                        </select>
                      </div>
                    </div>

                    {/* Footer text */}
                    <div>
                      <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">
                        Receipt Custom Notes & Footer Message
                      </label>
                      <textarea
                        rows={2}
                        value={salesInvoice.footer_text}
                        onChange={(e) => setSalesInvoice(prev => ({ ...prev, footer_text: e.target.value }))}
                        placeholder="Thank you for dining with us!..."
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveInvoiceConfig}
                    disabled={savingInvoice}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-xs font-bold shadow transition-all flex items-center justify-center space-x-1.5"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingInvoice ? 'Saving Invoice Config...' : 'Save Invoice Settings'}</span>
                  </button>
                </div>

                {/* THERMAL INVOICE LIVE PREVIEW */}
                <div className="glass p-5 rounded-xl border-slate-850 space-y-4">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center space-x-1.5">
                    <Eye className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Live Thermal Invoice Preview (Monospace POS Roll)</span>
                  </h4>

                  <div className="flex justify-center bg-slate-900 p-6 rounded-lg border border-slate-850/80">
                    <div 
                      className="bg-white text-slate-950 p-4 border border-slate-350 shadow-2xl transition-all duration-300 font-mono relative"
                      style={{ 
                        width: salesInvoice.paper_width === '58mm' ? '192px' : '272px',
                        fontSize: salesInvoice.font_size === 'small' ? '9px' : salesInvoice.font_size === 'large' ? '12px' : '10.5px',
                        lineHeight: '1.2'
                      }}
                    >
                      {/* Logo */}
                      {salesInvoice.logo_url ? (
                        <div className="text-center mb-2">
                          <img src={salesInvoice.logo_url} className="max-h-10 max-w-[80px] object-contain mx-auto filter grayscale" />
                        </div>
                      ) : (
                        <div className="text-center text-[8px] text-slate-400 border border-dashed border-slate-300 py-1 mb-1.5">
                          [ NO STORE LOGO ]
                        </div>
                      )}

                      {/* Header */}
                      <div className="text-center bold uppercase text-xs">
                        {salesInvoice.merchant_name || 'RESTOChain Foods'}
                      </div>
                      <div className="text-center text-[8.5px] mt-0.5">
                        {salesInvoice.merchant_address || '123 Main St, Metro Manila'}
                      </div>
                      <div className="text-center text-[8.5px]">
                        {salesInvoice.merchant_contact || '+63 912 345 6789'}
                      </div>
                      <div className="text-center text-[8.5px] mb-1">
                        {salesInvoice.merchant_tin || 'TIN: 000-123-456-000'}
                      </div>

                      <div className="border-t border-slate-400 border-dashed my-1.5"></div>

                      <div className="text-center bold text-[11px] tracking-wide my-1">
                        {salesInvoice.header_text || 'SALES INVOICE'}
                      </div>

                      <div className="border-t border-slate-400 border-dashed my-1.5"></div>

                      {/* Meta */}
                      <div className="space-y-0.5 text-[8.5px]">
                        <div className="flex justify-between">
                          <span>DATE:</span>
                          <span>06/04/2026, 1:24 PM</span>
                        </div>
                        <div className="flex justify-between">
                          <span>INVOICE:</span>
                          <span>9B570D73...</span>
                        </div>
                        <div className="flex justify-between">
                          <span>CASHIER:</span>
                          <span>admin</span>
                        </div>
                      </div>

                      <div className="border-t border-slate-400 border-dashed my-1.5"></div>

                      {/* Items */}
                      <div className="space-y-1 text-[8.5px]">
                        <div>
                          <div className="bold uppercase">CHEESEBURGER DELUXE</div>
                          <div className="flex justify-between">
                            <span>  2 x ₱180.00</span>
                            <span>₱360.00</span>
                          </div>
                        </div>
                        <div>
                          <div className="bold uppercase">FRENCH FRIES LG</div>
                          <div className="flex justify-between">
                            <span>  1 x ₱95.00</span>
                            <span>₱95.00</span>
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-slate-400 border-dashed my-1.5"></div>

                      {/* Total */}
                      <div className="flex justify-between bold text-[11px]">
                        <span>TOTAL:</span>
                        <span>₱455.00</span>
                      </div>

                      <div className="border-t border-slate-400 border-dashed my-1.5"></div>

                      {/* Footer text */}
                      <div className="text-center text-[8.5px] whitespace-pre-line text-slate-700 italic">
                        {salesInvoice.footer_text || 'Thank you for dining with us!\nCome back again!'}
                      </div>

                      <div className="text-center text-[7px] text-slate-400 mt-3 pt-1 border-t border-slate-100">
                        RESTOChain Cloud POS
                      </div>
                      
                      {/* Thermal receipt jagged bottom decoration */}
                      <div className="absolute left-0 right-0 -bottom-2 h-2.5 overflow-hidden flex">
                        {Array.from({ length: 30 }).map((_, i) => (
                          <div key={i} className="w-2.5 h-2.5 bg-slate-900 rotate-45 transform origin-top-left -mt-1 border-r border-b border-slate-800"></div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
            </div>
          )}
        </div>
      )}
    </div>
  );
};
