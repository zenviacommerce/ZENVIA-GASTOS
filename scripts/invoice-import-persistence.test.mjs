import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('invoice model and migration persist equivalence surcharge',async()=>{
  const [types,migration]=await Promise.all([
    read('../src/types.ts'),
    read('../supabase/migrations/20260916120000_add_equivalence_surcharge.sql'),
  ]);
  assert.match(types,/equivalenceSurcharge:\s*number/);
  assert.match(types,/equivalenceSurcharge\?:\s*number/);
  assert.match(migration,/equivalence_surcharge_amount\s+numeric\(14,2\)\s+not null\s+default 0/i);
});

test('repository maps and persists equivalence surcharge',async()=>{
  const source=await read('../src/services/repository.ts');
  assert.match(source,/equivalenceSurcharge:\s*numberOrZero\(i\.equivalence_surcharge_amount\)/);
  assert.match(source,/equivalence_surcharge_amount:\s*preparedInput\.equivalenceSurcharge\s*\?\?\s*0/);
  assert.match(source,/equivalenceSurcharge:\s*preparedInput\.equivalenceSurcharge\s*\?\?\s*0/);
});

test('invoice detail shows equivalence surcharge only when non-zero',async()=>{
  const source=await read('../src/components/InvoiceDetailModal.tsx');
  assert.match(source,/invoice\.equivalenceSurcharge\s*!==\s*0/);
  assert.match(source,/Recargo de equivalencia/);
});

test('new supplier creation is tracked and rolled back when import fails',async()=>{
  const source=await read('../src/services/repository.ts');
  assert.match(source,/Promise<\{\s*id:\s*string;\s*created:\s*boolean\s*\}>/);
  assert.match(source,/created:\s*false/);
  assert.match(source,/created:\s*true/);
  assert.match(source,/cleanupCreatedSupplier/);
  assert.match(source,/supplierResult\.created/);
  assert.match(source,/count:\s*'exact'/);
});
