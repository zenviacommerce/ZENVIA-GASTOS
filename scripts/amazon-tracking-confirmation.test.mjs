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
  assert.match(helper,/includedData\s*:\s*\[?['"]PACKAGES['"]\]?/i);
  assert.match(helper,/packageReferenceId/i);
  assert.match(helper,/shipmentConfirmation/i);
  assert.match(helper,/trackingNumber/i);
  assert.match(helper,/orderItemId/i);
  assert.match(helper,/quantity/i);
});

test('label creation sends Amazon tracking without invalidating an already-created label on Amazon failure',async()=>{
  const fn=await source('supabase/functions/sendcloud-orders/index.ts');
  assert.match(fn,/syncAmazonTracking/i);
  assert.match(fn,/amazonTracking/i);
  assert.match(fn,/catch\s*\([^)]*\)\s*\{[\s\S]{0,1500}amazon_tracking_sync_error/i);
});

test('regular Sendcloud sync retries pending Amazon tracking confirmations',async()=>{
  const fn=await source('supabase/functions/sendcloud-orders/index.ts');
  assert.match(fn,/retryPendingAmazonTracking/i);
  assert.match(fn,/amazon_tracking_synced_at/i);
});
