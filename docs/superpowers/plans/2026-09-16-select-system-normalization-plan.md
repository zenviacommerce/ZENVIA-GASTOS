# Select System Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace visible native dropdowns with a unified two-component select system and remove duplicate native/global tooltips in Orders.

**Architecture:** Keep `SearchableSelect` for dynamic catalogs and add a sibling `SelectField` for bounded lists. Share positioning/menu behavior through a small `useFloatingSelectMenu` hook and common CSS classes in `shared-forms.css`, while preserving each screen's existing values and callbacks. The global truncated-text tooltip remains the only overflow tooltip system; duplicate `title` attributes are removed from Orders text cells.

**Tech Stack:** React 19, TypeScript, Vite, lucide-react, Node test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-16-select-system-normalization-design.md`

## Global Constraints

- `SelectField` is for short, bounded option lists and has no search input.
- `SearchableSelect` remains for dynamic/growing lists and keeps search.
- Both controls share trigger/menu styling, portal positioning, keyboard behavior, dark mode and mobile behavior.
- Visible native `<select>` controls must be removed from `src/pages` and `src/components` unless explicitly allow-listed for a technical reason.
- Existing IDs, values, persistence, filtering and business logic must not change.
- The global truncated-text tooltip is the only overflow tooltip; Orders must not also emit native `title` tooltips for the same text.
- Follow TDD: failing regression/contract first, then minimal implementation, then full suite/build.

---

### Task 1: Lock the global dropdown and tooltip contracts

**Files:**
- Create: `scripts/select-system-normalization.test.mjs`
- Modify: `src/pages/Orders.tsx`
- Modify: `src/components/OrderLabelDefaults.tsx`

**Interfaces:**
- Consumes: current source tree under `src/pages` and `src/components`.
- Produces: a regression guard that rejects visible native `<select>` markup and duplicate Orders `title` tooltips.

- [ ] **Step 1: Write the failing source-contract test**

Create a Node test that recursively scans `.tsx` files under `src/pages` and `src/components`, fails with file paths when `<select` remains, and asserts that Orders product/tracking cells no longer contain `title={productsText(order)}` or `title={order.trackingStatusMessage||tracking.label}`. Also assert that `OrderLabelDefaults` does not assign `badge.title=original` to `.ordersTracking` badges.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test scripts/select-system-normalization.test.mjs`

Expected: FAIL. The output must enumerate current native-select files and the Orders duplicate-tooltip assertions must fail.

- [ ] **Step 3: Fix only the duplicate-tooltip regression**

In `src/pages/Orders.tsx`, remove native `title` props from the product text cell and tracking badge while preserving their visible text. In `src/components/OrderLabelDefaults.tsx`, replace the tracking-badge native title assignment with an accessible label (`aria-label`) only when the original status differs from the translated visible label.

- [ ] **Step 4: Run the focused tooltip assertions**

Run: `node --test scripts/select-system-normalization.test.mjs`

Expected: tooltip-specific assertions PASS; native-select inventory still FAILS.

- [ ] **Step 5: Commit**

Commit message: `fix: remove duplicate order tooltips`

---

### Task 2: Add shared floating-menu behavior and `SelectField`

**Files:**
- Create: `src/components/forms/useFloatingSelectMenu.ts`
- Create: `src/components/forms/SelectField.tsx`
- Modify: `src/components/forms/SearchableSelect.tsx`
- Modify: `src/shared-forms.css`
- Modify: `scripts/select-system-normalization.test.mjs`

**Interfaces:**
- Produces: `SelectFieldOption = { value:string; label:string; description?:string }` and `SelectField` props `{value, options, onChange, placeholder?, disabled?, allowEmpty?, emptyLabel?, ariaLabel?}`.
- Produces: `useFloatingSelectMenu(open:boolean)` returning `rootRef`, `menuRef`, `menuPosition`, and `positionMenu` for both select variants.
- `SearchableSelect` keeps its existing public API.

- [ ] **Step 1: Extend the test with component contracts**

Assert `SelectField.tsx` exists, imports `createPortal`, supports `role="combobox"`, `role="listbox"`, `ArrowDown`, `ArrowUp`, `Enter`, and `Escape`, and uses the same `searchableSelectTrigger`, `searchableSelectMenu`, `searchableSelectList`, and `searchableSelectOption` visual classes as `SearchableSelect`.

Assert both select components consume `useFloatingSelectMenu`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/select-system-normalization.test.mjs`

Expected: FAIL because `SelectField` and the shared hook do not exist.

- [ ] **Step 3: Implement `useFloatingSelectMenu`**

Extract the existing body-portal positioning logic from `SearchableSelect`: fixed positioning, viewport clamping, open-above decision, document scroll capture and window resize repositioning.

- [ ] **Step 4: Refactor `SearchableSelect` onto the shared hook**

Keep search filtering, active option movement, focus-on-open and its current public props unchanged.

- [ ] **Step 5: Implement `SelectField`**

Render the same trigger/menu/option structure without the search input. Support empty option, active option tracking, outside click, keyboard navigation, disabled state and portal positioning.

- [ ] **Step 6: Consolidate CSS**

Keep the existing `searchableSelect*` class names as the shared visual contract. Add only the minimal selectors needed for the simple variant; do not create a second visual theme.

- [ ] **Step 7: Run the focused test**

Run: `node --test scripts/select-system-normalization.test.mjs`

Expected: component-contract assertions PASS; native-select inventory may still FAIL.

- [ ] **Step 8: Commit**

Commit message: `feat: add unified simple select control`

---

### Task 3: Migrate expense/product/sales controls

**Files:**
- Modify: `src/components/InvoiceFilters.tsx`
- Modify: `src/components/ProductModal.tsx`
- Modify: `src/components/SalesConfigurationModals.tsx`
- Modify: `src/pages/SalesInvoices.tsx`

**Interfaces:**
- Consumes: `SelectField` from Task 2.
- Produces: no business-logic API changes; only UI control substitution.

- [ ] **Step 1: Migrate expense period selector**

Replace the native period select in `InvoiceFilters` with `SelectField`, flattening quarter options into the same option list while preserving the existing `selectPreset` callback and current values.

- [ ] **Step 2: Migrate product VAT selector**

Replace `ProductModal` sales VAT `<select>` with `SelectField` using values `21`, `10`, `4`, and `0`.

- [ ] **Step 3: Migrate sales configuration type selector**

Replace the series-kind native select in `SalesConfigurationModals` with `SelectField`, preserving `'standard'|'rectifying'` typing.

- [ ] **Step 4: Migrate sales invoice bounded selectors**

Replace series, VAT registration, per-line VAT rate, filters/status/series/configuration selects in `SalesInvoices.tsx` with `SelectField`. Keep client selection as `SearchableSelect` because clients grow dynamically.

- [ ] **Step 5: Run the inventory test**

Run: `node --test scripts/select-system-normalization.test.mjs`

Expected: these files disappear from the native-select failure list.

- [ ] **Step 6: Commit**

Commit message: `refactor: normalize expense product and sales selects`

---

### Task 4: Migrate Orders and remaining application dropdowns

**Files:**
- Modify: `src/pages/Orders.tsx`
- Modify: any `.tsx` file under `src/pages` or `src/components` still reported by `scripts/select-system-normalization.test.mjs`

**Interfaces:**
- Consumes: `SelectField` and `SearchableSelect`.
- Produces: zero visible native selects in `src/pages` and `src/components`.

- [ ] **Step 1: Migrate Orders tracking and printer selectors**

Use `SelectField` for the bounded tracking-status list and for the local-printer list. Preserve `setTrackingFilter`, `setPrinter`, and `savePrinter` behavior.

- [ ] **Step 2: Use the test output as the exhaustive migration inventory**

Run `node --test scripts/select-system-normalization.test.mjs`; for every exact `.tsx` path printed by the native-select assertion, fetch that file and classify each list by the approved rule: dynamic/growing => `SearchableSelect`; bounded/fixed => `SelectField`.

- [ ] **Step 3: Replace each remaining native select without altering its value domain or callback**

Keep each screen's existing state and persistence semantics. For dynamic entity catalogs, include useful secondary search text already available in that screen's data model.

- [ ] **Step 4: Re-run until the inventory is empty**

Run: `node --test scripts/select-system-normalization.test.mjs`

Expected: PASS with no native-select matches and all tooltip/component contracts passing.

- [ ] **Step 5: Commit**

Commit message: `refactor: normalize remaining application selects`

---

### Task 5: Full regression verification

**Files:**
- No production changes unless a regression is found.

**Interfaces:**
- Verifies the complete feature branch.

- [ ] **Step 1: Run all Node tests**

Run: `node --test scripts/*.test.mjs`

Expected: 0 failures.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: exit 0; existing chunk-size warnings are acceptable, new TypeScript/Vite errors are not.

- [ ] **Step 3: Review diff against the design**

Verify two distinct components remain (`SelectField`, `SearchableSelect`), search exists only in the growing-list variant, no visible native selects remain, Orders has only one tooltip system, and no business-data shape changed.

- [ ] **Step 4: Open PR to `main`**

PR title: `Normalize dropdowns and remove duplicate order tooltips`

- [ ] **Step 5: Verify PR CI**

Require the branch workflow to complete successfully before merge.
