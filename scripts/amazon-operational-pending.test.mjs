import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Amazon tracking retries only pick previously failed confirmations',async()=>{
  const helper=await source('supabase/functions/_shared/amazon/shipment-confirmation.ts');
  assert.match(helper,/\.gt\(['"]amazon_tracking_sync_attempts['"],\s*0\)/i);
  assert.match(helper,/\.is\(['"]amazon_tracking_synced_at['"],\s*null\)/i);
});

test('Amazon tracking confirmation claims the row before calling SP-API',async()=>{
  const helper=await source('supabase/functions/_shared/amazon/shipment-confirmation.ts');
  assert.match(helper,/claimAmazonTrackingAttempt/i);
  assert.match(helper,/\.eq\(['"]amazon_tracking_sync_attempts['"]/i);
  assert.match(helper,/\.is\(['"]amazon_tracking_synced_at['"],\s*null\)/i);
});
