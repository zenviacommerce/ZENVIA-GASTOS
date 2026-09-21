import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Orders exposes bulk label generation and configurable post-create downloads', async () => {
  const source = await readFile(new URL('../src/pages/Orders.tsx', import.meta.url), 'utf8');
  assert.match(source, /Generar etiquetas pendientes/);
  assert.match(source, /generateConfiguredLabels/);
  assert.match(source, /generateLabels\(configuredBulkTargets/);
  assert.match(source, /settings\.orders\.downloadLabelAfterCreation/);
  assert.match(source, /settings\.shipping\.autoDownload/);
  assert.match(source, /prepareLabelPdf/);
  assert.match(source, /bulkLabelZipFilename/);
});

test('the shared invoice period filters expose Hoy', async () => {
  const source = await readFile(new URL('../src/components/InvoiceFilters.tsx', import.meta.url), 'utf8');
  assert.match(source, /\['today',\s*'Hoy'\]/);
  assert.match(source, /\{value:'today',label:'Hoy'\}/);
  assert.match(source, /SelectField/);
});

test('Suppliers uses the shared period panel, including the Hoy preset', async () => {
  const suppliers = await readFile(new URL('../src/pages/Suppliers.tsx', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/components/PeriodFilterPanel.tsx', import.meta.url), 'utf8');
  assert.match(suppliers, /PeriodFilterPanel/);
  assert.match(suppliers, /defaultDateFilter/);
  assert.match(panel, /today/);
  assert.match(panel, /Hoy/);
});

test('the application configures the ZENVIA logo as favicon', async () => {
  const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(source, /ZENVIA_LOGO/);
  assert.match(source, /rel\s*=\s*['"]icon['"]/);
});
