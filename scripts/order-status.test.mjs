import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadOrderStatusModule() {
  const source = await readFile(new URL('../src/services/orderStatus.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

test('a source-pending order with a Sendcloud parcel is not operationally pending', async () => {
  const { isPendingOrder } = await loadOrderStatusModule();
  assert.equal(isPendingOrder({ sourceStatus: 'Pending', sendcloudParcelId: 714512042 }), false);
});

test('an unlabelled, non-cancelled, non-processed order remains pending', async () => {
  const { isPendingOrder } = await loadOrderStatusModule();
  assert.equal(isPendingOrder({ sourceStatus: 'Pending', sendcloudParcelId: null }), true);
});

test('Dashboard uses the operational pending-order predicate', async () => {
  const source = await readFile(new URL('../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /from ['"]\.\.\/services\/orderStatus['"]/);
  assert.doesNotMatch(source, /function\s+isPendingOrder\s*\(/);
});
