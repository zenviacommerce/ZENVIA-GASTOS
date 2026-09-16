import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('strong merchandise evidence wins over generic transport wording',async()=>{
  const source=await read('../src/services/invoiceReaderEnhanced.ts');
  assert.match(source,/const merchandiseCategoryId\s*=\s*detectMerchandiseCategory\(categories,\s*base\.text,\s*invoiceLines\)/);
  assert.match(source,/const serviceCategoryId\s*=\s*merchandiseCategoryId\s*\?\s*undefined\s*:\s*serviceCategoryByContent\(categories,\s*base\.text\)/);
  assert.match(source,/const categoryId\s*=\s*merchandiseCategoryId\s*\|\|\s*serviceCategoryId\s*\|\|\s*base\.categoryId/);
});

test('expense invoice page exposes period-aware KPI cards',async()=>{
  const source=await read('../src/pages/Invoices.tsx');
  assert.match(source,/import \{ StatCard \} from ['"]\.\.\/components\/StatCard['"]/);
  for(const label of ['Gasto total','IVA soportado','Nº de facturas','Pendientes de revisar','Ticket medio','Proveedores distintos']){
    assert.match(source,new RegExp(`label=["']${label}["']`));
  }
  assert.match(source,/className=["']stats expenseStats["']/);
});
