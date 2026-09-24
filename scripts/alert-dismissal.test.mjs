import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

async function loadAlerts(){
  const source=await read('../src/services/alerts.ts');
  const output=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('alert fingerprint stays stable until the alert changes',async()=>{
  const {alertFingerprint}=await loadAlerts();
  const first={severity:'warning',page:'orders',title:'Pedido pendiente',message:'Pedido 1 · 24 h sin completar'};
  const same={...first};
  const changed={...first,message:'Pedido 1 · 48 h sin completar'};
  assert.equal(alertFingerprint(first),alertFingerprint(same));
  assert.notEqual(alertFingerprint(first),alertFingerprint(changed));
});

test('AlertCenter persists cleared alerts and filters them after refresh',async()=>{
  const source=await read('../src/components/AlertCenter.tsx');
  assert.match(source,/preferences\.dismissedAlerts\[item\.id\]!==alertFingerprint\(item\)/);
  assert.match(source,/dismissed\[alert\.id\]=alertFingerprint\(alert\)/);
  assert.match(source,/patchPreferences\(\{dismissedAlerts:dismissed\}\)/);
  assert.match(source,/Limpiar alertas/);
});

test('user preferences schema keeps dismissed alert fingerprints',async()=>{
  const schema=await read('../src/services/settingsSchema.ts');
  const settings=await read('../src/services/settings.ts');
  assert.match(schema,/dismissedAlerts: Record<string, string>/);
  assert.match(schema,/dismissedAlerts: \{\}/);
  assert.match(schema,/recordOfStringsValue\(input,'dismissedAlerts'/);
  assert.match(settings,/dismissedAlerts:patch\.dismissedAlerts\?\{\.\.\.current\.dismissedAlerts,\.\.\.patch\.dismissedAlerts\}:current\.dismissedAlerts/);
});
