-- ============================================================
-- MIGRATION: Fix Kitchen Receipts Tenant-Scoped Unique Control Number
-- ============================================================

-- Drop global unique constraint on control_number
ALTER TABLE public.kitchen_receipts DROP CONSTRAINT IF EXISTS kitchen_receipts_control_number_key;

-- Add tenant-scoped unique constraint on (tenant_id, control_number)
ALTER TABLE public.kitchen_receipts DROP CONSTRAINT IF EXISTS kitchen_receipts_tenant_control_number_key;
ALTER TABLE public.kitchen_receipts ADD CONSTRAINT kitchen_receipts_tenant_control_number_key UNIQUE (tenant_id, control_number);
