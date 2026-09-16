import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadModule() {
  const source = await readFile(new URL('../src/services/invoiceProductLine.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

test('cleans currency symbols accidentally left in product descriptions', async () => {
  const { cleanInvoiceProductDescription } = await loadModule();
  assert.equal(cleanInvoiceProductDescription('D FILM 45x0,83 kgs € €'), 'D FILM 45x0,83 kgs');
  assert.equal(cleanInvoiceProductDescription('D ROLLOS ALUMINIO PROFESIONAL € €'), 'D ROLLOS ALUMINIO PROFESIONAL');
});

test('rejects payment and fiscal summary rows as product lines', async () => {
  const { isNonProductInvoiceLine } = await loadModule();
  assert.equal(isNonProductInvoiceLine('D 21,00% 5.536,79 € 1.162,72 € 6.699,51 € PAGO ANTICIPADO ES58 2100 2592 2802 1017 4067'), true);
  assert.equal(isNonProductInvoiceLine('450,000 D FILM 45x0,83 kgs 3,63 € 1.633,50 €'), false);
});

test('product list exposes the complete product name on hover', async () => {
  const source = await readFile(new URL('../src/pages/Products.tsx', import.meta.url), 'utf8');
  assert.match(source, /<strong\s+title=\{p\.name\}>\{p\.name\}<\/strong>/);
});
