import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('new sales invoice uses SearchableSelect for the growing client list',async()=>{
  const source=await read('../src/pages/SalesInvoices.tsx');
  assert.match(source,/SearchableSelect/);
  assert.match(source,/clientOptions/);
  assert.match(source,/ariaLabel="Cliente de la factura"/);
  assert.doesNotMatch(source,/Cliente \*<select value=\{clientId\}/);
});

test('expense invoice detail uses SearchableSelect for suppliers',async()=>{
  const source=await read('../src/components/InvoiceDetailModal.tsx');
  assert.match(source,/SearchableSelect/);
  assert.match(source,/supplierOptions/);
  assert.match(source,/ariaLabel="Proveedor asignado"/);
  assert.doesNotMatch(source,/<select id="invoiceSupplier"/);
});

test('expense supplier filter is searchable by supplier data',async()=>{
  const source=await read('../src/components/InvoiceFilters.tsx');
  assert.match(source,/SearchableSelect/);
  assert.match(source,/supplierOptions/);
  assert.match(source,/Todos los proveedores/);
  assert.match(source,/taxId|email/);
  assert.doesNotMatch(source,/<select value=\{filter\.supplierId\}/);
});

test('short VAT-rate enum uses SelectField without native select',async()=>{
  const source=await read('../src/pages/SalesInvoices.tsx');
  assert.match(source,/SelectField/);
  assert.doesNotMatch(source,/<select value=\{line\.taxRate\}/);
});
