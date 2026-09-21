import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=(path)=>readFile(new URL(path,import.meta.url),'utf8');

test('Facturación settings exposes every operational sales default',async()=>{
  const page=await read('../src/pages/Settings.tsx');
  assert.match(page,/function SalesSection/);
  for(const label of [
    'Vencimiento por defecto','Método de pago por defecto','IVA por defecto',
    'Serie por defecto','Registro IVA por defecto','Notas por defecto',
    'Mostrar IBAN','Mostrar datos fiscales','Mostrar vencimiento','Mostrar método de pago',
    'Permitir cobros parciales','Marcar automáticamente como cobrada','Permitir editar facturas emitidas'
  ]) assert.match(page,new RegExp(label,'i'),label);
  assert.match(page,/updateSection\('sales'/);
  assert.match(page,/loadManagedSalesSeries/);
  assert.match(page,/loadTaxRegistrations/);
});

test('new invoices consume configured sales defaults instead of hidden literals',async()=>{
  const core=await read('../src/pages/SalesInvoicesCore.tsx');
  assert.match(core,/settings\.sales\.defaultVatRate/);
  assert.match(core,/clientDefaultPaymentMethod/);
  assert.match(core,/sales\.defaultPaymentMethod/);
  assert.match(core,/settings\.sales\.defaultNotes/);
  assert.match(core,/settings\.sales\.defaultSeriesId/);
  assert.match(core,/settings\.sales\.defaultTaxRegistrationId/);
  assert.doesNotMatch(core,/setPaymentMethod\('Transferencia bancaria'\)/);
  assert.match(core,/allowPartialPayments/);
  assert.match(core,/allowEditIssuedInvoices/);
});

test('invoice PDF visibility is driven by sales settings',async()=>{
  const pdf=await read('../src/services/salesInvoicePdf.ts');
  assert.match(pdf,/SalesSettings/);
  assert.match(pdf,/showIbanOnPdf/);
  assert.match(pdf,/showFiscalDataOnPdf/);
  assert.match(pdf,/showDueDateOnPdf/);
  assert.match(pdf,/showPaymentMethodOnPdf/);
});

test('database enforces partial payment auto-paid and issued-edit settings',async()=>{
  const sql=await read('../supabase/migrations/20260921090000_configurable_sales_behavior.sql');
  assert.match(sql,/sales_setting_boolean/i);
  assert.match(sql,/allowPartialPayments/);
  assert.match(sql,/autoMarkPaid/);
  assert.match(sql,/allowEditIssuedInvoices/);
  assert.match(sql,/sync_sales_payment_status/i);
  assert.match(sql,/guard_sales_invoice_immutable/i);
  assert.match(sql,/mark_sales_invoice_paid/i);
});
