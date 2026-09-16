import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Amazon service exposes typed analytics and mapping calls',async()=>{
  const service=await source('src/services/amazon.ts');
  for(const name of [
    'AmazonAnalyticsFilters','AmazonSummary','AmazonSeriesPoint','loadAmazonSummary','loadAmazonSeries',
    'loadAmazonProducts','loadAmazonMarketplaces','loadAmazonOrders','loadAmazonInventory','loadAmazonUnmapped',
    'setAmazonProductMapping','deleteAmazonProductMapping','amazonQuickRange','loadAmazonProductOptions'
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
