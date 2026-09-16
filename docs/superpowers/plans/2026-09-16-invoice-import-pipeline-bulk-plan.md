# Invoice Import Pipeline and Bulk Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify single and bulk expense-invoice import, fix CABAPLAST extraction, enforce the historical recipient cutoff, persist equivalence surcharge, and prevent orphaned suppliers on failed imports.

**Architecture:** Introduce a pure candidate-preparation layer used by both single and bulk UI. Keep browser-side PDF/OCR reading, but separate parsing/validation from persistence. Persistence remains in `repository.ts`, strengthened with compensating rollback for newly created resources.

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS, browser File API, existing invoice readers, Node `node:test` scripts.

**Spec:** `docs/superpowers/specs/2026-09-16-invoice-import-bulk-tooltips-products-design.md`

## Global Constraints

- Single and bulk imports MUST use the same candidate preparation and validation functions.
- `15436385G` is accepted automatically only when invoice date is <= `2026-06-30`; from `2026-07-01` it requires review.
- Name-only matches for Cristian Jesús Pérez Garrido do not auto-approve without the NIF.
- Bulk UI accepts multiple PDFs; ZIP support is out of scope.
- Bulk analysis concurrency is limited to 2 documents.
- Preparing candidates must not persist suppliers/products/invoices.
- Equivalence surcharge is stored as an aggregate amount; multiple surcharge bands are out of scope.
- A failed invoice import must not leave a newly-created unreferenced supplier behind.

---

### Task 1: Recipient rules and import candidate types

**Files:**
- Create: `src/services/invoiceRecipientRules.ts`
- Create: `src/services/invoiceImportPipeline.ts`
- Create: `scripts/invoice-import-pipeline.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- Produces: `validateInvoiceRecipient(text:string, invoiceDate:string): {accepted:boolean; needsReview:boolean; reason?:string; detectedTaxId?:string; detectedName?:string}`
- Produces: `InvoiceImportCandidate`, `InvoiceImportCandidateStatus`, `prepareInvoiceCandidate(file,categories,onProgress?)`.

- [ ] **Step 1: Write failing recipient-rule tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}`);
}

test('accepts historical recipient through 2026-06-30',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  assert.deepEqual(validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO NIF 15436385G','2026-06-30'),{accepted:true,needsReview:false,detectedTaxId:'15436385G',detectedName:'CRISTIAN JESUS PEREZ GARRIDO'});
});

test('requires review for historical recipient from 2026-07-01',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  const result=validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO NIF 15436385G','2026-07-01');
  assert.equal(result.accepted,false);
  assert.equal(result.needsReview,true);
  assert.match(result.reason,/Destinatario no válido/i);
});

test('name without tax id never auto-approves',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  assert.equal(validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO','2026-03-13').needsReview,true);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/invoice-import-pipeline.test.mjs`
Expected: FAIL because `invoiceRecipientRules.ts` does not exist.

- [ ] **Step 3: Add recipient implementation and candidate types**

Implement `invoiceRecipientRules.ts` with normalized text/NIF matching and exact date cutoff. Extend `src/types.ts` with:

```ts
export type InvoiceImportCandidateStatus='analyzing'|'ready'|'needs_review'|'duplicate'|'error'|'importing'|'imported';

export interface InvoiceImportCandidate {
  id:string;
  file:File;
  fileHash:string;
  status:InvoiceImportCandidateStatus;
  reviewReason?:string;
  supplierName:string;
  supplierTaxId?:string;
  supplierEmail?:string;
  supplierPhone?:string;
  supplierAddress?:string;
  supplierWebsite?:string;
  recipientTaxId?:string;
  recipientName?:string;
  invoiceNumber:string;
  invoiceDate:string;
  categoryId?:string;
  subtotal:number;
  vat:number;
  equivalenceSurcharge:number;
  withholding:number;
  total:number;
  text:string;
  confidence:number;
  lines:NewInvoiceLineInput[];
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test scripts/invoice-import-pipeline.test.mjs`
Expected: PASS recipient-rule tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/invoiceRecipientRules.ts src/services/invoiceImportPipeline.ts src/types.ts scripts/invoice-import-pipeline.test.mjs
git commit -m "feat: add invoice import candidate rules"
```

### Task 2: CABAPLAST supplier/contact extraction and short product codes

**Files:**
- Modify: `src/services/supplierContactExtractor.ts`
- Modify: `src/services/supplierInvoiceDetails.ts`
- Modify: `src/services/invoiceProductLine.ts`
- Modify: `scripts/supplier-invoice-details.test.mjs`
- Modify: `scripts/invoice-product-line.test.mjs`

**Interfaces:**
- Existing `extractSupplierContactData(text,supplierName)` must recover tax ID/email/phone near the supplier even when fields appear before the name.
- Existing `extractSupplierInvoiceDetails(text,supplierName)` must search a bidirectional context window.
- Existing product-line parsing must retain short supplier SKU values such as `0170`, `0007`, `0257`.

- [ ] **Step 1: Add failing CABAPLAST fixture tests**

Add a fixture containing supplier address/contact lines before `DISTRIBUCIONES CABAPLAST 99 S.L.` and assert:

```js
assert.equal(details.taxId,'B90163700');
assert.match(details.address,/MAIRENA DEL ALCOR/i);
assert.equal(contact.email,'cabaplast99@hotmail.com');
```

Add product-line assertions that rows beginning with `0170`, `0007`, `0257` produce product lines and preserve the SKU.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test scripts/supplier-invoice-details.test.mjs scripts/invoice-product-line.test.mjs`
Expected: at least one CABAPLAST extraction or short-code assertion fails.

- [ ] **Step 3: Implement bidirectional supplier context**

Change supplier block construction to include approximately 8 meaningful lines before and 12 after the matched supplier name, stopping at clear invoice/buyer boundaries. Score tax ID, email and phone candidates using supplier-name proximity and penalize buyer markers.

- [ ] **Step 4: Allow short SKU product rows**

Adjust the product-row recognizer so a 4-digit leading code is accepted when the remaining row contains quantity/description/price structure. Do not treat plain postal codes or totals as products.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test scripts/supplier-invoice-details.test.mjs scripts/invoice-product-line.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/supplierContactExtractor.ts src/services/supplierInvoiceDetails.ts src/services/invoiceProductLine.ts scripts/supplier-invoice-details.test.mjs scripts/invoice-product-line.test.mjs
git commit -m "fix: parse CABAPLAST supplier and product rows"
```

### Task 3: Equivalence surcharge model and amount repair

**Files:**
- Create: `supabase/migrations/20260916120000_add_equivalence_surcharge.sql`
- Modify: `src/types.ts`
- Modify: `src/services/invoiceProductLine.ts`
- Modify: `src/services/repository.ts`
- Modify: `src/components/InvoiceDetailModal.tsx`
- Modify: `scripts/invoice-product-line.test.mjs`

**Interfaces:**
- `Invoice.equivalenceSurcharge:number`
- `NewInvoiceInput.equivalenceSurcharge:number`
- `repairInvoiceAmounts` returns `{subtotal,vat,equivalenceSurcharge,total}` when surcharge is detected.

- [ ] **Step 1: Add failing fiscal-summary test**

Use the CABAPLAST fixture and assert the repaired amounts include `equivalenceSurcharge:100.58` and satisfy:

```js
assert.equal(Number((result.subtotal+result.vat+result.equivalenceSurcharge-result.withholding).toFixed(2)),result.total);
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test scripts/invoice-product-line.test.mjs`
Expected: FAIL because surcharge is not returned/persisted.

- [ ] **Step 3: Add migration**

```sql
alter table public.invoices
  add column if not exists equivalence_surcharge_amount numeric(14,2) not null default 0;
```

- [ ] **Step 4: Implement extraction and persistence**

Extend amount repair to detect `RECARGO`, `R.E.`, or a separate 5.20% surcharge row. Map DB field in `loadAppData`, persist in `createInvoice`, and include it in extraction metadata.

- [ ] **Step 5: Show surcharge in invoice detail**

Render a fiscal line only when `invoice.equivalenceSurcharge !== 0`.

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260916120000_add_equivalence_surcharge.sql src/types.ts src/services/invoiceProductLine.ts src/services/repository.ts src/components/InvoiceDetailModal.tsx scripts/invoice-product-line.test.mjs
git commit -m "feat: support equivalence surcharge on expense invoices"
```

### Task 4: Pure candidate preparation and duplicate validation

**Files:**
- Modify: `src/services/invoiceImportPipeline.ts`
- Modify: `scripts/invoice-import-pipeline.test.mjs`

**Interfaces:**
- `prepareInvoiceCandidate(file,categories,onProgress?)` reads, repairs and validates without writes.
- `classifyCandidate(candidate, existingInvoices)` sets `ready`, `needs_review`, or `duplicate`.

- [ ] **Step 1: Add failing pure-classification tests**

Test duplicate by file hash, duplicate by normalized supplier + invoice number, invalid historical recipient, and a valid candidate becoming `ready`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/invoice-import-pipeline.test.mjs`
Expected: FAIL on missing preparation/classification exports.

- [ ] **Step 3: Implement minimal pipeline**

Call `readInvoiceDocumentEnhanced`, supplier extractors, `repairInvoiceAmounts`, `repairInvoiceProductLines`, `validateInvoiceRecipient`, and browser SHA-256. No Supabase write is allowed from this module.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --test scripts/invoice-import-pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/invoiceImportPipeline.ts scripts/invoice-import-pipeline.test.mjs
git commit -m "feat: prepare validated invoice import candidates"
```

### Task 5: Safe persistence with compensating rollback

**Files:**
- Modify: `src/services/repository.ts`
- Create: `scripts/invoice-import-rollback.test.mjs`

**Interfaces:**
- `createInvoice(input:NewInvoiceInput)` keeps the public call shape.
- New internal `ensureSupplierDetailed(...)` returns `{id:string; created:boolean}` so rollback knows whether deletion is safe to consider.

- [ ] **Step 1: Add failing source-contract tests**

Assert repository source includes a created-supplier flag, cleanup of unreferenced newly-created suppliers, and storage cleanup on invoice/line failure.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/invoice-import-rollback.test.mjs`
Expected: FAIL because `ensureSupplier` currently returns only an ID and does not remove orphan suppliers.

- [ ] **Step 3: Implement rollback-safe persistence**

Return creation metadata from supplier creation. On any failure after supplier creation, delete only that supplier if `created === true` and `invoices` contains zero references to it. Preserve existing suppliers even on failure.

- [ ] **Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/repository.ts scripts/invoice-import-rollback.test.mjs
git commit -m "fix: roll back orphan resources on invoice import failure"
```

### Task 6: Reuse candidate form for single upload

**Files:**
- Create: `src/components/InvoiceCandidateForm.tsx`
- Modify: `src/components/UploadInvoiceModal.tsx`
- Create: `scripts/invoice-upload-shared-pipeline.test.mjs`

**Interfaces:**
- `InvoiceCandidateForm` receives candidate fields plus `onChange` and renders supplier/number/date/category/base/IVA/surcharge/retention/total.
- `UploadInvoiceModal` uses `prepareInvoiceCandidate` and passes the corrected candidate to `onSave`.

- [ ] **Step 1: Add failing source-contract test**

Assert `UploadInvoiceModal.tsx` imports `prepareInvoiceCandidate` and `InvoiceCandidateForm` and no longer calls `readInvoiceDocumentEnhanced` directly.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/invoice-upload-shared-pipeline.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Extract the shared form and wire single upload**

Keep camera multi-image conversion intact. For a single PDF/image, prepare a candidate, show review fields, and submit a `NewInvoiceInput` derived from that candidate.

- [ ] **Step 4: Run tests and build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/InvoiceCandidateForm.tsx src/components/UploadInvoiceModal.tsx scripts/invoice-upload-shared-pipeline.test.mjs
git commit -m "refactor: reuse invoice import pipeline for single uploads"
```

### Task 7: Bulk invoice import UI with concurrency 2

**Files:**
- Create: `src/components/BulkInvoiceImportModal.tsx`
- Modify: `src/pages/Invoices.tsx`
- Modify: `src/pages/ExpenseInvoicesHub.tsx`
- Modify: `src/App.tsx`
- Create: `scripts/bulk-invoice-import.test.mjs`

**Interfaces:**
- `BulkInvoiceImportModal({open,onClose,categories,existingInvoices,onSave,onFinished})`
- Uses `prepareInvoiceCandidate` for each file.
- Analysis queue runs at most 2 active candidates.

- [ ] **Step 1: Add failing bulk UI source-contract tests**

Assert multiple PDF input, concurrency constant `2`, statuses in UI, `Importar X facturas`, and `Invoices` exposes a bulk action.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/bulk-invoice-import.test.mjs`
Expected: FAIL because component does not exist.

- [ ] **Step 3: Implement queue and review UI**

Use a worker loop with exactly two asynchronous workers over selected files. Render one card/row per candidate, progress counts, edit/review action, exclude action, and final summary.

- [ ] **Step 4: Import ready candidates sequentially**

For each `ready` candidate, set `importing`, await `onSave`, mark `imported` or `error`, continue to the next candidate, then call `onFinished` once.

- [ ] **Step 5: Wire App and invoices page**

Add `bulkUpload` state in `App.tsx`, pass `onBulkUpload` through `ExpenseInvoicesHub` to `Invoices`, and render `BulkInvoiceImportModal` beside `UploadInvoiceModal`.

- [ ] **Step 6: Run full test/build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/BulkInvoiceImportModal.tsx src/pages/Invoices.tsx src/pages/ExpenseInvoicesHub.tsx src/App.tsx scripts/bulk-invoice-import.test.mjs
git commit -m "feat: add bulk expense invoice import"
```

### Task 8: Apply migration, repair CABAPLAST supplier, and integration verification

**Files:**
- No new code beyond prior tasks unless verification exposes a defect.

- [ ] **Step 1: Apply Supabase migration**

Apply `20260916120000_add_equivalence_surcharge.sql` to project `sjkxxbedkkmgmqnvaqjh`.

- [ ] **Step 2: Repair existing CABAPLAST supplier profile**

Update the existing supplier matching `DISTRIBUCIONES CABAPLAST 99 S.L.` only where fields are blank: tax ID `B90163700`, address `C/ MAIRENA DEL ALCOR N 20, 41006 SEVILLA (SEVILLA)`, email `cabaplast99@hotmail.com`, and supplier type to `goods` unless an existing non-unclassified type requires `both`.

- [ ] **Step 3: Run full verification**

Run: `npm test && npm run build`
Expected: all tests and Vite build pass.

- [ ] **Step 4: Review diff**

Confirm no server OCR/Edge Function, ZIP support, or unrelated refactor entered the implementation.
