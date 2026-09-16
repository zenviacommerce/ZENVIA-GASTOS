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

const vigatroText=`VIGATRO S.L.\nCantidad Producto Precio Importe\n450,000 D FILM 45x0,83 kgs 3,63 € 1.633,50 €\n360,000 D ROLLOS ALUMINIO PROFESIONAL 5,81 € 2.090,88 €\n378,000 D FILM PVC 30X250 3,81 € 1.440,18 €\n270,000 D FILM PVC 45X250 5,69 € 1.534,95 €\n>> Total: 6.699,51 €\nTotal (Impuestos Incl.) 6.699,51 €\nImpuesto Base Cuota Total Entregado: 6.699,51 Cambio: 0,00 €\nD 21,00% 5.536,79 € 1.162,72 € 6.699,51 € PAGO ANTICIPADO ES58 6.699,51 €\nTotal: 5.536,79 € 1.162,72 € 6.699,51 €`;

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

test('parses a quantity-description-price row without deleting decimal dimensions', async () => {
  const { parseSimpleInvoiceProductRow } = await loadModule();
  assert.deepEqual(parseSimpleInvoiceProductRow('450,000 D FILM 45x0,83 kgs 3,63 € 1.633,50 €'), {
    description: 'D FILM 45x0,83 kgs',
    quantity: 450,
    unitPrice: 3.63,
    lineTotal: 1633.5,
  });
});

test('detects VAT-inclusive invoice summary', async()=>{
  const { extractInclusiveTaxSummary } = await loadModule();
  assert.deepEqual(extractInclusiveTaxSummary(vigatroText),{
    taxRate:21,
    subtotal:5536.79,
    vat:1162.72,
    total:6699.51,
  });
});

test('normalizes VAT-inclusive line prices to net product cost', async()=>{
  const { repairInvoiceProductLines } = await loadModule();
  const [line]=repairInvoiceProductLines(vigatroText,[]);
  assert.equal(line.unitPrice,3.63);
  assert.equal(line.normalizedUnitPrice,3);
  assert.equal(line.lineNet,1350);
  assert.equal(line.taxRate,21);
  assert.equal(line.taxAmount,283.5);
  assert.equal(line.lineTotal,1633.5);
});

test('repairs invoice header amounts from inclusive tax summary', async()=>{
  const { repairInvoiceAmounts } = await loadModule();
  assert.deepEqual(repairInvoiceAmounts(vigatroText,{subtotal:0,vat:6699.51,total:6699.51}),{
    subtotal:5536.79,
    vat:1162.72,
    total:6699.51,
  });
});

test('repository persists normalized net cost instead of gross printed price', async()=>{
  const source=await readFile(new URL('../src/services/repository.ts',import.meta.url),'utf8');
  assert.match(source,/line\.normalizedUnitPrice\s*\?\?\s*line\.unitPrice/);
  assert.match(source,/line_net:\s*line\.lineNet\s*\?\?\s*line\.lineTotal/);
  assert.match(source,/tax_rate:\s*line\.taxRate/);
  assert.match(source,/tax_amount:\s*line\.taxAmount/);
  assert.match(source,/repairInvoiceAmounts/);
});

test('product list exposes the complete product name on hover', async () => {
  const source = await readFile(new URL('../src/pages/Products.tsx', import.meta.url), 'utf8');
  assert.match(source, /<strong\s+title=\{p\.name\}>\{p\.name\}<\/strong>/);
});
