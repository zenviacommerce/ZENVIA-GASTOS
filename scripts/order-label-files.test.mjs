import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadModule() {
  const source = await readFile(new URL('../src/services/orderLabelFiles.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

const baseOrder = {
  orderNumber: '403-1234567-1234567',
  shippingAddress: { country_code: 'ES', postal_code: '28001' },
  items: [{ name: 'Zenic | 2 Rollos Mercado Transparente | 30×40cm | Bolsas Sin Dibujo Ni Asas' }],
};


test('uses the order number as the PDF filename', async () => {
  const { labelPdfBaseName, labelPdfFilename } = await loadModule();
  assert.equal(labelPdfBaseName(baseOrder,{strategy:'order_number'}), '403-1234567-1234567');
  assert.equal(labelPdfFilename(baseOrder,{strategy:'order_number'}), '403-1234567-1234567.pdf');
});

test('deduplicates repeated label PDF filenames', async () => {
  const { uniqueLabelPdfFilename } = await loadModule();
  const used = new Set();
  assert.equal(uniqueLabelPdfFilename(baseOrder, used,{strategy:'order_number'}), '403-1234567-1234567.pdf');
  assert.equal(uniqueLabelPdfFilename(baseOrder, used,{strategy:'order_number'}), '403-1234567-1234567_2.pdf');
});

