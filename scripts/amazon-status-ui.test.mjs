import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('marketplace bootstrap uses Sellers API and upserts the configured seller workspace',async()=>{
  const marketplaces=await source('supabase/functions/_shared/amazon/marketplaces.ts');
  assert.match(marketplaces,/\/sellers\/v1\/marketplaceParticipations/);
  assert.match(marketplaces,/readAmazonSpApiCredentials/);
  assert.match(marketplaces,/amazon_accounts/);
  assert.match(marketplaces,/amazon_marketplaces/);
  assert.match(marketplaces,/marketplace\.id/);
  assert.match(marketplaces,/defaultCurrencyCode/);
  assert.match(marketplaces,/isParticipating/);
  assert.match(marketplaces,/owner_id,seller_id/);
  assert.match(marketplaces,/owner_id,amazon_account_id,marketplace_id/);
});

test('marketplace bootstrap excludes Non-Amazon sales channels returned by Sellers API',async()=>{
  const marketplaces=await source('supabase/functions/_shared/amazon/marketplaces.ts');
  assert.match(marketplaces,/marketplace\.name/);
  assert.match(marketplaces,/startsWith\(['"]Amazon\.['"]\)/);
});

test('orchestrator bootstraps marketplaces before creating jobs',async()=>{
  const orchestrator=await source('supabase/functions/amazon-sync-orchestrator/index.ts');
  assert.match(orchestrator,/ensureAmazonAccountAndMarketplaces/);
});

test('Amazon status endpoint authenticates access and never returns credentials',async()=>{
  const status=await source('supabase/functions/amazon-status/index.ts');
  assert.match(status,/authenticateUser/);
  assert.match(status,/permissions.*amazon|role.*admin/si);
  assert.match(status,/AMAZON_SPAPI_CREDENTIALS/);
  assert.match(status,/amazon_accounts/);
  assert.match(status,/amazon_marketplaces/);
  assert.match(status,/amazon_sync_runs/);
  assert.match(status,/amazon_sync_jobs/);
  assert.doesNotMatch(status,/clientSecret|refreshToken|accessToken/);
});

test('frontend Amazon service loads status and can request manual sync',async()=>{
  const service=await source('src/services/amazon.ts');
  assert.match(service,/functions\.invoke\('amazon-status'/);
  assert.match(service,/functions\.invoke\('amazon-sync-manual'/);
  assert.match(service,/AmazonStatus/);
});

test('Amazon page renders live connection state and admin manual sync without losing external links',async()=>{
  const page=await source('src/pages/Amazon.tsx');
  assert.match(page,/loadAmazonStatus/);
  assert.match(page,/requestAmazonSync/);
  assert.match(page,/Seller Central/);
  assert.match(page,/Sellerboard/);
  assert.match(page,/Sincronizar ahora/);
  assert.match(page,/marketplace/i);
  assert.doesNotMatch(page,/La conexión segura con Amazon SP-API y Amazon Ads se configurará en el backend en la siguiente fase/);
});
