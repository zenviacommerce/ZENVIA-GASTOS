import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('settings export is versioned and contains all non-secret configuration families',async()=>{
  const source=await read('src/services/settingsExport.ts');
  assert.match(source,/zenvia-gestion-settings/);
  assert.match(source,/version:\s*1/);
  for(const field of ['businessSettings','branding','taxRegistrations','invoiceSeries','appSettings','aliases','shippingRules','automationRules'])assert.match(source,new RegExp(field),field);
});

test('settings export never reads secrets, sessions, tokens or binary branding',async()=>{
  const source=await read('src/services/settingsExport.ts');
  assert.doesNotMatch(source,/integration_secrets/i);
  assert.doesNotMatch(source,/getSession\s*\(/i);
  assert.doesNotMatch(source,/accessToken|refreshToken|service_role|anon_key|api[_-]?key|secret[_-]?key/i);
  assert.doesNotMatch(source,/logoDataUrl|storage\.from\([^)]*\)\.download/i);
  assert.match(source,/logo_path/);
});

test('global reset previews changed sections and leaves user preferences untouched',async()=>{
  const source=await read('src/services/settingsExport.ts');
  assert.match(source,/previewSettingsReset/);
  assert.match(source,/resetAllSettingsToDefaults/);
  assert.match(source,/DEFAULT_APP_SETTINGS/);
  assert.match(source,/app_settings/);
  assert.doesNotMatch(source,/user_preferences[^\n]*delete|delete[^\n]*user_preferences/i);
  assert.doesNotMatch(source,/DEFAULT_USER_PREFERENCES/);
});

test('Maintenance UI exposes configuration export and confirmed global reset',async()=>{
  const page=await read('src/pages/Settings.tsx');
  assert.match(page,/Exportar configuración/);
  assert.match(page,/Restaurar configuración global/);
  assert.match(page,/previewSettingsReset/);
  assert.match(page,/confirmAction/);
  assert.doesNotMatch(page,/window\.confirm/);
});


test('global reset is performed through an audited admin RPC',async()=>{
  const source=await read('src/services/settingsExport.ts');
  const sql=await read('supabase/migrations/20260921114500_configuration_maintenance_repairs.sql');
  assert.match(source,/configuration_reset_app_settings/);
  assert.match(sql,/configuration_reset_app_settings/);
  assert.match(sql,/private\.app_is_admin\(\)/);
  assert.match(sql,/audit_logs/);
});
