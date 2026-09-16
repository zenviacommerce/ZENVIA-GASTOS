import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('overflow helper checks width and height clipping',async()=>{
  const source=await read('../src/services/truncatedTextTooltip.ts');
  assert.match(source,/scrollWidth\s*>\s*element\.clientWidth\s*\+\s*1/);
  assert.match(source,/scrollHeight\s*>\s*element\.clientHeight\s*\+\s*1/);
});

test('tooltip eligibility excludes buttons and action controls',async()=>{
  const source=await read('../src/services/truncatedTextTooltip.ts');
  assert.match(source,/button|input|select|textarea/i);
  assert.match(source,/zenviaRowAction|iconBtn|statusBtn/);
  assert.match(source,/textContent/);
});

test('UnifiedListExperience manages one delegated floating tooltip',async()=>{
  const source=await read('../src/components/UnifiedListExperience.tsx');
  assert.match(source,/isTextOverflowing/);
  assert.match(source,/zenviaTruncatedTooltip/);
  for(const event of ['pointerover','pointerout','focusin','focusout','scroll','resize'])assert.match(source,new RegExp(event));
  assert.match(source,/getBoundingClientRect/);
  assert.match(source,/180/);
  assert.match(source,/removeEventListener/);
});

test('tooltip ignores its own DOM mutations so showing text does not immediately hide it',async()=>{
  const source=await read('../src/components/UnifiedListExperience.tsx');
  assert.match(source,/new\s+MutationObserver\(\s*mutations\s*=>/);
  assert.match(source,/mutations\.every\([\s\S]*tooltip\.contains\(mutation\.target\)/);
});

test('tooltip CSS is global elegant themed and imported once',async()=>{
  const [css,main]=await Promise.all([read('../src/truncated-tooltip.css'),read('../src/main.tsx')]);
  assert.match(css,/\.zenviaTruncatedTooltip/);
  assert.match(css,/border-radius/);
  assert.match(css,/max-width/);
  assert.match(css,/box-shadow/);
  assert.match(css,/transition/);
  assert.match(css,/pointer-events:\s*none/);
  assert.match(css,/z-index/);
  assert.match(css,/::after/);
  assert.match(css,/data-theme=["']dark["']/);
  assert.match(main,/truncated-tooltip\.css/);
});

test('product names no longer rely on native title tooltips',async()=>{
  const source=await read('../src/pages/Products.tsx');
  assert.doesNotMatch(source,/title=\{p\.name\}/);
});
