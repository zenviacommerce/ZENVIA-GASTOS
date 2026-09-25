import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('integration creation enforces configured SaaS entitlements and Amazon account limits',async()=>{
  const source=await read('supabase/functions/integration-accounts/index.ts');
  assert.match(source,/requireWorkspaceEntitlement/);
  assert.match(source,/integration\.amazon/);
  assert.match(source,/integration\.sendcloud/);
  assert.match(source,/integration\.gmail/);
  assert.match(source,/enforceWorkspaceLimit/);
  assert.match(source,/amazon_accounts/);
  assert.match(source,/Has alcanzado el límite de \$\{limit\} cuentas Amazon/);
});

test('shared entitlement helper is backwards compatible when limits are not configured',async()=>{
  const source=await read('supabase/functions/_shared/saas/entitlements.ts');
  assert.match(source,/configured:false,enabled:true,limit:null/);
  assert.match(source,/entitlement\.enabled!==false/);
  assert.match(source,/currentUsage>=entitlement\.limit/);
});

test('Platform bridge exposes users, Amazon accounts and monthly order usage with limits',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/monthlyOrders:\{value:monthlyOrders,limit:limitFor\(row\.id,'monthly_orders'\)\}/);
  assert.match(bridge,/users:\{value:usersForWorkspace\.active,limit:limitFor\(row\.id,'users'\)\}/);
  assert.match(bridge,/amazonAccounts:\{value:amazonForWorkspace,limit:limitFor\(row\.id,'amazon_accounts'\)\}/);
  assert.match(bridge,/select\('owner_id,id,status'\)/);
  assert.match(bridge,/row\.status!=='disabled'/);
  assert.doesNotMatch(bridge,/amazon_accounts'\)\.select\('owner_id,id,active'\)/);
});
