import { supabase } from './supabase';

export interface TransferSlipTemplate {
  header_title: string;
  header_subtitle: string;
  logo_url: string; // Base64 data URL
  custom_footer: string;
  sender_label: string;
  receiver_label: string;
  show_signatures: boolean;
}

export interface SalesInvoiceTemplate {
  merchant_name: string;
  merchant_address: string;
  merchant_contact: string;
  merchant_tin: string;
  logo_url: string; // Base64 data URL
  header_text: string;
  footer_text: string;
  paper_width: '58mm' | '80mm';
  font_size: 'small' | 'medium' | 'large';
}

export interface CustomerPromotion {
  title: string;
  desc: string;
  image: string; // Used for badge/tag e.g. "🔥 Chef Recommended"
  color: string; // Gradient preset, e.g. "from-pink-500 to-rose-600"
}

export interface SystemSettings {
  transfer_slip: TransferSlipTemplate;
  sales_invoice: SalesInvoiceTemplate;
  customer_promotions: CustomerPromotion[];
}

export const DEFAULT_TRANSFER_SLIP_TEMPLATE: TransferSlipTemplate = {
  header_title: 'RESTAURANT INVENTORY SYSTEM',
  header_subtitle: 'Kitchen & Stock Logistics Management',
  logo_url: '',
  custom_footer: 'Kitchen & Stock Logistics Management',
  sender_label: 'Dispatched By (Sender Signature)',
  receiver_label: 'Received By (Receiver Signature)',
  show_signatures: true,
};

export const DEFAULT_SALES_INVOICE_TEMPLATE: SalesInvoiceTemplate = {
  merchant_name: 'Dr Humba',
  merchant_address: '123 Main St, Metro Manila',
  merchant_contact: '+63 912 345 6789',
  merchant_tin: 'TIN: 000-123-456-000',
  logo_url: '',
  header_text: 'SALES INVOICE',
  footer_text: 'Thank you for dining with us!\nCome back again!',
  paper_width: '58mm',
  font_size: 'medium',
};

export const DEFAULT_PROMOTIONS: CustomerPromotion[] = [
  {
    title: "Today's Special: Dr. Humba Platter",
    desc: "Get 15% off on our signature premium family platter. Fresh ingredients, direct from farm!",
    image: "🔥 Chef Recommended",
    color: "from-pink-500 to-rose-600",
  },
  {
    title: "Double the Freshness, Double the Joy!",
    desc: "Pair any meal with our fresh house blend iced tea for just ₱49.",
    image: "🥤 Refreshing Choice",
    color: "from-amber-500 to-orange-600",
  },
  {
    title: "Join Our Loyalty Program",
    desc: "Ask the cashier to sign up today! Earn 1 point per ₱100 spent and redeem exciting food rewards.",
    image: "✨ Membership Rewards",
    color: "from-purple-500 to-indigo-600",
  }
];

export const settingsService = {
  async getSettings(): Promise<SystemSettings> {
    const settings: SystemSettings = {
      transfer_slip: { ...DEFAULT_TRANSFER_SLIP_TEMPLATE },
      sales_invoice: { ...DEFAULT_SALES_INVOICE_TEMPLATE },
      customer_promotions: [...DEFAULT_PROMOTIONS],
    };

    // Load from database if possible
    try {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*');

      if (error) {
        throw error;
      }

      if (data && data.length > 0) {
        data.forEach((row: any) => {
          if (row.key === 'transfer_slip') {
            settings.transfer_slip = { ...DEFAULT_TRANSFER_SLIP_TEMPLATE, ...row.value };
          } else if (row.key === 'sales_invoice') {
            settings.sales_invoice = { ...DEFAULT_SALES_INVOICE_TEMPLATE, ...row.value };
          } else if (row.key === 'customer_promotions') {
            settings.customer_promotions = Array.isArray(row.value) ? row.value : [...DEFAULT_PROMOTIONS];
          }
        });

        // Cache to localStorage in case we go offline
        localStorage.setItem('system_settings', JSON.stringify(settings));
      } else {
        // Empty db table, try local storage fallback
        const local = localStorage.getItem('system_settings');
        if (local) {
          try {
            const parsed = JSON.parse(local);
            if (parsed.transfer_slip) settings.transfer_slip = { ...settings.transfer_slip, ...parsed.transfer_slip };
            if (parsed.sales_invoice) settings.sales_invoice = { ...settings.sales_invoice, ...parsed.sales_invoice };
            if (parsed.customer_promotions) settings.customer_promotions = parsed.customer_promotions;
          } catch (e) {
            console.error('Failed to parse localStorage settings:', e);
          }
        }
      }
    } catch (err) {
      console.warn('Supabase system_settings table not accessible, falling back to localStorage:', err);
      const local = localStorage.getItem('system_settings');
      if (local) {
        try {
          const parsed = JSON.parse(local);
          if (parsed.transfer_slip) settings.transfer_slip = { ...settings.transfer_slip, ...parsed.transfer_slip };
          if (parsed.sales_invoice) settings.sales_invoice = { ...settings.sales_invoice, ...parsed.sales_invoice };
          if (parsed.customer_promotions) settings.customer_promotions = parsed.customer_promotions;
        } catch (e) {
          console.error('Failed to parse localStorage settings:', e);
        }
      }
    }

    return settings;
  },

  async saveSettings(
    key: 'transfer_slip' | 'sales_invoice' | 'customer_promotions', 
    value: any, 
    userId?: string, 
    tenantId?: string
  ): Promise<boolean> {
    // Save to local storage first
    try {
      const local = localStorage.getItem('system_settings');
      const parsed = local ? JSON.parse(local) : {};
      parsed[key] = value;
      localStorage.setItem('system_settings', JSON.stringify(parsed));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }

    // Save to database
    try {
      let activeTenantId = tenantId;
      if (!activeTenantId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', user.id)
            .single();
          if (profile) {
            activeTenantId = profile.tenant_id;
          }
        }
      }

      if (!activeTenantId) {
        console.warn('No active tenant ID found for saving settings.');
        return false;
      }

      const { error } = await supabase
        .from('system_settings')
        .upsert({
          tenant_id: activeTenantId,
          key,
          value,
          updated_at: new Date().toISOString(),
          updated_by: userId || null,
        }, { onConflict: 'tenant_id,key' });

      if (error) throw error;
      return true;
    } catch (err) {
      console.warn('Failed to upsert to system_settings in Supabase, stored locally:', err);
      return false;
    }
  }
};
