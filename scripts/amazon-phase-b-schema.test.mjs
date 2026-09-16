import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migrationPath='supabase/migrations/20260916190000_amazon_analytics_phase_b.sql';
const tables=[
  'amazon_accounts','amazon_marketplaces','amazon_orders','amazon_order_items',
  'amazon_finance_transactions','amazon_inventory_current','amazon_inventory_daily',
  'amazon_sync_runs','amazon_sync_state','amazon_sync_jobs',
];

test('phase B migration creates the complete Amazon core schema', async () => {
  const sql=await source(migrationPath);
  for(const table of tables) assert.match(sql,new RegExp(`create table(?: if not exists)? public\\.${table}\\b`,'i'),table);
  assert.match(sql,/initial_sync_from[\s\S]*2026-01-01/i);
  assert.match(sql,/unique[\s\S]*amazon_order_id/i);
  assert.match(sql,/job_key\s+text\s+not null/i);
  assert.match(sql,/unique[\s\S]*job_key/i);
});

test('all Amazon public tables are RLS protected and client writes are revoked', async () => {
  const sql=await source(migrationPath);
  for(const table of tables) {
    assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`,'i'),`${table} RLS`);
  }
  assert.match(sql,/private\.app_workspace_owner_id\(\)/);
  assert.match(sql,/private\.app_has_permission\('amazon'\)/);
  assert.match(sql,/grant select on[\s\S]*to authenticated/i);
  assert.match(sql,/revoke (?:insert|all|insert, update, delete)[\s\S]*from anon, authenticated/i);
});

test('sync jobs are claimed atomically with skip locked and backend-only execution', async () => {
  const sql=await source(migrationPath);
  assert.match(sql,/function private\.amazon_claim_sync_jobs/i);
  assert.match(sql,/for update skip locked/i);
  assert.match(sql,/status\s*=\s*'running'/i);
  assert.match(sql,/attempts\s*=\s*j\.attempts\s*\+\s*1/i);
  assert.match(sql,/revoke all on function private\.amazon_claim_sync_jobs[\s\S]*from public/i);
  assert.match(sql,/grant execute on function private\.amazon_claim_sync_jobs[\s\S]*to service_role/i);
});

test('Amazon business tables do not define buyer PII columns', async () => {
  const sql=(await source(migrationPath)).toLowerCase();
  for(const forbidden of ['buyer_name','buyer_email','buyer_phone','shipping_address','buyer_address']) {
    assert.equal(sql.includes(forbidden),false,`must not persist ${forbidden}`);
  }
});
