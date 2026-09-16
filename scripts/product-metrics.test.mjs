import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function load(){
  const source=await readFile(new URL('../src/services/productMetrics.ts',import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('100 cost and 125 sale gives 25 percent over cost',async()=>{
  const {productMarginMetrics}=await load();
  assert.deepEqual(productMarginMetrics(100,125),{margin:25,marginPct:25});
});

test('zero cost keeps euro margin but has no percentage',async()=>{
  const {productMarginMetrics}=await load();
  assert.deepEqual(productMarginMetrics(0,125),{margin:125,marginPct:null});
});

test('missing cost or sale has no margin metrics',async()=>{
  const {productMarginMetrics}=await load();
  assert.deepEqual(productMarginMetrics(null,125),{margin:null,marginPct:null});
  assert.deepEqual(productMarginMetrics(100,null),{margin:null,marginPct:null});
});

test('Products uses shared margin helper and labels average as over cost',async()=>{
  const source=await readFile(new URL('../src/pages/Products.tsx',import.meta.url),'utf8');
  assert.match(source,/productMarginMetrics/);
  assert.match(source,/Sobre coste/);
  assert.doesNotMatch(source,/margin\/sale\*100/);
});
