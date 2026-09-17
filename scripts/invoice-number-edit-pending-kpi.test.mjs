import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('sales invoices expose editable manual numbering for drafts and issued invoices',()=>{
  const service=read('src/services/salesInvoiceNumber.ts');
  const editor=read('src/components/SalesInvoiceNumberEditor.tsx');
  const main=read('src/main.tsx');
  assert.match(service,/updateSalesInvoiceNumber/,'numbering service must expose the invoice-number update');
  assert.match(service,/update_sales_invoice_number/,'numbering service must call the secure RPC');
  assert.match(editor,/Número de factura/,'numbering UI must expose the invoice number field');
  assert.match(editor,/updateSalesInvoiceNumber/,'numbering UI must save manual invoice-number changes');
  assert.match(editor,/statusLabel\(editing\.status\)/,'numbering UI must work independently of draft/issued status');
  assert.match(main,/SalesInvoiceNumberEditor/,'numbering manager must be mounted in the application');
});

test('invoice-number migration validates duplicates, preserves manual draft numbers, advances sequence and writes audit history',()=>{
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>/invoice_number/i.test(name));
  assert.ok(migrations.length>0,'an invoice-number migration must exist');
  const sql=migrations.map(name=>read(`supabase/migrations/${name}`)).join('\n');
  assert.match(sql,/update_sales_invoice_number/i,'migration must provide a secure number-update RPC');
  assert.match(sql,/Ya existe una factura con el número/i,'RPC must reject duplicate numbers');
  assert.match(sql,/next_number/i,'manual numbers ahead of the sequence must advance next_number');
  assert.match(sql,/audit_logs/i,'renumbering must be audited');
  assert.match(sql,/coalesce\(trim\(v_invoice\.invoice_number\),'\s*'\)<>''/,'issuing a draft must preserve a manually assigned number');
});

test('Orders highlights Pendientes with the same dashboard warning class when pending is positive',()=>{
  const enhancer=read('src/components/PendingOrdersKpiHighlight.tsx');
  const main=read('src/main.tsx');
  assert.match(enhancer,/dashboardPendingOrders/,'Pendientes KPI must reuse dashboardPendingOrders');
  assert.match(enhancer,/value>0/,'highlight must only be active when pending orders are positive');
  assert.match(main,/PendingOrdersKpiHighlight/,'pending KPI enhancer must be mounted in the application');
});
