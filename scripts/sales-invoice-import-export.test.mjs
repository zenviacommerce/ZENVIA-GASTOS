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
  for(const label of ['Importar facturas de venta','Seleccionar PDFs','Revisar','Cliente','Serie','Número de factura','Fecha factura','Vencimiento','DNI / CIF / VAT','Guardar / reparar borradores'])assert.match(modal,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\  for(const label of ['Importar facturas de venta','Seleccionar PDFs','Revisar','Cliente','Serie','Número de factura','Fecha factura','Guardar como borrador'])assert.match(modal,new RegExp(label,'i'));'),'i'));
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


test('sales invoice import preserves fiscal identities without labels and defaults due dates',async()=>{
  const party=await source('src/services/invoicePartyExtractor.ts');
  const service=await source('src/services/salesInvoiceImport.ts');
  const sales=await source('src/services/sales.ts');
  assert.match(party,/validTaxIdCandidate/);
  assert.match(party,/ABCDEFGHJNPQRSUVW/);
  assert.match(party,/knownTaxPrefixes/);
  assert.match(service,/dueDate:string/);
  assert.match(service,/extractSalesDueDate/);
  assert.match(service,/addDays\(issueDate,30\)/);
  assert.match(sales,/defaultSalesDueDate/);
  assert.match(sales,/due_date:nullable\(input\.dueDate\)\|\|defaultSalesDueDate\(issueDate,30\)/);
});

test('desktop sidebar hides the mobile drawer close button',async()=>{
  const css=await source('src/mobile-nav.css');
  assert.match(css,/\.sidebar \.mobileMenuClose\{display:none!important\}/);
  assert.match(css,/@media[\s\S]*\.sidebar \.mobileMenuClose\{[\s\S]*display:grid!important/);
});
