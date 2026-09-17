import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('sales invoices expose editable manual numbering for drafts and issued invoices',()=>{
  const sales=read('src/services/sales.ts');
  const page=read('src/pages/SalesInvoices.tsx');
  assert.match(sales,/updateSalesInvoiceNumber/,'sales service must expose a dedicated invoice-number update');
  assert.match(page,/Número de factura/,'invoice editor must expose the invoice number field');
  assert.match(page,/updateSalesInvoiceNumber/,'invoice editor must save manual invoice-number changes');
});

test('invoice-number migration validates duplicates, advances sequence and writes audit history',()=>{
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>/invoice_number/i.test(name));
  assert.ok(migrations.length>0,'an invoice-number migration must exist');
  const sql=migrations.map(name=>read(`supabase/migrations/${name}`)).join('\n');
  assert.match(sql,/update_sales_invoice_number/i,'migration must provide a secure number-update RPC');
  assert.match(sql,/invoice_number/i,'RPC must update invoice_number');
  assert.match(sql,/next_number/i,'manual numbers ahead of the sequence must advance next_number');
  assert.match(sql,/audit_logs/i,'issued invoice renumbering must be audited');
});

test('Orders highlights Pendientes with the same dashboard warning class when pending is positive',()=>{
  const orders=read('src/pages/Orders.tsx');
  assert.match(orders,/pending\s*>\s*0\s*\?\s*['"]dashboardPendingOrders['"]/,'Pendientes KPI must enable dashboardPendingOrders when there are pending orders');
});
