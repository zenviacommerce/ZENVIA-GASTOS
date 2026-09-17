import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('transport tariff modal overrides the generic modal geometry with higher specificity',async()=>{
  const css=await read('src/components/transport-tariffs.css');
  assert.match(css,/\.modal\.transportTariffModal\{[^}]*width:min\(1400px,calc\(100vw - 48px\)\)[^}]*max-width:none[^}]*padding:0[^}]*overflow:hidden/s);
  assert.doesNotMatch(css,/(^|})\.transportTariffModal\{[^}]*width:min\(1400px,calc\(100vw - 48px\)\)/s,'generic .modal is emitted later in the production bundle, so the tariff geometry must use a more specific selector');
});

test('transport tariff responsive geometry also outranks the generic modal width',async()=>{
  const css=await read('src/components/transport-tariffs.css');
  assert.match(css,/@media\(max-width:900px\)[^{]*\{[\s\S]*?\.modal\.transportTariffModal\{width:calc\(100vw - 24px\);height:calc\(100dvh - 24px\)\}/);
  assert.match(css,/@media\(max-width:620px\)[^{]*\{[\s\S]*?\.modal\.transportTariffModal\{width:100vw;height:100dvh;max-height:none;border-radius:0\}/);
});
