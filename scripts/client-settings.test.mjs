import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('Clientes settings exposes defaults, enrichment and identity controls',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  assert.match(page,/function ClientsSection/);
  for(const label of [
    'País por defecto','IVA por defecto','Días de pago por defecto','Método de pago por defecto',
    'Crear clientes automáticamente','Completar CIF\/NIF','Completar dirección','Completar país',
    'No sobrescribir datos revisados','Criterios de identidad'
  ]) assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/updateSection\('clients'/);
});

test('clients table stores habitual VAT and payment method',async()=>{
  const sql=await read('../supabase/migrations/20260921093000_client_billing_defaults.sql');
  assert.match(sql,/add column if not exists default_vat_rate/i);
  assert.match(sql,/add column if not exists default_payment_method/i);
});

test('manual client creation uses configured defaults and persists billing preferences',async()=>{
  const page=await read('../src/pages/Clients.tsx');
  const sales=await read('../src/services/sales.ts');
  assert.match(page,/useSettings/);
  assert.match(page,/settings\.clients\.defaultCountryCode/);
  assert.match(page,/settings\.clients\.defaultPaymentTermsDays/);
  assert.match(page,/defaultVatRate/);
  assert.match(page,/defaultPaymentMethod/);
  assert.match(sales,/default_vat_rate/);
  assert.match(sales,/default_payment_method/);
});

test('sales invoice editor lets client defaults override global VAT and payment method',async()=>{
  const core=await read('../src/pages/SalesInvoicesCore.tsx');
  assert.match(core,/clientDefaultVatRate/);
  assert.match(core,/clientDefaultPaymentMethod/);
});

test('sales invoice import respects client auto-create enrichment and identity settings',async()=>{
  const importer=await read('../src/services/salesInvoiceImport.ts');
  assert.match(importer,/ClientsSettings/);
  assert.match(importer,/autoCreate/);
  assert.match(importer,/overwriteReviewed/);
  assert.match(importer,/duplicateIdentity/);
  assert.match(importer,/fillTaxId/);
  assert.match(importer,/fillAddress/);
  assert.match(importer,/fillCountry/);
});
