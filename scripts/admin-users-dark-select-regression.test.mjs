import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('managed users keep using the existing admin-users Edge Function list action', async () => {
  const access = await source('src/services/access.ts');
  assert.match(access, /invokeAdmin<\{\s*users:\s*ManagedUser\[\]\s*\}>\(\{\s*action:\s*['"]list['"]\s*\}\)/s);
  assert.doesNotMatch(access, /supabase\.rpc\(['"]list_managed_users['"]\)/);
});

test('normalized SelectField trigger and menu have explicit dark-mode surfaces', async () => {
  const css = await source('src/shared-forms.css');
  assert.match(css, /html\[data-theme=['"]dark['"]\][^{]*\.searchableSelectTrigger[^{]*\{[^}]*background[^}]*#0f172a/is);
  assert.match(css, /html\[data-theme=['"]dark['"]\][^{]*\.searchableSelectMenu[^{]*\{[^}]*background[^}]*#111827/is);
  assert.match(css, /html\[data-theme=['"]dark['"]\][^{]*\.searchableSelectOption[^\{]*\.isActive[^{]*\{[^}]*background[^}]*#172033/is);
});
