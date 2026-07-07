-- ============================================================
-- MIGRATION: Convert Global Unique Constraints to Tenant Composite Constraints
-- ============================================================

-- 1. sales table
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_control_number_key;
ALTER TABLE public.sales ADD CONSTRAINT sales_tenant_control_number_key UNIQUE (tenant_id, control_number);

-- 2. stock_receipts table
ALTER TABLE public.stock_receipts DROP CONSTRAINT IF EXISTS stock_receipts_control_number_key;
ALTER TABLE public.stock_receipts ADD CONSTRAINT stock_receipts_tenant_control_number_key UNIQUE (tenant_id, control_number);

-- 3. stock_adjustments table
ALTER TABLE public.stock_adjustments DROP CONSTRAINT IF EXISTS stock_adjustments_control_number_key;
ALTER TABLE public.stock_adjustments ADD CONSTRAINT stock_adjustments_tenant_control_number_key UNIQUE (tenant_id, control_number);

-- 4. transfer_requests table
ALTER TABLE public.transfer_requests DROP CONSTRAINT IF EXISTS transfer_requests_control_number_key;
ALTER TABLE public.transfer_requests ADD CONSTRAINT transfer_requests_tenant_control_number_key UNIQUE (tenant_id, control_number);

-- 5. cashier_sessions table
ALTER TABLE public.cashier_sessions DROP CONSTRAINT IF EXISTS cashier_sessions_control_number_key;
ALTER TABLE public.cashier_sessions ADD CONSTRAINT cashier_sessions_tenant_control_number_key UNIQUE (tenant_id, control_number);
