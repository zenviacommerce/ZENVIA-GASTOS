import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('shared forms stay responsive, keyboard-visible and dark-mode aware',async()=>{
  const css=await read('../src/shared-forms.css');
  assert.match(css,/@media\(max-width:700px\)[\s\S]*\.formGrid\{grid-template-columns:1fr\}/);
  assert.match(css,/\.formModalActions\{position:sticky;bottom:0/);
  assert.match(css,/\.searchableSelectTrigger:focus-visible/);
  assert.match(css,/\[data-theme="dark"\][\s\S]*\.searchableSelectMenu/);
});

test('client and product forms use the shared modal primitives',async()=>{
  const [clients,products]=await Promise.all([
    read('../src/pages/Clients.tsx'),
    read('../src/components/ProductModal.tsx'),
  ]);
  for(const source of [clients,products]){
    assert.match(source,/FormModal/);
    assert.match(source,/FormSection/);
    assert.match(source,/FormGrid/);
  }
  assert.match(clients,/PostalAddressFields/);
  assert.match(products,/SearchableSelect/);
});

test('business fiscal settings reuse shared country and postal controls',async()=>{
  const source=await read('../src/pages/SalesInvoices.tsx');
  assert.match(source,/PostalAddressFields/);
  assert.doesNotMatch(source,/País<input\s+maxLength=\{2\}/);
});

test('country persistence remains ISO alpha-2',async()=>{
  const [catalog,picker]=await Promise.all([
    read('../src/services/countryCatalog.ts'),
    read('../src/components/forms/CountryPicker.tsx'),
  ]);
  assert.match(catalog,/ISO_ALPHA2/);
  assert.match(picker,/value:option\.code/);
  assert.match(picker,/onChange=\{onChange\}/);
});

test('postal lookup sends no client or company personal fields',async()=>{
  const source=await read('../src/services/postalLookup.ts');
  assert.match(source,/api\.zippopotam\.us\/\$\{encodeURIComponent\(countryCode\)\}\/\$\{encodeURIComponent\(postalCode\)\}/);
  assert.doesNotMatch(source,/email|phone|taxId|legalName|addressLine/i);
});

test('short closed enums use SelectField instead of native selects',async()=>{
  const [sales,config]=await Promise.all([
    read('../src/pages/SalesInvoices.tsx'),
    read('../src/components/SalesConfigurationModals.tsx'),
  ]);
  assert.match(sales,/SelectField/);
  assert.doesNotMatch(sales,/<select value=\{line\.taxRate\}/);
  assert.doesNotMatch(sales,/<select value=\{status\}/);
  assert.match(config,/SelectField/);
  assert.doesNotMatch(config,/<select value=\{form\.kind\}/);
});
