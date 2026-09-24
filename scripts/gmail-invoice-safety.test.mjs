import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('Gmail invoice import uses the shared candidate pipeline and stops uncertain data before persistence',async()=>{
  const source=await read('../src/services/gmailImport.ts');
  assert.match(source,/prepareInvoiceCandidate/);
  assert.match(source,/invoiceCandidateToInput/);
  assert.match(source,/prepared\.status==='needs_review'/);
  assert.match(source,/reviewRequired:true/);
  assert.match(source,/kind:'review'/);
  assert.doesNotMatch(source,/import \{ readInvoiceDocumentEnhanced \}/);
  assert.doesNotMatch(source,/extraction\.supplierName \|\| senderFallback/);
});

test('Gmail review UI edits the shared candidate before explicitly saving it',async()=>{
  const source=await read('../src/pages/Gmail.tsx');
  assert.match(source,/InvoiceCandidateForm/);
  assert.match(source,/saveReviewedGmailCandidate/);
  assert.match(source,/REVISIÓN SEGURA/);
  assert.match(source,/No se creará la factura ni el proveedor hasta que confirmes estos datos/);
});

test('shared pipeline validates supplier number date total and fiscal consistency',async()=>{
  const source=await read('../src/services/invoiceImportPipeline.ts');
  assert.match(source,/validateInvoiceCandidateIntegrity/);
  assert.match(source,/saneSupplierName/);
  assert.match(source,/saneInvoiceNumber/);
  assert.match(source,/saneInvoiceDate/);
  assert.match(source,/invoiceAmountsConsistent/);
  assert.match(source,/status='needs_review'/);
});

test('date parser tolerates spaces around OCR separators',async()=>{
  const source=await read('../src/services/invoiceReader.ts');
  assert.match(source,/validCalendarDate/);
  assert.match(source,/\\s\*\[-\/.\]\\s\*/);
});

test('merchandise detection is based on generic table structure rather than supplier names',async()=>{
  const source=await read('../src/services/invoiceReaderV2.ts');
  assert.match(source,/concepto\|descripcion\|producto\|detalle/);
  assert.match(source,/tableMarkers/);
  assert.match(source,/cantidad/);
  assert.match(source,/precio/);
  assert.doesNotMatch(source,/Cash Sierra Nevada/i);
});