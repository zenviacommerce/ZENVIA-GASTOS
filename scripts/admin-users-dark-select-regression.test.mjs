import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('managed users are loaded through a database RPC instead of the Edge Function list action', async () => {
  const access = await source('src/services/access.ts');
  assert.match(access, /supabase\.rpc\(['"]list_managed_users['"]\)/);
});

test('managed user list RPC is admin-only, workspace-scoped and preserves last sign-in data', async () => {
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const names = await readdir(migrationDir);
  const migrations = await Promise.all(
    names.filter(name => name.endsWith('.sql')).map(name => readFile(new URL(name, migrationDir), 'utf8')),
  );
  const sql = migrations.join('\n');

  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.list_managed_users\s*\(\s*\)/i);
  assert.match(sql, /private\.app_is_admin\s*\(\s*\)/i);
  assert.match(sql, /data_owner_id\s*=\s*private\.app_workspace_owner_id\s*\(\s*\)/i);
  assert.match(sql, /join\s+auth\.users/i);
  assert.match(sql, /last_sign_in_at/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.list_managed_users\s*\(\s*\)\s+to\s+authenticated/i);
});

test('normalized SelectField trigger and menu have explicit dark-mode surfaces', async () => {
  const css = await source('src/shared-forms.css');
  assert.match(css, /html\[data-theme=['"]dark['"]\][^{]*\.searchableSelectTrigger[^{]*\{[^}]*background[^}]*#0f172a/is);
  assert.match(css, /html\[data-theme=['"]dark['"]\][^{]*\.searchableSelectMenu[^{]*\{[^}]*background[^}]*#111827/is);
  assert.match(css, /html\[data-theme=['"]dark['"]\][^{]*\.searchableSelectOption[^\{]*\.isActive[^{]*\{[^}]*background[^}]*#172033/is);
});
