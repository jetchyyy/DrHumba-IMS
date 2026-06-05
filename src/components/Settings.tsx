import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Settings as SettingsIcon, Database, ShieldCheck, UserCheck, Terminal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';

export const Settings: React.FC = () => {
  const { profile } = useAuth();

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2.5">
          <SettingsIcon className="w-8 h-8 text-primary" />
          <span>System Settings & Setup Guide</span>
        </h2>
        <p className="text-muted-foreground mt-1">Database migration coordinates and corporate administrative setup guides.</p>
      </div>

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
          </CardContent>
        </Card>

        {/* First admin provision instruction */}
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
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
    </div>
  );
};
