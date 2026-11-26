import { supabase } from './supabase';

// Tenant-wide switch stored in system_settings (key 'void_approval').
// The server enforces it in fn_void_sale_items / fn_request_void; the UI only mirrors it.
const SETTING_KEY = 'void_approval';

export const VOID_APPROVER_ROLES = ['super_admin', 'branch_manager', 'inventory_manager'];

type ProfileLike = { role_name?: string; is_platform_admin?: boolean; allowed_tabs?: string[] | null } | null | undefined;

export function canApproveVoids(profile: ProfileLike): boolean {
  if (!profile) return false;
  return (
    VOID_APPROVER_ROLES.includes(profile.role_name || '') ||
    Boolean(profile.is_platform_admin) ||
    Boolean(profile.allowed_tabs?.includes('sales_void_approve'))
  );
}

export async function fetchVoidApprovalRequired(): Promise<boolean> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', SETTING_KEY)
    .maybeSingle();
  if (error) throw error;
  return Boolean((data?.value as { require_approval?: boolean } | null)?.require_approval);
}

export async function saveVoidApprovalRequired(required: boolean, tenantId: string, userId?: string): Promise<void> {
  const { error } = await supabase
    .from('system_settings')
    .upsert({
      tenant_id: tenantId,
      key: SETTING_KEY,
      value: { require_approval: required },
      updated_at: new Date().toISOString(),
      updated_by: userId || null,
    }, { onConflict: 'tenant_id,key' });
  if (error) throw error;
}

export interface VoidRequest {
  id: string;
  sale_id: string;
  branch_id: string;
  items: Array<{ sale_item_id: string; quantity_to_void: number }> | null;
  refund_amount: number;
  void_reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
}
