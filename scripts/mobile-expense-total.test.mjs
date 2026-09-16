import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('mobile expense invoice cards prioritize Total instead of IVA', async () => {
  const unified = await source('src/components/UnifiedListExperience.tsx');

  assert.match(unified, /expenseInvoicesHub/);
  assert.match(unified, /EXPENSE_INVOICE_MOBILE_METRICS\s*=\s*\[['"]fecha['"],\s*['"]estado['"],\s*['"]total['"]\]/i);
  assert.match(unified, /expenseInvoiceTable/);
});
