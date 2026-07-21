# AI Agent & Developer Guidelines: Multi-Tenancy & Data Isolation

This repository is a multi-tenant POS, inventory, and restaurant management system. To ensure database safety, clean data isolation, and feature consistency, all AI coding agents and human developers must strictly follow the architectural standards defined below.

---

## 1. Multi-Tenant Architecture & Data Isolation

Data isolation is enforced at the database level using Postgres Row Level Security (RLS) policies.

* **Tenant Identification:** All tenant-specific tables must contain a `tenant_id` column:
  ```sql
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'
  ```
* **Production Default Tenant:** The default production tenant is **Dr. Humba** with UUID:
  `00000000-0000-0000-0000-000000000000`
* **Row Level Security (RLS):** Always enable RLS on newly created tables and restrict reads/writes using tenant functions:
  ```sql
  ALTER TABLE public.your_table_name ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Read access by tenant" ON public.your_table_name FOR SELECT TO authenticated 
      USING (tenant_id = public.get_my_tenant_id());
  ```
* **Auto-Stamping Tenant Trigger:** To prevent RLS violation inserts, register the tenant auto-stamping trigger for every tenant-scoped table:
  ```sql
  DROP TRIGGER IF EXISTS tg_auto_stamp_tenant_your_table_name ON public.your_table_name;
  CREATE TRIGGER tg_auto_stamp_tenant_your_table_name
    BEFORE INSERT ON public.your_table_name
    FOR EACH ROW EXECUTE FUNCTION public.fn_auto_stamp_tenant_id();
  ```
* **Composite Unique Constraints:** Never declare columns like `sku`, `control_number`, or serials as globally `UNIQUE`. They must be composite unique keys scoped to the tenant to prevent cross-tenant insertion collisions:
  ```sql
  UNIQUE (tenant_id, control_number)
  ```
* **Atomic Control Sequences:** When updating sequence counters in the `control_number_sequences` tracker, specify `tenant_id` to use the composite primary key:
  ```sql
  INSERT INTO public.control_number_sequences (tenant_id, sequence_name, current_val)
  VALUES (NEW.tenant_id, v_prefix, 1)
  ON CONFLICT (tenant_id, sequence_name) DO UPDATE
  SET current_val = public.control_number_sequences.current_val + 1;
  ```

---

## 2. Database Migration Standards

* Migrations must be placed in `supabase/migrations/` and structured as raw, idempotent SQL.
* Before pushing new migrations, always check if your tables or triggers already exist on the remote database.
* To verify and push migrations to the remote database:
  `supabase db push`
* If remote and local migration history diverges, use the CLI's repair status command:
  `supabase migration repair --status applied <version>`

---

## 3. Component Architecture & State Mapping

* **Supabase Joins parsing:** In React/TypeScript components, note that Supabase client-side joins (e.g. `.select('*, branches(*)')`) can return joined tables as arrays of objects. Always map query results to extract singular objects safely:
  ```typescript
  const branchObj = Array.isArray(row.branches) ? row.branches[0] : row.branches;
  ```
* **Feature Gating:**
  * Define feature keys in `TAB_FEATURE_KEYS` within `Sidebar.tsx`.
  * Register matching feature labels in `FEATURE_LABELS` within `SuperAdminDashboard.tsx`.
  * Hide unavailable features from the sidebar using `features[key] === false` rather than leaving them locked.

---

## 4. UI/UX & Quality Verification

* Run applications locally using custom build modes:
  * Dr Humba (Enterprise Single Tenant): `npm run dev -- --mode drhumba`
  * ERP SaaS (Multi Tenant): `npm run dev -- --mode erpsaas`
* Always execute the production compiler to verify TypeScript type checks and chunk build integrity:
  `npm run build`
