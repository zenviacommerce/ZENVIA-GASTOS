import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Amazon product listing metadata keeps Amazon title separate from internal ZENVIA product name',async()=>{
  const [products,unmapped,service,sync,migration]=await Promise.all([
    read('src/components/amazon/AmazonProducts.tsx'),
    read('src/components/amazon/AmazonUnmapped.tsx'),
    read('src/services/amazon.ts'),
    read('supabase/functions/amazon-sync-product-images/index.ts'),
    read('supabase/migrations/20260925120000_amazon_listing_product_names.sql'),
  ]);
  assert.match(service,/loadAmazonProductMetadata/);
  assert.match(sync,/fromListingName/);
  assert.match(sync,/product_name:productName/);
  assert.match(migration,/add column if not exists product_name text/);
  assert.match(products,/ZENVIA:/);
  assert.match(products,/Nombre Amazon pendiente/);
  assert.match(unmapped,/amazonMarketplaceCode/);
  assert.doesNotMatch(products,/row\.productName\|\|row\.sellerSku/);
});

test('Amazon chart Y axis reserves enough space for full monetary values',async()=>{
  const summary=await read('src/components/amazon/AmazonSummary.tsx');
  assert.match(summary,/function chartMoneyTick/);
  assert.match(summary,/maximumFractionDigits:0/);
  assert.match(summary,/<YAxis width=\{86\}/);
  assert.match(summary,/margin=\{\{top:8,right:16,bottom:0,left:10\}\}/);
});


test('Amazon listing metadata prefers the Spanish marketplace for the canonical display name',async()=>{
  const sync=await read('supabase/functions/amazon-sync-product-images/index.ts');
  assert.match(sync,/\[esMarketplaceId,product\.marketplaceId,\.\.\.activeMarketplaceIds\]/);
});
