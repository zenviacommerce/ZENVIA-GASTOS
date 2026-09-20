import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('General settings reuse structured business identity and modular behavior settings',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  const sales=await read('../src/services/sales.ts');
  const schema=await read('../src/services/settingsSchema.ts');
  assert.match(page,/Configuración general|General de empresa/);
  for(const label of ['Razón social','Nombre comercial','CIF\/VAT','Dirección','País','Email','Teléfono','Web','IBAN','Moneda','Zona horaria','Formato de fecha','Idioma']) {
    assert.match(page,new RegExp(label,'i'));
  }
  assert.match(page,/loadBusinessSettings/);
  assert.match(page,/saveBusinessSettings/);
  assert.match(page,/loadCompanyBranding/);
  assert.match(page,/uploadCompanyLogo/);
  assert.match(page,/removeCompanyLogo/);
  assert.match(page,/updateSection\('general'/);
  assert.match(sales,/website/);
  assert.match(schema,/currencyCode/);
  assert.match(schema,/timezone/);
  assert.match(schema,/dateFormat/);
  assert.match(schema,/documentLanguage/);
});

test('business settings schema contains website before General UI depends on it',async()=>{
  const migration=await read('../supabase/migrations/20260921000500_business_settings_website.sql');
  assert.match(migration,/alter table public\.business_settings/i);
  assert.match(migration,/add column if not exists website text/i);
});
