import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url);

test('transport tariff VAT rate exists before effective-revisions migration uses it', async () => {
  const files = (await readdir(migrationsUrl)).filter(name => name.endsWith('.sql')).sort();
  const consumer = '20260918024000_general_transport_tariff_effective_revisions.sql';
  const earlier = files.filter(name => name.localeCompare(consumer) < 0);
  let found = false;
  for (const name of earlier) {
    const sql = await readFile(new URL(name, migrationsUrl), 'utf8');
    if (/add column(?: if not exists)?\s+vat_rate_pct\b/i.test(sql) || /vat_rate_pct\s+numeric\(6,3\)/i.test(sql)) {
      found = true;
      break;
    }
  }
  assert.equal(found, true, 'vat_rate_pct must be created before the effective-revisions migration');
});
