import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadRetailModule(){
  const source=await readFile(new URL('../src/services/invoiceRetailCorrections.ts',import.meta.url),'utf8');
  const transpiled=ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

test('Cash Sierra Nevada reconstructs real descriptions instead of numeric columns',async()=>{
  const {getCashSierraNevadaProductLines}=await loadRetailModule();
  const text=`PRECIO IVA
1,623 1,642
PRADO DEL REY
PRECIO CON TASAS
TOTAL FACTURA
29006 Málaga 1,00 1,00
CANTIDAD
CONCEPTO
FACTURA VENTA
Efectivo
3,26 3,26
MANTEL ROLLO 1,20X7 MT. ROJO C/25 R-0985 MANTEL ROLLO 1,20X7 MT. BURDEOS C/25 R-3279
BULTOS
área de clientes de https://cashsierranevada.es`;
  const lines=getCashSierraNevadaProductLines(text.split(/\r?\n/),text);
  assert.equal(lines.length,2);
  assert.deepEqual(lines.map(line=>line.description),[
    'MANTEL ROLLO 1,20X7 MT. ROJO C/25 R-0985',
    'MANTEL ROLLO 1,20X7 MT. BURDEOS C/25 R-3279',
  ]);
  assert.deepEqual(lines.map(line=>line.quantity),[1,1]);
  assert.deepEqual(lines.map(line=>line.unitPrice),[1.623,1.642]);
  assert.deepEqual(lines.map(line=>line.lineTotal),[1.62,1.64]);
});

test('Cash Sierra Nevada ignores trolley text while preserving product order',async()=>{
  const {getCashSierraNevadaProductLines}=await loadRetailModule();
  const text=`PRECIO IVA
1,740 1,973 0,750
PRADO DEL REY
TOTAL FACTURA
29006 Málaga 5,00
10,00 1,00
CANTIDAD
FACTURA VENTA
COPA CAVA 10uds. C/63 KONNY TENEDOR METALIZADO BOLSA 25U. C/20 MONDIS SERVILLETAS P.PUNTA 38X38 NATURAL 50UND C/24 KARME CARRO Nº 43
BULTOS
Cash Sierra Nevada, S.L.`;
  const lines=getCashSierraNevadaProductLines(text.split(/\r?\n/),text);
  assert.equal(lines.length,3);
  assert.deepEqual(lines.map(line=>line.description),[
    'COPA CAVA 10uds. C/63 KONNY',
    'TENEDOR METALIZADO BOLSA 25U. C/20 MONDIS',
    'SERVILLETAS P.PUNTA 38X38 NATURAL 50UND C/24 KARME',
  ]);
});

test('shared side drawer locks the page and keeps natural content height',async()=>{
  const [component,css,detail]=await Promise.all([
    readFile(new URL('../src/components/UnifiedListExperience.tsx',import.meta.url),'utf8'),
    readFile(new URL('../src/unified-list-experience.css',import.meta.url),'utf8'),
    readFile(new URL('../src/components/InvoiceDetailModal.tsx',import.meta.url),'utf8'),
  ]);
  assert.match(component,/const open=document\.querySelector\(selectors\)!==null/);
  assert.doesNotMatch(component,/some\(backdrop=>backdrop\.offsetParent!==null\)/);
  assert.match(css,/:where\(\.zenviaDetailDrawer,\.masterDrawer,\.ordersDrawer\)>\*\{[\s\S]*?flex-shrink:0/);
  assert.match(detail,/modalBackdrop zenviaDetailDrawerBackdrop/);
  assert.match(detail,/invoiceDetailModal zenviaDetailDrawer/);
});
