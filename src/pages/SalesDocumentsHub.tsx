import { useState } from 'react';
import { FileText, ReceiptText } from 'lucide-react';
import { SalesInvoices } from './SalesInvoices';
import { SalesReceipts } from './SalesReceipts';
import '../sales-receipts.css';

export function SalesDocumentsHub(){
  const [section,setSection]=useState<'invoices'|'receipts'>('invoices');
  return <>
    <div className="salesDocumentTabs" role="tablist" aria-label="Documentos de venta">
      <button type="button" role="tab" aria-selected={section==='invoices'} className={section==='invoices'?'active':''} onClick={()=>setSection('invoices')}><FileText size={16}/> Facturas</button>
      <button type="button" role="tab" aria-selected={section==='receipts'} className={section==='receipts'?'active':''} onClick={()=>setSection('receipts')}><ReceiptText size={16}/> Recibos</button>
    </div>
    {section==='invoices'?<SalesInvoices/>:<SalesReceipts/>}
  </>;
}
