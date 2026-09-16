import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Orders exposes bulk pending-label generation and downloads newly created labels', async () => {
  const source = await readFile(new URL('../src/pages/Orders.tsx', import.meta.url), 'utf8');
  assert.match(source, /Generar etiquetas pendientes/);
  assert.match(source, /generatePendingLabels/);
  assert.match(source, /downloadLabel\(blob,/);
  assert.doesNotMatch(source, /handleBlob\(blob,fresh,'print'\)/);
});

test('the shared invoice period filters expose Hoy', async () => {
  const source = await readFile(new URL('../src/components/InvoiceFilters.tsx', import.meta.url), 'utf8');
  assert.match(source, /\['today',\s*'Hoy'\]/);
  assert.match(source, /\{value:'today',label:'Hoy'\}/);
  assert.match(source, /SelectField/);
});

test('Suppliers exposes the same Hoy quick filter', async () => {
  const source = await readFile(new URL('../src/pages/Suppliers.tsx', import.meta.url), 'utf8');
  assert.match(source, /PeriodPreset='today'\|'month'/);
  assert.match(source, />Hoy<\/button>/);
});

test('the application configures the ZENVIA logo as favicon', async () => {
  const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /ZENVIA_LOGO/);
  assert.match(source, /rel\s*=\s*['"]icon['"]/);
});
