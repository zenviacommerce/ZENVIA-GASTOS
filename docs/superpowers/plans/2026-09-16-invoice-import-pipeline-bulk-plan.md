# Invoice Import Pipeline and Bulk Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify single and bulk expense-invoice import, fix CABAPLAST extraction, enforce the historical recipient cutoff, persist equivalence surcharge, and prevent orphaned suppliers on failed imports.

**Architecture:** Introduce a pure candidate-preparation layer shared by single and bulk UI. Keep browser-side PDF/OCR reading, but separate parsing/validation from persistence. Persistence remains in `repository.ts`, strengthened with compensating rollback for resources created by the current import.

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS, browser File API, existing invoice readers, Node `node:test` scripts.

**Spec:** `docs/superpowers/specs/2026-09-16-invoice-import-bulk-tooltips-products-design.md`

## Global Constraints

- Single and bulk imports MUST use the same candidate preparation and validation functions.
- `15436385G` is accepted automatically only when invoice date is <= `2026-06-30`; from `2026-07-01` it requires review.
- Name-only matches for Cristian Jesús Pérez Garrido do not auto-approve without the NIF.
- Bulk UI accepts multiple PDFs; ZIP support is out of scope.
- Bulk analysis concurrency is limited to 2 documents.
- Preparing candidates must not persist suppliers/products/invoices.
- `NewInvoiceInput.equivalenceSurcharge` is optional and defaults to 0 so Gmail and other existing callers remain compatible.
- Equivalence surcharge is stored as an aggregate amount; multiple surcharge bands are out of scope.
- A failed invoice import must not leave a newly-created unreferenced supplier behind.
- Existing CABAPLAST `supplier_type='service'` is known bad data from the failed import and must be corrected to `goods`, not `both`.

---

### Task 1: Recipient rules and candidate types

**Files:**
- Create: `src/services/invoiceRecipientRules.ts`
- Create: `src/services/invoiceImportPipeline.ts`
- Create: `scripts/invoice-import-pipeline.test.mjs`
- Modify: `src/types.ts`

**Interfaces:**
- `validateInvoiceRecipient(text:string, invoiceDate:string): {accepted:boolean; needsReview:boolean; reason?:string; detectedTaxId?:string; detectedName?:string}`
- `InvoiceImportCandidateStatus='analyzing'|'ready'|'needs_review'|'duplicate'|'error'|'importing'|'imported'`
- `InvoiceImportCandidate` contains file/hash, supplier fields, recipient fields, invoice header, `equivalenceSurcharge`, text/confidence and lines.

- [ ] **Step 1: Write failing recipient tests**

```js
test('accepts historical recipient through cutoff',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  assert.equal(validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO NIF 15436385G','2026-06-30').accepted,true);
});

test('blocks automatic import from 2026-07-01',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  const result=validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO NIF 15436385G','2026-07-01');
  assert.equal(result.needsReview,true);
  assert.match(result.reason,/Destinatario no válido/i);
});

test('name without NIF requires review',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  assert.equal(validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO','2026-03-13').needsReview,true);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/invoice-import-pipeline.test.mjs`
Expected: FAIL because recipient module does not exist.

- [ ] **Step 3: Implement recipient rule and candidate type**

Normalize accents/case and NIF punctuation. Return `needsReview:false` for documents that do not contain the historical recipient; the special rule only intervenes when that identity/name is detected. Add candidate type to `src/types.ts`.

- [ ] **Step 4: Run GREEN**

Run: `node --test scripts/invoice-import-pipeline.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/invoiceRecipientRules.ts src/services/invoiceImportPipeline.ts src/types.ts scripts/invoice-import-pipeline.test.mjs
git commit -m "feat: add invoice import candidate rules"
```

### Task 2: CABAPLAST supplier extraction and short product codes

**Files:**
- Modify: `src/services/supplierContactExtractor.ts`
- Modify: `src/services/supplierInvoiceDetails.ts`
- Modify: `src/services/invoiceProductLine.ts`
- Modify: `scripts/supplier-invoice-details.test.mjs`
- Modify: `scripts/invoice-product-line.test.mjs`

- [ ] **Step 1: Add failing CABAPLAST fixture tests**

```js
assert.equal(details.taxId,'B90163700');
assert.match(details.address,/MAIRENA DEL ALCOR/i);
assert.equal(contact.email,'cabaplast99@hotmail.com');
```

Also assert rows beginning `0170`, `0007`, `0257` are parsed as products and preserve `supplierSku`.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/supplier-invoice-details.test.mjs scripts/invoice-product-line.test.mjs`
Expected: CABAPLAST extraction/short-code assertions fail.

- [ ] **Step 3: Implement bidirectional supplier context**

Include 8 meaningful lines before and 12 after the supplier-name line. Score tax ID/email/phone by supplier proximity; penalize buyer markers. Address extraction may combine multiple address lines but must not include buyer data.

- [ ] **Step 4: Implement short-code row recognition**

Accept a 4-digit leading supplier code only when the rest of the row also has quantity/description/price structure. Keep fiscal summary/payment rows excluded.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test scripts/supplier-invoice-details.test.mjs scripts/invoice-product-line.test.mjs`
Expected: PASS.

```bash
git add src/services/supplierContactExtractor.ts src/services/supplierInvoiceDetails.ts src/services/invoiceProductLine.ts scripts/supplier-invoice-details.test.mjs scripts/invoice-product-line.test.mjs
git commit -m "fix: parse CABAPLAST supplier and product rows"
```

### Task 3: Equivalence surcharge

**Files:**
- Create: `supabase/migrations/20260916120000_add_equivalence_surcharge.sql`
- Modify: `src/types.ts`
- Modify: `src/services/invoiceProductLine.ts`
- Modify: `src/services/repository.ts`
- Modify: `src/components/InvoiceDetailModal.tsx`
- Modify: `scripts/invoice-product-line.test.mjs`

**Interfaces:**
- `Invoice.equivalenceSurcharge:number`
- `NewInvoiceInput.equivalenceSurcharge?:number`
- `repairInvoiceAmounts` returns `equivalenceSurcharge` with default 0.

- [ ] **Step 1: Add failing fiscal-summary test**

```js
const result=repairInvoiceAmounts(cabaplastText,{subtotal:0,vat:0,total:2441.08});
assert.equal(result.equivalenceSurcharge,100.58);
assert.equal(Number((result.subtotal+result.vat+result.equivalenceSurcharge).toFixed(2)),2441.08);
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/invoice-product-line.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Add migration**

```sql
alter table public.invoices
  add column if not exists equivalence_surcharge_amount numeric(14,2) not null default 0;
```

- [ ] **Step 4: Implement extraction, mapping and persistence**

Detect explicit `RECARGO`, `R.E.` or 5.20% surcharge rows. Map DB value in `loadAppData`; persist `input.equivalenceSurcharge ?? repairedAmounts.equivalenceSurcharge ?? 0`; include in extraction metadata.

- [ ] **Step 5: Render surcharge in invoice detail**

Show only when non-zero.

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run build`
Expected: PASS.

```bash
git add supabase/migrations/20260916120000_add_equivalence_surcharge.sql src/types.ts src/services/invoiceProductLine.ts src/services/repository.ts src/components/InvoiceDetailModal.tsx scripts/invoice-product-line.test.mjs
git commit -m "feat: support equivalence surcharge on expense invoices"
```

### Task 4: Pure candidate preparation and duplicate classification

**Files:**
- Modify: `src/services/invoiceImportPipeline.ts`
- Modify: `scripts/invoice-import-pipeline.test.mjs`

**Interfaces:**
- `prepareInvoiceCandidate(file,categories,onProgress?)` performs reading/repair/extraction without Supabase writes.
- `classifyCandidate(candidate, existingInvoices)` applies duplicate and recipient rules.

- [ ] **Step 1: Add failing tests** for valid candidate, duplicate hash, duplicate normalized supplier+number, and historical-recipient review.
- [ ] **Step 2: Run RED** with `node --test scripts/invoice-import-pipeline.test.mjs`.
- [ ] **Step 3: Implement** by composing `readInvoiceDocumentEnhanced`, supplier extractors, amount/line repair, recipient validation and SHA-256.
- [ ] **Step 4: Run GREEN** with the same test command.
- [ ] **Step 5: Commit**

```bash
git add src/services/invoiceImportPipeline.ts scripts/invoice-import-pipeline.test.mjs
git commit -m "feat: prepare validated invoice import candidates"
```

### Task 5: Safe persistence and orphan rollback

**Files:**
- Modify: `src/services/repository.ts`
- Create: `scripts/invoice-import-rollback.test.mjs`

**Interfaces:**
- Replace internal supplier creation return with `{id:string; created:boolean}`.

- [ ] **Step 1: Add failing contract tests** asserting creation metadata, storage cleanup and conditional removal of a newly-created supplier.
- [ ] **Step 2: Run RED** with `node --test scripts/invoice-import-rollback.test.mjs`.
- [ ] **Step 3: Implement cleanup**: on failure, remove created invoice/storage/product mappings as today; if supplier was newly created, query invoice references and delete supplier only when count is zero. Existing supplier records are never deleted.
- [ ] **Step 4: Run** `npm test && npm run build` and require PASS.
- [ ] **Step 5: Commit**

```bash
git add src/services/repository.ts scripts/invoice-import-rollback.test.mjs
git commit -m "fix: roll back orphan resources on invoice import failure"
```

### Task 6: Shared single-invoice candidate form

**Files:**
- Create: `src/components/InvoiceCandidateForm.tsx`
- Modify: `src/components/UploadInvoiceModal.tsx`
- Create: `scripts/invoice-upload-shared-pipeline.test.mjs`

- [ ] **Step 1: Add failing contract test** asserting UploadInvoiceModal imports `prepareInvoiceCandidate` and `InvoiceCandidateForm` and no longer calls `readInvoiceDocumentEnhanced` directly.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Extract shared form** with supplier/number/date/category/base/IVA/recargo/retention/total fields; preserve camera multi-image-to-PDF flow.
- [ ] **Step 4: Convert corrected candidate to `NewInvoiceInput`** and pass surcharge as optional number.
- [ ] **Step 5: Run** `npm test && npm run build`.
- [ ] **Step 6: Commit**

```bash
git add src/components/InvoiceCandidateForm.tsx src/components/UploadInvoiceModal.tsx scripts/invoice-upload-shared-pipeline.test.mjs
git commit -m "refactor: reuse invoice pipeline for single uploads"
```

### Task 7: Bulk import UI

**Files:**
- Create: `src/components/BulkInvoiceImportModal.tsx`
- Modify: `src/pages/Invoices.tsx`
- Modify: `src/pages/ExpenseInvoicesHub.tsx`
- Modify: `src/App.tsx`
- Create: `scripts/bulk-invoice-import.test.mjs`

**Interfaces:**
- `BulkInvoiceImportModal({open,onClose,categories,existingInvoices,onSave,onFinished})`
- exactly 2 analysis workers; imports happen sequentially.

- [ ] **Step 1: Add failing UI contract tests** for `<input multiple accept="application/pdf">`, concurrency 2, candidate statuses and `Importar X facturas`.
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implement two-worker analysis queue** and cards/rows for file, state, supplier, number, date, fiscal totals, lines and review/error reason.
- [ ] **Step 4: Implement edit/exclude and sequential import**. A failed candidate becomes `error` and does not stop later `ready` candidates.
- [ ] **Step 5: Wire `bulkUpload` state** through App -> ExpenseInvoicesHub -> Invoices and render bulk modal in App.
- [ ] **Step 6: Run** `npm test && npm run build`.
- [ ] **Step 7: Commit**

```bash
git add src/components/BulkInvoiceImportModal.tsx src/pages/Invoices.tsx src/pages/ExpenseInvoicesHub.tsx src/App.tsx scripts/bulk-invoice-import.test.mjs
git commit -m "feat: add bulk expense invoice import"
```

### Task 8: Database/application verification and CABAPLAST repair

- [ ] **Step 1: Apply migration** `20260916120000_add_equivalence_surcharge.sql` to Supabase project `sjkxxbedkkmgmqnvaqjh`.
- [ ] **Step 2: Repair existing CABAPLAST supplier only where contact fields are blank**: tax ID `B90163700`, address `C/ MAIRENA DEL ALCOR N 20, 41006 SEVILLA (SEVILLA)`, email `cabaplast99@hotmail.com`.
- [ ] **Step 3: Correct CABAPLAST `supplier_type` to `goods`** even if currently `service`, because that classification is known to have been created by the defective import.
- [ ] **Step 4: Run** `npm test && npm run build` and require PASS.
- [ ] **Step 5: Review diff** to confirm no ZIP/server-OCR/unrelated refactor entered the change.
