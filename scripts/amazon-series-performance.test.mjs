import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function optionalSource(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Amazon analytics series aggregates the requested range in one SQL pass',async()=>{
  const sql=await optionalSource('supabase/migrations/20260917005000_amazon_series_single_pass.sql');
  assert.match(sql,/create\s+or\s+replace\s+function\s+public\.amazon_analytics_series/i);
  assert.doesNotMatch(sql,/public\.amazon_analytics_summary\s*\(/i,'series must not call the full summary once per bucket');
  assert.match(sql,/generate_series/i,'series must still emit empty day or month buckets');
  assert.match(sql,/order_metrics_by_bucket/i);
  assert.match(sql,/item_metrics_by_bucket/i);
  assert.match(sql,/finance_metrics_by_bucket/i);
});

test('Amazon analytics series keeps completeness and permission semantics',async()=>{
  const sql=await optionalSource('supabase/migrations/20260917005000_amazon_series_single_pass.sql');
  assert.match(sql,/private\.app_workspace_owner_id\(\)/i);
  assert.match(sql,/private\.app_has_permission\('amazon'\)/i);
  assert.match(sql,/profitComplete/i);
  assert.match(sql,/sync_queued/i);
  assert.match(sql,/sync_running/i);
  assert.match(sql,/sync_failed/i);
});
