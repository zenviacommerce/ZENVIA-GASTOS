import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Amazon chart formats period labels as Spanish calendar dates',async()=>{
  const summary=await source('src/components/amazon/AmazonSummary.tsx');
  assert.match(summary,/chartTickLabel/);
  assert.match(summary,/toLocaleDateString\('es-ES'/);
  assert.match(summary,/interval="preserveStartEnd"/);
  assert.match(summary,/minTickGap=\{34\}/);
  assert.match(summary,/labelFormatter=\{value=>chartTooltipLabel\(value,grain\)\}/);
  assert.doesNotMatch(summary,/String\(value\)\.slice\(5\)/);
});

test('Amazon manual sync immediately kicks a worker instead of waiting for cron',async()=>{
  const manual=await source('supabase/functions/amazon-sync-manual/index.ts');
  assert.match(manual,/amazon-sync-worker/);
  assert.match(manual,/getAdminKey/);
  assert.match(manual,/await kickWorker\(\)/);
  assert.match(manual,/workerKicked/);
});

test('Amazon queue is drained every minute after the throughput migration',async()=>{
  const migration=await source('supabase/migrations/20260925113000_amazon_worker_every_minute.sql');
  assert.match(migration,/cron\.unschedule/);
  assert.match(migration,/amazon-sync-worker/);
  assert.match(migration,/'\* \* \* \* \*'/);
});

test('Amazon UI polls active sync jobs and refreshes analytics when the queue drains',async()=>{
  const page=await source('src/pages/Amazon.tsx');
  assert.match(page,/previousPendingJobs/);
  assert.match(page,/pendingJobs/);
  assert.match(page,/setTimeout\(\(\)=>void refresh\(\),5_000\)/);
  assert.match(page,/previous>0&&pendingJobs===0/);
  assert.match(page,/setAnalyticsRefresh\(value=>value\+1\)/);
  assert.match(page,/Sincronización de Amazon completada/);
});
