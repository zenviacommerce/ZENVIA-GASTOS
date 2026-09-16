import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadModule() {
  const source = await readFile(new URL('../src/services/supplierInvoiceDetails.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

const vigatroText = `VIGATRO S.L.\nC.I.F. B90166976\nCTRA. SEVILLA MALAGA KM. 1\nMERCASEVILLA NAVE 1 MOD 1 - 2\n41020 - SEVILLA\nwww.vigatro.com\nFACTURA\nCliente: ZENVIA COMMERCE S.L.\nB26806943`;

test('extracts dotted Spanish CIF next to the supplier', async () => {
  const { extractSupplierInvoiceDetails } = await loadModule();
  assert.equal(extractSupplierInvoiceDetails(vigatroText, 'VIGATRO S.L').taxId, 'B90166976');
});

test('extracts supplier postal address without taking buyer data', async () => {
  const { extractSupplierInvoiceDetails } = await loadModule();
  assert.equal(
    extractSupplierInvoiceDetails(vigatroText, 'VIGATRO S.L').address,
    'CTRA. SEVILLA MALAGA KM. 1, MERCASEVILLA NAVE 1 MOD 1 - 2, 41020 - SEVILLA',
  );
});

test('extracts supplier website', async () => {
  const { extractSupplierInvoiceDetails } = await loadModule();
  assert.equal(extractSupplierInvoiceDetails(vigatroText, 'VIGATRO S.L').website, 'https://www.vigatro.com');
});

test('supplier model and editor persist address and website', async () => {
  const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8');
  const editor = await readFile(new URL('../src/services/supplierEditor.ts', import.meta.url), 'utf8');
  assert.match(types, /address\?: string \| null/);
  assert.match(types, /website\?: string \| null/);
  assert.match(editor, /address:\s*input\.address/);
  assert.match(editor, /website:\s*input\.website/);
});
