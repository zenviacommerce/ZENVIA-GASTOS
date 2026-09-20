# Configuration Center Phase 5 — Amazon, Integrations, Alerts, and Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Configuration Center by connecting Amazon behavior, integration health, in-app alerts, controlled automations, maintenance tools, configuration export/reset, and a final hardcode sweep.

**Architecture:** Amazon settings parameterize existing analytics/sync flows instead of duplicating them. Integration health is read from existing services and sync metadata. Alerts are derived from existing business data plus typed thresholds. Maintenance actions use narrowly scoped services/RPCs with preview/confirmation and audit trails.

**Tech Stack:** React, TypeScript, Supabase/PostgreSQL/RPC/Edge Functions, Amazon SP-API integration, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-configuration-center-design.md`

## Global Constraints

- Amazon secrets remain server-side.
- Disabling automatic sync does not hide already-synced data or block manual sync.
- Maintenance mutations require preview, confirmation, admin authorization, and audit.
- Configuration export excludes secrets and ephemeral connection tokens.
- Reset restores typed defaults only; it does not rewrite historical documents.

## Review Focus

- Marketplace labels remain human-readable after configurable marketplace selection.
- An automatic-sync toggle stops scheduling/automatic invocation but manual sync still works.
- Alert thresholds evaluate deterministic business data and do not duplicate stale alerts endlessly.
- Duplicate detection never auto-merges entities without explicit admin confirmation.
- Configuration export contains no secret material or access tokens.

---

### Task 1: Add Amazon configuration schema and editor

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/services/settingsSchema.ts`
- Modify: `src/services/amazon.ts`
- Modify: `src/pages/Amazon.tsx`
- Test: `scripts/amazon-settings.test.mjs`

**Interfaces:**
- Consumes existing marketplace/account data
- Produces effective Amazon settings for active marketplaces, primary marketplace, consolidated currency, default period/history, mapping defaults, KPI visibility, and automatic sync flags

- [ ] **Step 1: Write failing Amazon settings tests**

Pin:
- active marketplace filtering;
- primary marketplace fallback when configured marketplace is inactive;
- readable country labels remain intact;
- manual sync remains callable when auto sync is off;
- invalid history days fall back safely.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/amazon-settings.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement typed Amazon settings**

Do not duplicate account IDs/secrets in JSON. Store only behavioral choices and marketplace IDs already present in `amazon_marketplaces`.

- [ ] **Step 4: Connect Amazon page defaults**

Default filter period, primary marketplace, visible KPI set, and unmapped-SKU behavior must derive from settings.

- [ ] **Step 5: Connect automatic-sync flags**

Where current scheduled jobs exist, make their enqueue/trigger path consult settings server-side. Manual “Actualizar” remains available.

- [ ] **Step 6: Run existing Amazon regressions**

```bash
node --test scripts/amazon-settings.test.mjs scripts/amazon-marketplace-labels.test.mjs scripts/amazon-shell-access.test.mjs scripts/amazon-sync-completion.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Settings.tsx src/services/settingsSchema.ts src/services/amazon.ts src/pages/Amazon.tsx supabase/functions scripts/amazon-settings.test.mjs
git commit -m "feat: add Amazon configuration"
```

---

### Task 2: Build Integrations status/control section without exposing secrets

**Files:**
- Create: `src/services/integrations.ts`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/services/gmail.ts`
- Modify: `src/services/orders.ts`
- Modify: `src/services/amazon.ts`
- Test: `scripts/integration-settings.test.mjs`

**Interfaces:**
- Produces `IntegrationHealth`:
```ts
type IntegrationHealth = {
  id: 'gmail'|'amazon'|'sendcloud'|'shopify';
  enabled: boolean;
  connected: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};
```

- [ ] **Step 1: Write failing health-model tests**

Assert no returned property contains keys/tokens/passwords and disconnected states are explicit.

- [ ] **Step 2: Run and verify failure**

Expected: FAIL.

- [ ] **Step 3: Implement adapters**

Read connection state from existing services/tables. Do not fetch `integration_secrets` values into the browser.

- [ ] **Step 4: Add “Probar conexión” and “Sincronizar ahora”**

Use existing authenticated backend actions. Show exact success/failure timestamps.

- [ ] **Step 5: Add enabled toggle**

Enabled state belongs in `app_settings.integrations`; backend automatic operations consult it, while status/history remain visible.

- [ ] **Step 6: Run tests/build and commit**

```bash
node --test scripts/integration-settings.test.mjs
npm run build
git add src/services/integrations.ts src/pages/Settings.tsx src/services/gmail.ts src/services/orders.ts src/services/amazon.ts scripts/integration-settings.test.mjs
git commit -m "feat: add integration controls and health"
```

---

### Task 3: Implement in-app alerts and configured thresholds

**Files:**
- Create: `src/services/alerts.ts`
- Create: `src/components/AlertCenter.tsx`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/App.tsx`
- Test: `scripts/configurable-alerts.test.mjs`

**Interfaces:**
- Produces:
  - `AlertDefinition`
  - `evaluateAlerts(context, settings): AppAlert[]`
  - `<AlertCenter />`

- [ ] **Step 1: Write failing pure alert tests**

Fixtures cover:
- overdue sales invoice;
- pending expense review;
- order pending beyond configured hours;
- missing tracking;
- product without cost;
- negative/low margin;
- cost increase above threshold;
- client without tax ID;
- supplier without tax ID.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/configurable-alerts.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement deterministic evaluator**

No database writes are needed merely to display an alert. Derive stable IDs from alert type + entity ID to prevent duplicate rendering.

- [ ] **Step 4: Add app-level Alert Center**

Display count and panel only for enabled alert types. Link each alert to the relevant module where possible.

- [ ] **Step 5: Add settings editor**

Each alert gets enabled, threshold where applicable, and in-app channel toggle. Email controls remain absent unless real email-delivery infrastructure is implemented in the same task.

- [ ] **Step 6: Run tests/build and commit**

```bash
node --test scripts/configurable-alerts.test.mjs
npm run build
git add src/services/alerts.ts src/components/AlertCenter.tsx src/pages/Settings.tsx src/App.tsx scripts/configurable-alerts.test.mjs
git commit -m "feat: add configurable in-app alerts"
```

---

### Task 4: Complete automation-rule configuration

**Files:**
- Create: `src/services/automationRules.ts`
- Modify: `src/pages/Settings.tsx`
- Modify: expense/order consumers from Phases 3–4
- Test: `scripts/automation-rules.test.mjs`

**Interfaces:**
- Produces typed rules for `order_label_created` and `expense_invoice_imported`

- [ ] **Step 1: Write failing rule normalization tests**

Reject unknown rule keys and unknown config properties. Missing rule rows use approved defaults.

- [ ] **Step 2: Run and verify failure**

Expected: FAIL.

- [ ] **Step 3: Implement CRUD and editor**

Use switches/parameters only for actions already implemented. Do not expose a generic script/action editor.

- [ ] **Step 4: Connect consumers**

Verify each configured flag maps to a code path already tested in Phases 3–4.

- [ ] **Step 5: Run tests and commit**

```bash
node --test scripts/automation-rules.test.mjs scripts/order-tracking-automation.test.mjs scripts/expense-import-settings.test.mjs
git add src/services/automationRules.ts src/pages/Settings.tsx src/services src/pages scripts/automation-rules.test.mjs
git commit -m "feat: add controlled automation rules"
```

---

### Task 5: Implement safe maintenance analysis and merge/reprocess actions

**Files:**
- Create: `src/services/maintenance.ts`
- Modify: `src/pages/Settings.tsx`
- Create: migration generated by `supabase migration new configuration_maintenance_rpcs` if transactional RPCs are required
- Test: `scripts/configuration-maintenance.test.mjs`

**Interfaces:**
- Produces:
  - `findSupplierDuplicates()`
  - `findClientDuplicates()`
  - `findProductDuplicates()`
  - `findInvoiceDuplicates()`
  - preview models for merge actions
  - admin-only transactional merge/reprocess/recalculate entry points

- [ ] **Step 1: Write failing duplicate-analysis tests**

Use fixtures where:
- same tax ID is high-confidence duplicate;
- same normalized name without tax evidence is a candidate, not automatic merge;
- invoice duplicate requires supplier identity + invoice number plus compatible date/amount evidence.

- [ ] **Step 2: Run and verify failure**

Expected: FAIL.

- [ ] **Step 3: Implement read-only detectors first**

Return evidence and confidence; never mutate.

- [ ] **Step 4: Implement transactional merge RPCs**

Supplier/client merge must repoint foreign keys and preserve audit/history. Require explicit source and destination IDs and admin check inside the RPC/security boundary.

- [ ] **Step 5: Add preview and confirmation UI**

Show counts of affected invoices/products/history rows before enabling merge.

- [ ] **Step 6: Implement explicit recalculation/reprocess tools**

Each action states scope and non-reversible effects. Historical recalculation is never triggered by changing a setting alone.

- [ ] **Step 7: Verify RLS/security and run advisors**

No maintenance RPC may be callable successfully by a normal user.

- [ ] **Step 8: Run tests/build and commit**

```bash
node --test scripts/configuration-maintenance.test.mjs
npm run build
git add src/services/maintenance.ts src/pages/Settings.tsx supabase/migrations scripts/configuration-maintenance.test.mjs
git commit -m "feat: add configuration maintenance tools"
```

---

### Task 6: Add configuration export and reset-to-defaults

**Files:**
- Create: `src/services/settingsExport.ts`
- Modify: `src/pages/Settings.tsx`
- Test: `scripts/settings-export.test.mjs`

**Interfaces:**
- Produces `buildSettingsExport()`, `downloadSettingsExport()`, `resetAllSettingsToDefaults()`

- [ ] **Step 1: Write failing secret-exclusion tests**

Assert export contains general/sales/etc. plus alias/rule metadata, but no values from `integration_secrets`, no session tokens, no Supabase keys.

- [ ] **Step 2: Run and verify failure**

Expected: FAIL.

- [ ] **Step 3: Implement versioned export**

Example root:

```json
{
  "format": "zenvia-gestion-settings",
  "version": 1,
  "exportedAt": "ISO timestamp",
  "appSettings": {},
  "aliases": [],
  "shippingRules": [],
  "automationRules": []
}
```

- [ ] **Step 4: Implement reset**

Preview changed sections, require confirmation, upsert `DEFAULT_APP_SETTINGS`, and audit the reset. Do not touch user preferences unless “Mis preferencias” is reset separately.

- [ ] **Step 5: Run tests/build and commit**

```bash
node --test scripts/settings-export.test.mjs
npm run build
git add src/services/settingsExport.ts src/pages/Settings.tsx scripts/settings-export.test.mjs
git commit -m "feat: add settings export and reset"
```

---

### Task 7: Hardcode sweep and full UI preference connection

**Files:**
- Search/modify: `src/pages/*.tsx`, `src/components/*.tsx`, `src/services/*.ts`
- Test: `scripts/configuration-hardcode-sweep.test.mjs`

**Interfaces:**
- Consumes all prior settings
- Produces no hidden duplicate authority for settings represented in UI

- [ ] **Step 1: Build an explicit deny-list test**

The test searches for known migrated literals/patterns in consumer files, allowing them only in `settingsSchema.ts` defaults/tests. Include:
- fixed current-quarter initializers;
- fixed page sizes in migrated pages;
- hidden 30-day due default;
- hardcoded Baleares/Correos/MRW selection;
- fixed order refresh interval;
- label filename strategy.

- [ ] **Step 2: Run and inspect failures**

Expected: FAIL until remaining consumers are migrated.

- [ ] **Step 3: Replace each duplicate authority**

Use provider values or pure helper arguments. Do not import React context inside low-level pure services.

- [ ] **Step 4: Connect remembered filters, columns, dashboard KPI visibility, and density**

Store per-user values under `user_preferences`. Persist remembered filters only when enabled.

- [ ] **Step 5: Run sweep test and build**

```bash
node --test scripts/configuration-hardcode-sweep.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src scripts/configuration-hardcode-sweep.test.mjs
git commit -m "refactor: remove migrated configuration hardcodes"
```

---

### Task 8: Final validation and stabilization

**Files:** all Configuration Center tests and affected existing regressions

- [ ] Run all new tests:
```bash
node --test scripts/configuration-schema.test.mjs scripts/settings-schema.test.mjs scripts/settings-service-contract.test.mjs scripts/settings-navigation.test.mjs scripts/user-preferences.test.mjs scripts/settings-general.test.mjs scripts/configurable-sales-due-date.test.mjs scripts/sales-settings.test.mjs scripts/client-settings.test.mjs scripts/entity-aliases.test.mjs scripts/expense-import-settings.test.mjs scripts/supplier-settings.test.mjs scripts/product-settings.test.mjs scripts/shipping-rules.test.mjs scripts/order-settings.test.mjs scripts/order-tracking-automation.test.mjs scripts/shipping-settings.test.mjs scripts/amazon-settings.test.mjs scripts/integration-settings.test.mjs scripts/configurable-alerts.test.mjs scripts/automation-rules.test.mjs scripts/configuration-maintenance.test.mjs scripts/settings-export.test.mjs scripts/configuration-hardcode-sweep.test.mjs
```

- [ ] Run all relevant existing regressions for invoices, imports, products, orders, tracking, Amazon, and UI contracts.
- [ ] Run full `node --test scripts/*.test.mjs`; compare any failure with the pre-feature baseline and repair stale contract tests that now misdescribe the implemented product.
- [ ] Run `npm run build`.
- [ ] Run Supabase security/performance advisors on the development branch and resolve new Configuration Center findings.
- [ ] Browser-verify desktop, iPad/Safari, mobile, light/dark, admin/user.
- [ ] Validate every visible switch/field by observing the corresponding behavior.
- [ ] Verify configuration export contains no secret.
- [ ] Verify `main` remains untouched by feature commits.
- [ ] Present preview and validation checklist to the user. Stop before merge and production migrations.
