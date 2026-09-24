import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('application exposes one shared readability scale',async()=>{
  const css=await read('../src/theme-consistency.css');
  for(const token of ['--ui-font-xs:12px','--ui-font-sm:13px','--ui-font-control:13.5px','--ui-font-md:14px','--ui-font-heading-sm:15px','--ui-control-height:42px']) assert.equal(css.includes(token),true,token);
  assert.match(css,/tableCard table[^}]*font-size:var\(--ui-font-md\)/);
});

test('Configuration consumes shared typography tokens instead of its old undersized controls',async()=>{
  const css=await read('../src/settings.css');
  assert.match(css,/Settings uses the same readability scale/);
  assert.match(css,/\.settingsPage\{font-size:var\(--ui-font-md,14px\)\}/);
  assert.match(css,/\.settingsNav button strong\{font-size:var\(--ui-font-sm,13px\)\}/);
  assert.match(css,/font-size:var\(--ui-font-xs,12px\)/);
  assert.match(css,/font-size:var\(--ui-font-md,14px\)/);
  assert.match(css,/font-size:var\(--ui-font-control,13.5px\)/);
});