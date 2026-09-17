import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const salesPage=fs.readFileSync('src/pages/SalesInvoices.tsx','utf8');
const salesService=fs.readFileSync('src/services/sales.ts','utf8');
const ordersPage=fs.readFileSync('src/pages/Orders.tsx','utf8');
const migrationName=fs.readdirSync('supabase/migrations').find(name=>name.includes('sales_invoice_number_override'));

test('draft invoices expose an optional manual invoice number override',()=>{
  assert.match(salesPage,/Número de factura/);
  assert.match(salesPage,/manualInvoiceNumber/);
  assert.match(salesService,/manualInvoiceNumber\?: string/);
  assert.match(salesService,/manual_invoice_number/);
});

test('issued invoices can change their number through a guarded RPC',()=>{
  assert.match(salesService,/export async function updateSalesInvoiceNumber/);
  assert.match(salesService,/sales_update_invoice_number/);
  assert.ok(migrationName,'expected a sales_invoice_number_override migration');
  const sql=fs.readFileSync(`supabase/migrations/${migrationName}`,'utf8');
  assert.match(sql,/create or replace function public\.sales_update_invoice_number/i);
  assert.match(sql,/app\.allow_invoice_number_edit/);
  assert.match(sql,/audit_logs/i);
  assert.match(sql,/next_number/i);
});

test('orders pending KPI reuses the dashboard warning treatment when pending is positive',()=>{
  assert.match(ordersPage,/pending>0\?'dashboardPendingOrders':''/);
  assert.match(ordersPage,/<span>Pendientes<\/span>/);
});
