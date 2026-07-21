# Workspace Customizations & Agent Rules

All agent invocations within this workspace must adhere to these rules.

## Multi-Tenancy Architecture
- This is a tenant-scoped database system. All operational tables must contain `tenant_id`.
- Default production tenant (Dr. Humba) is `'00000000-0000-0000-0000-000000000000'`.
- Row Level Security (RLS) must be enabled on every operational table, isolating access to `tenant_id = public.get_my_tenant_id()`.
- Register the `tg_auto_stamp_tenant_your_table` trigger on insert for every tenant-scoped table.
- Use composite unique constraints on `(tenant_id, column)` (e.g. `(tenant_id, control_number)`) instead of global unique constraints to avoid cross-tenant duplicate collisions.
- When locking or incrementing control number sequences, include `tenant_id` in the ON CONFLICT composite target check.

## Component Joins Mapping
- Supabase relational select queries can return joined entities as arrays of objects in client-side responses. Safely parse and map them to singular objects.

## Feature Flags Control
- Map sidebar navigation item IDs to feature flags in `TAB_FEATURE_KEYS` in `Sidebar.tsx`.
- Keep the Super Admin features dashboard in `SuperAdminDashboard.tsx` mapped to the same key names.
- Switch off and completely hide features from the sidebar if disabled by the tenant's plan feature flags.

## Quality Checks
- Run development servers using `--mode drhumba` or `--mode erpsaas`.
- Ensure a clean build output (`npm run build`) with zero TypeScript compilation warnings before committing any code.
