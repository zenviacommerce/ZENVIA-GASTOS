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
  const orders=await source('src/pages/Orders.tsx');
  assert.match(orders,/TransportTariffsPanel/,'Orders must render the tariff manager');
  assert.match(orders,/Tarifas de transporte/i,'Orders must expose a tariff configuration entry point');
});
