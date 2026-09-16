import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Finances sync uses v2024-06-19 listTransactions with date, marketplace and nextToken pagination',async()=>{
  const finances=await source('supabase/functions/_shared/amazon/finances.ts');
  assert.match(finances,/\/finances\/2024-06-19\/transactions/);
  assert.match(finances,/postedAfter/);
  assert.match(finances,/postedBefore/);
  assert.match(finances,/marketplaceId/);
  assert.match(finances,/nextToken/);
  assert.match(finances,/payload\?\.transactions|payload\.transactions/);
});

test('Finances normalization keeps original amount/currency and categorizes transactions',async()=>{
  const finances=await source('supabase/functions/_shared/amazon/finances.ts');
  assert.match(finances,/transactionId/);
  assert.match(finances,/transactionType/);
  assert.match(finances,/transactionStatus/);
  assert.match(finances,/totalAmount/);
  assert.match(finances,/currencyAmount/);
  assert.match(finances,/currencyCode/);
  for(const category of ['sale','refund','referral_fee','fba_fee','storage_fee','other_fee','tax','adjustment','other'])assert.match(finances,new RegExp(`['"]${category}['"]`));
});

test('Finances sync derives a stable key and upserts idempotently',async()=>{
  const finances=await source('supabase/functions/_shared/amazon/finances.ts');
  assert.match(finances,/deriveTransactionKey/);
  assert.match(finances,/crypto\.subtle\.digest/);
  assert.match(finances,/amazon_finance_transactions/);
  assert.match(finances,/owner_id,amazon_account_id,transaction_key/);
});

test('Finances persistence sanitizes raw metadata and never stores buyer PII',async()=>{
  const finances=(await source('supabase/functions/_shared/amazon/finances.ts')).toLowerCase();
  assert.match(finances,/safe.*metadata|sanitize.*metadata/);
  for(const forbidden of ['buyer_name','buyer_email','buyer_phone','shipping_address','delivery_address'])assert.equal(finances.includes(forbidden),false,forbidden);
});

test('Finances Edge Function is internal-only and delegates one job',async()=>{
  const edge=await source('supabase/functions/amazon-sync-finances/index.ts');
  assert.match(edge,/requireInternalSecret/);
  assert.match(edge,/syncFinancesJob/);
});
