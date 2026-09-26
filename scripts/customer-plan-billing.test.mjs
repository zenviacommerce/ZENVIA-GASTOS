import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Settings exposes an admin-only Plan and billing section',async()=>{
  const settings=await read('src/pages/Settings.tsx');
  assert.match(settings,/\| 'billing'/);
  assert.match(settings,/id:'billing',label:'Plan y facturación'/);
  assert.match(settings,/function BillingSection/);
  assert.match(settings,/Plan actual/);
  assert.match(settings,/Uso del plan/);
  assert.match(settings,/Planes disponibles/);
  assert.match(settings,/Solicitar cambio/);
  assert.match(settings,/active&&active\.id==='billing'\?<BillingSection/);
});

test('customer billing overview is loaded through an authenticated server endpoint',async()=>{
  const [service,backend]=await Promise.all([
    read('src/services/billing.ts'),
    read('supabase/functions/customer-billing/index.ts'),
  ]);
  assert.match(service,/functions\.invoke\('customer-billing'/);
  assert.match(service,/createSupportTicket/);
  assert.match(service,/Cambio de plan/);
  assert.match(backend,/auth\.getUser\(token\)/);
  assert.match(backend,/caller\.role!=='admin'/);
  assert.match(backend,/from\('billing_plans'\)/);
  assert.match(backend,/from\('plan_entitlements'\)/);
  assert.match(backend,/from\('workspace_subscriptions'\)/);
  assert.match(backend,/from\('app_users'\)/);
  assert.match(backend,/from\('amazon_accounts'\)/);
  assert.match(backend,/from\('fulfillment_orders'\)/);
});

test('internal plan is never offered as a customer selectable plan',async()=>{
  const service=await read('src/services/billing.ts');
  assert.match(service,/plan_key!=='internal'/);
  assert.match(service,/plan\.is_public/);
});

test('App passes the loaded SaaS access profile into Settings',async()=>{
  const app=await read('src/App.tsx');
  assert.match(app,/<SettingsPage isAdmin=\{access\.role==='admin'\} access=\{access\}\/>/);
});
