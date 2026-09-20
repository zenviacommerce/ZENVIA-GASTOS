import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url);

test('configuration center core schema is workspace-scoped and RLS protected', async () => {
  const files = (await readdir(migrationsUrl)).filter(name => name.endsWith('.sql')).sort();
  const migration = files.find(name => name.includes('configuration_center_core'));
  assert.ok(migration, 'missing configuration_center_core migration');

  const sql = await readFile(new URL(migration, migrationsUrl), 'utf8');
  for (const table of ['app_settings','user_preferences','entity_alias_rules','shipping_rules','automation_rules']) {
    assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i'), `missing ${table}`);
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `RLS not enabled for ${table}`);
  }

  assert.match(sql, /app_settings_workspace_select/i);
  assert.match(sql, /app_settings_admin_(?:insert|update|delete)/i);
  assert.match(sql, /private\.app_is_admin\(\)/i);
  assert.match(sql, /private\.app_is_active\(\)/i);

  assert.match(sql, /user_preferences[\s\S]*auth\.uid\(\)/i);
  assert.match(sql, /user_preferences[\s\S]*private\.app_workspace_owner_id\(\)/i);

  assert.match(sql, /entity_alias_rules[\s\S]*normalized_alias/i);
  assert.match(sql, /shipping_rules[\s\S]*priority/i);
  assert.match(sql, /automation_rules[\s\S]*rule_key/i);

  assert.match(sql, /audit_logs/i);
  assert.match(sql, /configuration/i);
  assert.match(sql, /create trigger audit_app_settings/i);

  const allSql = await Promise.all(files.map(name => readFile(new URL(name, migrationsUrl), 'utf8')));
  assert.match(allSql.join('\n'), /create index(?: if not exists)? user_preferences_owner_idx\s+on public\.user_preferences\s*\(owner_id,user_id\)/i);
});
