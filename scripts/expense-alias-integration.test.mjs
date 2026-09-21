import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('expense supplier resolution consults explicit aliases before heuristic matching and creation',async()=>{
  const source=await read('../src/services/repository.ts');
  assert.match(source,/resolveEntityAlias/);
  const ensureStart=source.indexOf('async function ensureSupplier');
  assert.ok(ensureStart>=0,'ensureSupplier missing');
  const block=source.slice(ensureStart,source.indexOf('async function cleanupCreatedSupplier',ensureStart));
  const aliasIndex=block.indexOf("resolveEntityAlias('supplier'");
  const heuristicIndex=block.indexOf('isLikelySameSupplier');
  const insertIndex=block.indexOf(".from('suppliers').insert");
  assert.ok(aliasIndex>=0,'alias lookup missing');
  assert.ok(heuristicIndex>=0,'heuristic fallback missing');
  assert.ok(insertIndex>=0,'supplier insert missing');
  assert.ok(aliasIndex<heuristicIndex,'explicit alias must be resolved before heuristic matching');
  assert.ok(aliasIndex<insertIndex,'explicit alias must be resolved before supplier creation');
  assert.match(block,/targetEntityId/);
});

test('Gmail supplier-number duplicate resolution honors explicit supplier aliases',async()=>{
  const source=await read('../src/services/gmailImport.ts');
  assert.match(source,/resolveEntityAlias/);
  assert.match(source,/targetEntityId/);
  assert.match(source,/findInvoiceBySupplierAndNumber/);
});
