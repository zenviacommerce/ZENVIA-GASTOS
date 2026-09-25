import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Amazon settings keep typed safe fallbacks',async()=>{
  const schema=await read('src/services/settingsSchema.ts');
  for(const field of [
    'activeMarketplaceIds','primaryMarketplaceId','consolidatedCurrency','defaultPeriod','historyDays',
    'autoSyncOrders','autoSyncInventory','autoSyncFinance','autoSyncImages',
    'defaultConsumptionFactor','unmappedSkuBehavior','defaultVatRate','fxMissingRatePolicy','visibleKpis'
  ]) assert.match(schema,new RegExp(field),field);
  assert.match(schema,/historyDays[^\n]*1[^\n]*3650/);
  assert.match(schema,/defaultConsumptionFactor[^\n]*0\.0001/);
  assert.match(schema,/fxMissingRatePolicy[^\n]*last_known[^\n]*exclude/);
  assert.match(schema,/amazon:\s*\{[\s\S]*?defaultPeriod:\s*'current_month'/);
});

test('Amazon page derives marketplace and period defaults from settings while manual sync stays available',async()=>{
  const service=await read('src/services/amazon.ts');
  const page=await read('src/pages/Amazon.tsx');
  assert.match(service,/resolveAmazonMarketplaceSelection/);
  assert.match(service,/amazonInitialRange/);
  assert.match(service,/resolveAmazonHistoryDays/);
  assert.match(page,/useSettings/);
  assert.match(page,/settings\.amazon/);
  assert.match(page,/resolveAmazonMarketplaceSelection/);
  assert.match(page,/amazonInitialRange/);
  assert.match(page,/requestAmazonSync/);
  assert.doesNotMatch(page,/autoSyncOrders[^\n]*requestAmazonSync/);
});

test('Amazon visible KPIs and default consumption factor are connected to UI',async()=>{
  const summary=await read('src/components/amazon/AmazonSummary.tsx');
  const unmapped=await read('src/components/amazon/AmazonUnmapped.tsx');
  assert.match(summary,/visibleKpis/);
  assert.match(summary,/kpiKey/);
  assert.match(unmapped,/defaultConsumptionFactor/);
  assert.match(unmapped,/initialFactor=\{defaultConsumptionFactor\}/);
});

test('automatic Amazon orchestration honors settings server-side but manual sync bypasses automatic flags',async()=>{
  const orchestrator=await read('supabase/functions/amazon-sync-orchestrator/index.ts');
  const helper=await read('supabase/functions/_shared/amazon/settings.ts');
  const manual=await read('supabase/functions/amazon-sync-manual/index.ts');
  assert.match(helper,/app_settings/);
  assert.match(helper,/autoSyncOrders/);
  assert.match(helper,/autoSyncInventory/);
  assert.match(helper,/autoSyncFinance/);
  assert.match(orchestrator,/loadAmazonAutomaticSyncSettings/);
  assert.match(orchestrator,/enabledSources/);
  assert.match(manual,/enqueueHourlySync/);
  assert.match(manual,/loadAmazonAutomaticSyncSettings/);
  assert.match(helper,/enabledSources,/);
  assert.doesNotMatch(helper,/enabledSources:automaticEnabled\?enabledSources:\[\]/);
});

test('Amazon settings editor exposes marketplaces, analytics fallbacks and automatic sync controls',async()=>{
  const page=await read('src/pages/Settings.tsx');
  assert.match(page,/function AmazonSection/);
  for(const label of [
    'Marketplace principal','Moneda consolidada','Periodo inicial','Histórico',
    'IVA de respaldo','Factor de consumo por defecto','Política FX',
    'Sincronizar pedidos automáticamente','Sincronizar inventario automáticamente',
    'Sincronizar finanzas automáticamente','Sincronizar imágenes automáticamente'
  ]) assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/updateSection\('amazon'/);
});


test('Amazon currency and VAT fallbacks are enforced by the analytics runtime migration',async()=>{
  const sql=await read('supabase/migrations/20260921101500_amazon_configuration_runtime.sql');
  assert.match(sql,/amazon_rate_to_consolidated/);
  assert.match(sql,/consolidatedCurrency/);
  assert.match(sql,/fxMissingRatePolicy/);
  assert.match(sql,/r\.rate_date=p_event_date/);
  assert.match(sql,/r\.rate_date<=p_event_date/);
  assert.match(sql,/amazon_effective_vat_amount/);
  assert.match(sql,/if p_explicit_vat is not null then return p_explicit_vat/);
  assert.match(sql,/defaultVatRate/);
  assert.match(sql,/amazon_analytics_summary/);
  assert.match(sql,/amazon_analytics_series/);
  assert.match(sql,/amazon_analytics_products/);
  assert.match(sql,/amazon_analytics_orders/);
});

test('automatic image sync is controlled by settings and scoped to the workspace',async()=>{
  const orchestrator=await read('supabase/functions/amazon-sync-orchestrator/index.ts');
  const images=await read('supabase/functions/amazon-sync-product-images/index.ts');
  assert.match(orchestrator,/automaticSettings\.autoSyncImages/);
  assert.match(orchestrator,/ownerId,amazonAccountId,limit:10/);
  assert.match(images,/const ownerId=String\(body\?\.ownerId/);
  assert.match(images,/const amazonAccountId=String\(body\?\.amazonAccountId/);
  assert.match(images,/accountQuery=accountQuery\.eq\('owner_id',ownerId\)/);
  assert.match(images,/accountQuery=accountQuery\.eq\('id',amazonAccountId\)/);
});
