import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('platform workspace list reads Amazon account status instead of a non-existent active column',async()=>{
  const source=await read('supabase/functions/platform-admin/index.ts');
  assert.match(source,/from\('amazon_accounts'\)\.select\('owner_id,id,status'\)/);
  assert.match(source,/row\.status!=='disabled'/);
  assert.doesNotMatch(source,/from\('amazon_accounts'\)\.select\('owner_id,id,active'\)/);
});

test('Amazon product column reserves more room for product names',async()=>{
  const css=await read('src/amazon.css');
  assert.match(css,/\.amazonProductNameCell\{min-width:440px;width:clamp\(440px,32vw,650px\)\}/);
  assert.match(css,/\.amazonProductIdentity strong\{display:block;max-width:clamp\(370px,28vw,590px\)/);
});
