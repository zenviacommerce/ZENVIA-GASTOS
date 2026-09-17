import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('sales invoicing reuses the normal page actions and moves export filters into a modal',async()=>{
  const page=await read('src/pages/SalesInvoices.tsx');
  assert.doesNotMatch(page,/salesTransferPanel/,'sales invoicing must not render a separate transfer panel above the page');
  assert.match(page,/Importar facturas/);
  assert.match(page,/Exportar \(/);
  assert.match(page,/salesExportModal/,'export filters should live in the standard modal flow');
  assert.match(page,/Exportar facturas de venta/);
});

test('transport tariff modal gives review content priority and confines horizontal scrolling to tariff bands',async()=>{
  const css=await read('src/components/transport-tariffs.css');
  assert.match(css,/\.transportTariffModal\{[^}]*width:min\(1400px,calc\(100vw - 48px\)\)/s,'desktop tariff modal should use more of the available viewport');
  assert.match(css,/\.transportTariffBody\{[^}]*grid-template-columns:220px minmax\(0,1fr\)/s,'versions column should stay compact');
  assert.match(css,/\.transportTariffBandsViewport\{[^}]*overflow-x:auto/s,'only the bands viewport should own horizontal scrolling');
  assert.match(css,/@media\(max-width:1180px\)[^{]*\{[^}]*\.transportTariffBody\{grid-template-columns:1fr\}/s,'intermediate widths should stack versions before the review becomes cramped');
});
