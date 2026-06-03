# RESTOChain: Multi-Branch Restaurant Inventory Management System

A production-ready Multi-Branch Restaurant Inventory Management System built using React, Vite, TypeScript, Supabase, and Tailwind CSS v3.

To guarantee maximum transaction safety and ensure data consistency, **zero business logic resides on the client**. All stock balance deductions, recipe validations, warehouse-to-branch transfers, and wastage adjustments are processed inside transaction-safe Supabase database functions, triggers, and PostgreSQL Row-Level Security (RLS) policies.

---

## 🚀 Getting Started

### 1. Database Setup (Supabase)

Since you are running migrations manually via the Supabase dashboard:

1. **Schema Migration**:
   * Navigate to the **SQL Editor** on your Supabase dashboard.
   * Click **New Query**, copy the entire contents of [20260603000000_schema.sql](file:///Users/jetchmerald/Documents/jetch/restaurant-inventory-system/supabase/migrations/20260603000000_schema.sql), paste them in, and click **Run**.
   * This creates the core tables, hooks, triggers, and zero-client RPC functions.

2. **Demo Data Seeding**:
   * Create another new query in the **SQL Editor**.
   * Copy the entire contents of [20260603000001_seed.sql](file:///Users/jetchmerald/Documents/jetch/restaurant-inventory-system/supabase/migrations/20260603000001_seed.sql), paste them, and click **Run**.
   * This populates:
     * One Warehouse (`Main Warehouse`)
     * Two restaurant branches (`Branch A - Downtown` and `Branch B - Uptown`)
     * Seven raw inventory ingredients (Onions, Tomatoes, Beef Patties, Buns, Cooking Oil, etc.)
     * Three POS menu items (Classic Burger, Double Cheeseburger, Onion Rings) with full ingredient recipe mappings.
     * Initial inventory balances (including low-stock levels at Branch A for testing).

---

### 2. Super Admin Setup (First User)

By default, any new account registered via the client-side login/signup panel is provisioned as a `cashier` (the lowest authorization level restricted to branch POS sales checkout).

To create the initial **Super Admin** account:

1. Launch the app locally (see commands below).
2. Go to the login screen and click **Need an account? Sign Up**.
3. Register your desired administrative email and password.
4. Open the Supabase **SQL Editor** and execute this query to elevate your profile:
   ```sql
   UPDATE public.profiles 
   SET role_name = 'super_admin' 
   WHERE email = 'your-admin-email@example.com';
   ```
   *(Be sure to replace `your-admin-email@example.com` with the exact address you registered).*
5. Refresh the page and log in. You now have full Super Admin control!

---

### 3. Local Development

1. **Verify Environment Variables**:
   Confirm that `.env` contains the Supabase URL and Anon Key provided in your instructions:
   ```env
   VITE_SUPABASE_URL=https://htjqtdlshdoskezsptvg.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1...
   ```

2. **Start Vite Development Server**:
   ```bash
   npm run dev
   ```
   Open your browser to the local dev server (usually `http://localhost:5173`).

---

## 🏛️ System Architecture

### Role-Based Access Control (RBAC)

The application implements a strict, server-enforced security matrix:

* **Super Admin**: Full corporate visibility. Can create branch locations, manage the menu and recipe catalog, provision staff credentials, view overall analytics, review audit logs, and trigger inventory transfers/adjustments.
* **Inventory Manager**: Dedicated inventory operations. Can modify inventory catalog items, execute stock-in deliveries, and review transfers or adjustments.
* **Branch Manager**: Retail operations. Can execute POS sales checkout, request stock transfers from the warehouse, log damages/spoilage, and view branch performance charts.
* **Cashier**: High-speed front-counter POS checkout. Can only view the POS screen to ring up orders.
* **Auditor**: Independent oversight. Corporate-wide read-only access to all dashboards, stock balances, ledger movements, and audit logs.

### Database Operations (RPC API)

The client application communicates with Supabase strictly via the following database functions:

* `fn_create_staff(p_email, p_password, p_role, p_branch_id)`: Registers a new staff member in `auth.users` and assigns their role profile. Can only be run by a Super Admin.
* `fn_receive_stock(p_receipt_id)`: Processes supplier invoice, applies purchase-to-base unit conversion math, updates catalog costs, and creates movement ledgers.
* `fn_process_sale(p_branch_id, p_items)`: Processes POS transactions. Looks up recipe ingredients for all sold items, validates that current branch balances are sufficient, deducts stock, and creates ledger movements. *Throws a database exception if inventory drops below zero, rolling back the transaction.*
* `fn_request_transfer(p_source, p_target, p_items)`: Submits a pending transfer request.
* `fn_approve_transfer(p_transfer_id)`: Deducts stock from source branch, adds to target branch, writes dual movements (`transfer_out`/`transfer_in`), and handles low-stock triggers.
* `fn_process_adjustment(p_adjustment_id)`: Commits spoilage, damages, or count corrections.
