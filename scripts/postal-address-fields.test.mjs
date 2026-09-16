import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('postal address fields debounce and cancel stale lookups',async()=>{
  const source=await read('../src/components/forms/PostalAddressFields.tsx');
  assert.match(source,/LOOKUP_DEBOUNCE_MS\s*=\s*450/);
  assert.match(source,/AbortController/);
  assert.match(source,/postalLookupKey/);
  assert.match(source,/lookupPostalCode/);
  assert.match(source,/currentQueryRef/);
});

test('postal address fields protect manual city and province edits',async()=>{
  const source=await read('../src/components/forms/PostalAddressFields.tsx');
  assert.match(source,/cityManual/);
  assert.match(source,/provinceManual/);
  assert.match(source,/setCityManual\(true\)/);
  assert.match(source,/setProvinceManual\(true\)/);
  assert.match(source,/setCityManual\(false\)/);
  assert.match(source,/setProvinceManual\(false\)/);
});

test('postal address fields use searchable country and multi-place selectors while preserving text inputs',async()=>{
  const source=await read('../src/components/forms/PostalAddressFields.tsx');
  assert.match(source,/CountryPicker/);
  assert.match(source,/SearchableSelect/);
  assert.match(source,/Código postal/);
  assert.match(source,/Población/);
  assert.match(source,/Provincia \/ región/);
  assert.match(source,/No encontramos el CP/);
});
