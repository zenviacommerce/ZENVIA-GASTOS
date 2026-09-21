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

test('Integrations settings editor exposes real health and actions',async()=>{
  const page=await read('src/pages/Settings.tsx');
  assert.match(page,/function IntegrationsSection/);
  for(const label of ['Gmail','Amazon','Sendcloud','Shopify','Probar conexión','Sincronizar ahora','Último éxito','Último intento'])assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/updateSection\('integrations'/);
  assert.doesNotMatch(page,/API key|Secret key|Access token|Refresh token/i);
});

test('automatic Amazon sync honors the global integration enable switch',async()=>{
  const helper=await read('supabase/functions/_shared/amazon/settings.ts');
  assert.match(helper,/amazonEnabled/);
  assert.match(helper,/automaticEnabled/);
  const orchestrator=await read('supabase/functions/amazon-sync-orchestrator/index.ts');
  assert.match(orchestrator,/automaticSettings\.automaticEnabled/);
});
