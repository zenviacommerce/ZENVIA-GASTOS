import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('sales invoice page exposes import and filtered export actions',async()=>{
  const page=await source('src/pages/SalesInvoices.tsx');
  assert.match(page,/SalesInvoiceImportModal/);
  assert.match(page,/exportSalesInvoices/);
  assert.match(page,/Importar facturas/);
  assert.match(page,/Exportar \(/);
});

test('sales invoice import reads PDFs into reviewable draft candidates and never auto-issues',async()=>{
  const service=await source('src/services/salesInvoiceImport.ts');
  assert.match(service,/readInvoiceDocumentEnhanced/);
  assert.match(service,/createSalesInvoiceDraft/);
  assert.match(service,/updateSalesInvoiceNumber/);
  assert.match(service,/matchSalesInvoiceClient/);
  assert.doesNotMatch(service,/issueSalesInvoice\s*\(/);
});

test('sales invoice import modal reviews multiple PDFs before creating drafts',async()=>{
  const modal=await source('src/components/SalesInvoiceImportModal.tsx');
  for(const label of ['Importar facturas de venta','Seleccionar PDFs','Revisar','Cliente','Serie','Número de factura','Fecha factura','Guardar como borrador'])assert.match(modal,new RegExp(label,'i'));
  assert.match(modal,/multiple/);
  assert.match(modal,/SearchableSelect/);
  assert.match(modal,/createSalesInvoiceDraftFromCandidate/);
});

test('sales invoice export creates a zip with CSV summary and generated invoice PDFs',async()=>{
  const service=await source('src/services/salesInvoiceExport.ts');
  assert.match(service,/JSZip/);
  assert.match(service,/createSalesInvoicePdfBlob/);
  assert.match(service,/resumen_/);
  assert.match(service,/facturas/);
  assert.match(service,/\.csv/);
});
