# Configuration Center Phase 3 — Expenses, Suppliers, and Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make expense import, supplier identity/enrichment, aliases, categorization, product creation, and cost behavior configurable without reintroducing duplicate entities.

**Architecture:** Explicit alias rules precede heuristic matching. A pure import policy object is derived from settings and passed through the shared import pipeline so Gmail, single upload, and bulk upload behave consistently. Product cost strategy is centralized and tested.

**Tech Stack:** React, TypeScript, Supabase, invoice PDF parsers, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-configuration-center-design.md`

## Global Constraints

- Explicit aliases win over name heuristics.
- Existing non-empty reviewed supplier/client fields are not overwritten unless the relevant setting explicitly permits it.
- Single upload, bulk upload, and Gmail reuse the same policy helpers.
- Historical cost recalculation occurs only through an explicit maintenance action.
- The existing Sierra Nevada / Compost and Paper regression must stay green.

## Review Focus

- An alias maps `Compost and Paper S.L.` to Sierra Nevada before any duplicate supplier is created.
- A disabled auto-create setting produces a review state rather than silently dropping an invoice.
- An invalid detected tax ID never overwrites a valid existing supplier tax ID.
- Switching product cost method changes future cost resolution but not historical rows.
- Gmail recovery still allows re-importing a deleted invoice when current lifecycle rules allow it.

---

### Task 1: Implement entity alias service and Settings UI

**Files:**
- Create: `src/services/entityAliases.ts`
- Modify: `src/pages/Settings.tsx`
- Test: `scripts/entity-aliases.test.mjs`

**Interfaces:**
- Produces:
  - `loadEntityAliases(type)`
  - `resolveEntityAlias(type, detectedName)`
  - `addEntityAlias(input)`
  - `updateEntityAlias(id, input)`
  - `deleteEntityAlias(id)`
  - `normalizeAlias(value)`

- [ ] **Step 1: Write failing normalization and precedence tests**

```js
assert.equal(normalizeAlias('  Compost & Paper, S.L. '), 'compost and paper sl');
assert.equal(await resolveFixture('supplier','Compost and Paper S.L.'), SIERRA_ID);
```

Also test inactive aliases and same normalized alias collision.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/entity-aliases.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement alias normalization/service**

Normalize accents, punctuation, legal suffix punctuation, whitespace, and `&` → `and` consistently. Do not fuzzy-match in the alias service.

- [ ] **Step 4: Build admin Alias UI**

Support create/edit/disable/delete with target searchable selector and entity type.

- [ ] **Step 5: Run tests and build**

```bash
node --test scripts/entity-aliases.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/entityAliases.ts src/pages/Settings.tsx scripts/entity-aliases.test.mjs
git commit -m "feat: add configurable entity aliases"
```

---

### Task 2: Derive one expense-import policy from settings

**Files:**
- Create: `src/services/expenseImportPolicy.ts`
- Modify: `src/services/settingsSchema.ts`
- Modify: `src/pages/Settings.tsx`
- Test: `scripts/expense-import-settings.test.mjs`

**Interfaces:**
- Produces `ExpenseImportPolicy` and `expenseImportPolicyFromSettings(settings, categories)`

- [ ] **Step 1: Write failing policy tests**

Cover:
- initial status;
- auto-create supplier/product;
- fill-empty supplier fields;
- default category/type;
- duplicate action;
- confidence threshold;
- required-review fields;
- Gmail PDF-only and attachment-size rules;
- price-history update toggle.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/expense-import-settings.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Add explicit settings types/defaults**

Defaults must reproduce current import behavior. Category defaults should store category IDs only after categories exist; fallback to category-name resolution for initial seed where necessary.

- [ ] **Step 4: Build Gastos e importación editor**

Every switch must map to a property consumed by the policy helper.

- [ ] **Step 5: Run tests**

```bash
node --test scripts/expense-import-settings.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/expenseImportPolicy.ts src/services/settingsSchema.ts src/pages/Settings.tsx scripts/expense-import-settings.test.mjs
git commit -m "feat: add expense import configuration"
```

---

### Task 3: Connect aliases and policy to all expense import paths

**Files:**
- Modify: `src/services/invoiceImportPipeline.ts`
- Modify: `src/services/gmailImport.ts`
- Modify: `src/components/UploadInvoiceModal.tsx`
- Modify: `src/components/BulkInvoiceImportModal.tsx`
- Modify: `src/services/repository.ts`
- Test: `scripts/expense-import-regression.test.mjs`
- Test: `scripts/invoice-import-pipeline.test.mjs`
- Test: `scripts/invoice-upload-shared-pipeline.test.mjs`

**Interfaces:**
- Consumes: `ExpenseImportPolicy`, `resolveEntityAlias()`
- Produces: deterministic identity order fiscal ID → explicit alias → exact/safe identity → heuristics → create/review

- [ ] **Step 1: Extend failing regressions**

Add explicit test assertions that alias resolution is called before `isLikelySameSupplier` fallback and before supplier creation.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/expense-import-regression.test.mjs scripts/invoice-import-pipeline.test.mjs scripts/invoice-upload-shared-pipeline.test.mjs
```

Expected: new assertions FAIL.

- [ ] **Step 3: Thread policy into the shared pipeline**

Do not independently implement settings in each modal. Resolve settings once and pass the same policy.

- [ ] **Step 4: Implement safe no-auto-create behavior**

If no supplier match and creation is disabled, return a candidate requiring review with the detected supplier data; do not discard the document.

- [ ] **Step 5: Implement controlled enrichment**

Only fields enabled in settings and empty on the existing entity may be filled when `onlyFillEmpty=true`.

- [ ] **Step 6: Run regression tests**

Expected: all PASS, including Sierra Nevada alias/heuristic regression.

- [ ] **Step 7: Commit**

```bash
git add src/services/invoiceImportPipeline.ts src/services/gmailImport.ts src/components/UploadInvoiceModal.tsx src/components/BulkInvoiceImportModal.tsx src/services/repository.ts scripts/expense-import-regression.test.mjs scripts/invoice-import-pipeline.test.mjs scripts/invoice-upload-shared-pipeline.test.mjs
git commit -m "feat: apply configured expense import rules"
```

---

### Task 4: Add supplier defaults, enrichment, identity threshold, and category/type rules

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/components/SupplierModal.tsx`
- Modify: `src/services/supplierEditor.ts`
- Modify: `src/services/supplierIdentity.ts`
- Create: `src/services/supplierRules.ts`
- Test: `scripts/supplier-settings.test.mjs`

**Interfaces:**
- Produces `applySupplierDefaults()`, `supplierIdentityThreshold()`, `resolveSupplierRule()`

- [ ] **Step 1: Write failing tests**

Pin default supplier type/category, allowed enrichment fields, only-fill-empty behavior, identity threshold bounds, and provider-specific category/type overrides.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/supplier-settings.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement supplier rule representation**

Use typed rules rather than arbitrary executable expressions. Rule conditions initially support supplier id/alias identity and rule outputs support category/type.

- [ ] **Step 4: Connect manual supplier creation and import enrichment**

Manual explicit user input always overrides defaults.

- [ ] **Step 5: Run tests and build**

```bash
node --test scripts/supplier-settings.test.mjs scripts/expense-import-regression.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.tsx src/components/SupplierModal.tsx src/services/supplierEditor.ts src/services/supplierIdentity.ts src/services/supplierRules.ts scripts/supplier-settings.test.mjs
git commit -m "feat: configure supplier behavior"
```

---

### Task 5: Add product defaults and configurable cost strategy

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/components/ProductModal.tsx`
- Modify: `src/services/productEditor.ts`
- Modify: `src/services/productMetrics.ts`
- Modify: `src/services/repository.ts`
- Create: `src/services/productCostPolicy.ts`
- Test: `scripts/product-settings.test.mjs`

**Interfaces:**
- Produces:
  - `ProductCostMethod = 'last_purchase' | 'average' | 'manual'`
  - `resolveProductCost(policy, history, manualCost)`
  - default VAT/unit/provider/category
  - cost-rise and margin-alert thresholds

- [ ] **Step 1: Write failing cost-policy tests**

Use deterministic fixtures:

```js
const history = [{cost: 2, quantity: 10}, {cost: 4, quantity: 30}];
assert.equal(resolveProductCost({method:'last_purchase'}, history, null), 4);
assert.equal(resolveProductCost({method:'average'}, history, null), 3.5);
assert.equal(resolveProductCost({method:'manual'}, history, 2.75), 2.75);
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/product-settings.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement cost policy**

Define average as quantity-weighted average of valid positive purchase-history entries. If quantities are unavailable, fall back to arithmetic average and mark the source in the helper result.

- [ ] **Step 4: Connect future updates only**

Changing method affects displayed/effective current cost and subsequent updates; do not rewrite historical `product_price_history` rows.

- [ ] **Step 5: Add Products settings editor**

Include VAT, unit, margin target/minimum, auto-create, auto-update cost, supplier/category defaults, thresholds, rounding, and cost decimals.

- [ ] **Step 6: Run tests and build**

```bash
node --test scripts/product-settings.test.mjs scripts/product-metrics.test.mjs scripts/product-price-history-trigger.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Settings.tsx src/components/ProductModal.tsx src/services/productEditor.ts src/services/productMetrics.ts src/services/repository.ts src/services/productCostPolicy.ts scripts/product-settings.test.mjs
git commit -m "feat: configure product defaults and costing"
```

---

### Task 6: Phase 3 verification

- [ ] Import a Sierra Nevada sample using the explicit alias and confirm no duplicate supplier.
- [ ] Disable auto-create supplier and confirm unmatched invoice enters review without entity creation.
- [ ] Disable auto-create product and confirm invoice can still be reviewed/saved according to policy.
- [ ] Exercise Gmail, single upload, and bulk upload against the same fixture.
- [ ] Change cost method and confirm historical price-history rows remain unchanged.
- [ ] Run focused tests and `npm run build`.
- [ ] Commit any fix with a regression test.
