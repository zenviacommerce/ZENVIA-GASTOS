import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('fulfillment orders persist Amazon tracking confirmation state',async()=>{
  const sql=await source('supabase/migrations/20260917103000_amazon_tracking_confirmation.sql');
  assert.match(sql,/amazon_tracking_synced_at\s+timestamptz/i);
  assert.match(sql,/amazon_tracking_last_attempt_at\s+timestamptz/i);
  assert.match(sql,/amazon_tracking_sync_error\s+text/i);
  assert.match(sql,/amazon_tracking_sync_attempts\s+integer/i);
});

test('Amazon tracking helper inspects packages and confirms shipment with the Orders API',async()=>{
  const helper=await source('supabase/functions/_shared/amazon/shipment-confirmation.ts');
  assert.match(helper,/includedData\s*:\s*\[['"]PACKAGES['"]\]/i);
  assert.match(helper,/packageReferenceId/i);
  assert.match(helper,/shipmentConfirmation/i);
  assert.match(helper,/trackingNumber/i);
  assert.match(helper,/orderItemId/i);
  assert.match(helper,/quantity/i);
});

test('automatic retry only backfills recently updated Amazon shipments',async()=>{
  const helper=await source('supabase/functions/_shared/amazon/shipment-confirmation.ts');
  assert.match(helper,/TRACKING_BACKFILL_DAYS\s*=\s*7/);
  assert.match(helper,/tracking_updated_at[^\n]*gte|\.gte\(['"]tracking_updated_at['"]/i);
});

test('Amazon tracking edge function supports one-order confirmation and retries',async()=>{
  const fn=await source('supabase/functions/amazon-confirm-shipment/index.ts');
  assert.match(fn,/syncAmazonTracking/i);
  assert.match(fn,/retryPendingAmazonTracking/i);
  assert.match(fn,/confirm_order_tracking/i);
  assert.match(fn,/retry_pending/i);
});

test('label creation keeps the label even if Amazon confirmation fails and regular sync retries it',async()=>{
  const orders=await source('src/services/orders.ts');
  assert.match(orders,/amazon-confirm-shipment/i);
  assert.match(orders,/createOrderLabel[\s\S]{0,700}invokeAmazonTracking/i);
  assert.match(orders,/syncSendcloudOrders[\s\S]{0,700}retry_pending/i);
  assert.match(orders,/catch\s*\{\s*\/\*\s*Amazon tracking is retried/i);
});
