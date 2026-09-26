import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Platform bridge exposes complete customer onboarding detail',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/action==='workspace_detail'/);
  assert.match(bridge,/from\('business_settings'\)/);
  assert.match(bridge,/from\('company_branding'\)/);
  assert.match(bridge,/from\('integration_accounts'\)/);
  assert.match(bridge,/from\('app_users'\)/);
});

test('Platform bridge can maintain customer profile branding and users',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/action==='update_workspace_profile'/);
  assert.match(bridge,/action==='prepare_workspace_logo'/);
  assert.match(bridge,/action==='finalize_workspace_logo'/);
  assert.match(bridge,/action==='invite_workspace_user'/);
  assert.match(bridge,/action==='update_workspace_user'/);
  assert.match(bridge,/action==='delete_workspace_user'/);
  assert.match(bridge,/loadUserLimit/);
});

test('plan configuration persists commercial metadata and entitlements',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  assert.match(bridge,/sortOrder/);
  assert.match(bridge,/metadata/);
  assert.match(bridge,/trialDays/);
  assert.match(bridge,/entitlements/);
});
