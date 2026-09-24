import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('bulk label generation is not disabled by background sync or status health checks',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  assert.match(source,/disabled=\{bulkGenerating\|\|configuredBulkTargets\.length===0\}/);
  assert.match(source,/disabled=\{!selectedOrders\.length\|\|bulkGenerating\}/);
  assert.doesNotMatch(source,/disabled=\{bulkGenerating\|\|syncing\|\|!status\?\.configured\|\|configuredBulkTargets\.length===0\}/);
  assert.doesNotMatch(source,/disabled=\{!selectedOrders\.length\|\|bulkGenerating\|\|syncing\|\|!status\?\.configured\}/);
});

test('direct printing is presented as optional Sendcloud Print Client functionality',async()=>{
  const source=await read('../src/pages/Orders.tsx');
  assert.match(source,/Impresión directa/);
  assert.match(source,/Sendcloud Print Client instalado en este equipo/);
  assert.match(source,/showInfo\('La impresión directa requiere Sendcloud Print Client/);
});

test('toast system supports neutral informational messages',async()=>{
  const service=await read('../src/services/toast.ts');
  const host=await read('../src/components/ToastHost.tsx');
  const css=await read('../src/toast.css');
  assert.match(service,/ToastKind = 'success' \| 'error' \| 'info'/);
  assert.match(service,/export function showInfo/);
  assert.match(host,/item\.kind === 'info'/);
  assert.match(css,/\.appToast\.info/);
});