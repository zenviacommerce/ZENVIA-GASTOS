import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260916202500_amazon_fk_indexes.sql', import.meta.url);

test('Amazon foreign keys have direct covering indexes before historical load', async () => {
  const sql = (await readFile(migrationUrl, 'utf8')).toLowerCase();
  const expected = [
    ['amazon_finance_transactions', 'amazon_account_id'],
    ['amazon_inventory_current', 'amazon_account_id'],
    ['amazon_inventory_daily', 'amazon_account_id'],
    ['amazon_marketplaces', 'amazon_account_id'],
    ['amazon_order_items', 'amazon_account_id'],
    ['amazon_orders', 'amazon_account_id'],
    ['amazon_sync_jobs', 'amazon_account_id'],
    ['amazon_sync_jobs', 'run_id'],
    ['amazon_sync_runs', 'amazon_account_id'],
    ['amazon_sync_state', 'amazon_account_id'],
  ];

  for (const [table, column] of expected) {
    assert.match(
      sql,
      new RegExp(`create\\s+index\\s+if\\s+not\\s+exists[\\s\\S]*?on\\s+public\\.${table}\\s*\\(\\s*${column}\\s*\\)`, 'i'),
      `${table}.${column}`,
    );
  }
});
