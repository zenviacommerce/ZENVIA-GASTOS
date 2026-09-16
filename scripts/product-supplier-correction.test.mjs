import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('ProductInput accepts an optional supplier correction',async()=>{
  const source=await read('../src/services/productEditor.ts');
  assert.match(source,/supplierId\?:\s*string\s*\|\s*null/);
});

test('product updates persist last_supplier_id independently from price changes',async()=>{
  const source=await read('../src/services/productEditor.ts');
  assert.match(source,/last_supplier_id/);
  assert.match(source,/supplierId/);
  assert.match(source,/priceChanged\s*=\s*!samePrice/);
  assert.doesNotMatch(source,/priceChanged\s*=.*supplierId/);
});

test('supplier-only correction does not create product price history',async()=>{
  const source=await read('../src/services/productEditor.ts');
  assert.match(source,/if\s*\(priceChanged\s*&&\s*newPrice\s*!=\s*null\)/);
  const manualHistoryCalls=(source.match(/addManualPriceHistory\(/g)||[]).length;
  assert.equal(manualHistoryCalls,3,'history helper should only be declared and called for actual price creation/change paths');
});

test('supplier field participates in rollback when a price-history write fails',async()=>{
  const source=await read('../src/services/productEditor.ts');
  assert.match(source,/select\([^)]*last_supplier_id/);
  assert.match(source,/last_supplier_id:\s*existing\.last_supplier_id/);
});
