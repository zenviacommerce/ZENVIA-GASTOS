import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function optionalSource(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Amazon sync claim recovers stale running jobs before claiming new work',async()=>{
  const sql=await optionalSource('supabase/migrations/20260917006300_amazon_sync_stale_job_recovery.sql');
  assert.match(sql,/create\s+or\s+replace\s+function\s+private\.amazon_claim_sync_jobs/i);
  assert.match(sql,/status\s*=\s*'running'/i);
  assert.match(sql,/locked_at\s*<\s*now\(\)\s*-\s*interval\s*'15 minutes'/i);
  assert.match(sql,/status\s*=\s*'queued'/i);
  assert.match(sql,/locked_at\s*=\s*null/i);
  assert.match(sql,/available_at\s*=\s*now\(\)/i);
});

test('Amazon sync claim fails stale jobs that already exhausted retries',async()=>{
  const sql=await optionalSource('supabase/migrations/20260917006300_amazon_sync_stale_job_recovery.sql');
  assert.match(sql,/attempts\s*>=\s*stale\.max_attempts/i);
  assert.match(sql,/status\s*=\s*'failed'/i);
  assert.match(sql,/finished_at\s*=\s*now\(\)/i);
});
