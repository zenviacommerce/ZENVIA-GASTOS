import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260917001000_amazon_analytics_dashboard_schema.sql', import.meta.url);
const hardeningUrl = new URL('../supabase/migrations/20260917004000_amazon_analytics_security_hardening.sql', import.meta.url);
async function migration(){return readFile(migrationUrl,'utf8');}
async function hardening(){return readFile(hardeningUrl,'utf8');}

test('Amazon analytics schema creates mappings, finance components and FX rates', async()=>{
  const sql = await migration();
  for (const table of ['amazon_product_mappings','amazon_finance_components','amazon_fx_rates']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(sql,/consumption_factor numeric[^\n]+check \(consumption_factor > 0\)/i);
  assert.match(sql,/unique \(owner_id, amazon_account_id, seller_sku\)/i);
  assert.match(sql,/unique \(owner_id, amazon_account_id, finance_transaction_id, component_key\)/i);
  assert.match(sql,/primary key \(rate_date, currency_code\)/i);
});

test('Amazon analytics tables are workspace scoped and permission protected', async()=>{
  const sql = await migration();
  for (const table of ['amazon_product_mappings','amazon_finance_components']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`create policy ${table}_select[\\s\\S]+private\\.app_workspace_owner_id\\(\\)[\\s\\S]+private\\.app_has_permission\\('amazon'\\)`));
  }
  assert.match(sql,/revoke insert, update, delete[\s\S]+amazon_finance_components[\s\S]+from anon, authenticated/i);
});

test('Amazon analytics hardening removes all direct mutation-capable table privileges from app roles', async()=>{
  const sql = await hardening();
  assert.match(sql,/revoke all on table[\s\S]+amazon_product_mappings[\s\S]+amazon_finance_components[\s\S]+amazon_fx_rates[\s\S]+from anon, authenticated/i);
  assert.match(sql,/grant select on table[\s\S]+amazon_product_mappings[\s\S]+amazon_finance_components[\s\S]+to authenticated/i);
  assert.doesNotMatch(sql,/grant[^;]*(insert|update|delete|truncate|trigger|references)[^;]*to authenticated/i);
});

test('Amazon analytics schema adds lookup indexes used by RPCs', async()=>{
  const sql = await migration();
  for (const index of [
    'amazon_product_mappings_sku_idx',
    'amazon_product_mappings_product_idx',
    'amazon_finance_components_period_idx',
    'amazon_finance_components_order_idx',
    'amazon_finance_components_sku_idx',
    'amazon_fx_rates_lookup_idx',
    'amazon_price_history_analytics_idx'
  ]) assert.match(sql,new RegExp(index));
});
