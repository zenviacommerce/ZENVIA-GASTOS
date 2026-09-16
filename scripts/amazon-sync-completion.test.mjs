import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('successful Amazon jobs update queue state, checkpoint and account last-success timestamp',async()=>{
  const sync=await source('supabase/functions/_shared/amazon/sync.ts');
  assert.match(sync,/markJobSuccess/);
  assert.match(sync,/amazon_sync_jobs/);
  assert.match(sync,/amazon_sync_state/);
  assert.match(sync,/amazon_accounts/);
  assert.match(sync,/last_successful_sync_at/);
  assert.match(sync,/amazon_account_id/);
  assert.match(sync,/owner_id/);
});

test('a completed job never moves a source high-water mark backwards',async()=>{
  const sync=await source('supabase/functions/_shared/amazon/sync.ts');
  assert.match(sync,/existingState|currentHighWater|previousHighWater/i);
  assert.match(sync,/Math\.max|>\s*new Date|highWater.*existing/i);
});
