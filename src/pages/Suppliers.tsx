import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, ChevronRight, FileText, Globe, Mail, MapPin, Package, Pencil, Phone, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { loadAppData } from '../services/repository';
import { showError, showSuccess } from '../services/toast';
import { confirmAction, openActionProcess } from '../services/actionDialog';
import type { ExpenseCategory, Invoice, Supplier } from '../types';
import { Pagination } from '../components/Pagination';
import { BulkSelectCheckbox, BulkSelectionToolbar } from '../components/BulkSelectionToolbar';
import { SelectField } from '../components/forms/SelectField';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { defaultDateFilter, periodLabel } from '../services/filters';
import '../supplier-actions.css';
import { useSettings } from '../context/SettingsContext';
import { hiddenTableColumns, persistRememberedFilter, rememberedFilter } from '../services/uiPreferences';

const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const dateLabel=(value?:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('es-ES'):'—';
const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
type SupplierTypeFilter='all'|'goods'|'service'|'both'|'unclassified';
type SupplierActivityFilter='all'|'active'|'inactive';
type SupplierMetric={count:number;total:number;lastDate:string|null;recent:Invoice[]};

function supplierTypeLabel(type: Supplier['supplierType']) {
  if(type==='goods') return 'Mercancía';
  if(type==='service') return 'Servicios';
  if(type==='both') return 'Mercancía y servicios';
  return 'Sin clasificar';
}

function SupplierDrawer({supplier,metric,period,onClose,onEdit,onDelete,busy}:{supplier:Supplier;metric:SupplierMetric;period:string;onClose:()=>void;onEdit:()=>void;onDelete:()=>void;busy:boolean}){
  return <div className="masterDrawerBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <aside className="masterDrawer">
      <div className="masterDrawerHead"><div><div className="eyebrow">PROVEEDOR</div><h2>{supplier.name}</h2><p>{supplier.taxId||'CIF/VAT pendiente'}</p></div><button className="iconBtn" onClick={onClose}><X size={18}/></button></div>
      <div className="masterDrawerPeriod"><CalendarDays size={14}/><span>{period}</span></div>
      <div className="masterDrawerKpis"><div><span>Gasto del periodo</span><strong>{money(metric.total)}</strong></div><div><span>Facturas</span><strong>{metric.count}</strong></div><div><span>Última compra</span><strong>{dateLabel(metric.lastDate)}</strong></div></div>
      <section className="masterDrawerSection"><h3>Datos del proveedor</h3><div className="masterInfoList">
        <div><span><Building2 size={15}/> Tipo</span><strong>{supplierTypeLabel(supplier.supplierType)}</strong></div>
        <div><span><FileText size={15}/> CIF/VAT</span><strong>{supplier.taxId||'Sin CIF/VAT'}</strong></div>
        <div><span><Mail size={15}/> Email</span><strong>{supplier.email||'Sin email'}</strong></div>
        <div><span><Phone size={15}/> Teléfono</span><strong>{supplier.phone||'Sin teléfono'}</strong></div>
        <div><span><MapPin size={15}/> Dirección</span><strong>{supplier.address||'Sin dirección'}</strong></div>
        <div><span><Globe size={15}/> Web</span><strong>{supplier.website?<a href={supplier.website} target="_blank" rel="noopener noreferrer">{supplier.website}</a>:'Sin web'}</strong></div>
      </div></section>
      <section className="masterDrawerSection"><div className="masterSectionHead"><h3>Facturas del periodo</h3><span>{metric.count} registrada{metric.count===1?'':'s'}</span></div>
        {metric.recent.length?<div className="masterRecentList">{metric.recent.map(invoice=><div key={invoice.id}><div><strong>{invoice.invoiceNumber||'Sin número'}</strong><span>{dateLabel(invoice.invoiceDate)} · {invoice.category}</span></div><b>{money(invoice.total)}</b></div>)}</div>:<div className="masterEmptyMini">No hay facturas de este proveedor en el periodo seleccionado.</div>}
      </section>
      <div className="masterDrawerActions"><button className="secondary" onClick={onEdit}><Pencil size={16}/> Editar</button><button className="secondary dangerText" disabled={busy} onClick={onDelete}><Trash2 size={16}/> Eliminar</button></div>
    </aside>
  </div>;
}

export function Suppliers({suppliers,onAdd,onEdit,onDelete}:{suppliers:Supplier[];onAdd:()=>void;onEdit:(supplier:Supplier)=>void;onDelete:(supplier:Supplier)=>Promise<void>}){
 const {preferences,updatePreferences}=useSettings();
 const pageSize=preferences.pageSize;
 const hiddenColumns=hiddenTableColumns(preferences,'suppliers');
 const remembered=rememberedFilter<{query:string;typeFilter:SupplierTypeFilter;activityFilter:SupplierActivityFilter;categoryFilter:string;dateFilter:ReturnType<typeof defaultDateFilter>}>(preferences,'suppliers.filters',{query:'',typeFilter:'all',activityFilter:'all',categoryFilter:'all',dateFilter:defaultDateFilter(preferences.defaultPeriod)});
 const [busyId,setBusyId]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [query,setQuery]=useState(remembered.query);
 const [typeFilter,setTypeFilter]=useState<SupplierTypeFilter>(remembered.typeFilter);
 const [activityFilter,setActivityFilter]=useState<SupplierActivityFilter>(remembered.activityFilter);
 const [categoryFilter,setCategoryFilter]=useState(remembered.categoryFilter);
 const [selected,setSelected]=useState<Supplier|null>(null);
 const [checkedIds,setCheckedIds]=useState<Set<string>>(()=>new Set());
 const [bulkBusy,setBulkBusy]=useState(false);
 const [invoices,setInvoices]=useState<Invoice[]>([]);
 const [categories,setCategories]=useState<ExpenseCategory[]>([]);
 const [dateFilter,setDateFilter]=useState(remembered.dateFilter);
 const [page,setPage]=useState(1);

 useEffect(()=>{let cancelled=false;loadAppData().then(data=>{if(!cancelled){setInvoices(data.invoices);setCategories(data.categories)}}).catch(()=>{});return()=>{cancelled=true}},[suppliers]);

 const selectedPeriod=periodLabel(dateFilter);
 const periodInvoices=useMemo(()=>invoices.filter(invoice=>(!dateFilter.from||invoice.invoiceDate>=dateFilter.from)&&(!dateFilter.to||invoice.invoiceDate<=dateFilter.to)),[invoices,dateFilter]);

 const metrics=useMemo(()=>{
   const map=new Map<string,SupplierMetric>();
   for(const supplier of suppliers)map.set(supplier.id,{count:0,total:0,lastDate:null,recent:[]});
   const ordered=[...periodInvoices].sort((a,b)=>b.invoiceDate.localeCompare(a.invoiceDate));
   for(const invoice of ordered){
     let supplier=suppliers.find(item=>item.id===invoice.supplierId);
     if(!supplier)supplier=suppliers.find(item=>normalize(item.name)===normalize(invoice.supplierName));
     if(!supplier)continue;
     const metric=map.get(supplier.id)!;
     metric.count+=1;metric.total+=invoice.total;
     if(!metric.lastDate||invoice.invoiceDate>metric.lastDate)metric.lastDate=invoice.invoiceDate;
     if(metric.recent.length<5)metric.recent.push(invoice);
   }
   return map;
 },[suppliers,periodInvoices]);

 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return suppliers.filter(supplier=>{
   const metric=metrics.get(supplier.id);
   const matchesQuery=!q||[supplier.name,supplier.taxId||'',supplier.email||'',supplier.phone||'',supplier.address||'',supplier.website||''].some(value=>value.toLowerCase().includes(q));
   if(typeFilter!=='all'&&supplier.supplierType!==typeFilter)return false;
   if(categoryFilter==='__none__'&&supplier.defaultCategoryId)return false;
   if(categoryFilter!=='all'&&categoryFilter!=='__none__'&&(supplier.defaultCategoryId||'')!==categoryFilter)return false;
   if(activityFilter==='active'&&(metric?.count||0)===0)return false;
   if(activityFilter==='inactive'&&(metric?.count||0)>0)return false;
   return matchesQuery;
 })},[suppliers,metrics,query,typeFilter,categoryFilter,activityFilter]);
 const selectedSuppliers=filtered.filter(supplier=>checkedIds.has(supplier.id));
 const allFilteredSelected=filtered.length>0&&filtered.every(supplier=>checkedIds.has(supplier.id));
 const toggleSupplier=(id:string,checked:boolean)=>setCheckedIds(current=>{const next=new Set(current);if(checked)next.add(id);else next.delete(id);return next;});
 const toggleAllSuppliers=(checked:boolean)=>setCheckedIds(checked?new Set(filtered.map(supplier=>supplier.id)):new Set());
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const paged=useMemo(()=>filtered.slice((page-1)*pageSize,page*pageSize),[filtered,page]);
 useEffect(()=>{setPage(1);setCheckedIds(new Set())},[query,typeFilter,categoryFilter,activityFilter,dateFilter]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void persistRememberedFilter(preferences,updatePreferences,'suppliers.filters',{query,typeFilter,activityFilter,categoryFilter,dateFilter})},350);return()=>window.clearTimeout(timer)},[query,typeFilter,activityFilter,categoryFilter,dateFilter,preferences.rememberFilters]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 const totals=useMemo(()=>({spent:filtered.reduce((sum,s)=>sum+(metrics.get(s.id)?.total||0),0),invoices:filtered.reduce((sum,s)=>sum+(metrics.get(s.id)?.count||0),0),active:filtered.filter(s=>(metrics.get(s.id)?.count||0)>0).length}),[filtered,metrics]);

 const remove=async(supplier:Supplier)=>{
   const confirmed=await confirmAction({title:'Eliminar proveedor',message:`Se eliminará “${supplier.name}”.`,confirmLabel:'Eliminar',tone:'danger',details:['Las facturas existentes no se borrarán; quedarán sin proveedor asignado.']});
   if(!confirmed)return;
   setBusyId(supplier.id);setError('');
   try{await onDelete(supplier);setSelected(null);showSuccess('Proveedor eliminado correctamente.')}
   catch(e){showError(e instanceof Error?e.message:'No se pudo eliminar el proveedor.')}
   finally{setBusyId(null)}
 };
 const removeSelected=async()=>{
   if(!selectedSuppliers.length)return;
   const confirmed=await confirmAction({title:`Eliminar ${selectedSuppliers.length} proveedor${selectedSuppliers.length===1?'':'es'}`,message:'Se eliminarán los proveedores seleccionados.',confirmLabel:'Eliminar seleccionados',tone:'danger',details:['Las facturas existentes no se borrarán.']});
   if(!confirmed)return;
   setBulkBusy(true);setError('');
   const process=openActionProcess({title:'Eliminando proveedores',description:'El resultado permanecerá visible al terminar.',items:selectedSuppliers.map(supplier=>({id:supplier.id,label:supplier.name}))});
   let removed=0;let failed=0;
   try{
     for(const supplier of selectedSuppliers){
       process.setItem(supplier.id,'running','Eliminando…');
       try{await onDelete(supplier);removed+=1;process.setItem(supplier.id,'success','Eliminado correctamente.');}
       catch(e){failed+=1;process.setItem(supplier.id,'error',e instanceof Error?e.message:'No se pudo eliminar.');}
     }
     setCheckedIds(new Set());
     process.finish(`${removed} eliminado${removed===1?'':'s'}.${failed?` ${failed} con error.`:''}`,failed?(removed?'warning':'error'):'success');
   }finally{setBulkBusy(false);}
 };
 const edit=(supplier:Supplier)=>{setSelected(null);onEdit(supplier)};

 return <div className="page masterPage">
    <div className="pageHead">
      <div><div className="eyebrow">MAESTRO</div><h1>Proveedores</h1><p>Directorio de proveedores, gasto y actividad de compra por periodo.</p></div>
      <button className="primary" onClick={onAdd}>+ Proveedor</button>
    </div>

    <PeriodFilterPanel filter={dateFilter} onChange={setDateFilter} title="Periodo de análisis"/>

    <div className="stats masterStats">
      <div className="stat"><div className="statIcon"><Building2/></div><div><span>Proveedores con actividad</span><strong>{totals.active}</strong><small>de {filtered.length} visibles · {selectedPeriod.toLowerCase()}</small></div></div>
      <div className="stat"><div className="statIcon"><ShoppingCart/></div><div><span>Gasto del periodo</span><strong>{money(totals.spent)}</strong><small>{selectedPeriod}</small></div></div>
      <div className="stat"><div className="statIcon"><FileText/></div><div><span>Facturas recibidas</span><strong>{totals.invoices}</strong><small>{selectedPeriod}</small></div></div>
    </div>

    <div className="businessFilterBar">
      <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar proveedor, CIF, email, teléfono o dirección…"/></div>
      <div className="businessFilterFields">
        <label className="filterField"><span>Tipo</span><SelectField value={typeFilter} onChange={value=>setTypeFilter(value as SupplierTypeFilter)} ariaLabel="Filtrar por tipo de proveedor" options={[{value:'all',label:'Todos los tipos'},{value:'goods',label:'Mercancía'},{value:'service',label:'Servicios'},{value:'both',label:'Mercancía y servicios'},{value:'unclassified',label:'Sin clasificar'}]}/></label>
        <label className="filterField"><span>Categoría habitual</span><SelectField value={categoryFilter} onChange={setCategoryFilter} ariaLabel="Filtrar por categoría habitual" options={[{value:'all',label:'Todas las categorías'},{value:'__none__',label:'Sin categoría habitual'},...categories.map(category=>({value:category.id,label:category.name}))]}/></label>
        <label className="filterField"><span>Actividad</span><SelectField value={activityFilter} onChange={value=>setActivityFilter(value as SupplierActivityFilter)} ariaLabel="Filtrar proveedores por actividad" options={[{value:'all',label:'Todos'},{value:'active',label:'Con facturas en el periodo'},{value:'inactive',label:'Sin facturas en el periodo'}]}/></label>
      </div>
      <span className="filterResultCount">{filtered.length} proveedor{filtered.length===1?'':'es'} · {selectedPeriod}</span>
    </div>

    {filtered.length>0&&(
      <BulkSelectionToolbar selectedCount={selectedSuppliers.length} totalCount={filtered.length} allSelected={allFilteredSelected} onToggleAll={toggleAllSuppliers} label="proveedores">
        <button className="secondary dangerText" type="button" disabled={!selectedSuppliers.length||bulkBusy} onClick={()=>void removeSelected()}>
          <Trash2 size={15}/> {bulkBusy?'Eliminando…':`Eliminar seleccionados (${selectedSuppliers.length})`}
        </button>
      </BulkSelectionToolbar>
    )}

    {error&&<div className="errorBox supplierPageError">{error}</div>}

    <section className="card tableCard masterTableCard">
      {filtered.length?(
        <table className="masterTable" data-preference-table="suppliers" data-hidden-columns={hiddenColumns}>
          <thead><tr><th className="bulkSelectionCell"><BulkSelectCheckbox checked={allFilteredSelected} onChange={toggleAllSuppliers} label={allFilteredSelected?'Deseleccionar proveedores visibles':'Seleccionar proveedores visibles'}/></th><th>Proveedor</th><th>CIF/VAT</th><th>Tipo</th><th>Categoría habitual</th><th>Contacto</th><th className="right">Facturas</th><th className="right">Gasto periodo</th><th>Última factura</th><th></th></tr></thead>
          <tbody>{paged.map(s=>{const metric=metrics.get(s.id)||{count:0,total:0,lastDate:null,recent:[]};return <tr className={`clickableRow ${checkedIds.has(s.id)?'bulkSelectedRow':''}`} key={s.id} onClick={()=>setSelected(s)}>
              <td className="bulkSelectionCell" onClick={e=>e.stopPropagation()}><BulkSelectCheckbox checked={checkedIds.has(s.id)} onChange={checked=>toggleSupplier(s.id,checked)} label={`Seleccionar ${s.name}`}/></td>
              <td><div className="masterEntityCell"><div className="masterAvatar"><Building2 size={17}/></div><div><strong>{s.name}</strong><small>{supplierTypeLabel(s.supplierType)}</small></div></div></td>
              <td>{s.taxId||<span className="muted">Pendiente</span>}</td>
              <td><span className={`masterTypeTag ${s.supplierType}`}>{supplierTypeLabel(s.supplierType)}</span></td>
              <td>{categories.find(category=>category.id===s.defaultCategoryId)?.name||<span className="muted">Sin categoría</span>}</td>
              <td><div className="masterContactCell"><span>{s.email||'—'}</span><small>{s.phone||''}</small></div></td>
              <td className="right"><strong>{metric.count}</strong></td>
              <td className="right"><strong>{money(metric.total)}</strong></td>
              <td>{dateLabel(metric.lastDate)}</td>
              <td className="right"><ChevronRight size={17}/></td>
            </tr>})}</tbody>
        </table>
      ):<div className="emptyState large">No hay proveedores para los filtros seleccionados.</div>}
    </section>

    {filtered.length>0&&(
      <div className="masterMobileList">
        {paged.map(s=>{const metric=metrics.get(s.id)||{count:0,total:0,lastDate:null,recent:[]};return <div className={`bulkMobileSelectableRow ${checkedIds.has(s.id)?'selected':''}`} key={s.id}>
            <BulkSelectCheckbox checked={checkedIds.has(s.id)} onChange={checked=>toggleSupplier(s.id,checked)} label={`Seleccionar ${s.name}`}/>
            <button className="card masterMobileRow" onClick={()=>setSelected(s)}>
              <div className="masterEntityCell"><div className="masterAvatar"><Package size={17}/></div><div><strong>{s.name}</strong><small>{supplierTypeLabel(s.supplierType)} · {s.taxId||'CIF pendiente'}</small></div></div>
              <div className="masterMobileAmounts"><span>Facturas <strong>{metric.count}</strong></span><span>Gasto periodo <strong>{money(metric.total)}</strong></span></div>
              <ChevronRight size={18}/>
            </button>
          </div>})}
      </div>
    )}

    {filtered.length>0&&<Pagination page={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage}/>}
    {!suppliers.length&&<div className="card emptyState large">Los proveedores también se crearán automáticamente al registrar facturas nuevas.</div>}
    {selected&&<SupplierDrawer supplier={selected} metric={metrics.get(selected.id)||{count:0,total:0,lastDate:null,recent:[]}} period={selectedPeriod} onClose={()=>setSelected(null)} onEdit={()=>edit(selected)} onDelete={()=>remove(selected)} busy={busyId===selected.id}/>}
  </div>;
}
