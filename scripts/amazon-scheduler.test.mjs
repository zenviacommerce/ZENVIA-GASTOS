import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('hourly orchestrator seeds the full historical backfill before incremental jobs when state is empty',async()=>{
  const orchestrator=await source('supabase/functions/amazon-sync-orchestrator/index.ts');
  assert.match(orchestrator,/amazon_sync_state/);
  assert.match(orchestrator,/enqueueInitialBackfill/);
  assert.match(orchestrator,/mode\s*===\s*'hourly'/);
  assert.match(orchestrator,/state/i);
});

test('cron migration invokes the orchestrator hourly and drains workers every five minutes through Vault secrets',async()=>{
  const migration=await source('supabase/migrations/20260916193000_amazon_sync_cron.sql');
  assert.match(migration,/pg_cron/i);
  assert.match(migration,/pg_net/i);
  assert.match(migration,/vault\.decrypted_secrets/i);
  assert.match(migration,/project_url/);
  assert.match(migration,/amazon_cron_secret_key/);
  assert.match(migration,/amazon-sync-orchestrator/);
  assert.match(migration,/amazon-sync-worker/);
  assert.match(migration,/7 \* \* \* \*/);
  assert.match(migration,/\*\/5 \* \* \* \*/);
  assert.doesNotMatch(migration,/sb_secret_[A-Za-z0-9_-]{8,}|service_role\s*[:=]\s*['"][^'"]+/i);
});

test('cron helper is not executable by browser roles',async()=>{
  const migration=await source('supabase/migrations/20260916193000_amazon_sync_cron.sql');
  assert.match(migration,/revoke all on function private\.amazon_invoke_internal_function[\s\S]*from public/i);
  assert.match(migration,/revoke all on function private\.amazon_invoke_internal_function[\s\S]*from anon/i);
  assert.match(migration,/revoke all on function private\.amazon_invoke_internal_function[\s\S]*from authenticated/i);
});

test('deployment documentation separates internal secret-key functions from user JWT functions',async()=>{
  const docs=await source('docs/amazon-sp-api-setup.md');
  assert.match(docs,/amazon-sync-orchestrator[\s\S]*verify_jwt\s*=\s*false/i);
  assert.match(docs,/amazon-sync-worker[\s\S]*verify_jwt\s*=\s*false/i);
  assert.match(docs,/amazon-status[\s\S]*verify_jwt\s*=\s*true/i);
  assert.match(docs,/amazon-sync-manual[\s\S]*verify_jwt\s*=\s*true/i);
  assert.match(docs,/amazon_cron_secret_key/);
  assert.match(docs,/project_url/);
});
