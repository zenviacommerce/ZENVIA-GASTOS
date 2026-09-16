import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

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
