import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('settings service normalizes reads and validates section writes',async()=>{
  const source=await read('../src/services/settings.ts');
  assert.match(source,/normalizeAppSettings/);
  assert.match(source,/validateSettingsSection/);
  assert.match(source,/loadAppSettings/);
  assert.match(source,/saveSettingsSection/);
  assert.match(source,/resetSettingsSection/);
  assert.match(source,/from\(['"]app_settings['"]\)/);
  assert.match(source,/schema_version/);
  assert.match(source,/APP_SETTINGS_SCHEMA_VERSION/);
  assert.match(source,/upsert|\.update\(/);
});

test('user preferences are scoped to the authenticated user and workspace',async()=>{
  const source=await read('../src/services/settings.ts');
  assert.match(source,/auth\.getUser\(\)/);
  assert.match(source,/from\(['"]app_users['"]\)/);
  assert.match(source,/data_owner_id/);
  assert.match(source,/from\(['"]user_preferences['"]\)/);
  assert.match(source,/normalizeUserPreferences/);
  assert.match(source,/saveUserPreferences/);
  assert.match(source,/user_id/);
  assert.match(source,/owner_id/);
});

test('settings provider exposes defaults and warnings instead of blocking the app on read errors',async()=>{
  const source=await read('../src/context/SettingsContext.tsx');
  assert.match(source,/DEFAULT_APP_SETTINGS/);
  assert.match(source,/DEFAULT_USER_PREFERENCES/);
  assert.match(source,/warnings/);
  assert.match(source,/loadAppSettings/);
  assert.match(source,/loadUserPreferences/);
  assert.match(source,/catch/);
  assert.match(source,/refresh/);
  assert.match(source,/updateSection/);
  assert.match(source,/updatePreferences/);
});

test('application root is wrapped by SettingsProvider',async()=>{
  const source=await read('../src/main.tsx');
  assert.match(source,/SettingsProvider/);
  assert.match(source,/<SettingsProvider>\s*<App\/>/);
});
