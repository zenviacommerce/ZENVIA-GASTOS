import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Orders sync uses v2026-01-01 searchOrders and safe non-PII datasets',async()=>{
  const orders=await source('supabase/functions/_shared/amazon/orders.ts');
  assert.match(orders,/\/orders\/2026-01-01\/orders/);
  assert.match(orders,/createdAfter/);
  assert.match(orders,/createdBefore/);
  assert.match(orders,/lastUpdatedAfter/);
  assert.match(orders,/lastUpdatedBefore/);
  assert.match(orders,/paginationToken/);
  assert.match(orders,/nextToken/);
  for(const dataset of ['PROCEEDS','EXPENSE','PROMOTION','CANCELLATION','FULFILLMENT','TAX'])assert.match(orders,new RegExp(dataset));
  assert.doesNotMatch(orders,/['"]BUYER['"]|['"]RECIPIENT['"]|['"]PAYMENT['"]/);
});

test('Orders sync upserts orders and line items with stable conflict keys',async()=>{
  const orders=await source('supabase/functions/_shared/amazon/orders.ts');
  assert.match(orders,/amazon_orders/);
  assert.match(orders,/amazon_order_items/);
  assert.match(orders,/owner_id,amazon_account_id,marketplace_id,amazon_order_id/);
  assert.match(orders,/owner_id,amazon_account_id,marketplace_id,amazon_order_id,order_item_id/);
  assert.match(orders,/seller_sku/);
  assert.match(orders,/asin/);
  assert.match(orders,/quantity_ordered/);
  assert.match(orders,/AMAZON_BUSINESS/);
  assert.match(orders,/is_business_order/);
  assert.match(orders,/programs/);
});

test('Orders normalization is defensive and persists no buyer PII',async()=>{
  const orders=(await source('supabase/functions/_shared/amazon/orders.ts')).toLowerCase();
  assert.match(orders,/normaliz/);
  assert.match(orders,/money/);
  for(const forbidden of ['buyer_name','buyer_email','buyer_phone','shipping_address','recipient_name'])assert.equal(orders.includes(forbidden),false,forbidden);
});

test('Orders Edge Function is internal-only and delegates one job',async()=>{
  const edge=await source('supabase/functions/amazon-sync-orders/index.ts');
  assert.match(edge,/requireInternalSecret/);
  assert.match(edge,/syncOrdersJob/);
});
