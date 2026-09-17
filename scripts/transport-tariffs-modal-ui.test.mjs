import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('transport tariffs uses the standard centered modal backdrop and close button styling',async()=>{
  const source=await read('../src/components/TransportTariffsPanel.tsx');
  assert.match(source,/className="modalBackdrop transportTariffOverlay"/,'transport tariff dialog must use the app fixed modal backdrop');
  assert.match(source,/className="modalHead transportTariffHead"/,'transport tariff header must inherit the standard modal close-button treatment');
  assert.doesNotMatch(source,/className="modalOverlay transportTariffOverlay"/,'legacy non-positioned overlay class must not be used');
});
