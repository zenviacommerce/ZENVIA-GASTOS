import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}
async function migrationsSource(){
  const dir=new URL('../supabase/migrations/',import.meta.url);
  const files=(await readdir(dir)).filter(name=>name.endsWith('.sql')).sort();
  return (await Promise.all(files.map(name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')))).join('\n');
}

test('service backend helper uses secret keys and internal calls require apikey',async()=>{
  const backend=await source('supabase/functions/_shared/amazon/supabase.ts');
  assert.match(backend,/SUPABASE_SECRET_KEYS/);
  assert.match(backend,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(backend,/createClient/);
  assert.match(backend,/apikey/i);
  assert.match(backend,/requireInternalSecret/);
  assert.doesNotMatch(backend,/VITE_/);
});

test('initial backfill starts at 2026-01-01 and is split into bounded windows',async()=>{
  const sync=await source('supabase/functions/_shared/amazon/sync.ts');
  assert.match(sync,/2026-01-01T00:00:00Z/);
  assert.match(sync,/BACKFILL_WINDOW_DAYS\s*=\s*7/);
  assert.match(sync,/enqueueInitialBackfill/);
  assert.match(sync,/orders/);
  assert.match(sync,/finances/);
  assert.match(sync,/inventory/);
  assert.match(sync,/job_key/);
});

test('hourly sync uses checkpoints with overlap and queue failures back off',async()=>{
  const sync=await source('supabase/functions/_shared/amazon/sync.ts');
  assert.match(sync,/enqueueHourlySync/);
  assert.match(sync,/OVERLAP_HOURS\s*=\s*6/);
  assert.match(sync,/high_water_mark/);
  assert.match(sync,/available_at/);
  assert.match(sync,/attempts/);
  assert.match(sync,/max_attempts/);
  assert.match(sync,/sanitizeAmazonError/);
});

test('current sync caps stale checkpoints to a seven-day freshness window',async()=>{
  const sync=await source('supabase/functions/_shared/amazon/sync.ts');
  assert.match(sync,/CURRENT_SYNC_MAX_LOOKBACK_HOURS\s*=\s*7\s*\*\s*24/);
  assert.match(sync,/freshnessFloor\s*=\s*minusHours\(now,CURRENT_SYNC_MAX_LOOKBACK_HOURS\)/);
  assert.match(sync,/overlapStart\s*<\s*freshnessFloor\s*\?\s*freshnessFloor\s*:\s*overlapStart/);
});

test('orchestrator and worker are internal-only and worker claims bounded jobs atomically',async()=>{
  const core=await source('supabase/migrations/20260916190000_amazon_analytics_phase_b.sql');
  const wrapper=await source('supabase/migrations/20260916191000_amazon_sync_queue_rpc.sql');
  const orchestrator=await source('supabase/functions/amazon-sync-orchestrator/index.ts');
  const worker=await source('supabase/functions/amazon-sync-worker/index.ts');
  assert.match(core,/function private\.amazon_claim_sync_jobs/i);
  assert.match(core,/for update skip locked/i);
  assert.match(wrapper,/function public\.amazon_claim_sync_jobs/i);
  assert.match(wrapper,/private\.amazon_claim_sync_jobs/);
  assert.match(wrapper,/revoke all on function public\.amazon_claim_sync_jobs[\s\S]*from public/i);
  assert.match(wrapper,/grant execute on function public\.amazon_claim_sync_jobs[\s\S]*to service_role/i);
  assert.match(orchestrator,/requireInternalSecret/);
  assert.match(worker,/requireInternalSecret/);
  assert.match(worker,/rpc\('amazon_claim_sync_jobs'/);
  assert.match(worker,/limit_count:\s*6/);
  assert.match(worker,/markJobFailed/);
});

test('job claimer prioritizes current hourly/manual work ahead of historical backfill',async()=>{
  const migrations=await migrationsSource();
  assert.match(migrations,/payload\s*->>\s*'mode'/i);
  assert.match(migrations,/when\s+coalesce\(j\.payload\s*->>\s*'mode'[^)]*\)\s+in\s*\('hourly','manual'\)\s+then\s+0/i);
  assert.match(migrations,/order\s+by[\s\S]*case[\s\S]*available_at[\s\S]*created_at/i);
  assert.match(migrations,/for\s+update\s+skip\s+locked/i);
});

test('job claimer coalesces stale current batches and keeps the newest current batch first',async()=>{
  const migrations=await migrationsSource();
  assert.match(migrations,/newer\.created_at\s*>\s*stale\.created_at/i);
  assert.match(migrations,/jsonb_build_object\(\s*'superseded'\s*,\s*true/i);
  assert.match(migrations,/set\s+status\s*=\s*'success'[\s\S]*rows_processed\s*=\s*0/i);
  assert.match(migrations,/when\s+coalesce\(j\.payload\s*->>\s*'mode'[^)]*\)\s+in\s*\('hourly','manual'\)\s+then\s+j\.created_at/i);
});

test('newest current batch claims orders before finances and inventory',async()=>{
  const migrations=await migrationsSource();
  assert.match(migrations,/case\s+j\.source\s+when\s+'orders'\s+then\s+0\s+when\s+'finances'\s+then\s+1\s+when\s+'inventory'\s+then\s+2/i);
});

test('manual sync authenticates a real user and requires admin role',async()=>{
  const manual=await source('supabase/functions/amazon-sync-manual/index.ts');
  const backend=await source('supabase/functions/_shared/amazon/supabase.ts');
  assert.match(backend,/auth\.getUser/);
  assert.match(backend,/app_users/);
  assert.match(backend,/role\s*!==\s*'admin'/);
  assert.match(manual,/authenticateAdminUser/);
  assert.match(manual,/role\s*!==\s*'admin'/);
  assert.match(manual,/enqueueHourlySync/);
  assert.doesNotMatch(`${manual}\n${backend}`,/user_metadata/);
});


test('production Amazon worker cron uses direct pg_net invocation instead of a missing helper',async()=>{
  const migration=await source('supabase/migrations/20260925124100_amazon_worker_direct_cron.sql');
  assert.match(migration,/amazon-sync-worker/);
  assert.match(migration,/net\.http_post/);
  assert.match(migration,/amazon_cron_secret_key/);
  const command=migration.slice(migration.indexOf('select cron.schedule'));
  assert.doesNotMatch(command,/amazon_invoke_internal_function/);
});
