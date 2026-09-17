import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('FX sync uses ECB data, writes EUR-normalized daily rates and is internal only', async()=>{
  const fx=await source('supabase/functions/_shared/amazon/fx.ts');
  const edge=await source('supabase/functions/amazon-sync-fx/index.ts');
  assert.match(fx,/data-api\.ecb\.europa\.eu/i);
  assert.match(fx,/amazon_fx_rates/);
  assert.match(fx,/rate_to_eur/);
  assert.match(fx,/OBS_VALUE/);
  assert.match(fx,/EUR/);
  assert.match(edge,/requireInternalSecret/);
  assert.match(edge,/amazon_marketplaces/);
});

test('FX scheduler invokes amazon-sync-fx with Vault apikey', async()=>{
  const sql=await source('supabase/migrations/20260917003000_amazon_fx_scheduler.sql');
  assert.match(sql,/amazon-sync-fx/);
  assert.match(sql,/amazon_cron_secret_key/);
  assert.match(sql,/project_url/);
  assert.match(sql,/'apikey'/);
  assert.match(sql,/amazon-fx-daily/);
});
