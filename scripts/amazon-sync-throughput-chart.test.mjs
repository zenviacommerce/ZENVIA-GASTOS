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


test('Amazon worker cron removes the legacy duplicate schedule',async()=>{
  const migration=await source('supabase/migrations/20260925114500_amazon_worker_cron_dedupe.sql');
  assert.match(migration,/amazon-worker-minute/);
  assert.match(migration,/amazon-sync-worker/);
  assert.match(migration,/cron\.unschedule/);
  assert.match(migration,/'\* \* \* \* \*'/);
});

test('manual sync handles an immediately drained queue without leaving stale pending state',async()=>{
  const page=await source('src/pages/Amazon.tsx');
  assert.match(page,/const nextStatus=await refresh\(\)/);
  assert.match(page,/const nextPending=/);
  assert.match(page,/else if\(result\.jobs\)/);
  assert.match(page,/setManualSyncPending\(false\)/);
});


test('Amazon summary uses indexable timestamp ranges for global finance rows',async()=>{
  const migration=await source('supabase/migrations/20260925124500_amazon_analytics_timestamp_filters.sql');
  assert.match(migration,/posted_date >= from_date::timestamptz/);
  assert.match(migration,/posted_date < \(to_date\+1\)::timestamptz/);
  assert.match(migration,/amazon_analytics_summary_without_fbm_20260917/);
  assert.match(migration,/amazon_analytics_series_without_fbm_20260917/);
});

test('Amazon renders primary KPIs before loading detail and chart data in parallel',async()=>{
  const summary=await source('src/components/amazon/AmazonSummary.tsx');
  assert.match(summary,/setSummary\(nextSummary\)[\s\S]*setLoading\(false\)[\s\S]*Promise\.allSettled/);
  assert.match(summary,/loadAmazonDetail\(filters\)/);
  assert.match(summary,/loadAmazonSeries\(filters,grain\)/);
});
