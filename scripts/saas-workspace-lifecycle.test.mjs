import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('tenant RLS separates membership visibility from operational workspace access',async()=>{
  const sql=await read('supabase/migrations/20260925173500_workspace_lifecycle_enforcement.sql');
  assert.match(sql,/create or replace function private\.app_membership_workspace_id/);
  assert.match(sql,/w\.status in \('active','trialing'\)/);
  assert.match(sql,/workspaces_member_select[\s\S]*app_membership_workspace_id/);
  assert.match(sql,/workspace_subscriptions_member_select[\s\S]*app_membership_workspace_id/);
});

test('Platform bridge can suspend, cancel and reactivate workspaces',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/action==='update_workspace'/);
  assert.match(bridge,/\['active','trialing','suspended','cancelled'\]\.includes\(status\)/);
  assert.match(bridge,/previousStatus:workspace\.status/);
});

test('customer app blocks suspended and cancelled workspaces before rendering business pages',async()=>{
  const app=await read('src/App.tsx');
  assert.match(app,/!\['active','trialing'\]\.includes\(access\.workspaceStatus\)/);
  assert.match(app,/Empresa suspendida/);
  assert.match(app,/Servicio cancelado/);
  assert.match(app,/Contacta con soporte/);
});


test('privileged tenant Edge Functions reject inactive workspaces',async()=>{
  const sources=await Promise.all([
    read('supabase/functions/_shared/amazon/supabase.ts'),
    read('supabase/functions/admin-users/index.ts'),
    read('supabase/functions/integration-accounts/index.ts'),
    read('supabase/functions/sendcloud-orders/index.ts'),
    read('supabase/functions/sendcloud-order-tools/index.ts'),
  ]);
  for(const source of sources){
    assert.match(source,/\['active','trialing'\]\.includes\(workspace\.status\)/);
    assert.match(source,/El acceso de tu empresa está suspendido/);
  }
});
