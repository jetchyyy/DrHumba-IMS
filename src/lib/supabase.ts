import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables in .env file');
}

const getSubdomain = (): string | null => {
  if (typeof window === 'undefined') return null;
  const hostname = window.location.hostname;
  
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return null;
  }

  const parts = hostname.split('.');
  if (parts.length > 1) {
    if (parts[0] === 'erp' && parts.length > 2) {
      return parts[1];
    }
    return parts[0];
  }
  return null;
};

const subdomain = getSubdomain();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      ...(subdomain ? { 'x-tenant-subdomain': subdomain.toLowerCase() } : {})
    }
  }
});
export type { User } from '@supabase/supabase-js';
export type { Database } from '../types/supabase';
