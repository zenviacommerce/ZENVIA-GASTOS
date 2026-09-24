import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('shipping configuration supports original A6 thermal A5 and A4 formats',async()=>{
  const schema=await read('../src/services/settingsSchema.ts');
  const page=await read('../src/pages/Settings.tsx');
  assert.match(schema,/labelSize: 'AUTO' \| 'A4' \| 'A5' \| 'A6' \| '10x15'/);
  assert.match(schema,/\['AUTO','A4','A5','A6','10x15'\]/);
  for(const value of ['AUTO','A6','10x15','A5','A4']) assert.match(page,new RegExp(`value:'${value}'`));
});

test('label PDF normalizer supports A5 and can preserve original PDF size',async()=>{
  const source=await read('../src/services/labelPdf.ts');
  assert.match(source,/A5:\[148,210\]/);
  assert.match(source,/layout\.labelSize==='AUTO'/);
  assert.match(source,/sourceViewport\.width\*25\.4\/72/);
  assert.match(source,/return document\?document\.output\('blob'\):blob/);
});
