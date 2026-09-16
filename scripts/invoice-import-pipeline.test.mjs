import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('accepts historical recipient through 2026-06-30',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  const result=validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO NIF 15436385G','2026-06-30');
  assert.equal(result.accepted,true);
  assert.equal(result.needsReview,false);
  assert.equal(result.detectedTaxId,'15436385G');
});

test('requires review for historical recipient from 2026-07-01',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  const result=validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO NIF 15436385G','2026-07-01');
  assert.equal(result.accepted,false);
  assert.equal(result.needsReview,true);
  assert.match(result.reason,/Destinatario no válido/i);
});

test('name without NIF does not auto-approve',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  const result=validateInvoiceRecipient('CRISTIAN JESUS PEREZ GARRIDO','2026-03-13');
  assert.equal(result.accepted,false);
  assert.equal(result.needsReview,true);
});

test('other recipients are not blocked by the historical exception rule',async()=>{
  const {validateInvoiceRecipient}=await loadTs('../src/services/invoiceRecipientRules.ts');
  const result=validateInvoiceRecipient('ZENVIA COMMERCE SL','2026-09-16');
  assert.equal(result.needsReview,false);
});

test('shared pipeline composes reader, supplier extraction, repair and recipient rules without Supabase writes',async()=>{
  const source=await read('../src/services/invoiceImportPipeline.ts');
  assert.match(source,/readInvoiceDocumentEnhanced/);
  assert.match(source,/extractSupplierContactData/);
  assert.match(source,/extractSupplierInvoiceDetails/);
  assert.match(source,/repairInvoiceAmounts/);
  assert.match(source,/repairInvoiceProductLines/);
  assert.match(source,/validateInvoiceRecipient/);
  assert.match(source,/export async function prepareInvoiceCandidate/);
  assert.match(source,/export function classifyInvoiceCandidate/);
  assert.match(source,/export function invoiceCandidateToInput/);
  assert.doesNotMatch(source,/from ['"]\.\/supabase['"]/);
});

test('candidate model contains statuses, hash, recipient and surcharge',async()=>{
  const types=await read('../src/types.ts');
  assert.match(types,/InvoiceImportCandidateStatus\s*=\s*'analyzing'\s*\|\s*'ready'\s*\|\s*'needs_review'\s*\|\s*'duplicate'\s*\|\s*'error'\s*\|\s*'importing'\s*\|\s*'imported'/);
  assert.match(types,/interface InvoiceImportCandidate/);
  assert.match(types,/fileHash:\s*string/);
  assert.match(types,/recipientTaxId\?:\s*string/);
  assert.match(types,/equivalenceSurcharge:\s*number/);
  assert.match(types,/fileHash\?:\s*string\s*\|\s*null/);
});

test('candidate classifier checks hash and supplier plus invoice number duplicates',async()=>{
  const source=await read('../src/services/invoiceImportPipeline.ts');
  assert.match(source,/existing\.fileHash\s*===\s*candidate\.fileHash/);
  assert.match(source,/supplierName/);
  assert.match(source,/invoiceNumber/);
  assert.match(source,/status:\s*'duplicate'/);
});
