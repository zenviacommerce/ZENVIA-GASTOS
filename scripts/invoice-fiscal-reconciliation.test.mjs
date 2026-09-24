import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('reconciles a small invoice from labelled base VAT and total instead of a nearby tax rate',async()=>{
  const {reconcileInvoiceFiscalAmounts}=await loadTs('../src/services/invoiceFiscalReconciler.ts');
  const text=['TOTAL FACTURA','3,94','REC. EQUIV.','0,68','IVA','3,26','BASE','21,00','%'].join('\n');
  const result=reconcileInvoiceFiscalAmounts(text,{subtotal:21,vat:0,total:21,withholding:0,equivalenceSurcharge:0});
  assert.equal(result.subtotal,3.26);
  assert.equal(result.vat,.68);
  assert.equal(result.total,3.94);
  assert.equal(result.corrected,true);
});

test('reconciles base plus VAT to total and ignores a nearby 21 percent token',async()=>{
  const {reconcileInvoiceFiscalAmounts}=await loadTs('../src/services/invoiceFiscalReconciler.ts');
  const text=['EUROS','TOTAL FACTURA','513,00','REC. EQUIV.','89,03','IVA','423,97','BASE','21,00','%'].join('\n');
  const result=reconcileInvoiceFiscalAmounts(text,{subtotal:423.97,vat:0,total:423.97,withholding:0,equivalenceSurcharge:0});
  assert.equal(result.subtotal,423.97);
  assert.equal(result.vat,89.03);
  assert.equal(result.total,513);
  assert.equal(result.corrected,true);
});

test('fiscal consistency rejects totals that do not equal base plus taxes and adjustments',async()=>{
  const {invoiceAmountsConsistent}=await loadTs('../src/services/invoiceFiscalReconciler.ts');
  assert.equal(invoiceAmountsConsistent({subtotal:100,vat:21,total:121,withholding:0,equivalenceSurcharge:0}),true);
  assert.equal(invoiceAmountsConsistent({subtotal:100,vat:21,total:100,withholding:0,equivalenceSurcharge:0}),false);
});