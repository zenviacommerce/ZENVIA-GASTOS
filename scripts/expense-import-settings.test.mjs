import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function transpiled(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('expense import policy mirrors configured expense behavior',async()=>{
  const {expenseImportPolicyFromSettings}=await transpiled('../src/services/expenseImportPolicy.ts');
  const policy=expenseImportPolicyFromSettings({
    initialStatus:'reviewed',
    autoCreateSuppliers:false,
    autoCreateProducts:false,
    fillMissingSupplierData:false,
    updateProductCosts:false,
    defaultCategoryId:'cat-1',
    defaultSupplierType:'service',
    detectDuplicates:false,
    blockHighConfidenceDuplicates:false,
    warnAmbiguousMatches:false,
    confidenceThreshold:.92,
    requiredReviewFields:['invoiceNumber','supplier'],
    gmailPdfOnly:false,
    maxAttachmentMb:12,
    allowReimportDeleted:false,
    createSupplierProductRelation:false,
    updatePriceHistory:false,
  });
  assert.deepEqual(policy,{
    initialStatus:'reviewed',
    autoCreateSuppliers:false,
    autoCreateProducts:false,
    fillMissingSupplierData:false,
    updateProductCosts:false,
    defaultCategoryId:'cat-1',
    defaultSupplierType:'service',
    detectDuplicates:false,
    blockHighConfidenceDuplicates:false,
    warnAmbiguousMatches:false,
    confidenceThreshold:.92,
    requiredReviewFields:['invoiceNumber','supplier'],
    gmailPdfOnly:false,
    maxAttachmentMb:12,
    allowReimportDeleted:false,
    createSupplierProductRelation:false,
    updatePriceHistory:false,
  });
});

test('expense policy safely falls back when omitted',async()=>{
  const {expenseImportPolicyFromSettings}=await transpiled('../src/services/expenseImportPolicy.ts');
  const policy=expenseImportPolicyFromSettings(undefined);
  assert.equal(policy.initialStatus,'pending');
  assert.equal(policy.autoCreateSuppliers,true);
  assert.equal(policy.autoCreateProducts,true);
  assert.equal(policy.detectDuplicates,true);
  assert.equal(policy.confidenceThreshold,.8);
  assert.equal(policy.gmailPdfOnly,true);
  assert.equal(policy.maxAttachmentMb,20);
});

test('Gastos e importación settings exposes controls consumed by the policy',async()=>{
  const source=await readFile(new URL('../src/pages/Settings.tsx',import.meta.url),'utf8');
  assert.match(source,/function ExpensesSection/);
  for(const label of [
    'Estado inicial','Crear proveedores automáticamente','Crear productos automáticamente',
    'Completar datos vacíos del proveedor','Actualizar costes automáticamente',
    'Categoría por defecto','Tipo de proveedor por defecto','Detectar duplicados',
    'Bloquear duplicados seguros','Avisar coincidencias dudosas','Umbral de confianza',
    'Importar solo PDF desde Gmail','Tamaño máximo de adjunto','Reprocesar facturas eliminadas',
    'Crear relación producto-proveedor','Actualizar histórico de precios'
  ]) assert.match(source,new RegExp(label,'i'),label);
  assert.match(source,/updateSection\('expenses'/);
});
