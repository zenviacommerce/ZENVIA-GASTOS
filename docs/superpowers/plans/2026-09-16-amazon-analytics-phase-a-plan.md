# Amazon Analytics Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the protected Amazon Analytics shell to ZENVIA Gestión without introducing Amazon data ingestion yet.

**Architecture:** Extend the existing `MenuPermission`/`app_users.permissions` access model with `amazon`, wire the page through the current `Sidebar` + `App` routing pattern, and add a lightweight Amazon status page that exposes only safe external links and connection-state copy. Database work in this phase is limited to preserving all current permissions while adding `amazon` to the effective constraint; Amazon business tables and API credentials remain Phase B.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Supabase/Postgres, Supabase Edge Functions, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-16-amazon-analytics-design.md`

## Global Constraints

- Phase A only: permission, navigation shell, connection-state page, Seller Central/Sellerboard links, access tests.
- Preserve current permissions: `dashboard`, `sales`, `orders`, `invoices`, `clients`, `products`, `suppliers`.
- Add `amazon` as a configurable permission for managed users and as an implicit permission for admins.
- No Amazon credentials or tokens in frontend code or `VITE_*` variables.
- External links must open with `target="_blank"` and `rel="noopener noreferrer"`.
- Do not add Amazon orders, finances, inventory, Ads, FX, sync jobs, mappings, or analytics calculations in this phase.

---

### Task 1: Lock the Phase A access contract with a failing test

**Files:**
- Create: `scripts/amazon-shell-access.test.mjs`

**Interfaces:**
- Consumes: current source files and migrations as text.
- Produces: regression contract covering the permission, admin sanitizer, route, sidebar entry, shell page, secure links, and effective permission constraint.

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run CI/test runner and verify it fails because `amazon` is absent**
- [ ] **Step 3: Commit the red test**

### Task 2: Add the `amazon` permission end-to-end

**Files:**
- Modify: `src/services/access.ts`
- Modify: `supabase/functions/admin-users/index.ts`
- Create: `supabase/migrations/20260916174000_add_amazon_permission.sql`

**Interfaces:**
- Produces: `MenuPermission` includes `amazon`; `permissionOptions` exposes Amazon; admin user management accepts/preserves `amazon`; database constraint admits all existing permissions plus `amazon`.

- [ ] **Step 1: Update permission type/options**
- [ ] **Step 2: Update the admin Edge Function allow-list**
- [ ] **Step 3: Add a migration that replaces only the effective permissions constraint**
- [ ] **Step 4: Re-run tests**

### Task 3: Add protected Amazon navigation and shell page

**Files:**
- Create: `src/pages/Amazon.tsx`
- Create: `src/amazon.css`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `MenuPermission = 'amazon'`.
- Produces: page id `amazon`, protected rendering via `can('amazon')`, connection-state shell, safe links to Seller Central and Sellerboard.

- [ ] **Step 1: Add the Amazon page with neutral connection-state UI**
- [ ] **Step 2: Add Amazon to Sidebar page type and menu**
- [ ] **Step 3: Add Amazon to App permission routing**
- [ ] **Step 4: Include page styles from the existing stylesheet entrypoint**
- [ ] **Step 5: Re-run tests and build**

### Task 4: Verify and prepare review

**Files:** none unless verification finds a defect.

- [ ] **Step 1: Run `node --test scripts/*.test.mjs` through CI**
- [ ] **Step 2: Run `npm run build` through CI**
- [ ] **Step 3: Verify branch diff contains no Amazon secrets or Phase B scope**
- [ ] **Step 4: Run Supabase security advisor after any database deployment; do not deploy the migration to production before the code is ready to merge**
