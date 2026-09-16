import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Amazon credentials are loaded only from one server-side project secret', async () => {
  const config=await source('supabase/functions/_shared/amazon/config.ts');
  assert.match(config,/AMAZON_SPAPI_CREDENTIALS/);
  assert.match(config,/Deno\.env\.get/);
  assert.match(config,/client_id/);
  assert.match(config,/client_secret/);
  assert.match(config,/refresh_token/);
  assert.match(config,/seller_id/);
  assert.doesNotMatch(config,/VITE_/);
});

test('SP-API client exchanges LWA refresh token and calls the EU endpoint', async () => {
  const sp=await source('supabase/functions/_shared/amazon/sp-api.ts');
  assert.match(sp,/https:\/\/api\.amazon\.com\/auth\/o2\/token/);
  assert.match(sp,/grant_type[^\n]*refresh_token/);
  assert.match(sp,/https:\/\/sellingpartnerapi-eu\.amazon\.com/);
  assert.match(sp,/x-amz-access-token/i);
  assert.match(sp,/x-amz-date/i);
  assert.match(sp,/user-agent/i);
  assert.doesNotMatch(sp,/AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|SignatureV4|SigV4/i);
});

test('SP-API client retries only transient failures with a bounded attempt count', async () => {
  const sp=await source('supabase/functions/_shared/amazon/sp-api.ts');
  const http=await source('supabase/functions/_shared/amazon/http.ts');
  assert.match(sp,/429/);
  assert.match(sp,/500/);
  assert.match(sp,/503/);
  assert.match(sp,/MAX_ATTEMPTS\s*=\s*4/);
  assert.match(sp,/retryAfterMs/);
  assert.match(http,/retry-after/i);
  assert.match(sp,/sanitizeAmazonError/);
  assert.match(http,/sanitizeAmazonError/);
});

test('Amazon setup documentation never instructs putting credentials in frontend variables', async () => {
  const docs=await source('docs/amazon-sp-api-setup.md');
  assert.match(docs,/private application|aplicaci[oó]n privada/i);
  assert.match(docs,/Finance and Accounting/i);
  assert.match(docs,/AMAZON_SPAPI_CREDENTIALS/);
  assert.match(docs,/Supabase.*Secrets|Edge Function Secrets/i);
  assert.doesNotMatch(docs,/VITE_AMAZON|NEXT_PUBLIC_AMAZON/);
});
