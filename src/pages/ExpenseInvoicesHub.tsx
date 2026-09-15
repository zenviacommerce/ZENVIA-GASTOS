import { useState } from 'react';
import { FileText, Mail } from 'lucide-react';
import type { ExpenseCategory, Invoice, Supplier } from '../types';
import { Invoices } from './Invoices';
import { GmailPage } from './Gmail';

export function ExpenseInvoicesHub({invoices,suppliers,categories,onUpload,onStatusChange,onOpenFile,onDelete,onSupplierChange,onCategoryChange,onImported}:{invoices:Invoice[];suppliers:Supplier[];categories:ExpenseCategory[];onUpload:()=>void;onStatusChange:(id:string,status:'pending'|'reviewed'|'accounted')=>Promise<void>;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoiceId:string,supplierId:string)=>Promise<void>;onCategoryChange:(invoiceId:string,categoryId:string)=>Promise<void>;onImported:()=>Promise<void>|void}){
 const [tab,setTab]=useState<'invoices'|'gmail'>('invoices');
 return <div className="expenseInvoicesHub">
   <div className="expenseHubNavShell">
     <div className="expenseHubNav" role="tablist" aria-label="Facturas de gastos">
       <button role="tab" aria-selected={tab==='invoices'} className={tab==='invoices'?'active':''} onClick={()=>setTab('invoices')}>
         <span className="expenseHubTabIcon"><FileText size={18}/></span>
         <span className="expenseHubTabText"><strong>Facturas</strong><small>Histórico, filtros y exportación</small></span>
       </button>
       <button role="tab" aria-selected={tab==='gmail'} className={tab==='gmail'?'active':''} onClick={()=>setTab('gmail')}>
         <span className="expenseHubTabIcon"><Mail size={18}/></span>
         <span className="expenseHubTabText"><strong>Importar con Gmail</strong><small>Buscar y añadir facturas recibidas</small></span>
       </button>
     </div>
   </div>
   {tab==='invoices'?<Invoices invoices={invoices} suppliers={suppliers} categories={categories} onUpload={onUpload} onStatusChange={onStatusChange} onOpenFile={onOpenFile} onDelete={onDelete} onSupplierChange={onSupplierChange} onCategoryChange={onCategoryChange}/>:<GmailPage categories={categories} onImported={onImported}/>} 
 </div>
}
