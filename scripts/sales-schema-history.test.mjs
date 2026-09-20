import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url);

test('sales and business schema has a reproducible baseline before later sales migrations', async () => {
  const files = (await readdir(migrationsUrl)).filter(name => name.endsWith('.sql')).sort();
  const baseline = files.find(name => name.includes('sales_module_baseline'));
  assert.ok(baseline, 'missing sales_module_baseline migration');
  assert.ok(
    baseline.localeCompare('20260917125000_sales_invoice_number_edit.sql') < 0,
    'sales baseline must run before later sales migrations',
  );

  const sql = await readFile(new URL(baseline, migrationsUrl), 'utf8');
  for (const table of [
    'business_settings',
    'clients',
    'sales_invoice_series',
    'sales_invoices',
    'sales_invoice_lines',
    'sales_payments',
    'sales_invoice_released_numbers',
    'company_branding',
    'business_tax_registrations',
    'integration_secrets',
  ]) {
    assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${table}\\b`, 'i'), `missing ${table}`);
  }
  for (const fn of [
    'sales_invoice_line_calculate',
    'recalculate_sales_invoice_totals',
    'guard_sales_invoice_line_edit',
    'guard_sales_invoice_immutable',
    'sync_sales_payment_status',
  ]) {
    assert.match(sql, new RegExp(`function private\\.${fn}\\b`, 'i'), `missing ${fn}`);
  }
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /app_workspace_owner_id\(\)/i);
});
