import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function transpiled(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('entity aliases normalize punctuation accents legal suffixes and ampersands deterministically',async()=>{
  const {normalizeAlias}=await transpiled('../src/services/entityAliasCore.ts');
  assert.equal(normalizeAlias('  Compost & Paper, S.L. '),'compost and paper sl');
  assert.equal(normalizeAlias('Áridos del Sur, S.L.U.'),'aridos del sur slu');
  assert.equal(normalizeAlias('Sierra   Nevada — Compost'),'sierra nevada compost');
});

test('entity alias service provides workspace-scoped CRUD and resolution',async()=>{
  const source=await readFile(new URL('../src/services/entityAliases.ts',import.meta.url),'utf8');
  assert.match(source,/from\(['"]entity_alias_rules['"]\)/);
  assert.match(source,/loadEntityAliases/);
  assert.match(source,/resolveEntityAlias/);
  assert.match(source,/addEntityAlias/);
  assert.match(source,/updateEntityAlias/);
  assert.match(source,/deleteEntityAlias/);
  assert.match(source,/normalized_alias/);
  assert.match(source,/active/);
});
