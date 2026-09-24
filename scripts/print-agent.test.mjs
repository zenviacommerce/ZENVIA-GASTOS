import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('web prefers ZENVIA Print Agent and keeps Sendcloud only as a temporary fallback',async()=>{
  const source=await read('../src/services/orders.ts');
  assert.match(source,/ZENVIA_PRINT_AGENT='http:\/\/127\.0\.0\.1:17931'/);
  assert.match(source,/LEGACY_SENDCLOUD_PRINT_CLIENT='http:\/\/127\.0\.0\.1:1903'/);
  assert.match(source,/await zenviaPrinters\(\)/);
  assert.match(source,/fallback temporal/);
  assert.match(source,/source==='zenvia'/);
  assert.match(source,/Content-Type':'application\/pdf'/);
});

test('standalone print agent is loopback-only by default and validates origins and PDFs',async()=>{
  const source=await read('../tools/print-agent/server.mjs');
  const pkg=JSON.parse(await read('../tools/print-agent/package.json'));
  assert.equal(pkg.dependencies['pdf-to-printer'],'5.8.1');
  assert.match(source,/HOST=process\.env\.ZENVIA_PRINT_HOST\|\|'127\.0\.0\.1'/);
  assert.match(source,/PORT=Number\(process\.env\.ZENVIA_PRINT_PORT\|\|17931\)/);
  assert.match(source,/gestion\.zenviacommerce\.com/);
  assert.match(source,/Access-Control-Allow-Private-Network/);
  assert.match(source,/pdf\.subarray\(0,5\)\.toString\('ascii'\)!=='%PDF-'/);
  assert.match(source,/await print\(file,\{printer:selected\.name,silent:true,scale:'noscale'\}\)/);
});

test('label size flows from Orders to the local printer driver',async()=>{
  const orders=await read('../src/services/orders.ts');
  const agent=await read('../tools/print-agent/server.mjs');
  const page=await read('../src/pages/Orders.tsx');
  assert.match(orders,/X-Label-Size/);
  assert.match(orders,/labelSize:ShippingSettings\['labelSize'\]/);
  assert.match(agent,/x-label-size/);
  assert.match(agent,/requestedSize==='10X15'\?'4x6'/);
  assert.match(agent,/\['A4','A5','A6'\]\.includes/);
  assert.match(agent,/paperSize/);
  assert.match(page,/ordersQuickLabelFormat/);
  assert.match(page,/value:'AUTO',label:'Original'/);
  assert.match(page,/value:'A5',label:'A5'/);
});
