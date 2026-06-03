export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      branches: {
        Row: {
          id: string;
          name: string;
          is_warehouse: boolean;
          location: string | null;
          created_at: string;
          updated_at: string;
        }
        Insert: {
          id?: string;
          name: string;
          is_warehouse?: boolean;
          location?: string | null;
          created_at?: string;
          updated_at?: string;
        }
        Update: {
          id?: string;
          name?: string;
          is_warehouse?: boolean;
          location?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      }
      profiles: {
        Row: {
          id: string;
          email: string;
          role_name: 'super_admin' | 'inventory_manager' | 'branch_manager' | 'cashier' | 'auditor';
          branch_id: string | null;
          created_at: string;
          updated_at: string;
        }
        Insert: {
          id: string;
          email: string;
          role_name: 'super_admin' | 'inventory_manager' | 'branch_manager' | 'cashier' | 'auditor';
          branch_id?: string | null;
          created_at?: string;
          updated_at?: string;
        }
        Update: {
          id?: string;
          email?: string;
          role_name?: 'super_admin' | 'inventory_manager' | 'branch_manager' | 'cashier' | 'auditor';
          branch_id?: string | null;
          created_at?: string;
          updated_at?: string;
        }
      }
      inventory_items: {
        Row: {
          id: string;
          sku: string;
          item_name: string;
          category: string;
          base_unit: string;
          purchase_unit: string;
          conversion_factor: number;
          reorder_level: number;
          cost_per_base_unit: number;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        }
        Insert: {
          id?: string;
          sku: string;
          item_name: string;
          category: string;
          base_unit: string;
          purchase_unit: string;
          conversion_factor: number;
          reorder_level: number;
          cost_per_base_unit: number;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        }
        Update: {
          id?: string;
          sku?: string;
          item_name?: string;
          category?: string;
          base_unit?: string;
          purchase_unit?: string;
          conversion_factor?: number;
          reorder_level?: number;
          cost_per_base_unit?: number;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        }
      }
    }
  }
}
