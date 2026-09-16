import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const file=new URL('../supabase/migrations/20260917002000_amazon_analytics_dashboard_rpcs.sql',import.meta.url);
async function sql(){return readFile(file,'utf8');}

test('Analytics RPC migration defines historical cost and bounded FX helpers',async()=>{
  const text=await sql();
  assert.match(text,/private\.amazon_rate_to_eur/);
  assert.match(text,/interval '7 days'/i);
  assert.match(text,/private\.amazon_historical_unit_cost_eur/);
  assert.match(text,/product_price_history[\s\S]+currency/i);
  assert.match(text,/price_date <=/i);
  assert.match(text,/amazon_rate_to_eur\([^;]+price_date/is);
  assert.match(text,/order by[^;]+price_date desc/is);
});

test('Summary and series RPCs expose approved KPIs and completeness',async()=>{
  const text=await sql();
  for(const fn of ['amazon_analytics_summary','amazon_analytics_series'])assert.match(text,new RegExp(`function public\\.${fn}`));
  for(const key of ['netSales','orders','units','amazonFees','refunds','productCost','profitBeforeAds','marginPct','profitComplete'])assert.match(text,new RegExp(key));
  for(const key of ['adsExcluded','unmappedSkuCount','missingHistoricalCostCount','missingFxEventCount','missingVatOrderCount','syncQueued','syncRunning','syncFailed'])assert.match(text,new RegExp(key));
  assert.match(text,/cancell?ed/i);
  assert.match(text,/ads_payment_excluded/);
});

test('Profit completeness accounts for running historical work, not only missing inputs',async()=>{
  const text=await sql();
  assert.match(text,/profitComplete[\s\S]{0,1000}syncQueued|syncQueued[\s\S]{0,1000}profitComplete/i);
  assert.match(text,/profitComplete[\s\S]{0,1000}syncRunning|syncRunning[\s\S]{0,1000}profitComplete/i);
});

test('Detail and mapping RPCs are present and paginated',async()=>{
  const text=await sql();
  for(const fn of [
    'amazon_analytics_products','amazon_analytics_marketplaces','amazon_analytics_orders',
    'amazon_analytics_inventory','amazon_analytics_unmapped_skus',
    'amazon_set_product_mapping','amazon_delete_product_mapping'
  ]) assert.match(text,new RegExp(`function public\\.${fn}`));
  assert.match(text,/page_size/);
  assert.match(text,/consumption_factor > 0|consumption_factor must be greater than zero/i);
  assert.match(text,/private\.app_workspace_owner_id\(\)/);
  assert.match(text,/private\.app_has_permission\('amazon'\)/);
});

test('Detail RPCs do not expose buyer or recipient PII',async()=>{
  const text=(await sql()).toLowerCase();
  for(const forbidden of ['buyer_name','buyer_email','buyer_phone','shipping_address','delivery_address'])assert.equal(text.includes(forbidden),false,forbidden);
});
