import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('bulk invoice modal accepts multiple PDFs and uses exactly two analysis workers',async()=>{
  const source=await read('../src/components/BulkInvoiceImportModal.tsx');
  assert.match(source,/multiple/);
  assert.match(source,/accept=["']application\/pdf["']/);
  assert.match(source,/ANALYSIS_CONCURRENCY\s*=\s*2/);
  assert.match(source,/prepareInvoiceCandidate/);
  assert.match(source,/classifyInvoiceCandidate/);
});

test('bulk import only imports ready candidates sequentially and keeps failures isolated',async()=>{
  const source=await read('../src/components/BulkInvoiceImportModal.tsx');
  assert.match(source,/status===['"]ready['"]/);
  assert.match(source,/for\s*\(const\s+candidate\s+of\s+ready/);
  assert.match(source,/status:['"]importing['"]/);
  assert.match(source,/status:['"]imported['"]/);
  assert.match(source,/status:['"]error['"]/);
  assert.match(source,/Importar .*factura/);
});

test('bulk modal shows candidate fiscal data and reuses shared candidate form for review',async()=>{
  const source=await read('../src/components/BulkInvoiceImportModal.tsx');
  assert.match(source,/InvoiceCandidateForm/);
  assert.match(source,/equivalenceSurcharge/);
  assert.match(source,/reviewReason/);
  assert.match(source,/lines\.length/);
});

test('invoice page exposes bulk import action and App renders the bulk modal',async()=>{
  const [invoices,hub,app]=await Promise.all([
    read('../src/pages/Invoices.tsx'),
    read('../src/pages/ExpenseInvoicesHub.tsx'),
    read('../src/App.tsx'),
  ]);
  assert.match(invoices,/onBulkUpload/);
  assert.match(invoices,/Importar facturas/);
  assert.match(hub,/onBulkUpload/);
  assert.match(app,/BulkInvoiceImportModal/);
  assert.match(app,/bulkUpload/);
});
