import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Amazon service exposes typed analytics and mapping calls',async()=>{
  const service=await source('src/services/amazon.ts');
  for(const name of [
    'AmazonAnalyticsFilters','AmazonSummary','AmazonSeriesPoint','loadAmazonSummary','loadAmazonSeries',
    'loadAmazonProducts','loadAmazonMarketplaces','loadAmazonOrders','loadAmazonInventory','loadAmazonUnmapped',
    'setAmazonProductMapping','deleteAmazonProductMapping','amazonQuickRange','loadAmazonProductOptions','consumptionFactor'
  ]) assert.match(service,new RegExp(name));
  for(const rpc of [
    'amazon_analytics_summary','amazon_analytics_series','amazon_analytics_products','amazon_analytics_marketplaces',
    'amazon_analytics_orders','amazon_analytics_inventory','amazon_analytics_unmapped_skus','amazon_set_product_mapping'
  ]) assert.match(service,new RegExp(rpc));
});

test('Quick ranges include current month as the dashboard default preset',async()=>{
  const service=await source('src/services/amazon.ts');
  for(const key of ['today','7d','30d','current_month','previous_month','current_quarter','current_year','custom'])assert.match(service,new RegExp(key));
});

test('Amazon page is a tabbed analytics dashboard with all approved tabs',async()=>{
  const page=await source('src/pages/Amazon.tsx');
  for(const tab of ['Resumen','Productos','Marketplaces','Pedidos','Inventario','Sin vincular'])assert.match(page,new RegExp(tab));
  assert.match(page,/amazonQuickRange\('current_month'/);
});

test('Amazon Summary renders VAT-aware net-profit KPI hierarchy and Recharts trend',async()=>{
  const summary=await source('src/components/amazon/AmazonSummary.tsx');
  for(const label of ['Ventas','IVA ventas','Ventas sin IVA','Pedidos','Unidades vendidas','Tarifas Amazon sin IVA','Publicidad','Reembolsos','Coste producto','Coste envíos FBM','Ganancia neta','Margen neto'])assert.match(summary,new RegExp(label));
  assert.match(summary,/recharts/);
  assert.match(summary,/ResponsiveContainer/);
  assert.match(summary,/loadAmazonSummary/);
  assert.match(summary,/loadAmazonSeries/);
});

test('Completeness UI surfaces historical sync and missing input states',async()=>{
  const banner=await source('src/components/amazon/AmazonCompleteness.tsx');
  for(const label of ['Sincronización histórica en curso','SKU sin vincular','coste histórico','FX','IVA','Ads','pedidos FBM sin coste de envío'])assert.match(banner,new RegExp(label,'i'));
  const service=await source('src/services/amazon.ts');
  assert.match(service,/missingFbmShippingCostCount/,'FBM shipping completeness must be typed in the frontend contract');
});

test('Amazon detail tabs use typed loaders and expose approved fields',async()=>{
  const cases=[
    ['src/components/amazon/AmazonProducts.tsx','loadAmazonProducts',['SKU','Unidades','Ventas','Coste','Tarifas','Beneficio','Margen']],
    ['src/components/amazon/AmazonMarketplaces.tsx','loadAmazonMarketplaces',['Marketplace','Pedidos','Unidades','Ventas','Beneficio']],
    ['src/components/amazon/AmazonOrders.tsx','loadAmazonOrders',['Pedido','Fecha','Marketplace','Estado','Ventas','Beneficio']],
    ['src/components/amazon/AmazonInventory.tsx','loadAmazonInventory',['SKU','Disponible','Reservado','Entrante','No disponible','Total']],
  ];
  for(const [path,loader,labels] of cases){const text=await source(path);assert.match(text,new RegExp(loader));for(const label of labels)assert.match(text,new RegExp(label));}
});

test('Sin vincular uses the shared mapping editor for product selection and consumption factor',async()=>{
  const unmapped=await source('src/components/amazon/AmazonUnmapped.tsx');
  const editor=await source('src/components/amazon/AmazonMappingEditor.tsx');
  assert.match(unmapped,/loadAmazonUnmapped/);assert.match(unmapped,/AmazonMappingEditor/);assert.match(unmapped,/sellerSku/);
  assert.match(editor,/setAmazonProductMapping/);assert.match(editor,/Factor|factor/);assert.match(editor,/Producto interno|producto interno/);assert.doesNotMatch(editor,/<select/i);
});

test('Products editor receives the persisted consumption factor instead of resetting to one',async()=>{
  const products=await source('src/components/amazon/AmazonProducts.tsx');
  assert.match(products,/initialFactor=\{editingRow\?\.consumptionFactor\|\|1\}/);
  const sql=await source('supabase/migrations/20260917002700_amazon_product_mapping_factor_fix.sql');
  assert.match(sql,/'consumptionFactor'/);
  assert.match(sql,/max\(consumption_factor\)/i);
});
