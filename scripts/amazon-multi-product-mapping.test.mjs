import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Amazon SKU mappings support multiple internal product components',async()=>{
  const sql=await source('supabase/migrations/20260925143500_amazon_multi_product_mappings.sql');
  assert.match(sql,/unique\s*\(owner_id,amazon_account_id,seller_sku,product_id\)/i);
  assert.match(sql,/amazon_mapping_cost_snapshot/i);
  assert.match(sql,/amazon_get_product_mappings/i);
  assert.match(sql,/amazon_delete_product_mapping_item/i);
  assert.match(sql,/quantity_ordered\*mapped_unit_cost_eur/i);
  assert.match(sql,/'productMappings',product_mappings/i);
  assert.doesNotMatch(sql,/unique\s*\(owner_id,\s*amazon_account_id,\s*seller_sku\)\s*;/i);
});

test('Amazon mapping editor exposes supplier and keeps a component list',async()=>{
  const [editor,service]=await Promise.all([
    source('src/components/amazon/AmazonMappingEditor.tsx'),
    source('src/services/amazon.ts'),
  ]);
  assert.match(editor,/Productos vinculados/);
  assert.match(editor,/Proveedor:/);
  assert.match(editor,/Añadir producto/);
  assert.match(editor,/deleteAmazonProductMappingItem/);
  assert.match(service,/last_supplier_id/);
  assert.match(service,/supplierName/);
  assert.match(service,/amazon_get_product_mappings/);
  assert.match(service,/amazon_add_product_mapping/);
});

test('Amazon product profitability UI reports multiple linked components',async()=>{
  const products=await source('src/components/amazon/AmazonProducts.tsx');
  assert.match(products,/Gestionar vínculos/);
  assert.match(products,/productMappings/);
  assert.match(products,/componentes/);
});

test('legacy Amazon mapping setter remains replace-safe during staggered rollout',async()=>{
  const sql=await source('supabase/migrations/20260925145500_amazon_mapping_backward_compat.sql');
  assert.match(sql,/create\s+or\s+replace\s+function\s+public\.amazon_add_product_mapping/i);
  assert.match(sql,/delete\s+from\s+public\.amazon_product_mappings/i);
  assert.match(sql,/m\.product_id<>v_product/i);
});
