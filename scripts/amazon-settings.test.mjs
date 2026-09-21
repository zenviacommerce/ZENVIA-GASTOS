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
  assert.doesNotMatch(manual,/loadAmazonAutomaticSyncSettings/);
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
