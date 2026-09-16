import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(p)=>readFile(new URL(p,import.meta.url),'utf8');

test('searchable select exposes combobox/listbox keyboard contract',async()=>{
  const source=await read('../src/components/forms/SearchableSelect.tsx');
  assert.match(source,/role=["']combobox["']/);
  assert.match(source,/role=["']listbox["']/);
  assert.match(source,/ArrowDown/);
  assert.match(source,/ArrowUp/);
  assert.match(source,/Escape/);
  assert.match(source,/Enter/);
  assert.match(source,/aria-expanded/);
  assert.match(source,/pointerdown/);
});

test('searchable select menu is portalled and viewport-positioned so modals cannot clip it',async()=>{
  const source=await read('../src/components/forms/SearchableSelect.tsx');
  assert.match(source,/createPortal/);
  assert.match(source,/getBoundingClientRect/);
  assert.match(source,/menuRef/);
  assert.match(source,/position:\s*['"]fixed['"]/);
});

test('shared form primitives expose modal section grid and sticky actions',async()=>{
  const source=await read('../src/components/forms/FormPrimitives.tsx');
  assert.match(source,/FormModal/);
  assert.match(source,/FormSection/);
  assert.match(source,/FormGrid/);
  assert.match(source,/formModalActions/);
});

test('shared form CSS is responsive and has focus-visible styles',async()=>{
  const source=await read('../src/shared-forms.css');
  assert.match(source,/\.formGrid/);
  assert.match(source,/@media[^]*max-width/);
  assert.match(source,/grid-template-columns:\s*1fr/);
  assert.match(source,/:focus-visible/);
  assert.match(source,/\.formModalActions/);
});
