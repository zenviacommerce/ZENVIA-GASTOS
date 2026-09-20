# Configuration Center Phase 4 — Orders and Shipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded logistics behavior with configurable order defaults, label naming, shipping rules, tracking automation, and Sendcloud preferences while preserving current Correos/MRW behavior initially.

**Architecture:** A pure shipping-rule engine selects a desired carrier/service from ordered rules. The Orders page and Sendcloud Edge Function receive explicit effective settings. Manual carrier selection always wins. Personal printer choice remains user-specific.

**Tech Stack:** React, TypeScript, Supabase Edge Functions, Sendcloud integration, JSZip, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-configuration-center-design.md`

## Global Constraints

- Initial rules reproduce Baleares `07xxx` → Correos and current MRW 19:00 fallback behavior.
- Manual selection overrides automation.
- Failure to match a rule must never create a wrong label automatically.
- Tracking push failures must remain visible/retriable.
- Label file naming defaults to order number and preserves existing uniqueness behavior.

## Review Focus

- Baleares rule wins before generic Spain fallback.
- Disabled rule is ignored.
- Missing configured service yields manual-selection state, not first-random-option selection.
- Custom filename templates cannot write path traversal characters.
- A successful Sendcloud label with failed Amazon confirmation retains the tracking and exposes retry state.

---

### Task 1: Implement typed shipping-rule engine and CRUD

**Files:**
- Create: `src/services/shippingRules.ts`
- Modify: `src/pages/Settings.tsx`
- Modify: `src/services/settingsSchema.ts`
- Test: `scripts/shipping-rules.test.mjs`

**Interfaces:**
- Produces:
  - `ShippingRule`
  - `matchesShippingRule(order, rule)`
  - `selectShippingRule(order, rules)`
  - CRUD for `shipping_rules`

- [ ] **Step 1: Write failing rule-order tests**

Fixtures:
- rule priority 10 ES + postalPrefix 07 → Correos;
- rule priority 20 ES → MRW 19;
- inactive priority 1 rule ignored;
- PT order gets no match unless explicit PT rule exists.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/shipping-rules.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement allowed condition vocabulary**

Initial conditions:
- country codes;
- postal-code prefix;
- source channel;
- min/max weight.

Actions:
- carrier matcher;
- service matcher;
- optional contract id.

Reject unknown condition/action keys during validation.

- [ ] **Step 4: Seed current production-equivalent rules in development**

Use explicit data migration/upsert scoped to the workspace only after owner resolution is safe. If data migrations cannot safely reference a generated owner ID, create initial rules through an authenticated bootstrap service instead of hardcoding an ID.

- [ ] **Step 5: Build rules editor**

Allow enable/disable, priority reorder, condition fields, carrier/service target, and validation.

- [ ] **Step 6: Run tests and build**

```bash
node --test scripts/shipping-rules.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/shippingRules.ts src/pages/Settings.tsx src/services/settingsSchema.ts scripts/shipping-rules.test.mjs supabase/migrations
git commit -m "feat: add configurable shipping rules"
```

---

### Task 2: Replace hardcoded automatic carrier/service selection

**Files:**
- Modify: `src/services/orderLabelFiles.ts`
- Modify: `src/services/orderShipping.ts`
- Modify: `src/pages/Orders.tsx`
- Test: `scripts/order-label-files.test.mjs`
- Test: `scripts/order-shipping-price-validation.test.mjs`

**Interfaces:**
- Consumes: selected `ShippingRule` action
- Produces: `selectConfiguredShippingOption(options, action)`

- [ ] **Step 1: Rewrite tests to pin configuration rather than hidden geography**

Keep regression fixtures but pass the rule result explicitly.

- [ ] **Step 2: Run and verify failure**

Expected: tests fail because current selectors still embed Baleares/MRW logic.

- [ ] **Step 3: Make option selection pure**

Match normalized carrier/service/code and optional contract id. Return `null` if the configured target is unavailable.

- [ ] **Step 4: Make carrier validation use effective carrier**

`validateOrderForCarrier` accepts the carrier selected from the rule/manual selection, not a hidden geographic default.

- [ ] **Step 5: Run tests**

```bash
node --test scripts/order-label-files.test.mjs scripts/order-shipping-price-validation.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/orderLabelFiles.ts src/services/orderShipping.ts src/pages/Orders.tsx scripts/order-label-files.test.mjs scripts/order-shipping-price-validation.test.mjs
git commit -m "feat: drive carrier selection from shipping rules"
```

---

### Task 3: Make label filenames, ZIP naming, refresh, and order defaults configurable

**Files:**
- Modify: `src/services/orderLabelFiles.ts`
- Modify: `src/pages/Orders.tsx`
- Modify: `src/services/orders.ts`
- Modify: `src/pages/Settings.tsx`
- Test: `scripts/order-settings.test.mjs`

**Interfaces:**
- Produces:
  - `LabelFilenameStrategy = 'order_number'|'sku'|'product'|'customer_order'|'custom'`
  - `renderLabelBaseName(order, strategy, template?)`
  - configurable refresh seconds and bulk ZIP template

- [ ] **Step 1: Write failing filename tests**

Test each strategy and custom template tokens `{order}`, `{sku}`, `{product}`, `{customer}`. Assert `../evil` becomes a safe basename.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/order-settings.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement safe templating**

After token substitution, sanitize to `[a-zA-Z0-9._-]`, trim separators, and fall back to `pedido`.

- [ ] **Step 4: Connect order defaults**

Wire channel/default state/country/default carrier behavior where those concepts apply to manual orders. Explicit manual form values win.

- [ ] **Step 5: Replace fixed refresh intervals**

Use a bounded setting, for example 30–3600 seconds. Clear/recreate timers when the effective value changes.

- [ ] **Step 6: Move printer preference to user preferences**

Migrate existing `zenvia-label-printer` localStorage value only when database preference is empty.

- [ ] **Step 7: Run tests and build**

```bash
node --test scripts/order-settings.test.mjs scripts/order-label-files.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/orderLabelFiles.ts src/pages/Orders.tsx src/services/orders.ts src/pages/Settings.tsx scripts/order-settings.test.mjs
git commit -m "feat: configure order and label defaults"
```

---

### Task 4: Configure tracking and post-label automations end to end

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/Orders.tsx`
- Modify: `src/services/orders.ts`
- Modify: `supabase/functions/sendcloud-order-tools/index.ts`
- Modify: `supabase/functions/sendcloud-orders/index.ts` if sync behavior needs shared status metadata
- Test: `scripts/order-tracking-automation.test.mjs`
- Test: `scripts/amazon-tracking-confirmation.test.mjs`

**Interfaces:**
- Consumes: `automation_rules.order_label_created`
- Produces independent flags: save tracking, push to marketplace, mark sent, download PDF, retry confirmation

- [ ] **Step 1: Write failing automation tests**

Pin the mixed outcome:
- label created;
- tracking saved locally;
- Amazon confirmation fails;
- order keeps tracking;
- UI exposes retry state;
- no duplicate label is created by retrying only confirmation.

- [ ] **Step 2: Run and verify failure**

```bash
node --test scripts/order-tracking-automation.test.mjs scripts/amazon-tracking-confirmation.test.mjs
```

Expected: new test FAIL.

- [ ] **Step 3: Separate label creation from marketplace confirmation**

Return structured result:

```ts
type LabelAutomationResult = {
  labelCreated: boolean;
  trackingSaved: boolean;
  marketplaceConfirmed: boolean | null;
  marketplaceError?: string;
};
```

- [ ] **Step 4: Respect each configured flag**

A disabled marketplace push must not be treated as an error. A disabled auto-download must still allow manual download.

- [ ] **Step 5: Add explicit retry action**

Retry only marketplace confirmation using stored tracking data.

- [ ] **Step 6: Deploy Edge Function version to development project only**

Verify JWT/auth behavior remains as currently configured.

- [ ] **Step 7: Run tests and build**

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Settings.tsx src/pages/Orders.tsx src/services/orders.ts supabase/functions/sendcloud-order-tools/index.ts supabase/functions/sendcloud-orders/index.ts scripts/order-tracking-automation.test.mjs scripts/amazon-tracking-confirmation.test.mjs
git commit -m "feat: configure post-label tracking automation"
```

---

### Task 5: Add Sendcloud/shipping preferences and integration status behavior

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/services/orders.ts`
- Modify: `supabase/functions/sendcloud-order-tools/index.ts`
- Test: `scripts/shipping-settings.test.mjs`

**Interfaces:**
- Consumes: `settings.shipping`
- Produces: label size/format/orientation/copies, sender fallback, weight fallback, enabled carriers, behavior when no method is valid, cost persistence flag

- [ ] **Step 1: Write failing settings tests**

Assert validated label sizes A4/A6/10x15, positive fallback weight, enabled-carrier filtering, and no-valid-method behavior.

- [ ] **Step 2: Run and verify failure**

Expected: FAIL.

- [ ] **Step 3: Implement each shipping preference at the layer that can actually enforce it**

- sender identity/address: pass through the backend request when Sendcloud supports an explicit sender, otherwise bind the configured sender to the supported sender-address identifier;
- fallback weight/unit: apply only when the order has no valid explicit weight;
- label format/size: request the supported Sendcloud label format where the API supports it;
- copies/orientation: apply in the client print/download preparation layer when Sendcloud returns a single canonical PDF;
- enabled carriers: filter automatic choices but never hide a manually selected existing label;
- fallback service/no-valid-method behavior: return a structured manual-selection requirement rather than guessing;
- confirm shipment and persist cost: connect to existing backend response fields.

A setting must not be shown until its enforcement path above is implemented and covered by a test.

- [ ] **Step 4: Persist returned shipping cost when enabled**

Do not overwrite recorded cost when the API returns no reliable value.

- [ ] **Step 5: Run tests/build and commit**

```bash
node --test scripts/shipping-settings.test.mjs
npm run build
git add src/pages/Settings.tsx src/services/orders.ts supabase/functions/sendcloud-order-tools/index.ts scripts/shipping-settings.test.mjs
git commit -m "feat: configure Sendcloud shipping behavior"
```

---

### Task 6: Phase 4 verification

- [ ] Verify seeded rules reproduce current Baleares/Correos and MRW behavior.
- [ ] Disable a rule and verify manual selection is required where no rule matches.
- [ ] Exercise all label filename strategies and duplicate ZIP names.
- [ ] Verify tracking success, tracking failure, and Amazon confirmation failure separately.
- [ ] Verify refresh interval change takes effect without page reload.
- [ ] Verify normal user cannot edit shipping rules.
- [ ] Run focused tests and `npm run build`.
