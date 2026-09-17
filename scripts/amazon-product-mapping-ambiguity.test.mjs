import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function optionalSource(path){
  try{return await readFile(new URL(`../${path}`,import.meta.url),'utf8');}
  catch{return '';}
}

test('Amazon product mapping RPC keeps public argument names but removes seller_sku ambiguity',async()=>{
  const sql=await optionalSource('supabase/migrations/20260917006400_amazon_product_mapping_ambiguity.sql');
  assert.match(sql,/create\s+or\s+replace\s+function\s+public\.amazon_set_product_mapping\s*\(\s*seller_sku\s+text\s*,\s*product_id\s+uuid\s*,\s*consumption_factor\s+numeric\s+default\s+1/i);
  assert.match(sql,/v_seller_sku\s+text/i);
  assert.match(sql,/v_seller_sku\s*:=\s*trim\(seller_sku\)/i);
  assert.match(sql,/on\s+conflict\s+on\s+constraint\s+amazon_product_mappings_owner_id_amazon_account_id_seller_s_key/i);
  assert.doesNotMatch(sql,/on\s+conflict\s*\([^)]*seller_sku[^)]*\)/i);
});

test('Amazon product unmapping RPC also uses an unambiguous local SKU variable',async()=>{
  const sql=await optionalSource('supabase/migrations/20260917006400_amazon_product_mapping_ambiguity.sql');
  assert.match(sql,/create\s+or\s+replace\s+function\s+public\.amazon_delete_product_mapping\s*\(\s*seller_sku\s+text\s*\)/i);
  assert.match(sql,/m\.seller_sku\s*=\s*v_seller_sku/i);
  assert.doesNotMatch(sql,/m\.seller_sku\s*=\s*trim\(seller_sku\)/i);
});
