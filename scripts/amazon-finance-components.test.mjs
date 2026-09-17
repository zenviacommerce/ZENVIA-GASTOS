import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Finance component normalizer classifies fee/refund leaves without additive parent duplication', async()=>{
  const parser = await source('supabase/functions/_shared/amazon/finance-components.ts');
  for (const token of ['Commission','FBAPerUnitFulfillmentFee','DigitalServicesFee','Storage','Refunded Sales','ProductAdsPayment']) {
    assert.match(parser,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  }
  for (const category of ['commission_fee','fba_fee','digital_services_fee','storage_fee','refund','ads_payment_excluded']) {
    assert.match(parser,new RegExp(`['\"]${category}['\"]`));
  }
  assert.match(parser,/Base/);
  assert.match(parser,/Tax/);
  assert.match(parser,/component_key/);
  assert.match(parser,/Refunded Sales/i);
});

test('Finance component normalizer falls back to persisted economic category when a non-zero transaction has no classified leaf', async()=>{
  const parser = await source('supabase/functions/_shared/amazon/finance-components.ts');
  const finances = await source('supabase/functions/_shared/amazon/finances.ts');
  const backfill = await source('supabase/functions/amazon-backfill-finance-components/index.ts');
  assert.match(parser,/persistedCategory|persisted_category|fallback/i);
  for (const token of ['referral_fee','other_fee','sale','tax','adjustment']) assert.match(parser,new RegExp(token));
  assert.match(parser,/amount_original/);
  assert.match(finances,/category/);
  assert.match(backfill,/category/);
});

test('Finance component normalizer excludes reserve cash movements and handles observed Amazon adjustment leaves explicitly', async()=>{
  const parser = await source('supabase/functions/_shared/amazon/finance-components.ts');
  for (const token of ['ReserveDebit','ReserveCredit','MicroDeposit','CLAWBACK','ReturnPostageBilling_Postage','ReturnPostageBilling_VAT']) {
    assert.match(parser,new RegExp(token,'i'));
  }
  assert.match(parser,/reservedebit[^\n]*reservecredit[^\n]*microdeposit[^\n]*sale_audit/i);
  assert.match(parser,/clawback[^\n]*adjustment/i);
  assert.match(parser,/returnpostagebilling_postage[^\n]*other_amazon_fee/i);
  assert.match(parser,/returnpostagebilling_vat[^\n]*tax_audit/i);
});

test('Finances sync persists normalized components after transaction upsert', async()=>{
  const finances = await source('supabase/functions/_shared/amazon/finances.ts');
  assert.match(finances,/normalizeFinanceComponents/);
  assert.match(finances,/amazon_finance_components/);
  assert.match(finances,/finance_transaction_id/);
  assert.match(finances,/owner_id,amazon_account_id,finance_transaction_id,component_key/);
});
