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

const cabaplastText=`C/MAIRENA DEL ALCOR N 20\nCRISTIAN JESUS PEREZ GARRIDO\n15436385G\n13/03/2026\nC/CAMINO DEL PILAR 8\n11660 PRADO DEL REY (CÁDIZ)\nFACTURA Nº:\nFECHA:\nCódigo: 002396\nCódigo Descripción Precio Importe\n126/4263\nNIF/CIF:\n41006 SEVILLA (SEVILLA)\nTlfno.: 658792484 / 657979844\nDISTRIBUCIONES CABAPLAST 99 S.L.\nCIF: B90163700\nPágina 1 de 1\nCRISTIAN PEREZ GARRIDO\nCajas Cantidad\ncabaplast99@hotmail.com\nTlfno.: 655154080\nRepresentante: ANTONIO LERIDA ( 617112386 ) 617112386`;

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

test('CABAPLAST captures address and CIF even when address is before supplier name', async()=>{
  const {extractSupplierInvoiceDetails}=await loadModule();
  const details=extractSupplierInvoiceDetails(cabaplastText,'DISTRIBUCIONES CABAPLAST 99 S.L.');
  assert.equal(details.taxId,'B90163700');
  assert.equal(details.address,'C/MAIRENA DEL ALCOR N 20, 41006 SEVILLA (SEVILLA)');
  assert.doesNotMatch(details.address,/CAMINO DEL PILAR|11660|PRADO DEL REY/i);
});

test('supplier model and editor persist address and website', async () => {
  const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8');
  const editor = await readFile(new URL('../src/services/supplierEditor.ts', import.meta.url), 'utf8');
  assert.match(types, /address\?: string \| null/);
  assert.match(types, /website\?: string \| null/);
  assert.match(editor, /address:\s*input\.address/);
  assert.match(editor, /website:\s*input\.website/);
});

test('new non-merchandise suppliers stay unclassified instead of being forced to service', async () => {
  const repository = await readFile(new URL('../src/services/repository.ts', import.meta.url), 'utf8');
  assert.match(repository, /supplier_type:\s*supplierTypeHint\s*===\s*'goods'\s*\?\s*'goods'\s*:\s*'unclassified'/);
});
