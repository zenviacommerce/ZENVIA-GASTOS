import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('maintenance exposes read-only duplicate detectors with evidence and confidence',async()=>{
  const source=await read('src/services/maintenance.ts');
  for(const name of ['findSupplierDuplicates','findClientDuplicates','findProductDuplicates','findInvoiceDuplicates'])assert.match(source,new RegExp(name));
  assert.match(source,/confidence/);
  assert.match(source,/evidence/);
  assert.match(source,/same_tax_id/);
  assert.match(source,/same_normalized_name/);
  assert.match(source,/same_supplier_invoice_number/);
});

test('supplier and client merges go through explicit transactional RPCs',async()=>{
  const source=await read('src/services/maintenance.ts');
  assert.match(source,/configuration_merge_supplier/);
  assert.match(source,/configuration_merge_client/);
  assert.match(source,/previewSupplierMerge/);
  assert.match(source,/previewClientMerge/);
  const sql=await read('supabase/migrations/20260921110000_configuration_maintenance_rpcs.sql');
  assert.match(sql,/private\.app_is_admin\(\)/);
  assert.match(sql,/configuration_merge_supplier/);
  assert.match(sql,/configuration_merge_client/);
  assert.match(sql,/delete from public\.suppliers/);
  assert.match(sql,/delete from public\.clients/);
});

test('maintenance does not expose automatic product or invoice merge',async()=>{
  const source=await read('src/services/maintenance.ts');
  assert.doesNotMatch(source,/mergeProduct\s*\(/);
  assert.doesNotMatch(source,/mergeInvoice\s*\(/);
});

test('maintenance includes safe diagnostics and explicit sync actions',async()=>{
  const source=await read('src/services/maintenance.ts');
  for(const name of ['listSuppliersMissingTaxId','listClientsMissingTaxId','listProductsWithoutCost','runSendcloudSync','runAmazonSync'])assert.match(source,new RegExp(name));
});

test('Settings maintenance UI requires preview and confirmation before merge',async()=>{
  const page=await read('src/pages/Settings.tsx');
  assert.match(page,/function MaintenanceSection/);
  assert.match(page,/Vista previa/);
  assert.match(page,/confirm/i);
  assert.match(page,/Fusionar proveedor/);
  assert.match(page,/Fusionar cliente/);
});


test('maintenance exposes preview/apply actions for the remaining approved repair tools',async()=>{
  const source=await read('src/services/maintenance.ts');
  for(const name of [
    'previewProductCostRecalculation','recalculateProductCosts',
    'previewSupplierProductRebuild','rebuildSupplierProductLinks',
    'previewPriceHistoryRebuild','rebuildPriceHistoryLinks',
    'previewExpenseInvoiceReprocess','applyExpenseInvoiceReprocess'
  ]) assert.match(source,new RegExp(name),name);
  const sql=await read('supabase/migrations/20260921114500_configuration_maintenance_repairs.sql');
  for(const rpc of [
    'configuration_recalculate_product_costs',
    'configuration_rebuild_supplier_product_links',
    'configuration_rebuild_price_history_links',
    'configuration_apply_invoice_reprocess'
  ]) assert.match(sql,new RegExp(rpc),rpc);
  assert.match(sql,/private\.app_is_admin\(\)/);
  assert.match(sql,/audit_logs/);
});

test('repair RPCs preview without mutating and apply only explicitly',async()=>{
  const sql=await read('supabase/migrations/20260921114500_configuration_maintenance_repairs.sql');
  assert.match(sql,/p_apply boolean default false/);
  assert.match(sql,/if not p_apply then/i);
  assert.doesNotMatch(sql,/delete from public\.product_price_history/i);
});
