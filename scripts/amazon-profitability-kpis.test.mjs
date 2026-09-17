import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Amazon summary exposes gross sales, sales VAT, Ads and net profit KPIs',async()=>{
  const service=await source('src/services/amazon.ts');
  const summary=await source('src/components/amazon/AmazonSummary.tsx');
  for(const field of ['grossSales','salesVat','netSales','amazonFees','amazonFeeVat','refunds','adsCost','productCost','fbmShippingCost','netProfit','marginPct']){
    assert.match(service,new RegExp(field),`AmazonSummary type must expose ${field}`);
  }
  for(const label of ['Ventas','IVA ventas','Ventas sin IVA','Tarifas Amazon sin IVA','Publicidad','Reembolsos','Coste producto','Coste envíos FBM','Ganancia neta','Margen neto']){
    assert.match(summary,new RegExp(label),`Summary UI must render ${label}`);
  }
  assert.doesNotMatch(summary,/Beneficio antes de Ads/,'old pre-Ads profit KPI must be removed');
});

test('Amazon profitability migration uses actual VAT and net-of-tax finance components',async()=>{
  const migration=await source('supabase/migrations/20260917160000_amazon_profitability_kpis.sql');
  assert.match(migration,/vat_amount is not null/i,'unknown VAT must remain incomplete, not estimated');
  assert.match(migration,/vat_amount\s*=\s*0|coalesce\([^)]*vat_amount/i,'explicit zero VAT must be accepted as a real value');
  assert.match(migration,/amount_original\s*-\s*coalesce\(tax_amount_original\s*,\s*0\)/i,'fees/refunds must remove recoverable tax');
  assert.match(migration,/ads_payment_excluded/i,'Amazon Ads payments must be included in profitability');
  assert.match(migration,/amazonFeeVat/i,'summary must expose recoverable Amazon fee VAT');
  assert.match(migration,/netProfit/i,'summary must expose net profit');
  assert.doesNotMatch(migration,/profitBeforeAds/i,'new summary must not calculate the old pre-Ads KPI');
});

test('Amazon series trends net profit rather than pre-Ads profit',async()=>{
  const migration=await source('supabase/migrations/20260917160000_amazon_profitability_kpis.sql');
  const summary=await source('src/components/amazon/AmazonSummary.tsx');
  assert.match(migration,/'netProfit'/);
  assert.match(summary,/dataKey="netProfit"/);
  assert.doesNotMatch(summary,/dataKey="profitBeforeAds"/);
});


test('Amazon Business orders treat missing tax as explicit zero while unknown B2C VAT stays provisional',async()=>{
  const migration=await source('supabase/migrations/20260918005500_amazon_business_orders_and_product_profitability.sql');
  assert.match(migration,/is_business_order/);
  assert.match(migration,/case when coalesce\(o\.is_business_order,false\) then 0::numeric end/i);
  assert.match(migration,/missing_vat_orders/);
  assert.match(migration,/businessOrders/);
  assert.match(migration,/sort_by/);
  assert.match(migration,/profit_before_ads/);
});
