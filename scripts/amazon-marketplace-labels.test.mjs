import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function optionalSource(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Amazon marketplace labels are human-readable in Spanish',async()=>{
  const helper=await optionalSource('src/components/amazon/marketplaceLabel.ts');
  for(const [code,country] of [['ES','España'],['DE','Alemania'],['FR','Francia'],['IT','Italia'],['BE','Bélgica'],['IE','Irlanda'],['NL','Países Bajos'],['PL','Polonia'],['SE','Suecia']]){
    assert.match(helper,new RegExp(`${code}[^\\n]*${country}`,'i'));
  }
  assert.match(helper,/formatAmazonMarketplace/i);
  assert.match(helper,/marketplaceId/i);
});

test('Orders and inventory render readable marketplace labels from marketplace metadata',async()=>{
  const orders=await optionalSource('src/components/amazon/AmazonOrders.tsx');
  const inventory=await optionalSource('src/components/amazon/AmazonInventory.tsx');
  const page=await optionalSource('src/pages/Amazon.tsx');
  for(const source of [orders,inventory]){
    assert.match(source,/AmazonMarketplaceStatus/i);
    assert.match(source,/formatAmazonMarketplace/i);
    assert.doesNotMatch(source,/<td>\{row\.marketplaceId\}<\/td>/i);
  }
  assert.match(page,/<AmazonOrders\s+filters=\{filters\}\s+marketplaces=\{marketplaces\}/i);
  assert.match(page,/<AmazonInventory\s+filters=\{filters\}\s+marketplaces=\{marketplaces\}/i);
});
