import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('inventory sync calls FBA Inventory v1 with marketplace granularity and pagination',async()=>{
  const inventory=await source('supabase/functions/_shared/amazon/inventory.ts');
  assert.match(inventory,/\/fba\/inventory\/v1\/summaries/);
  assert.match(inventory,/granularityType[^\n]*Marketplace/);
  assert.match(inventory,/granularityId/);
  assert.match(inventory,/marketplaceIds/);
  assert.match(inventory,/details[^\n]*true/);
  assert.match(inventory,/nextToken/);
});

test('inventory normalization persists current FBA quantity breakdowns',async()=>{
  const inventory=await source('supabase/functions/_shared/amazon/inventory.ts');
  for(const field of ['sellerSku','asin','totalQuantity','fulfillableQuantity','inboundWorkingQuantity','inboundShippedQuantity','inboundReceivingQuantity','totalReservedQuantity','totalUnfulfillableQuantity','totalResearchingQuantity'])assert.match(inventory,new RegExp(field));
  assert.match(inventory,/amazon_inventory_current/);
  assert.match(inventory,/owner_id,amazon_account_id,marketplace_id,seller_sku/);
});

test('inventory writes at most one daily snapshot per marketplace SKU and date',async()=>{
  const inventory=await source('supabase/functions/_shared/amazon/inventory.ts');
  assert.match(inventory,/amazon_inventory_daily/);
  assert.match(inventory,/snapshot_date/);
  assert.match(inventory,/owner_id,amazon_account_id,marketplace_id,seller_sku,snapshot_date/);
  assert.doesNotMatch(inventory,/window_from|historical.*inventory|backfill.*inventory/i);
});

test('inventory Edge Function is internal-only and delegates one job',async()=>{
  const edge=await source('supabase/functions/amazon-sync-inventory/index.ts');
  assert.match(edge,/requireInternalSecret/);
  assert.match(edge,/syncInventoryJob/);
});
