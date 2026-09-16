import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('ClientModal uses shared form and postal address controls',async()=>{
  const source=await read('../src/pages/Clients.tsx');
  assert.match(source,/FormModal/);
  assert.match(source,/FormSection/);
  assert.match(source,/FormGrid/);
  assert.match(source,/PostalAddressFields/);
  assert.doesNotMatch(source,/País\s*<input[^>]*maxLength=\{2\}/);
});

test('ClientModal preserves existing client values and save normalization',async()=>{
  const source=await read('../src/pages/Clients.tsx');
  assert.match(source,/countryCode:client\.countryCode\|\|'ES'/);
  assert.match(source,/postalCode:client\.postalCode\|\|''/);
  assert.match(source,/city:client\.city\|\|''/);
  assert.match(source,/province:client\.province\|\|''/);
  assert.match(source,/normalizeTaxId\(form\.taxId\)/);
  assert.match(source,/normalizeEmail\(form\.email\)/);
  assert.match(source,/normalizePhone\(form\.phone\)/);
});
