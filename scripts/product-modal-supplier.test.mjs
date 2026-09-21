import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('ProductModal uses shared form primitives instead of a long stack form',async()=>{
  const source=await read('../src/components/ProductModal.tsx');
  assert.match(source,/FormModal/);
  assert.match(source,/FormGrid/);
  assert.ok((source.match(/<FormSection/g)||[]).length>=4,'expected at least four structured sections');
  assert.doesNotMatch(source,/className=["']stackForm["']/);
});

test('ProductModal exposes searchable supplier correction and emits supplierId',async()=>{
  const source=await read('../src/components/ProductModal.tsx');
  assert.match(source,/suppliers:Supplier\[\]/);
  assert.match(source,/SearchableSelect/);
  assert.match(source,/supplierId/);
  assert.match(source,/Sin proveedor/);
  assert.match(source,/no crea una compra/i);
});

test('ProductModal derives the automatic sale price from configurable target margin',async()=>{
  const source=await read('../src/components/ProductModal.tsx');
  assert.match(source,/settings\.products\.targetMarginPct/);
  assert.match(source,/settings\.products\.priceRounding/);
  assert.match(source,/1\+targetMarginPct\/100/);
  assert.match(source,/sobre coste/i);
});

test('App passes the supplier catalog to ProductModal',async()=>{
  const source=await read('../src/App.tsx');
  assert.match(source,/<ProductModal[^>]*suppliers=\{data\.suppliers\}/);
});
