# Shared Forms, Searchable Countries and Postal Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish reusable form/modal primitives, searchable entity selectors, human-readable country selection and international country+postal-code autocomplete, then migrate the forms touched by the current feature work to those primitives.

**Architecture:** Build small UI primitives (`FormModal`, `FormSection`, `FormGrid`, `SearchableSelect`) with no business knowledge. Layer `CountryPicker` on a local ISO country catalog and `PostalAddressFields` on a network adapter (`postalLookup`) that only receives country code and postal code. Existing persisted values remain ISO alpha-2 codes and existing city/province fields remain editable, so the external lookup is an enhancement rather than a dependency.

**Tech Stack:** React 19, TypeScript, Vite, existing CSS architecture (`sales.css` plus shared app CSS), browser `fetch`, Zippopotam.us, Node `node:test` source/pure-logic tests.

**Spec:** `docs/superpowers/specs/2026-09-16-invoice-import-bulk-tooltips-products-design.md`

## Global Constraints

- Country values MUST continue to persist as ISO 3166-1 alpha-2 codes.
- Country controls MUST display readable country names and MUST be searchable.
- Searchable selectors MUST support keyboard navigation, Escape, click-outside, touch and visible focus.
- Small closed selects such as VAT `21/10/4/0` and short payment-term lists MUST remain native/simple selects.
- Postal lookup MUST send only `countryCode` and `postalCode` to the external service.
- Postal lookup failure, 404 or unsupported country MUST NOT block save.
- City and province/region MUST remain manually editable at all times.
- Manual city/province edits MUST NOT be overwritten by a repeated response for the same country+postal-code query.
- Existing suppliers keep their free-text `address`; no structured supplier-address migration is part of this plan.
- Forms touched in this work SHOULD use shared visual primitives; unrelated legacy modals are not rewritten.

---

### Task 1: Add shared form primitives and searchable select

**Files:**
- Create: `src/components/forms/FormPrimitives.tsx`
- Create: `src/components/forms/SearchableSelect.tsx`
- Modify: `src/sales.css`
- Create: `scripts/shared-form-controls.test.mjs`

**Interfaces:**
- Produces `FormModal`, `FormSection`, `FormGrid`, `FormFieldSpan` (or equivalent class helper) from `FormPrimitives.tsx`.
- Produces `SearchableSelect<T extends string>` with props:
  - `value:T|''`
  - `options:Array<{value:T;label:string;searchText?:string;description?:string}>`
  - `onChange:(value:T|'')=>void`
  - `placeholder?:string`
  - `searchPlaceholder?:string`
  - `disabled?:boolean`
  - `allowEmpty?:boolean`
  - `emptyLabel?:string`
  - `ariaLabel?:string`

- [ ] **Step 1: Write failing source-contract tests**

Create `scripts/shared-form-controls.test.mjs` that reads the two component files and asserts they exist and contain the accessibility/interaction contracts:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(p)=>readFile(new URL(p,import.meta.url),'utf8');

test('searchable select exposes combobox/listbox keyboard contract',async()=>{
  const source=await read('../src/components/forms/SearchableSelect.tsx');
  assert.match(source,/role=["']combobox["']/);
  assert.match(source,/role=["']listbox["']/);
  assert.match(source,/ArrowDown/);
  assert.match(source,/ArrowUp/);
  assert.match(source,/Escape/);
  assert.match(source,/Enter/);
  assert.match(source,/aria-expanded/);
});

test('shared form primitives expose modal section grid and sticky actions',async()=>{
  const source=await read('../src/components/forms/FormPrimitives.tsx');
  assert.match(source,/FormModal/);
  assert.match(source,/FormSection/);
  assert.match(source,/FormGrid/);
  assert.match(source,/formModalActions/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/shared-form-controls.test.mjs`
Expected: FAIL because the shared files do not exist.

- [ ] **Step 3: Implement `SearchableSelect`**

Use controlled open/query/highlight state. Filter with a normalized accent-insensitive string:

```ts
const normalizeSearch=(value:string)=>value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase()
  .trim();
```

The combobox button/input must set `aria-expanded`, `aria-controls` and `aria-activedescendant` when applicable. Arrow keys move the highlighted option, Enter selects, Escape closes, and a document `pointerdown` listener closes when clicking outside.

- [ ] **Step 4: Implement form primitives**

`FormModal` owns backdrop, header, scroll container and sticky action footer. `FormSection` owns icon/title/subtitle. `FormGrid` renders the common responsive grid. Keep business-specific labels/content in callers.

- [ ] **Step 5: Add shared CSS**

Add `.formModal`, `.formSection`, `.formGrid`, `.formSpan2`, `.formModalActions`, `.searchableSelect*` rules. Desktop grid defaults to two columns; below the existing mobile breakpoint it becomes one column. Ensure dropdown uses a portal-like fixed/absolute layer or stacking context high enough to escape section overflow without horizontal page overflow.

- [ ] **Step 6: Run tests and build**

Run: `node --test scripts/shared-form-controls.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/forms/FormPrimitives.tsx src/components/forms/SearchableSelect.tsx src/sales.css scripts/shared-form-controls.test.mjs
git commit -m "feat: add shared form controls"
```

### Task 2: Add complete country catalog and CountryPicker

**Files:**
- Create: `src/services/countryCatalog.ts`
- Create: `src/components/forms/CountryPicker.tsx`
- Create: `scripts/country-picker.test.mjs`

**Interfaces:**
- `CountryOption = {code:string; nameEs:string; nameEn:string; searchText:string}`.
- `COUNTRIES:CountryOption[]` contains the ISO alpha-2 catalog used by the UI.
- `countryName(code:string, locale?:'es'|'en'):string` returns readable name or the uppercase code as fallback.
- `CountryPicker` props: `value:string`, `onChange:(code:string)=>void`, optional `disabled`, `label` handled by caller.

- [ ] **Step 1: Write failing pure/source tests**

Test at minimum:

```js
test('Spain can be found by Spanish name English name and ISO code',async()=>{
  const {searchCountries}=await loadCountryModule();
  for(const query of ['España','Spain','ES']) {
    assert.equal(searchCountries(query)[0]?.code,'ES');
  }
});

test('Germany can be found outside Spanish market assumptions',async()=>{
  const {searchCountries}=await loadCountryModule();
  assert.equal(searchCountries('Germany')[0]?.code,'DE');
});
```

Also assert `CountryPicker.tsx` renders `SearchableSelect` rather than a two-letter text input.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/country-picker.test.mjs`
Expected: FAIL because catalog/picker do not exist.

- [ ] **Step 3: Implement country catalog**

Store the ISO alpha-2 codes locally and derive readable Spanish/English names with `Intl.DisplayNames` when available, with a deterministic fallback map for browsers lacking it. Export accent-insensitive `searchCountries(query)` so tests do not need React.

- [ ] **Step 4: Implement CountryPicker**

Map `COUNTRIES` to `SearchableSelect` options where `value=code`, `label=nameEs`, and `searchText` includes Spanish name, English name and code. The emitted value remains the ISO code.

- [ ] **Step 5: Run focused tests/build**

Run: `node --test scripts/country-picker.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/countryCatalog.ts src/components/forms/CountryPicker.tsx scripts/country-picker.test.mjs
git commit -m "feat: add searchable country picker"
```

### Task 3: Add postal lookup adapter with cache and stale-request protection

**Files:**
- Create: `src/services/postalLookup.ts`
- Create: `scripts/postal-lookup.test.mjs`

**Interfaces:**
- `PostalPlace = {city:string; region:string; countryCode:string; postalCode:string}`.
- `lookupPostalCode(countryCode:string, postalCode:string, signal?:AbortSignal):Promise<PostalPlace[]>`.
- `postalLookupKey(countryCode:string,postalCode:string):string` normalizes cache keys.
- The adapter URL is `https://api.zippopotam.us/{countryCode}/{postalCode}`.

- [ ] **Step 1: Write failing tests around pure helpers and source contract**

Assert the URL is built from only country/postal code, the module has an in-memory `Map`, 404 returns `[]`, and no client fields (`name`, `taxId`, `email`, `addressLine1`) appear in the request construction.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/postal-lookup.test.mjs`
Expected: FAIL because `postalLookup.ts` does not exist.

- [ ] **Step 3: Implement adapter**

Normalize `countryCode.toUpperCase()` and trim postal code. Return cached results first. Fetch with optional abort signal. For `404`, cache and return an empty array. For other non-OK responses throw a short error consumed as non-fatal by the UI. Map Zippopotam `places` into `PostalPlace[]` and de-duplicate by city+region.

- [ ] **Step 4: Run focused tests/build**

Run: `node --test scripts/postal-lookup.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/postalLookup.ts scripts/postal-lookup.test.mjs
git commit -m "feat: add international postal lookup"
```

### Task 4: Add reusable PostalAddressFields with manual-value protection

**Files:**
- Create: `src/components/forms/PostalAddressFields.tsx`
- Modify: `src/sales.css`
- Create: `scripts/postal-address-fields.test.mjs`

**Interfaces:**
- Props:
  - `countryCode:string`
  - `postalCode:string`
  - `city:string`
  - `province:string`
  - `onCountryCodeChange:(value:string)=>void`
  - `onPostalCodeChange:(value:string)=>void`
  - `onCityChange:(value:string)=>void`
  - `onProvinceChange:(value:string)=>void`
  - optional `requiredPostalCode`, `requiredCity`.
- Uses `CountryPicker`, `SearchableSelect` (only when multiple returned places exist), and `lookupPostalCode`.

- [ ] **Step 1: Write failing source-contract tests**

Assert the component has a 400–500 ms debounce, uses `AbortController`, tracks a query key, has explicit manual-dirty state for city/province, uses `CountryPicker`, and shows `SearchableSelect` when multiple `PostalPlace` values are available.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/postal-address-fields.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement debounce and stale-response handling**

On country/postal change, clear the previous timer and abort previous request. Capture `queryKey=postalLookupKey(...)`; before applying a response confirm it still equals the current key.

- [ ] **Step 4: Protect manual edits**

Track `cityManual` and `provinceManual`. User typing sets the corresponding flag. A lookup for the same query does not overwrite dirty values. Changing country or postal code resets those flags for the new query and may apply new automatic values.

- [ ] **Step 5: Handle one/many/no places**

One place auto-fills non-dirty city/region. Multiple places expose a searchable place selector. Empty/error results show a subtle helper (`No encontramos el CP; completa población y provincia manualmente`) but never disable save.

- [ ] **Step 6: Run tests/build**

Run: `node --test scripts/postal-address-fields.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/forms/PostalAddressFields.tsx src/sales.css scripts/postal-address-fields.test.mjs
git commit -m "feat: add reusable postal address fields"
```

### Task 5: Migrate Client modal to shared form/address components

**Files:**
- Modify: `src/pages/Clients.tsx`
- Create: `scripts/client-shared-form.test.mjs`

**Interfaces:**
- Client persistence remains unchanged: `countryCode`, `postalCode`, `city`, `province` continue through existing `ClientInput`.
- `ClientModal` consumes `FormModal`, `FormSection`, `FormGrid`, `PostalAddressFields`.

- [ ] **Step 1: Write failing source-contract test**

Assert `Clients.tsx` imports/uses `PostalAddressFields` and no longer renders `País<input ... maxLength={2}>`. Assert existing save normalization remains intact.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/client-shared-form.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Migrate the modal**

Keep identification/contact/commercial sections and current field semantics. Replace the raw country/postal/city/province labels with `PostalAddressFields` wired directly to `form.countryCode`, `form.postalCode`, `form.city`, `form.province`.

- [ ] **Step 4: Verify existing clients preserve values**

The effect that populates `form` from an existing client must remain unchanged in value semantics; opening an existing client MUST NOT trigger save or rewrite until the user changes fields.

- [ ] **Step 5: Run tests/build**

Run: `node --test scripts/client-shared-form.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients.tsx scripts/client-shared-form.test.mjs
git commit -m "feat: improve client country and postal fields"
```

### Task 6: Migrate ZENVIA fiscal settings and VAT registrations

**Files:**
- Modify: `src/pages/SalesInvoices.tsx`
- Modify: `src/components/SalesConfigurationModals.tsx`
- Create: `scripts/fiscal-country-controls.test.mjs`

**Interfaces:**
- `BusinessSettings.countryCode/postalCode/city/province` persist unchanged.
- `TaxRegistrationInput.countryCode` persists unchanged.
- Business address uses `PostalAddressFields`; VAT registration uses `CountryPicker` only because `addressText` remains free-form.

- [ ] **Step 1: Write failing source-contract test**

Assert `SalesInvoices.tsx` uses `PostalAddressFields` in `BusinessModal`, `SalesConfigurationModals.tsx` uses `CountryPicker`, and neither form renders a two-character raw country input.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/fiscal-country-controls.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Migrate BusinessModal**

Keep legal identity, VAT registrations, logo, banking/footer sections. In address/contact section, keep address line/email/phone and replace country+postal+city+province fields with `PostalAddressFields`.

- [ ] **Step 4: Migrate TaxRegistrationsPanel country field**

Replace raw ISO input with `CountryPicker value={form.countryCode}` and `onChange={countryCode=>setForm(v=>({...v,countryCode}))}`. Keep validation `countryCode.length===2` as storage validation.

- [ ] **Step 5: Run tests/build**

Run: `node --test scripts/fiscal-country-controls.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/SalesInvoices.tsx src/components/SalesConfigurationModals.tsx scripts/fiscal-country-controls.test.mjs
git commit -m "feat: standardize fiscal country controls"
```

### Task 7: Redesign ProductModal on shared primitives and searchable supplier

**Files:**
- Modify: `src/components/ProductModal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/sales.css`
- Modify/Test alongside: `scripts/product-modal-supplier.test.mjs`

**Interfaces:**
- Depends on `ProductInput.supplierId?:string|null` from the product supplier-correction plan.
- Depends on `SearchableSelect`, `FormModal`, `FormSection`, `FormGrid` from Task 1.
- `ProductModal` receives `suppliers:Supplier[]` and emits `supplierId:supplierId||null` in `onSave`.

- [ ] **Step 1: Extend failing ProductModal contract test**

Require the modal to use `FormModal`, at least four `FormSection` blocks, `FormGrid`, and `SearchableSelect` for provider selection. Assert there is no root `stackForm` usage in ProductModal.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/product-modal-supplier.test.mjs`
Expected: FAIL on shared-layout/searchable-selector requirements.

- [ ] **Step 3: Implement the approved layout**

Sections:
- `Identificación`: full-width name, SKU/EAN, category/unit.
- `Compra y proveedor`: searchable provider + current cost.
- `Venta`: sale price + VAT, preserving auto `cost * 1.25` behavior and showing markup-over-cost indicator.
- `Facturación`: full-width invoice description.

Keep historical-cost note compact. Provider helper explicitly states the correction does not create purchase history.

- [ ] **Step 4: Wire supplier options from App**

Pass `data.suppliers` into ProductModal. Include an empty `Sin proveedor` option via `SearchableSelect`'s empty support.

- [ ] **Step 5: Run product tests and full build**

Run: `node --test scripts/product-modal-supplier.test.mjs scripts/product-metrics.test.mjs scripts/product-supplier-correction.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProductModal.tsx src/App.tsx src/sales.css scripts/product-modal-supplier.test.mjs
git commit -m "feat: redesign product form"
```

### Task 8: Migrate long entity selectors touched by this release

**Files:**
- Modify: `src/pages/SalesInvoices.tsx`
- Modify: `src/components/InvoiceDetailModal.tsx`
- Modify: invoice/bulk components created by the invoice-import plan where provider/client selection appears.
- Create: `scripts/searchable-entity-selectors.test.mjs`

**Interfaces:**
- Use `SearchableSelect` for long entity lists only: clients, suppliers, products/registrations when list size can grow.
- Preserve native selects for VAT rates, series kind, status and other short closed enums.

- [ ] **Step 1: Write failing source-contract test**

Assert the new invoice client selector and invoice-detail supplier selector use `SearchableSelect`; assert VAT-rate selectors still use native `<select>`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/searchable-entity-selectors.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Replace only long entity selectors**

Build option labels with useful secondary search terms (`name`, `taxId`, codes). Do not alter persistence values or validation paths.

- [ ] **Step 4: Run full UI tests/build**

Run: `node --test scripts/searchable-entity-selectors.test.mjs scripts/shared-form-controls.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SalesInvoices.tsx src/components/InvoiceDetailModal.tsx src/components scripts/searchable-entity-selectors.test.mjs
git commit -m "feat: standardize searchable entity selectors"
```

### Task 9: Final responsive/accessibility regression verification for shared forms

**Files:**
- Create: `scripts/shared-form-regression.test.mjs`
- Modify production files only if verification exposes a defect.

- [ ] **Step 1: Add regression assertions**

Assert CSS includes one-column mobile `.formGrid`, modal sticky action positioning, focus-visible styles for the searchable control, and dark-mode selectors/variables used by the app. Assert Client/Product/Business forms all use the shared primitives.

- [ ] **Step 2: Run entire test suite**

Run: `node --test scripts/*.test.mjs`
Expected: all PASS.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Vite build succeeds; existing chunk-size warning is acceptable if unchanged.

- [ ] **Step 4: Review diff for accidental behavior changes**

Confirm persisted country values remain ISO codes, no supplier address schema change was introduced, simple selects remain simple, and postal lookup request construction contains no personal fields.

- [ ] **Step 5: Commit verification test**

```bash
git add scripts/shared-form-regression.test.mjs
git commit -m "test: cover shared form regressions"
```

## Cross-plan execution order

This plan must be coordinated with the three existing plans as follows:

1. Finish the invoice pipeline/bulk plan through its shared pipeline and bulk UI checkpoints.
2. Execute Product margin helper and product supplier persistence tasks (Tasks 1–2 of `2026-09-16-products-provider-margin-plan.md`).
3. Execute Tasks 1–4 of this plan (shared primitives, countries, postal service, address fields).
4. Execute Task 7 of this plan instead of the old native-select ProductModal layout step; it subsumes the UI portion of Task 3 in the product plan while preserving its supplier behavior.
5. Execute the global tooltip plan.
6. Execute Tasks 5–6 and 8–9 of this plan.
7. Apply/verify Supabase migrations and explicit CABAPLAST data repair from the invoice plan.
8. Run final code review, full CI, merge to `main`, verify `main` CI and Vercel.

No checkpoint is merged to `main` before the complete coordinated feature is green.