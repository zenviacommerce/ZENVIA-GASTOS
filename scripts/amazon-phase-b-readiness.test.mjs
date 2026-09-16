import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Amazon status is readable with amazon permission but only admin can bootstrap the connection',async()=>{
  const status=await source('supabase/functions/amazon-status/index.ts');
  assert.match(status,/permissions\|\|\[\]\)\.includes\('amazon'\)/);
  assert.match(status,/configured\s*&&\s*caller\.role\s*===\s*'admin'/);
  assert.match(status,/ensureAmazonAccountAndMarketplaces/);
});

test('persisted finance metadata excludes raw transaction descriptions',async()=>{
  const finances=await source('supabase/functions/_shared/amazon/finances.ts');
  const start=finances.indexOf('export function safeTransactionMetadata');
  const end=finances.indexOf('\n}\n',start);
  assert.ok(start>=0&&end>start,'safeTransactionMetadata must exist');
  const metadataBlock=finances.slice(start,end+3);
  assert.doesNotMatch(metadataBlock,/description\s*:/i);
  assert.match(finances,/transaction\?\.description/);
});

test('Amazon credentials and internal project keys never appear in frontend source',async()=>{
  const service=await source('src/services/amazon.ts');
  const page=await source('src/pages/Amazon.tsx');
  const combined=`${service}\n${page}`;
  assert.doesNotMatch(combined,/AMAZON_SPAPI_CREDENTIALS|refresh_token|client_secret|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/);
});
