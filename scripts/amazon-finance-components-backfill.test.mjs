import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('historical finance component backfill is internal, paginated and reuses the live normalizer',async()=>{
  const text=await source('supabase/functions/amazon-backfill-finance-components/index.ts');
  assert.match(text,/requireInternalSecret/);
  assert.match(text,/normalizeFinanceComponents/);
  assert.match(text,/amazon_finance_transactions/);
  assert.match(text,/amazon_finance_components/);
  assert.match(text,/metadata/);
  assert.match(text,/limit/);
  assert.match(text,/cursor/);
  assert.match(text,/hasMore/);
});

test('finance backfill normalizes a page concurrently and persists components in bulk',async()=>{
  const text=await source('supabase/functions/amazon-backfill-finance-components/index.ts');
  assert.match(text,/Promise\.all/);
  assert.match(text,/finance_transaction_id/);
  assert.match(text,/\.in\('finance_transaction_id'/);
  assert.match(text,/components\.slice/);
  assert.match(text,/BULK_WRITE_SIZE/);
});

test('finance backfill never asks for or persists buyer PII',async()=>{
  const text=(await source('supabase/functions/amazon-backfill-finance-components/index.ts')).toLowerCase();
  for(const forbidden of ['buyer_name','buyer_email','buyer_phone','shipping_address','delivery_address'])assert.equal(text.includes(forbidden),false,forbidden);
});
