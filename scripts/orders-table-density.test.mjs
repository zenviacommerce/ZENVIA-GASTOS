import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('orders desktop table keeps readable column widths and scrolls inside its card',async()=>{
  const css=await read('src/orders.css');
  assert.match(css,/\.ordersTableCard\s*\{[^}]*overflow-x:auto/s);
  assert.match(css,/\.ordersTable\s*\{[^}]*min-width:\s*(?:1[45]\d{2}|1[6-9]\d{2})px/s);
  assert.match(css,/\.ordersTable th:nth-child\(11\)[^}]*min-width/s);
  assert.match(css,/\.ordersTable th:nth-child\(12\)[^}]*min-width/s);
});

test('shipping price stacks estimate label instead of running into weight',async()=>{
  const css=await read('src/orders.css');
  assert.match(css,/\.ordersShippingPrice\s*\{[^}]*display:block/s);
  assert.match(css,/\.ordersShippingPrice\+small\s*\{/s);
});


test('tracking and date columns never overlap on desktop',async()=>{
  const css=await read('src/orders.css');
  assert.match(css,/\.ordersTable\s*\{[^}]*min-width:\s*1900px[^}]*table-layout:auto!important/s);
  assert.match(css,/th:nth-child\(12\)[^}]*min-width:\s*230px/s);
  assert.match(css,/th:nth-child\(13\)[^}]*min-width:\s*145px/s);
  assert.match(css,/td:nth-child\(12\) \.ordersTracking\{[^}]*max-width:\s*210px[^}]*overflow:hidden/s);
});
