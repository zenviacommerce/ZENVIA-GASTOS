import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260916092000_recalculate_product_price_history.sql', import.meta.url);

async function migrationSql() {
  return readFile(migrationUrl, 'utf8').catch(() => '');
}

test('correcting the same invoice line recalculates product costs from real history', async () => {
  const sql = await migrationSql();
  assert.match(sql, /on conflict \(invoice_line_id\) do update/i);
  assert.match(sql, /order by h\.price_date desc, h\.created_at desc, h\.id desc/i);
  assert.match(sql, /offset 1\s+limit 1/i);
  assert.doesNotMatch(sql, /previous_cost\s*=\s*case\s+when\s+p\.last_cost/i);
});

test('the migration repairs existing product snapshots from price history', async () => {
  const sql = await migrationSql();
  assert.match(sql, /update public\.products p/i);
  assert.match(sql, /product_price_history/i);
  assert.match(sql, /previous_cost/i);
  assert.match(sql, /last_purchase_date/i);
});
