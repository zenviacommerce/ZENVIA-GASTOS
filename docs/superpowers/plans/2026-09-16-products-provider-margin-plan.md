# Products Provider Correction and Margin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow manual correction of a product's current supplier without creating fake purchase history, and display the product margin percentage as markup over cost so a default 1.25x sale price displays 25%.

**Architecture:** Reuse the existing `products.last_supplier_id` field because the user's intent is administrative correction of a missing/incorrect current supplier, not a new preferred-supplier concept. Extend ProductModal/ProductInput with an optional supplier ID and update only `last_supplier_id` for supplier edits; keep price history logic isolated to actual price changes. Centralize product margin math in a small pure helper used by list, drawer, mobile view and KPI.

**Tech Stack:** React 19, TypeScript, Supabase JS, existing product editor service, Node `node:test` scripts.

**Spec:** `docs/superpowers/specs/2026-09-16-invoice-import-bulk-tooltips-products-design.md`

## Global Constraints

- Manual supplier correction MUST NOT insert into `product_price_history`.
- Manual supplier correction MUST NOT modify `last_cost` or `previous_cost`.
- Manual supplier correction MUST NOT rewrite historical invoices.
- A later real purchase may overwrite `last_supplier_id` through the normal invoice-price trigger.
- Margin percentage is `(sale - cost) / cost * 100`.
- If cost is null or zero, margin percentage is null and UI displays `—`.
- Default sale price remains `cost * 1.25`; only displayed percentage semantics change.

---

### Task 1: Add pure product margin helper

**Files:**
- Create: `src/services/productMetrics.ts`
- Create: `scripts/product-metrics.test.mjs`
- Modify: `src/pages/Products.tsx`

**Interfaces:**
- Produces: `productMarginMetrics(cost:number|null|undefined, sale:number|null|undefined): {margin:number|null; marginPct:number|null}`

- [ ] **Step 1: Write failing tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';

async function load(){
  const source=await readFile(new URL('../src/services/productMetrics.ts',import.meta.url),'utf8');
  const out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}`);
}

test('100 cost and 125 sale gives 25 percent over cost',async()=>{
  const {productMarginMetrics}=await load();
  assert.deepEqual(productMarginMetrics(100,125),{margin:25,marginPct:25});
});

test('zero cost has no percentage',async()=>{
  const {productMarginMetrics}=await load();
  assert.deepEqual(productMarginMetrics(0,125),{margin:125,marginPct:null});
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/product-metrics.test.mjs`
Expected: FAIL because `productMetrics.ts` does not exist.

- [ ] **Step 3: Implement helper**

```ts
export function productMarginMetrics(cost:number|null|undefined,sale:number|null|undefined){
  if(cost==null||sale==null)return {margin:null,marginPct:null};
  const margin=sale-cost;
  return {margin,marginPct:cost>0?margin/cost*100:null};
}
```

- [ ] **Step 4: Replace local percentage formula in Products**

Use the helper inside `productMetrics(...)`; preserve cost-variation (`delta`) calculation. Change KPI subtitle from `Sobre precio de venta` to `Sobre coste`.

- [ ] **Step 5: Run tests/build**

Run: `node --test scripts/product-metrics.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/productMetrics.ts scripts/product-metrics.test.mjs src/pages/Products.tsx
git commit -m "fix: show product margin over cost"
```

### Task 2: Expose supplier correction in product input and editor service

**Files:**
- Modify: `src/services/productEditor.ts`
- Modify: `src/types.ts`
- Create: `scripts/product-supplier-correction.test.mjs`

**Interfaces:**
- `ProductInput` gains `supplierId?: string|null`.
- `getProductSalesDetails` need not return supplier because `Product` already has `supplierId` from `loadAppData`.
- `updateProduct` updates `last_supplier_id` from `input.supplierId ?? null` independently from price-history insertion.

- [ ] **Step 1: Write failing source-contract test**

Assert `ProductInput` includes `supplierId`, `updateProduct` writes `last_supplier_id`, and supplier-only change does not make `priceChanged` true or call `addManualPriceHistory`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/product-supplier-correction.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement supplier field persistence**

Read `last_supplier_id` with the existing product row. Include `last_supplier_id: input.supplierId || null` in the update object. Include existing `last_supplier_id` in rollback if manual price-history insertion later fails.

For `addProduct`, allow an optional supplier and write `last_supplier_id` at creation, but do not create supplier-product or price-history rows merely because a supplier was chosen.

- [ ] **Step 4: Run focused test and build**

Run: `node --test scripts/product-supplier-correction.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/productEditor.ts src/types.ts scripts/product-supplier-correction.test.mjs
git commit -m "feat: allow product supplier correction"
```

### Task 3: Add supplier selector to ProductModal

**Files:**
- Modify: `src/components/ProductModal.tsx`
- Modify: `src/App.tsx`
- Create: `scripts/product-modal-supplier.test.mjs`

**Interfaces:**
- `ProductModal` props gain `suppliers:Supplier[]`.
- Local state `supplierId` initializes from `product?.supplierId ?? ''`.
- `onSave` sends `supplierId: supplierId || null`.

- [ ] **Step 1: Add failing UI source-contract test**

Assert ProductModal imports `Supplier`, receives `suppliers`, renders `<option value="">Sin proveedor</option>`, maps supplier options, initializes from `product?.supplierId`, and includes `supplierId` in save input.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/product-modal-supplier.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement selector**

Add a label near category/unit fields:

```tsx
<label>Proveedor
  <select value={supplierId} onChange={e=>setSupplierId(e.target.value)}>
    <option value="">Sin proveedor</option>
    {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
  </select>
  <span className="fieldHint">Corrige aquí el proveedor actual si una importación no lo detectó. No modifica el histórico de compras.</span>
</label>
```

- [ ] **Step 4: Wire App**

Pass `suppliers={data.suppliers}` to ProductModal.

- [ ] **Step 5: Run full tests/build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProductModal.tsx src/App.tsx scripts/product-modal-supplier.test.mjs
git commit -m "feat: edit current supplier from product form"
```

### Task 4: Verify no fake history is created by supplier correction

**Files:**
- No production files unless verification exposes a defect.

- [ ] **Step 1: Use Supabase test data or a reversible transaction-like manual check**

Choose an existing product with no supplier, record `last_cost`, `previous_cost`, and count of `product_price_history`, update only `last_supplier_id`, then verify price fields and history row count are unchanged.

- [ ] **Step 2: Verify a real later purchase still controls current supplier**

Confirm the existing invoice trigger can update `last_supplier_id` from the latest real `product_price_history` row after a confirmed purchase.

- [ ] **Step 3: Run full suite/build**

Run: `npm test && npm run build`
Expected: PASS.
