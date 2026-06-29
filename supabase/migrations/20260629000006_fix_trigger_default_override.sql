-- ============================================================
-- MIGRATION: Fix Tenant Stamp Trigger Default Override
-- ============================================================

-- Redefine fn_auto_stamp_tenant_id to handle cases where PostgreSQL 
-- pre-populates column defaults (e.g. '00000000-0000-0000-0000-000000000000') before trigger execution.
CREATE OR REPLACE FUNCTION public.fn_auto_stamp_tenant_id()
RETURNS TRIGGER AS $$
DECLARE
    v_user_tenant_id UUID;
BEGIN
  -- If tenant_id is NULL or equals the default tenant ID, attempt to stamp it with the active session tenant ID
  IF NEW.tenant_id IS NULL OR NEW.tenant_id = '00000000-0000-0000-0000-000000000000' THEN
    v_user_tenant_id := public.get_my_tenant_id();
    IF v_user_tenant_id IS NOT NULL THEN
      NEW.tenant_id := v_user_tenant_id;
    END IF;
  END IF;

  -- Fallback validation
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Cannot determine tenant_id for new row in table %. Ensure the user has a valid tenant association.', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
