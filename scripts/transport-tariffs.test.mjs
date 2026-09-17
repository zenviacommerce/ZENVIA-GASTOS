import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('transport tariff schema is versioned, workspace scoped and review-gated',async()=>{
  const migration=await source('supabase/migrations/20260917162000_transport_tariffs.sql');
  for(const table of ['transport_tariff_documents','transport_tariff_services','transport_tariff_bands']){
    assert.match(migration,new RegExp(`create table(?: if not exists)? public\\.${table}`,'i'),`missing ${table}`);
  }
  for(const field of ['effective_from','effective_to','fuel_surcharge_pct','prices_include_vat','source_file_name','source_file_path','parser_provider','parser_confidence']){
    assert.match(migration,new RegExp(field,'i'),`documents must persist ${field}`);
  }
  for(const field of ['service_name','external_provider','external_service_code','mapping_status']){
    assert.match(migration,new RegExp(field,'i'),`services must persist ${field}`);
  }
  for(const field of ['country_code','zone_code','zone_name','min_weight_kg','max_weight_kg','base_price','extra_kg_price']){
    assert.match(migration,new RegExp(field,'i'),`bands must persist ${field}`);
  }
  assert.match(migration,/draft[\s\S]{0,160}reviewed[\s\S]{0,160}active/i,'status flow must include draft, reviewed and active');
  assert.match(migration,/enable row level security/i,'tariff tables must use RLS');
  assert.match(migration,/transport_tariff_mark_reviewed/i,'review must be an explicit database operation');
  assert.match(migration,/transport_tariff_activate/i,'activation must be an explicit database operation');
});

test('transport tariff service keeps parsing, review and activation as separate steps',async()=>{
  const service=await source('src/services/transportTariffs.ts');
  assert.match(service,/parseTransportTariffDocument/,'document parsing must live behind one service boundary');
  assert.match(service,/createTransportTariffDraft/,'an import must create a draft');
  assert.match(service,/saveTransportTariffReview/,'review edits must be persisted before activation');
  assert.match(service,/markTransportTariffReviewed/,'review must be explicit');
  assert.match(service,/activateTransportTariff/,'activation must be explicit');
  assert.match(service,/pdfjs-dist|readTransportDocumentText/,'PDF extraction must be supported');
  assert.match(service,/JSZip|xlsx/i,'Excel/XLSX extraction must be supported');
});

test('transport tariff parser can use AI but safely falls back without auto-activation',async()=>{
  const edge=await source('supabase/functions/transport-tariff-parser/index.ts');
  assert.match(edge,/OPENAI_API_KEY/,'AI parser must use a server-side key only');
  assert.match(edge,/\/v1\/responses/,'AI parser must use the Responses API');
  assert.match(edge,/fallback/,'AI parser must preserve a deterministic fallback');
  assert.match(edge,/json_schema|schema/i,'AI parser must request structured output');
  assert.doesNotMatch(edge,/transport_tariff_activate|status\s*:\s*['"]active['"]/i,'parser must never activate a tariff');
});

test('transport tariff UI always reviews an import before activation',async()=>{
  const panel=await source('src/components/TransportTariffsPanel.tsx');
  assert.match(panel,/Tarifas de transporte/i);
  assert.match(panel,/Subir tarifa/i);
  assert.match(panel,/Revisar importaci[oó]n/i);
  assert.match(panel,/Confirmar revisi[oó]n/i);
  assert.match(panel,/Activar tarifa/i);
  assert.match(panel,/\.pdf[^\n]*\.xlsx|\.xlsx[^\n]*\.pdf/i,'file picker must accept PDF and XLSX');
  assert.match(panel,/mapping_status|mappingStatus/i,'service mapping must be reviewable');
  assert.doesNotMatch(panel,/createTransportTariffDraft\([^;]+;\s*await\s+activateTransportTariff/is,'import must never auto-activate');
});

test('Orders exposes transport tariff configuration',async()=>{
  const bridge=await source('src/components/OrderLabelDefaults.tsx');
  assert.match(bridge,/TransportTariffsPanel/,'Orders enhancement must render the tariff manager');
  assert.match(bridge,/Tarifas de transporte/i,'Orders must expose a tariff configuration entry point');
  assert.match(bridge,/ordersPage \.pageHead \.actions/,'tariff button must be scoped to Orders');
});


test('active tariff keeps one visible document while any field can change by effective date',async()=>{
  const service=await source('src/services/transportTariffs.ts');
  const panel=await source('src/components/TransportTariffsPanel.tsx');
  const shipping=await source('src/services/orderShipping.ts');
  const migration=await source('supabase/migrations/20260918024000_general_transport_tariff_effective_revisions.sql');

  assert.match(service,/saveActiveTransportTariff/,'active tariff changes need a dedicated dated save');
  assert.match(service,/transport_tariff_save_active/,'active changes must persist through the effective-date RPC');
  assert.match(service,/transport_tariff_reprice_estimates/,'estimated shipping costs must be recalculated after an active change');
  assert.match(panel,/Aplicar cambios desde/i);
  assert.match(panel,/Todos los campos que cambies se aplicarán desde la fecha indicada/i);
  assert.doesNotMatch(panel,/Combustible por periodos|createTransportTariffVersion/,'effective dating must be generic, not fuel-specific or a visible clone');
  assert.match(shipping,/document\.revisions/,'shipping estimate must resolve the full tariff revision valid for the order date');
  assert.match(migration,/transport_tariff_revisions/);
  assert.match(migration,/snapshot jsonb/i);
  assert.match(migration,/drop table if exists public\.transport_tariff_fuel_periods/i);
});
