-- Transfer drafts: let staff save a transfer request or stock shipment and
-- finalize it later. Drafts live in their own table so they never touch stock,
-- never consume a control number, and never show up in transfer reports.

CREATE TABLE IF NOT EXISTS public.transfer_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    -- 'request' finalizes through fn_request_transfer, 'send' through fn_send_transfer
    draft_type TEXT NOT NULL CHECK (draft_type IN ('request', 'send')),
    source_branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    target_branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    -- Same shape as the p_items payload of fn_request_transfer / fn_send_transfer
    items JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transfer_drafts_tenant ON public.transfer_drafts (tenant_id);

DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_transfer_drafts ON public.transfer_drafts;
CREATE TRIGGER tg_auto_stamp_tenant_transfer_drafts
  BEFORE INSERT ON public.transfer_drafts
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();

ALTER TABLE public.transfer_drafts ENABLE ROW LEVEL SECURITY;

-- A draft belongs to the side that is preparing it: the requesting (target)
-- branch for requests, the dispatching (source) branch for shipments.
DROP POLICY IF EXISTS "Manage transfer drafts" ON public.transfer_drafts;
CREATE POLICY "Manage transfer drafts" ON public.transfer_drafts FOR ALL TO authenticated
    USING (
        tenant_id = public.get_my_tenant_id() AND (
            created_by = auth.uid() OR
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() = CASE WHEN draft_type = 'request' THEN target_branch_id ELSE source_branch_id END
        )
    )
    WITH CHECK (
        tenant_id = public.get_my_tenant_id() AND (
            created_by = auth.uid() OR
            public.get_my_role() IN ('super_admin', 'inventory_manager') OR
            public.get_my_branch_id() = CASE WHEN draft_type = 'request' THEN target_branch_id ELSE source_branch_id END
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transfer_drafts TO authenticated;


-- Finalize a draft: run it through the normal request/send function (so all of
-- its stock, minimum-quantity and permission checks apply) and remove the draft
-- in the same transaction.
CREATE OR REPLACE FUNCTION public.fn_submit_transfer_draft(
    p_draft_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_draft public.transfer_drafts%ROWTYPE;
    v_transfer_id UUID;
BEGIN
    SELECT * INTO v_draft
    FROM public.transfer_drafts
    WHERE id = p_draft_id
      AND tenant_id = public.get_my_tenant_id()
      AND (
          created_by = auth.uid() OR
          public.get_my_role() IN ('super_admin', 'inventory_manager') OR
          public.get_my_branch_id() = CASE WHEN draft_type = 'request' THEN target_branch_id ELSE source_branch_id END
      )
    FOR UPDATE;

    IF v_draft.id IS NULL THEN
        RAISE EXCEPTION 'Draft not found or already submitted.';
    END IF;

    IF jsonb_array_length(v_draft.items) = 0 THEN
        RAISE EXCEPTION 'Add at least one item before submitting this draft.';
    END IF;

    IF v_draft.draft_type = 'send' THEN
        v_transfer_id := public.fn_send_transfer(v_draft.source_branch_id, v_draft.target_branch_id, v_draft.items);
    ELSE
        v_transfer_id := public.fn_request_transfer(v_draft.source_branch_id, v_draft.target_branch_id, v_draft.items);
    END IF;

    DELETE FROM public.transfer_drafts WHERE id = p_draft_id;

    RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.fn_submit_transfer_draft(UUID) TO authenticated;
