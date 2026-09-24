import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('integration health contract is safe and never exposes secrets',async()=>{
  const service=await read('src/services/integrations.ts');
  assert.match(service,/export type IntegrationId='gmail'\|'amazon'\|'sendcloud'\|'shopify'/);
  assert.match(service,/export type IntegrationHealth=/);
  for(const field of ['enabled','connected','lastSuccessAt','lastAttemptAt','lastError'])assert.match(service,new RegExp(field));
  assert.doesNotMatch(service,/select\([^)]*(secret|token|password|api_key|access_token)/i);
  assert.doesNotMatch(service,/integration_secrets/i);
  assert.doesNotMatch(service,/accessToken\s*:/);
});

test('connection tests reuse safe existing adapters',async()=>{
  const service=await read('src/services/integrations.ts');
  for(const name of ['testGmailConnection','loadAmazonStatus','getSendcloudStatus'])assert.match(service,new RegExp(name));
  assert.match(service,/channel==='shopify'/);
  assert.match(service,/checkedAt/);
});

test('manual integration sync actions remain explicit',async()=>{
  const service=await read('src/services/integrations.ts');
  for(const name of ['syncGmailInvoiceCandidates','requestAmazonSync','syncSendcloudOrders'])assert.match(service,new RegExp(name));
  assert.match(service,/syncIntegration/);
});

test('Gmail helpers test and sync without returning OAuth tokens',async()=>{
  const gmail=await read('src/services/gmail.ts');
  assert.match(gmail,/export async function testGmailConnection/);
  assert.match(gmail,/export async function syncGmailInvoiceCandidates/);
  assert.doesNotMatch(gmail,/testGmailConnection[\s\S]{0,1200}return\s+connection/);
});

test('Integrations settings editor supports multi-account credentials without exposing stored secrets',async()=>{
  const page=await read('src/pages/Settings.tsx');
  const accounts=await read('src/services/integrationAccounts.ts');
  assert.match(page,/function IntegrationsSection/);
  for(const label of ['Gmail','Amazon','Sendcloud','Shopify','Probar','Sincronizar','Añadir cuenta','Predeterminada'])assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/type="password"/);
  assert.match(page,/Refresh token/i);
  assert.match(page,/Secret key/i);
  assert.match(page,/Los secretos guardados nunca se vuelven a mostrar/i);
  assert.doesNotMatch(accounts,/\.from\(['"]integration_secrets['"]\)/i);
  assert.doesNotMatch(accounts,/secret_id/i);
  assert.match(accounts,/supabase\.functions\.invoke\('integration-accounts'/);
});

test('multi-account service models account identity, default selection and legacy compatibility safely',async()=>{
  const source=await read('src/services/integrationAccounts.ts');
  for(const field of ['provider','externalAccountId','isDefault','credentialSource','credentialsConfigured','parentAccountId','linkedResourceId','legacy'])assert.match(source,new RegExp(field),field);
  assert.match(source,/loadLegacyIntegrationAccounts/);
  assert.match(source,/legacy-amazon-/);
  assert.match(source,/legacy-sendcloud-current/);
  assert.match(source,/legacy-shopify-/);
  assert.match(source,/legacy-gmail-/);
  assert.match(source,/setDefaultIntegrationAccount/);
  assert.match(source,/disconnectIntegrationAccount/);
});

test('automatic Amazon sync honors the global integration enable switch',async()=>{
  const helper=await read('supabase/functions/_shared/amazon/settings.ts');
  assert.match(helper,/amazonEnabled/);
  assert.match(helper,/automaticEnabled/);
  const orchestrator=await read('supabase/functions/amazon-sync-orchestrator/index.ts');
  assert.match(orchestrator,/automaticSettings\.automaticEnabled/);
});
