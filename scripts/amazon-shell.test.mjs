import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = async (path) => {
  try {
    return await readFile(new URL(path, import.meta.url), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
};

test('amazon is a first-class configurable permission', async () => {
  const [accessSource, adminUsersSource, migrationSource] = await Promise.all([
    read('../src/services/access.ts'),
    read('../supabase/functions/admin-users/index.ts'),
    read('../supabase/migrations/20260916170000_add_amazon_permission.sql'),
  ]);

  assert.match(accessSource, /export type MenuPermission[^;]*'amazon'/s);
  assert.match(accessSource, /id:\s*['"]amazon['"],\s*label:\s*['"]Amazon['"]/);
  assert.match(adminUsersSource, /allowedPermissions\s*=\s*\[[^\]]*['"]amazon['"]/s);

  for (const permission of ['dashboard', 'sales', 'orders', 'invoices', 'clients', 'products', 'suppliers', 'amazon']) {
    assert.match(migrationSource, new RegExp(`['"]${permission}['"]`));
  }
  assert.match(migrationSource, /app_users_permissions_check/);
});

test('amazon navigation and page shell stay permission-gated and safe', async () => {
  const [sidebarSource, appSource, amazonPageSource] = await Promise.all([
    read('../src/components/Sidebar.tsx'),
    read('../src/App.tsx'),
    read('../src/pages/Amazon.tsx'),
  ]);

  assert.match(sidebarSource, /export type Page[^;]*'amazon'/s);
  assert.match(sidebarSource, /\['amazon','Amazon','Amazon'/);
  assert.match(appSource, /regularPages[^;]*'amazon'/s);
  assert.match(appSource, /page===['"]amazon['"]&&can\(['"]amazon['"]\)/);
  assert.match(amazonPageSource, /Seller Central/);
  assert.match(amazonPageSource, /Sellerboard/);
  assert.match(amazonPageSource, /target=["']_blank["']/);
  assert.match(amazonPageSource, /rel=["']noopener noreferrer["']/);
});
