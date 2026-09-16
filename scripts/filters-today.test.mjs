import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadFilters() {
  const source = await readFile(new URL('../src/services/filters.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

test('today preset resolves to the same from/to date', async () => {
  const { rangeForPreset } = await loadFilters();
  const now = new Date(2026, 8, 16, 12, 0, 0);
  assert.deepEqual(rangeForPreset('today', now), { from: '2026-09-16', to: '2026-09-16' });
});

test('today preset is labelled Hoy', async () => {
  const { filterForPreset, periodLabel } = await loadFilters();
  const now = new Date(2026, 8, 16, 12, 0, 0);
  assert.equal(periodLabel(filterForPreset('today', '', now), now), 'Hoy');
});
