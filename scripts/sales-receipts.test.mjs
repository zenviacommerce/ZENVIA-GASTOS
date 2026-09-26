import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('sales hub exposes invoices and receipts without duplicating the sales engine',async()=>{
  const [hub,receipts,sales]=await Promise.all([
    read('src/pages/SalesDocumentsHub.tsx'),
    read('src/pages/SalesReceipts.tsx'),
    read('src/services/sales.ts'),
  ]);
  assert.match(hub,/Facturas/);
  assert.match(hub,/Recibos/);
  assert.match(receipts,/loadSalesInvoices/);
  assert.match(receipts,/addSalesPayment/);
  assert.match(receipts,/ProductCatalogPicker/);
  assert.match(receipts,/SelectField/);
  assert.match(receipts,/SearchableSelect/);
  assert.match(sales,/documentKind: 'invoice' \| 'receipt'/);
  assert.match(sales,/createSalesReceiptDraft/);
  assert.match(sales,/issueSalesReceipt/);
});

test('receipts have their own series and explicit fiscal treatment',async()=>{
  const [sales,migration]=await Promise.all([
    read('src/services/sales.ts'),
    read('supabase/migrations/20260926150000_sales_receipts.sql'),
  ]);
  assert.match(sales,/code:'REC'/);
  assert.match(sales,/prefix:\`REC-\$\{year\}-\`/);
  assert.match(migration,/fiscal_treatment/);
  assert.match(migration,/taxable','exempt','non_taxable','out_of_scope/);
  assert.match(migration,/issue_sales_receipt/);
  assert.match(migration,/Los recibos exentos o no sujetos deben tener IVA 0 %/);
  assert.match(migration,/Indica el motivo fiscal/);
});

test('invoice screens stay scoped to invoices after receipts are introduced',async()=>{
  const [wrapper,core]=await Promise.all([
    read('src/pages/SalesInvoices.tsx'),
    read('src/pages/SalesInvoicesCore.tsx'),
  ]);
  assert.match(wrapper,/documentKind==='invoice'/);
  assert.match(core,/documentKind==='invoice'/);
});

test('receipt UI supports draft issue collection deletion and PDF',async()=>{
  const [page,pdf]=await Promise.all([
    read('src/pages/SalesReceipts.tsx'),
    read('src/services/salesReceiptPdf.ts'),
  ]);
  assert.match(page,/Guardar borrador/);
  assert.match(page,/Emitir recibo/);
  assert.match(page,/Marcar cobrado/);
  assert.match(page,/deleteSalesReceiptDraft/);
  assert.match(page,/createSalesReceiptPdfBlob/);
  assert.match(pdf,/RECIBO/);
  assert.match(pdf,/Tratamiento fiscal/);
});
