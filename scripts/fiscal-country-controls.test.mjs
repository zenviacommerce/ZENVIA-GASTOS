import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('BusinessModal uses the reusable postal address fields for issuer address',async()=>{
  const source=await read('../src/pages/SalesInvoices.tsx');
  assert.match(source,/PostalAddressFields/);
  assert.match(source,/countryCode=\{form\.countryCode/);
  assert.match(source,/postalCode=\{form\.postalCode/);
  assert.doesNotMatch(source,/País<input\s+maxLength=\{2\}/);
});

test('VAT registrations use the searchable CountryPicker while retaining ISO validation',async()=>{
  const source=await read('../src/components/SalesConfigurationModals.tsx');
  assert.match(source,/CountryPicker/);
  assert.match(source,/value=\{form\.countryCode\}/);
  assert.match(source,/countryCode\.trim\(\)\.length!==2/);
  assert.doesNotMatch(source,/País<input\s+maxLength=\{2\}/);
});
