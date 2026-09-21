import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function transpiled(path){
  const source=await readFile(new URL(path,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('formatters fall back instead of crashing on legacy currency or timezone values',async()=>{
  const {formatAppDateTime,formatAppMoney}=await transpiled('../src/services/formatting.ts');
  const settings={currencyCode:'BAD!',timezone:'Madrid',dateFormat:'DD/MM/YYYY',documentLanguage:'es'};
  assert.doesNotThrow(()=>formatAppMoney(12.5,undefined,settings));
  assert.match(formatAppMoney(12.5,undefined,settings),/12/);
  assert.doesNotThrow(()=>formatAppDateTime('2026-09-21T09:00:00Z',settings));
  assert.match(formatAppDateTime('2026-09-21T09:00:00Z',settings),/21\/09\/2026/);
});

test('application root has an error boundary so a render error cannot blank the whole UI',async()=>{
  const main=await readFile(new URL('../src/main.tsx',import.meta.url),'utf8');
  const boundary=await readFile(new URL('../src/components/AppErrorBoundary.tsx',import.meta.url),'utf8');
  assert.match(main,/AppErrorBoundary/);
  assert.match(boundary,/getDerivedStateFromError/);
  assert.match(boundary,/No se pudo mostrar la aplicación/);
  assert.match(boundary,/Recargar/);
});
