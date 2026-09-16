import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(){
  const source=await readFile(new URL('../src/services/postalLookup.ts',import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return {source,module:await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)};
}

test('postal lookup normalizes country and postal code into its cache key',async()=>{
  const {module}=await load();
  assert.equal(module.postalLookupKey(' es ',' 11660 '),'ES|11660');
});

test('postal lookup source builds Zippopotam request from country and postal only',async()=>{
  const {source}=await load();
  assert.match(source,/https:\/\/api\.zippopotam\.us\/\$\{encodeURIComponent\(countryCode\)\}\/\$\{encodeURIComponent\(postalCode\)\}/);
  assert.match(source,/new Map/);
  for(const forbidden of ['taxId','email','addressLine1','clientName'])assert.doesNotMatch(source,new RegExp(forbidden));
});

test('404 returns an empty result and repeated lookup comes from cache',async()=>{
  const {module}=await load();
  let calls=0;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{calls+=1;return new Response('',{status:404})};
  try{
    assert.deepEqual(await module.lookupPostalCode('ES','00000'),[]);
    assert.deepEqual(await module.lookupPostalCode('ES','00000'),[]);
    assert.equal(calls,1);
  }finally{globalThis.fetch=originalFetch}
});

test('Spanish postal codes expose province rather than autonomous community',async()=>{
  const {module}=await load();
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({places:[{'place name':'Prado del Rey',state:'Andalucía'},{'place name':'Prado del Rey',state:'Andalucía'}]}),{status:200,headers:{'content-type':'application/json'}});
  try{
    assert.deepEqual(await module.lookupPostalCode('ES','11660'),[{city:'Prado del Rey',region:'Cádiz',countryCode:'ES',postalCode:'11660'}]);
  }finally{globalThis.fetch=originalFetch}
});
