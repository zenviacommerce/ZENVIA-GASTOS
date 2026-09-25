import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('ZENVIA Platform uses its own Supabase project',async()=>{
  const source=await read('platform/src/supabase.ts');
  assert.match(source,/ucokhtztxozxcikrmidv\.supabase\.co/);
  assert.match(source,/sb_publishable_7KW1QyBGfFKB1FLaelFfAQ_DO8yGju0/);
  assert.doesNotMatch(source,/sjkxxbedkkmgmqnvaqjh\.supabase\.co/);
});

test('Platform backend authenticates independent internal users and permissions',async()=>{
  const source=await read('platform/supabase/functions/platform-admin/index.ts');
  assert.match(source,/from\('platform_users'\)/);
  assert.match(source,/from\('platform_role_permissions'\)/);
  assert.match(source,/from\('platform_user_permissions'\)/);
  assert.match(source,/gestionBridgeUrl/);
  assert.match(source,/x-platform-token/);
  assert.doesNotMatch(source,/from\('platform_admins'\)/);
});

test('Gestion exposes only a server-to-server Platform bridge',async()=>{
  const bridge=await read('supabase/functions/platform-bridge/index.ts');
  const notify=await read('supabase/functions/support-notify/index.ts');
  assert.match(bridge,/platform_bridge_secrets/);
  assert.match(bridge,/x-platform-token/);
  assert.match(bridge,/sha256\(supplied\)/);
  assert.match(notify,/x-platform-token/);
  assert.match(notify,/platform_bridge_secrets/);
});

test('Platform UI supports first activation and internal user management',async()=>{
  const app=await read('platform/src/App.tsx');
  const api=await read('platform/src/api.ts');
  assert.match(app,/Primera activación/);
  assert.match(app,/soporte@zenviacommerce\.com/);
  assert.match(app,/Usuarios de Platform/);
  assert.match(app,/permissionOverrides/);
  assert.match(api,/bootstrapInitial/);
  assert.match(api,/listUsers/);
  assert.match(api,/inviteUser/);
  assert.match(api,/updateUser/);
});

test('independent Platform schema defines roles permissions audit and locked secrets',async()=>{
  const core=await read('platform/supabase/migrations/20260925190000_platform_core.sql');
  const hardening=await read('platform/supabase/migrations/20260925191000_platform_core_hardening.sql');
  assert.match(core,/create table if not exists public\.platform_users/);
  assert.match(core,/create table if not exists public\.platform_roles/);
  assert.match(core,/create table if not exists public\.platform_permissions/);
  assert.match(core,/create table if not exists public\.platform_audit_logs/);
  assert.match(core,/create table if not exists public\.platform_secrets/);
  assert.match(hardening,/platform_secrets_no_client_access/);
  assert.match(hardening,/using \(false\)/);
});
