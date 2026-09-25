import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('order header actions use a bounded mobile grid instead of overlapping',async()=>{
  const css=await read('src/orders.css');
  assert.match(css,/\.ordersPage \.pageHead \.actions\{[\s\S]*?display:grid!important[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.ordersPage \.pageHead \.actions>button\{[\s\S]*?min-width:0[\s\S]*?white-space:normal/);
  assert.match(css,/\.ordersPage \.pageHead \.actions>\.ordersQuickLabelFormat\{[\s\S]*?grid-column:1\/-1/);
  assert.match(css,/button:nth-of-type\(3\)\{[\s\S]*?grid-column:1\/-1/);
  assert.match(css,/button:nth-of-type\(4\)\{[\s\S]*?grid-column:1\/-1/);
});
