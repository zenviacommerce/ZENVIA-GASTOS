import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Platform surfaces Edge Function response errors instead of generic invoke text',async()=>{
  const source=await read('platform/src/api.ts');
  assert.match(source,/FunctionsHttpError/);
  assert.match(source,/error\.context\.clone\(\)\.json\(\)/);
  assert.match(source,/payload\?\.error\|\|payload\?\.message/);
});
