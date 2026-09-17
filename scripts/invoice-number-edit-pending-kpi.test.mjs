import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('invoice number is proposed and editable inside the create/edit invoice modal',()=>{
  const page=read('src/pages/SalesInvoices.tsx');
  const main=read('src/main.tsx');
  assert.match(page,/updateSalesInvoiceNumber/,'invoice modal must use the invoice-number update service');
  assert.match(page,/\[invoiceNumber,setInvoiceNumber\]/,'invoice modal must keep the editable number in modal state');
  assert.match(page,/Número de factura/,'invoice modal must show a Número de factura field');
  assert.match(page,/prefix.*nextNumber|nextNumber.*prefix/s,'invoice modal must propose the next number from the selected series');
  assert.match(page,/setInvoiceNumber\(e\.target\.value\)/,'invoice number field must be directly editable');
  assert.doesNotMatch(main,/SalesInvoiceNumberEditor/,'there must not be a separate invoice-numbering button/manager');
});

test('saving a draft persists the chosen number and issuance preserves it',()=>{
  const page=read('src/pages/SalesInvoices.tsx');
  const migrations=fs.readdirSync(path.join(root,'supabase/migrations')).filter(name=>/invoice_number/i.test(name));
  assert.ok(migrations.length>0,'an invoice-number migration must exist');
  const sql=migrations.map(name=>read(`supabase/migrations/${name}`)).join('\n');
  assert.match(page,/updateSalesInvoiceNumber\([^,]+,invoiceNumber\.trim\(\)\)/,'modal save must persist the chosen invoice number');
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
