import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadCountryModule(){
  const source=await readFile(new URL('../src/services/countryCatalog.ts',import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('Spain can be found by Spanish name English name and ISO code',async()=>{
  const {searchCountries}=await loadCountryModule();
  for(const query of ['España','Spain','ES'])assert.equal(searchCountries(query)[0]?.code,'ES');
});

test('Germany can be found outside Spanish market assumptions',async()=>{
  const {searchCountries}=await loadCountryModule();
  assert.equal(searchCountries('Germany')[0]?.code,'DE');
  assert.equal(searchCountries('Alemania')[0]?.code,'DE');
  assert.equal(searchCountries('DE')[0]?.code,'DE');
});

test('country catalog contains a broad ISO alpha-2 catalog',async()=>{
  const {COUNTRIES}=await loadCountryModule();
  assert.ok(COUNTRIES.length>=240,`expected a full ISO catalog, got ${COUNTRIES.length}`);
  assert.ok(COUNTRIES.every(item=>/^[A-Z]{2}$/.test(item.code)));
});

test('CountryPicker displays names through SearchableSelect while emitting ISO codes',async()=>{
  const source=await readFile(new URL('../src/components/forms/CountryPicker.tsx',import.meta.url),'utf8');
  assert.match(source,/SearchableSelect/);
  assert.match(source,/nameEs/);
  assert.match(source,/nameEn/);
  assert.match(source,/option\.code/);
  assert.doesNotMatch(source,/maxLength=\{?2\}?/);
});
