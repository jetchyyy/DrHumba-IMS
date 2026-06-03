import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Settings as SettingsIcon, Database, ShieldCheck, UserCheck, Terminal } from 'lucide-react';

export const Settings: React.FC = () => {
  const { profile } = useAuth();

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2.5">
          <SettingsIcon className="w-6 h-6 text-indigo-500" />
          <span>System Settings & Setup Guide</span>
        </h2>
        <p className="text-sm text-slate-400">Database migration coordinates and corporate administrative setup guides.</p>
      </div>

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
    </div>
  );
};
