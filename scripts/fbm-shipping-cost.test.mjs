import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('fulfillment orders persist historical shipping cost fields',async()=>{
  const migration=await source('supabase/migrations/20260917161000_fbm_shipping_cost.sql');
  for(const column of ['shipping_cost_amount','shipping_cost_currency','shipping_cost_source','shipping_cost_net_amount','shipping_cost_tax_amount','shipping_cost_recorded_at']){
    assert.match(migration,new RegExp(column),`shipping schema must contain ${column}`);
  }
});

test('label creation sends and stores the selected Sendcloud quote',async()=>{
  const service=await source('src/services/orders.ts');
  const edge=await source('supabase/functions/sendcloud-orders/index.ts');
  assert.match(service,/price:option\.price/,'selected option price must be sent to label creation');
  assert.match(service,/currency:option\.currency/,'selected option currency must be sent to label creation');
  assert.match(edge,/shipping_cost_amount/,'label creation must persist the shipping cost');
  assert.match(edge,/shipping_cost_source/,'label creation must persist the cost source');
  assert.match(edge,/sendcloud_quote/,'Sendcloud quote must be identified as its source');
});

test('Amazon summary includes only Merchant/FBM shipping cost matched by Amazon order id',async()=>{
  const migration=await source('supabase/migrations/20260917161000_fbm_shipping_cost.sql');
  assert.match(migration,/fulfillment_channel\s*=\s*'MERCHANT'/i,'shipping cost applies only to Amazon merchant fulfilled orders');
  assert.match(migration,/source_channel\s*=\s*'amazon'/i,'shipping cost match must be scoped to Amazon fulfillment orders');
  assert.match(migration,/order_number\s*=\s*eo\.amazon_order_id|order_id\s*=\s*eo\.amazon_order_id/i,'fulfillment order must match the Amazon order id');
  assert.match(migration,/fbmShippingCost/,'summary must expose FBM shipping cost');
  assert.match(migration,/net_profit.*shipping|shipping.*net_profit/is,'FBM shipping cost must reduce net profit');
});
