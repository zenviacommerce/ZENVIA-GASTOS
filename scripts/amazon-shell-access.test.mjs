import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Amazon is a configurable permission and is preserved by admin user management', async () => {
  const access = await source('src/services/access.ts');
  const adminUsers = await source('supabase/functions/admin-users/index.ts');

  assert.match(access, /MenuPermission[^\n]*'amazon'/);
  assert.match(access, /id:\s*'amazon',[^\n]*label:\s*'Amazon'/);
  assert.match(adminUsers, /allowedPermissions\s*=\s*\[[^\]]*'amazon'/s);
});

test('Amazon is a protected application page and sidebar destination', async () => {
  const app = await source('src/App.tsx');
  const sidebar = await source('src/components/Sidebar.tsx');

  assert.match(sidebar, /type Page[^\n]*'amazon'/);
  assert.match(sidebar, /\['amazon',\s*'Amazon'/);
  assert.match(app, /import\s+\{\s*AmazonPage\s*\}\s+from\s+'\.\/pages\/Amazon'/);
  assert.match(app, /regularPages[^\n]*'amazon'/);
  assert.match(app, /page==='amazon'&&can\('amazon'\)&&<AmazonPage/);
});

test('Amazon shell shows connection state and opens Seller Central and Sellerboard safely', async () => {
  const amazon = await source('src/pages/Amazon.tsx');

  assert.match(amazon, /Estado de conexión/);
  assert.match(amazon, /Pendiente de configurar/);
  assert.match(amazon, /Seller Central/);
  assert.match(amazon, /Sellerboard/);
  assert.match(amazon, /target="_blank"/);
  assert.match(amazon, /rel="noopener noreferrer"/);
});

test('the effective app_users permission constraint keeps current permissions and adds amazon', async () => {
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const names = await readdir(migrationDir);
  const migrations = await Promise.all(
    names.filter(name => name.endsWith('.sql')).map(name => readFile(new URL(name, migrationDir), 'utf8')),
  );
  const sourceText = migrations.join('\n');

  assert.match(sourceText, /app_users_permissions_check/);
  assert.match(
    sourceText,
    /array\['dashboard','sales','orders','invoices','clients','products','suppliers','amazon'\]::text\[\]/,
  );
});
