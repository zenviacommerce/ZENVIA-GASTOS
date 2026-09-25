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



test('Amazon mapping modal uses the Amazon product name as its primary title',async()=>{
  const [modal,unmapped]=await Promise.all([
    source('src/components/amazon/AmazonMappingModal.tsx'),
    source('src/components/amazon/AmazonUnmapped.tsx'),
  ]);
  assert.match(modal,/productName\?:string\|null/);
  assert.match(modal,/\{productName\|\|sellerSku\}/);
  assert.match(modal,/\{sellerSku\} · \{asin\|\|'ASIN no disponible'\}/);
  assert.match(unmapped,/productName=\{editingRow\?\.asin\?metadata\[editingRow\.asin\]\?\.productName\|\|null:null\}/);
});

test('Amazon mapping modal stays responsive without horizontal overflow',async()=>{
  const css=await source('src/amazon-mapping.css');
  assert.match(css,/\.amazonMappingModal\{[\s\S]*width:min\(1040px,calc\(100vw - 48px\)\)/);
  assert.match(css,/\.amazonMappingModal \.amazonMappingEditor\{[\s\S]*grid-template-columns:minmax\(0,1\.15fr\) minmax\(340px,\.85fr\)/);
  assert.match(css,/\.amazonMappingModal \.amazonMappingAdd\{[\s\S]*display:flex[\s\S]*flex-direction:column/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*\.amazonMappingModal \.amazonMappingEditor\{grid-template-columns:1fr\}/);
  assert.match(css,/\.amazonMappingModalBody\{[\s\S]*overflow:auto/);
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
