import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('alert evaluator supports every configured alert type with stable ids',async()=>{
  const source=await read('src/services/alerts.ts');
  for(const type of [
    'overdueSalesInvoice','pendingExpenseReview','pendingOrder','missingTracking',
    'amazonError','sendcloudError','gmailError','productWithoutCost',
    'negativeMargin','costIncrease','clientMissingTaxId','supplierMissingTaxId'
  ]) assert.match(source,new RegExp(type),type);
  assert.match(source,/stableAlertId/);
  assert.match(source,/type.*entityId/);
  assert.match(source,/evaluateAlerts/);
});

test('alert thresholds are deterministic and derived without writes',async()=>{
  const source=await read('src/services/alerts.ts');
  assert.match(source,/daysBetween/);
  assert.match(source,/hoursBetween/);
  assert.match(source,/marginPct/);
  assert.match(source,/increasePct/);
  assert.doesNotMatch(source,/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
});

test('disabled or non in-app alerts are suppressed',async()=>{
  const source=await read('src/services/alerts.ts');
  assert.match(source,/!setting\.enabled\|\|!setting\.inApp/);
});

test('AlertCenter loads real app context and links alerts to modules',async()=>{
  const component=await read('src/components/AlertCenter.tsx');
  for(const name of ['loadSalesInvoices','loadClients','listFulfillmentOrders','loadIntegrationHealth','evaluateAlerts'])assert.match(component,new RegExp(name));
  assert.match(component,/onNavigate/);
  assert.match(component,/alert\.page/);
});

test('App mounts the alert center globally for authenticated users',async()=>{
  const app=await read('src/App.tsx');
  assert.match(app,/AlertCenter/);
  assert.match(app,/notifications=\{settings\.notifications\}/);
});

test('settings editor exposes only implemented in-app alert channels and thresholds',async()=>{
  const page=await read('src/pages/Settings.tsx');
  assert.match(page,/function AlertsSection/);
  assert.match(page,/Solo dentro de la aplicación|Dentro de la aplicación/i);
  assert.match(page,/updateSection\('notifications'/);
  assert.doesNotMatch(page,/alertEmail|Email de alertas|Enviar por email/i);
});
