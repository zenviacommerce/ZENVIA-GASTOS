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

const options = [
  { code: 'correos:paq', name: 'Correos Paq Estándar', carrierCode: 'correos', carrierName: 'Correos', contractId: 1 },
  { code: 'mrw:timeslot=12:expedition', name: 'MRW Urgent 12:00 Expedition 0-80kg', carrierCode: 'mrw', carrierName: 'MRW', contractId: 2 },
  { code: 'mrw:timeslot=19:expedition', name: 'MRW Urgent 19:00 Expedition 0-80kg', carrierCode: 'mrw', carrierName: 'MRW', contractId: 2 },
];

test('uses the order number as the PDF filename', async () => {
  const { labelPdfBaseName, labelPdfFilename } = await loadModule();
  assert.equal(labelPdfBaseName(baseOrder), '403-1234567-1234567');
  assert.equal(labelPdfFilename(baseOrder), '403-1234567-1234567.pdf');
});

test('deduplicates repeated label PDF filenames', async () => {
  const { uniqueLabelPdfFilename } = await loadModule();
  const used = new Set();
  assert.equal(uniqueLabelPdfFilename(baseOrder, used), '403-1234567-1234567.pdf');
  assert.equal(uniqueLabelPdfFilename(baseOrder, used), '403-1234567-1234567_2.pdf');
});

test('selects MRW Urgent 19:00 outside Baleares', async () => {
  const { selectAutomaticShippingOption } = await loadModule();
  assert.equal(selectAutomaticShippingOption(baseOrder, options)?.code, 'mrw:timeslot=19:expedition');
});

test('selects Correos for Baleares', async () => {
  const { selectAutomaticShippingOption } = await loadModule();
  const balearic = { ...baseOrder, shippingAddress: { country_code: 'ES', postal_code: '07001' } };
  assert.equal(selectAutomaticShippingOption(balearic, options)?.code, 'correos:paq');
});
