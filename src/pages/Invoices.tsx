import { useEffect, useMemo, useState } from 'react';
import { Download, Search, Camera, FileUp, CheckCircle2, CircleDollarSign, Eye, Trash2, AlertCircle } from 'lucide-react';
import type { Invoice, Supplier } from '../types';
import { exportInvoices } from '../services/exportQuarter';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { InvoiceFilters } from '../components/InvoiceFilters';
import { Pagination } from '../components/Pagination';
import { defaultInvoiceFilter, filterInvoices, periodLabel, safeExportLabel } from '../services/filters';

const PAGE_SIZE=20;

export function Invoices({invoices,suppliers,onUpload,onStatusChange,onOpenFile,onDelete,onSupplierChange}:{invoices:Invoice[];suppliers:Supplier[];onUpload:()=>void;onStatusChange:(id:string,status:'pending'|'reviewed'|'accounted')=>Promise<void>;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoiceId:string,supplierId:string)=>Promise<void>}){
 const [query,setQuery]=useState(''); const [exporting,setExporting]=useState(false);
 const [filter,setFilter]=useState(defaultInvoiceFilter);
 const [selected,setSelected]=useState<Invoice|null>(null);
 const [busyId,setBusyId]=useState<string|null>(null);
 const [actionError,setActionError]=useState('');
 const [page,setPage]=useState(1);
 const filtered=useMemo(()=>{
   const periodFiltered=filterInvoices(invoices,filter);
   const q=query.trim().toLowerCase();
   return !q?periodFiltered:periodFiltered.filter(i=>[i.supplierName,i.invoiceNumber,i.category].some(v=>v.toLowerCase().includes(q)));
 },[invoices,query,filter]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
 const paged=useMemo(()=>filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[filtered,page]);
 useEffect(()=>{setPage(1)},[query,filter]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 const selectedSupplier=suppliers.find(s=>s.id===filter.supplierId);
 const selectionLabel=`${periodLabel(filter)}${selectedSupplier?` · ${selectedSupplier.name}`:''}`;
 const doExport=async()=>{setExporting(true);setActionError('');try{const blob=await exportInvoices(filtered,selectionLabel);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`ZENVIA_Gastos_${safeExportLabel(selectionLabel)||'seleccion'}.zip`;a.click();URL.revokeObjectURL(url);}catch(e){setActionError(e instanceof Error?e.message:'No se pudo preparar la exportación.')}finally{setExporting(false)}};
 const openFile=async(invoice:Invoice)=>{setActionError('');try{await onOpenFile(invoice)}catch(e){setActionError(e instanceof Error?e.message:'No se pudo abrir el documento.')}};
 const remove=async(invoice:Invoice)=>{
   if(!window.confirm(`¿Eliminar la factura ${invoice.invoiceNumber==='—'?'seleccionada':invoice.invoiceNumber} de ${invoice.supplierName}? Esta acción no se puede deshacer.`)) return;
   setActionError(''); setBusyId(invoice.id);
   try{await onDelete(invoice);if(selected?.id===invoice.id)setSelected(null)}catch(e){setActionError(e instanceof Error?e.message:'No se pudo eliminar la factura.')}finally{setBusyId(null)}
 };
 const changeSupplier=async(invoice:Invoice,supplierId:string)=>{
   setActionError('');setBusyId(invoice.id);
   try{
     await onSupplierChange(invoice.id,supplierId);
     const supplier=suppliers.find(s=>s.id===supplierId);
     if(supplier)setSelected(current=>current?.id===invoice.id?{...current,supplierId,supplierName:supplier.name}:current);
   }catch(e){
     const text=e instanceof Error?e.message:'No se pudo cambiar el proveedor de la factura.';
     setActionError(text);
     throw e;
   }finally{setBusyId(null)}
 };
 return <div className="page"><div className="pageHead"><div><div className="eyebrow">DOCUMENTACIÓN · {periodLabel(filter)}</div><h1>Facturas de gastos</h1><p>Consulta el histórico completo, filtra y exporta cualquier periodo.</p></div><div className="actions"><button className="secondary" onClick={doExport} disabled={exporting||!filtered.length}><Download size={17}/> {exporting?'Preparando…':`Exportar (${filtered.length})`}</button><button className="primary" onClick={onUpload}>+ Nueva factura</button></div></div>
 <InvoiceFilters filter={filter} onChange={setFilter} invoices={invoices} suppliers={suppliers}/>
 <div className="toolbar invoiceSearchToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar proveedor, nº factura, categoría…"/></div><span className="filterResultCount">{filtered.length} factura{filtered.length===1?'':'s'} · {selectionLabel}</span></div>
 {actionError&&<div className="errorBox tableError"><AlertCircle size={18}/>{actionError}</div>}
 <section className="card tableCard">{filtered.length?<><table><thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Categoría</th><th>Origen</th><th>Estado</th><th className="right">Total</th><th className="right">Acciones</th></tr></thead><tbody>{paged.map(i=><tr key={i.id} className="clickableRow" onClick={()=>setSelected(i)}><td>{new Date(`${i.invoiceDate}T12:00:00`).toLocaleDateString('es-ES')}</td><td><strong>{i.supplierName}</strong></td><td>{i.invoiceNumber}</td><td><span className="tag">{i.category}</span></td><td>{i.source==='camera'?<><Camera size={14}/> Cámara</>:i.source==='manual'?<><FileUp size={14}/> Archivo</>:'Gmail'}</td><td><div className="statusActions" onClick={e=>e.stopPropagation()}><button title="Pendiente" className={i.status==='pending'?'statusBtn active warnBtn':'statusBtn'} onClick={()=>onStatusChange(i.id,'pending')}>P</button><button title="Revisada" className={i.status==='reviewed'?'statusBtn active okBtn':'statusBtn'} onClick={()=>onStatusChange(i.id,'reviewed')}><CheckCircle2 size={13}/></button><button title="Contabilizada" className={i.status==='accounted'?'statusBtn active accountBtn':'statusBtn'} onClick={()=>onStatusChange(i.id,'accounted')}><CircleDollarSign size={13}/></button></div></td><td className="right"><strong>{i.total.toLocaleString('es-ES',{minimumFractionDigits:2})} €</strong></td><td className="right"><div className="invoiceActions" onClick={e=>e.stopPropagation()}><button className="iconBtn" title="Abrir factura" disabled={!i.filePath} onClick={()=>openFile(i)}><Eye size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar factura" disabled={busyId===i.id} onClick={()=>remove(i)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table><Pagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage}/></>:<div className="emptyState large">No hay facturas para los filtros seleccionados.</div>}</section>
 <InvoiceDetailModal invoice={selected} suppliers={suppliers} onClose={()=>setSelected(null)} onOpenFile={openFile} onDelete={remove} onSupplierChange={changeSupplier} deleting={busyId===selected?.id}/>
 </div>
}
