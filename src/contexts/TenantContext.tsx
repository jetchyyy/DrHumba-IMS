import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Tenant {
  id: string;
  name: string;
  subdomain: string | null;
  plan_type: 'starter' | 'professional' | 'enterprise';
  billing_cycle: 'monthly' | 'yearly';
  status: 'pending' | 'active' | 'suspended';
  max_branches: number;
  max_users: number;
  features: {
    pos: boolean;
    sales_history: boolean;
    inventory: boolean;
    global_inventory: boolean;
    receiving: boolean;
    transfers: boolean;
    adjustments: boolean;
    transactions: boolean;
    recipes: boolean;
    branches: boolean;
    analytics: boolean;
    audit_logs: boolean;
    users: boolean;
    settings: boolean;
  };
  logo_url: string | null;
  created_at: string;
  is_restaurant?: boolean;
  is_retail?: boolean;
  is_service?: boolean;
}

interface TenantContextType {
  tenant: Tenant | null;
  tenantLoading: boolean;
  tenantError: 'not_found' | 'suspended' | null;
  isSingleTenantMode: boolean;
  platformAdmin: boolean;
  setPlatformAdmin: (admin: boolean) => void;
  refreshTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

// Subdomain extraction helper
export const getSubdomain = (): string | null => {
  const hostname = window.location.hostname;
  const mainDomainEnv = import.meta.env.VITE_MAIN_DOMAIN || 'localhost';
  const mainDomain = mainDomainEnv.split(':')[0]; // Remove port if present

  if (hostname === mainDomain || hostname === 'localhost' || hostname === '127.0.0.1') {
    return null;
  }

  if (hostname.endsWith(mainDomain)) {
    const prefix = hostname.slice(0, -mainDomain.length - 1); // e.g. "erp.pizzahut" or "pizzahut"
    const parts = prefix.split('.');
    if (parts.length > 1 && parts[0] === 'erp') {
      return parts[1];
    }
    return parts[parts.length - 1];
  }

  // Fallback: tenant.localhost
  const parts = hostname.split('.');
  if (parts.length > 1) {
    if (parts[0] === 'erp' && parts.length > 2) {
      return parts[1];
    }
    return parts[0];
  }

  return null;
};

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [tenantError, setTenantError] = useState<'not_found' | 'suspended' | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState(false);

  const isSingleTenantMode = import.meta.env.VITE_TENANT_MODE === 'single';
  const primaryTenantId = import.meta.env.VITE_PRIMARY_TENANT_ID || '00000000-0000-0000-0000-000000000000';

  const loadTenant = async () => {
    setTenantLoading(true);
    setTenantError(null);
    try {
      if (isSingleTenantMode) {
        // Fetch static tenant (Dr. Humba)
        const { data, error } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', primaryTenantId)
          .single();

        if (error) throw error;
        setTenant(data);
      } else {
        // Multi-tenant subdomain resolution
        const subdomain = getSubdomain();

        if (!subdomain) {
          // We are on the root domain (Landing Page / Apply / Odc)
          setTenant(null);
        } else {
          // Fetch tenant by subdomain
          const { data, error } = await supabase
            .from('tenants')
            .select('*')
            .eq('subdomain', subdomain.toLowerCase())
            .single();

          if (error || !data) {
            setTenantError('not_found');
            setTenant(null);
          } else if (data.status === 'suspended') {
            setTenantError('suspended');
            setTenant(data);
          } else {
            setTenant(data);
          }
        }
      }
    } catch (err) {
      console.error('Error loading tenant context:', err);
      if (!isSingleTenantMode) {
        setTenantError('not_found');
      }
    } finally {
      setTenantLoading(false);
    }
  };

  useEffect(() => {
    loadTenant();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const isDrHumba = isSingleTenantMode;
    
    const favicon = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
    const appleIcon = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement;

    if (isDrHumba) {
      // Dr. Humba Pink theme (HSL 336 80% 57%)
      root.style.setProperty('--primary', '336 80% 57%');
      root.style.setProperty('--primary-foreground', '0 0% 100%');
      
      document.title = "Dr. Humba Management System";
      if (favicon) favicon.href = "/drhumbalogo.jpg";
      if (appleIcon) appleIcon.href = "/drhumbalogo-192.png";
    } else {
      // General SaaS Tenant Indigo theme (HSL 250 84% 54%)
      root.style.setProperty('--primary', '250 84% 54%');
      root.style.setProperty('--primary-foreground', '0 0% 100%');
      
      if (tenant) {
        document.title = `${tenant.name} - Inventory System`;
        const logoUrl = tenant.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/saaslogo.png";
        if (favicon) favicon.href = logoUrl;
        if (appleIcon) appleIcon.href = logoUrl;
      } else {
        // SaaS Landing Page / Root Domain
        const appName = import.meta.env.VITE_DEFAULT_APP_NAME || "ERPSaaS";
        document.title = `${appName} - Smart Operations ERP`;
        const defaultLogo = import.meta.env.VITE_DEFAULT_LOGO || "/saaslogo.png";
        if (favicon) favicon.href = defaultLogo;
        if (appleIcon) appleIcon.href = defaultLogo;
      }
    }

    // Dynamic PWA Manifest Injection
    try {
      const appName = isDrHumba ? "Dr. Humba" : (tenant?.name || "ERPSaaS");
      const appDescription = isDrHumba 
        ? "Restaurant inventory and settings management system for Dr. Humba." 
        : `Management system for ${appName}.`;
      const logoUrl = isDrHumba 
        ? "/drhumbalogo-192.png" 
        : (tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/saaslogo.png");
      const logoUrl512 = isDrHumba 
        ? "/drhumbalogo-512.png" 
        : (tenant?.logo_url || import.meta.env.VITE_DEFAULT_LOGO || "/saaslogo.png");

      const myDynamicManifest = {
        name: `${appName} Management System`,
        short_name: appName,
        description: appDescription,
        start_url: window.location.origin + "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        orientation: "any",
        icons: [
          {
            src: logoUrl,
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: logoUrl,
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: logoUrl512,
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: logoUrl512,
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      };

      const stringManifest = JSON.stringify(myDynamicManifest);
      const blob = new Blob([stringManifest], { type: 'application/json' });
      const manifestURL = URL.createObjectURL(blob);

      let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement;
      if (manifestLink) {
        manifestLink.href = manifestURL;
      } else {
        manifestLink = document.createElement('link');
        manifestLink.rel = 'manifest';
        manifestLink.href = manifestURL;
        document.head.appendChild(manifestLink);
      }
    } catch (e) {
      console.error('Failed to inject dynamic PWA manifest:', e);
    }
  }, [tenant, isSingleTenantMode]);

  return (
    <TenantContext.Provider
      value={{
        tenant,
        tenantLoading,
        tenantError,
        isSingleTenantMode,
        platformAdmin,
        setPlatformAdmin,
        refreshTenant: loadTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
