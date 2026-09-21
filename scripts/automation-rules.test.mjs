import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('automation rules allow only the two approved event keys',async()=>{
  const source=await read('src/services/automationRules.ts');
  assert.match(source,/order_label_created/);
  assert.match(source,/expense_invoice_imported/);
  assert.match(source,/Unknown automation rule key|Regla de automatización no permitida/i);
});

test('order label automation has independent controlled flags',async()=>{
  const source=await read('src/services/automationRules.ts');
  for(const flag of ['saveTracking','pushToMarketplace','markSent','downloadPdf','retryConfirmation'])assert.match(source,new RegExp(flag),flag);
  assert.match(source,/ORDER_LABEL_CONFIG_KEYS/);
});

test('expense import automation only exposes implemented post-import actions',async()=>{
  const source=await read('src/services/automationRules.ts');
  for(const flag of ['updateProductCosts','updatePriceHistory','createSupplierProductRelation'])assert.match(source,new RegExp(flag),flag);
  assert.match(source,/EXPENSE_IMPORT_CONFIG_KEYS/);
});

test('unknown automation config properties are rejected and missing rows use defaults',async()=>{
  const source=await read('src/services/automationRules.ts');
  assert.match(source,/unknownKeys/);
  assert.match(source,/throw new Error/);
  assert.match(source,/DEFAULT_AUTOMATION_RULES/);
  assert.match(source,/rowsByKey\.get\(key\)\|\|DEFAULT_AUTOMATION_RULES\[key\]/);
});

test('order and expense consumers load their automation rules',async()=>{
  const orders=await read('src/services/orders.ts');
  const repository=await read('src/services/repository.ts');
  assert.match(orders,/loadAutomationRule\('order_label_created'\)/);
  assert.match(repository,/loadAutomationRule\('expense_invoice_imported'\)/);
});

test('settings exposes controlled automation rule editor without generic scripts',async()=>{
  const page=await read('src/pages/Settings.tsx');
  assert.match(page,/Automatización tras crear etiqueta/);
  assert.match(page,/Automatización tras importar gasto/);
  assert.match(page,/saveAutomationRule/);
  assert.doesNotMatch(page,/script editor|javascript|custom action code/i);
});
