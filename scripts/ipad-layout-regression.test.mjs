import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('wide business tables remain horizontally scrollable on iPad-sized viewports',async()=>{
  const css=await read('src/theme-consistency.css');
  assert.match(css,/@media \(max-width:1180px\)/);
  assert.match(css,/\.page :where\(\.tableCard,\.masterTableCard,\.ordersTableCard\)[\s\S]*overflow-x:auto!important/);
  assert.match(css,/-webkit-overflow-scrolling:touch/);
  assert.match(css,/\.page \.tableCard>table[\s\S]*min-width:980px!important/);
});

test('expense Gmail/factures tabs clear the fixed tablet header',async()=>{
  const css=await read('src/theme-consistency.css');
  assert.match(css,/\.expenseHubNavShell[\s\S]*padding:calc\(92px \+ env\(safe-area-inset-top\)\) 15px 0!important/);
  assert.match(css,/\.expenseHubNav[\s\S]*overflow-x:auto/);
});
