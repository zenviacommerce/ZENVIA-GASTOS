import { useEffect, useMemo, useState } from 'react';
import { Download, Search, Camera, FileUp, CheckCircle2, CircleDollarSign, Eye, Trash2, Files, Euro, BadgeEuro, ReceiptText, Clock3, Calculator, Building2 } from 'lucide-react';
import type { ExpenseCategory, Invoice, Supplier } from '../types';
import { exportInvoices } from '../services/exportQuarter';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { InvoiceFilters } from '../components/InvoiceFilters';
import { Pagination } from '../components/Pagination';
import { StatCard } from '../components/StatCard';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { defaultInvoiceFilter, filterInvoices, periodLabel, safeExportLabel } from '../services/filters';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import { useSettings } from '../context/SettingsContext';
import { hiddenTableColumns, persistRememberedFilter, rememberedFilter } from '../services/uiPreferences';
import { formatAppDate, formatAppMoney } from '../services/formatting';


export function Invoices({invoices,suppliers,categories,onUpload,onBulkUpload,onStatusChange,onOpenFile,onDelete,onSupplierChange,onCategoryChange}:{invoices:Invoice[];suppliers:Supplier[];categories:ExpenseCategory[];onUpload:()=>void;onBulkUpload:()=>void;onStatusChange:(id:string,status:'pending'|'reviewed'|'accounted')=>Promise<void>;onOpenFile:(invoice:Invoice)=>Promise<void>;onDelete:(invoice:Invoice)=>Promise<void>;onSupplierChange:(invoiceId:string,supplierId:string)=>Promise<void>;onCategoryChange:(invoiceId:string,categoryId:string)=>Promise<void>}){
 const {settings,preferences,updatePreferences}=useSettings();
 const money=(value:number)=>formatAppMoney(value,settings.general.currencyCode,settings.general,{minimumFractionDigits:2,maximumFractionDigits:2});
 const pageSize=preferences.pageSize;
 const hiddenColumns=hiddenTableColumns(preferences,'expenses');
 const remembered=rememberedFilter<{query:string;filter:ReturnType<typeof defaultInvoiceFilter>}>(preferences,'expenses.filters',{query:'',filter:defaultInvoiceFilter(preferences.defaultPeriod)});
 const [query,setQuery]=useState(remembered.query); const [exporting,setExporting]=useState(false);
 const [filter,setFilter]=useState(remembered.filter);
 const [selected,setSelected]=useState<Invoice|null>(null);
 const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
 const [busyId,setBusyId]=useState<string|null>(null);
 const [bulkDeleting,setBulkDeleting]=useState(false);
 const [page,setPage]=useState(1);
 const filtered=useMemo(()=>{
   const periodFiltered=filterInvoices(invoices,filter);
   const q=query.trim().toLowerCase();
   return !q?periodFiltered:periodFiltered.filter(i=>[i.supplierName,i.invoiceNumber,i.category].some(v=>v.toLowerCase().includes(q)));
 },[invoices,query,filter]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const paged=useMemo(()=>filtered.slice((page-1)*pageSize,page*pageSize),[filtered,page]);
 useEffect(()=>{setPage(1);setCheckedIds(new Set())},[query,filter]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void persistRememberedFilter(preferences,updatePreferences,'expenses.filters',{query,filter})},350);return()=>window.clearTimeout(timer)},[query,filter,preferences.rememberFilters]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 const selectedSupplier=suppliers.find(s=>s.id===filter.supplierId);
 const selectedCategory=categories.find(category=>category.id===filter.categoryId);
 const statusLabels:Record<string,string>={pending:'Pendientes',reviewed:'Revisadas',accounted:'Contabilizadas'};
 const sourceLabels:Record<string,string>={manual:'Archivo / manual',camera:'Cámara',gmail:'Gmail'};
 const selectionLabel=[periodLabel(filter),selectedSupplier?.name,selectedCategory?.name,filter.status?statusLabels[filter.status]:null,filter.source?sourceLabels[filter.source]:null].filter(Boolean).join(' · ');
 const expenseTotal=filtered.reduce((sum,invoice)=>sum+invoice.total,0);
 const vatTotal=filtered.reduce((sum,invoice)=>sum+invoice.vat,0);
 const invoiceCount=filtered.length;
 const pendingReview=filtered.filter(invoice=>invoice.status==='pending').length;
 const averageTicket=invoiceCount?expenseTotal/invoiceCount:0;
 const supplierCount=new Set(filtered.map(invoice=>invoice.supplierId||invoice.supplierName)).size;
 const selectedRows=filtered.filter(invoice=>checkedIds.has(invoice.id));
 const allFilteredSelected=filtered.length>0&&filtered.every(invoice=>checkedIds.has(invoice.id));
 const toggleChecked=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
 const toggleAllFiltered=(checked:boolean)=>setCheckedIds(checked?new Set(filtered.map(invoice=>invoice.id)):new Set());
 const exportRows=selectedRows.length?selectedRows:filtered;
 const doExport=async()=>{setExporting(true);try{const label=selectedRows.length?`${selectedRows.length} seleccionadas`:selectionLabel;const blob=await exportInvoices(exportRows,label);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`ZENVIA_Gastos_${safeExportLabel(label)||'seleccion'}.zip`;a.click();URL.revokeObjectURL(url);}catch(e){showError(e instanceof Error?e.message:'No se pudo preparar la exportación.')}finally{setExporting(false)}};
 const openFile=async(invoice:Invoice)=>{try{await onOpenFile(invoice)}catch(e){showError(e instanceof Error?e.message:'No se pudo abrir el documento.')}};
 const changeStatus=async(id:string,status:'pending'|'reviewed'|'accounted')=>{try{await onStatusChange(id,status);const labels={pending:'pendiente',reviewed:'revisada',accounted:'contabilizada'} as const;showSuccess(`Factura marcada como ${labels[status]}.`)}catch(e){showError(e instanceof Error?e.message:'No se pudo cambiar el estado de la factura.')}};
 const remove=async(invoice:Invoice)=>{
   const confirmed=await confirmAction({title:'Eliminar factura de gasto',message:`Se eliminará ${invoice.invoiceNumber==='—'?'la factura seleccionada':invoice.invoiceNumber} de ${invoice.supplierName}.`,confirmLabel:'Eliminar',tone:'danger',details:['Esta acción no se puede deshacer.']});
   if(!confirmed)return;
   setBusyId(invoice.id);
   try{await onDelete(invoice);if(selected?.id===invoice.id)setSelected(null);setCheckedIds(current=>{const next=new Set(current);next.delete(invoice.id);return next});showSuccess('Factura eliminada correctamente.')}catch(e){showError(e instanceof Error?e.message:'No se pudo eliminar la factura.')}finally{setBusyId(null)}
 };
 const removeSelected=async()=>{
   if(!selectedRows.length)return;
   const confirmed=await confirmAction({title:`Eliminar ${selectedRows.length} factura${selectedRows.length===1?'':'s'} de gasto`,message:'Se eliminarán las facturas seleccionadas.',confirmLabel:'Eliminar seleccionadas',tone:'danger',details:['Esta acción no se puede deshacer.']});
   if(!confirmed)return;
   setBulkDeleting(true);
   const process=openActionProcess({title:'Eliminando gastos',description:'El resultado permanecerá visible al terminar.',items:selectedRows.map(invoice=>({id:invoice.id,label:`${invoice.invoiceNumber==='—'?invoice.supplierName:invoice.invoiceNumber} · ${invoice.supplierName}`}))});
   let removed=0;let failed=0;
   try{
     for(const invoice of selectedRows){
       process.setItem(invoice.id,'running','Eliminando…');
       try{await onDelete(invoice);removed+=1;process.setItem(invoice.id,'success','Eliminada correctamente.');}
       catch(e){failed+=1;process.setItem(invoice.id,'error',errorMessage(e,'No se pudo eliminar.'));}
     }
     if(selected&&selectedRows.some(invoice=>invoice.id===selected.id))setSelected(null);
     setCheckedIds(new Set());
     process.finish(`${removed} eliminada${removed===1?'':'s'}.${failed?` ${failed} con error.`:''}`,failed?(removed?'warning':'error'):'success');
   }finally{setBulkDeleting(false);}
 };
 const changeSupplier=async(invoice:Invoice,supplierId:string)=>{
   setBusyId(invoice.id);
   try{await onSupplierChange(invoice.id,supplierId);const supplier=suppliers.find(s=>s.id===supplierId);if(supplier)setSelected(current=>current?.id===invoice.id?{...current,supplierId,supplierName:supplier.name}:current);showSuccess('Proveedor de la factura actualizado correctamente.')}catch(e){throw e instanceof Error?e:new Error('No se pudo cambiar el proveedor de la factura.')}finally{setBusyId(null)}
 };
 const changeCategory=async(invoice:Invoice,categoryId:string)=>{
   setBusyId(invoice.id);
   try{await onCategoryChange(invoice.id,categoryId);const category=categories.find(c=>c.id===categoryId);if(category)setSelected(current=>current?.id===invoice.id?{...current,categoryId,category:category.name}:current);showSuccess('Categoría de la factura actualizada correctamente.')}catch(e){throw e instanceof Error?e:new Error('No se pudo cambiar la categoría de la factura.')}finally{setBusyId(null)}
 };
 return <div className="page"><div className="pageHead"><div><div className="eyebrow">DOCUMENTACIÓN · {periodLabel(filter)}</div><h1>Facturas de gastos</h1><p>Consulta el histórico completo, filtra y exporta cualquier periodo.</p></div><div className="actions"><button className="secondary" onClick={doExport} disabled={exporting||!exportRows.length}><Download size={17}/> {exporting?'Preparando…':selectedRows.length?`Exportar seleccionadas (${selectedRows.length})`:`Exportar (${filtered.length})`}</button><button className="secondary" onClick={onBulkUpload}><Files size={17}/> Importar facturas</button><button className="primary" onClick={onUpload}>+ Nueva factura</button></div></div>
 <InvoiceFilters filter={filter} onChange={setFilter} invoices={invoices} suppliers={suppliers} categories={categories}/>
 <div className="stats expenseStats"><StatCard label="Gasto total" value={money(expenseTotal)} sub={selectionLabel} icon={<Euro/>}/><StatCard label="IVA soportado" value={money(vatTotal)} sub={selectionLabel} icon={<BadgeEuro/>}/><StatCard label="Nº de facturas" value={String(invoiceCount)} sub={selectionLabel} icon={<ReceiptText/>}/><StatCard label="Pendientes de revisar" value={String(pendingReview)} sub={pendingReview?`${pendingReview} pendiente${pendingReview===1?'':'s'}`:'Todo revisado'} icon={<Clock3/>}/><StatCard label="Ticket medio" value={money(averageTicket)} sub="Media por factura" icon={<Calculator/>}/><StatCard label="Proveedores distintos" value={String(supplierCount)} sub={selectionLabel} icon={<Building2/>}/></div>
 <div className="toolbar invoiceSearchToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar proveedor, nº factura, categoría…"/></div><span className="filterResultCount">{filtered.length} factura{filtered.length===1?'':'s'} · {selectionLabel}</span></div>
 {filtered.length>0&&<BulkSelectionToolbar selectedCount={selectedRows.length} totalCount={filtered.length} allSelected={allFilteredSelected} onToggleAll={toggleAllFiltered} label="gastos visibles">
   <button className="secondary dangerText" type="button" disabled={!selectedRows.length||bulkDeleting||exporting} onClick={()=>void removeSelected()}><Trash2 size={15}/> {bulkDeleting?'Eliminando…':`Eliminar seleccionados (${selectedRows.length})`}</button>
   <button className="primary" type="button" disabled={!selectedRows.length||exporting||bulkDeleting} onClick={doExport}><Download size={15}/> Exportar seleccionados ({selectedRows.length})</button>
 </BulkSelectionToolbar>}
 <section className="card tableCard">{filtered.length?<><table data-preference-table="expenses" data-hidden-columns={hiddenColumns}><thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allFilteredSelected} onChange={toggleAllFiltered} label={allFilteredSelected?'Deseleccionar gastos visibles':'Seleccionar gastos visibles'}/></th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Categoría</th><th>Origen</th><th>Estado</th><th className="right">IVA</th><th className="right">Total</th><th className="right">Acciones</th></tr></thead><tbody>{paged.map(i=><tr key={i.id} className={`clickableRow ${checkedIds.has(i.id)?'bulkSelectedRow':''}`} onClick={()=>setSelected(i)}><td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(i.id)} onChange={checked=>toggleChecked(i.id,checked)} label={`Seleccionar gasto ${i.invoiceNumber==='—'?i.supplierName:i.invoiceNumber}`}/></td><td>{formatAppDate(i.invoiceDate,settings.general)}</td><td><strong>{i.supplierName}</strong></td><td>{i.invoiceNumber}</td><td><span className="tag">{i.category}</span></td><td>{i.source==='camera'?<><Camera size={14}/> Cámara</>:i.source==='manual'?<><FileUp size={14}/> Archivo</>:'Gmail'}</td><td><div className="statusActions" onClick={e=>e.stopPropagation()}><button title="Pendiente" className={i.status==='pending'?'statusBtn active warnBtn':'statusBtn'} onClick={()=>void changeStatus(i.id,'pending')}>P</button><button title="Revisada" className={i.status==='reviewed'?'statusBtn active okBtn':'statusBtn'} onClick={()=>void changeStatus(i.id,'reviewed')}><CheckCircle2 size={13}/></button><button title="Contabilizada" className={i.status==='accounted'?'statusBtn active accountBtn':'statusBtn'} onClick={()=>void changeStatus(i.id,'accounted')}><CircleDollarSign size={13}/></button></div></td><td className="right">{money(i.vat)}</td><td className="right"><strong>{money(i.total)}</strong></td><td className="right"><div className="invoiceActions" onClick={e=>e.stopPropagation()}><button className="iconBtn" title="Abrir factura" disabled={!i.filePath} onClick={()=>openFile(i)}><Eye size={16}/></button><button className="iconBtn dangerIcon" title="Eliminar factura" disabled={busyId===i.id} onClick={()=>remove(i)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table><Pagination page={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage}/></>:<div className="emptyState large">No hay facturas para los filtros seleccionados.</div>}</section>
 <InvoiceDetailModal invoice={selected} suppliers={suppliers} categories={categories} onClose={()=>setSelected(null)} onOpenFile={openFile} onDelete={remove} onSupplierChange={changeSupplier} onCategoryChange={changeCategory} deleting={busyId===selected?.id}/>
 </div>
}