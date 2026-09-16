import { useEffect, useMemo, useState } from 'react';
import { Building2, CalendarDays, ChevronRight, FileText, Globe, Mail, MapPin, Package, Pencil, Phone, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { loadAppData } from '../services/repository';
import type { Invoice, Supplier } from '../types';
import { Pagination } from '../components/Pagination';
import '../supplier-actions.css';

const PAGE_SIZE=20;
const money=(value:number)=>value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
const dateLabel=(value?:string|null)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('es-ES'):'—';
const normalize=(value:string)=>value.trim().toLowerCase().replace(/\s+/g,' ');
const iso=(value:Date)=>{const year=value.getFullYear();const month=String(value.getMonth()+1).padStart(2,'0');const day=String(value.getDate()).padStart(2,'0');return `${year}-${month}-${day}`;};

type SupplierFilter='all'|'goods'|'service'|'both'|'unclassified';
type PeriodPreset='today'|'month'|'quarter'|'year'|'all'|'custom';
type SupplierMetric={count:number;total:number;lastDate:string|null;recent:Invoice[]};

function currentRange(preset:Exclude<PeriodPreset,'custom'>){
  const now=new Date();
  if(preset==='all')return {from:'',to:''};
  if(preset==='today'){const today=iso(now);return {from:today,to:today};}
  if(preset==='month')return {from:iso(new Date(now.getFullYear(),now.getMonth(),1)),to:iso(new Date(now.getFullYear(),now.getMonth()+1,0))};
  if(preset==='year')return {from:`${now.getFullYear()}-01-01`,to:`${now.getFullYear()}-12-31`};
  const quarterStart=Math.floor(now.getMonth()/3)*3;
  return {from:iso(new Date(now.getFullYear(),quarterStart,1)),to:iso(new Date(now.getFullYear(),quarterStart+3,0))};
}

function periodText(preset:PeriodPreset,from:string,to:string){
  if(preset==='today')return 'Hoy';
  if(preset==='month')return 'Mes actual';
  if(preset==='quarter')return 'Trimestre actual';
  if(preset==='year')return 'Año actual';
  if(preset==='all')return 'Todo el histórico';
  if(from&&to)return `${dateLabel(from)} – ${dateLabel(to)}`;
  if(from)return `Desde ${dateLabel(from)}`;
  if(to)return `Hasta ${dateLabel(to)}`;
  return 'Periodo personalizado';
}

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
 const initialRange=currentRange('quarter');
 const [busyId,setBusyId]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [filter,setFilter]=useState<SupplierFilter>('all');
 const [selected,setSelected]=useState<Supplier|null>(null);
 const [invoices,setInvoices]=useState<Invoice[]>([]);
 const [period,setPeriod]=useState<PeriodPreset>('quarter');
 const [dateFrom,setDateFrom]=useState(initialRange.from);
 const [dateTo,setDateTo]=useState(initialRange.to);
 const [page,setPage]=useState(1);

 useEffect(()=>{let cancelled=false;loadAppData().then(data=>{if(!cancelled)setInvoices(data.invoices)}).catch(()=>{});return()=>{cancelled=true}},[suppliers]);

 const applyPreset=(preset:Exclude<PeriodPreset,'custom'>)=>{const range=currentRange(preset);setPeriod(preset);setDateFrom(range.from);setDateTo(range.to);};
 const periodLabel=periodText(period,dateFrom,dateTo);
 const periodInvoices=useMemo(()=>invoices.filter(invoice=>(!dateFrom||invoice.invoiceDate>=dateFrom)&&(!dateTo||invoice.invoiceDate<=dateTo)),[invoices,dateFrom,dateTo]);

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

 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();return suppliers.filter(s=>{
   const matchesQuery=!q||[s.name,s.taxId||'',s.email||'',s.phone||'',s.address||'',s.website||''].some(v=>v.toLowerCase().includes(q));
   const matchesFilter=filter==='all'||s.supplierType===filter;
   return matchesQuery&&matchesFilter;
 })},[suppliers,query,filter]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
 const paged=useMemo(()=>filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[filtered,page]);
 useEffect(()=>{setPage(1)},[query,filter,period,dateFrom,dateTo]);
 useEffect(()=>{setPage(current=>Math.min(current,totalPages))},[totalPages]);
 const totals=useMemo(()=>({spent:suppliers.reduce((sum,s)=>sum+(metrics.get(s.id)?.total||0),0),invoices:suppliers.reduce((sum,s)=>sum+(metrics.get(s.id)?.count||0),0),active:suppliers.filter(s=>(metrics.get(s.id)?.count||0)>0).length}),[suppliers,metrics]);

 const remove=async(supplier:Supplier)=>{
   const confirmed=window.confirm(`¿Eliminar el proveedor "${supplier.name}"?\n\nLas facturas existentes no se borrarán; quedarán sin proveedor asignado.`);
   if(!confirmed)return;
   setBusyId(supplier.id);setError('');
   try{await onDelete(supplier);setSelected(null)}catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar el proveedor.')}finally{setBusyId(null)}
 };
 const edit=(supplier:Supplier)=>{setSelected(null);onEdit(supplier)};

 return <div className="page masterPage">
   <div className="pageHead"><div><div className="eyebrow">MAESTRO</div><h1>Proveedores</h1><p>Directorio de proveedores, gasto y actividad de compra por periodo.</p></div><button className="primary" onClick={onAdd}>+ Proveedor</button></div>

   <div className="masterPeriodPanel">
     <div className="masterPeriodTop"><div><CalendarDays size={17}/><div><strong>Periodo de análisis</strong><span>{periodLabel}</span></div></div><div className="masterPeriodQuick"><button className={period==='today'?'active':''} onClick={()=>applyPreset('today')}>Hoy</button><button className={period==='month'?'active':''} onClick={()=>applyPreset('month')}>Mes actual</button><button className={period==='quarter'?'active':''} onClick={()=>applyPreset('quarter')}>Trimestre actual</button><button className={period==='year'?'active':''} onClick={()=>applyPreset('year')}>Año actual</button><button className={period==='all'?'active':''} onClick={()=>applyPreset('all')}>Todo</button></div></div>
     <div className="masterPeriodDates"><label>Desde<input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPeriod('custom')}}/></label><label>Hasta<input type="date" value={dateTo} min={dateFrom||undefined} onChange={e=>{setDateTo(e.target.value);setPeriod('custom')}}/></label>{period==='custom'&&<button className="secondary" onClick={()=>applyPreset('quarter')}>Restablecer trimestre</button>}</div>
   </div>

   <div className="stats masterStats"><div className="stat"><div className="statIcon"><Building2/></div><div><span>Proveedores con actividad</span><strong>{totals.active}</strong><small>de {suppliers.length} registrados · {periodLabel.toLowerCase()}</small></div></div><div className="stat"><div className="statIcon"><ShoppingCart/></div><div><span>Gasto del periodo</span><strong>{money(totals.spent)}</strong><small>{periodLabel}</small></div></div><div className="stat"><div className="statIcon"><FileText/></div><div><span>Facturas recibidas</span><strong>{totals.invoices}</strong><small>{periodLabel}</small></div></div></div>
   <div className="masterToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar proveedor, CIF, email, teléfono o dirección…"/></div><div className="masterFilters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Todos</button><button className={filter==='goods'?'active':''} onClick={()=>setFilter('goods')}>Mercancía</button><button className={filter==='service'?'active':''} onClick={()=>setFilter('service')}>Servicios</button><button className={filter==='both'?'active':''} onClick={()=>setFilter('both')}>Ambos</button><button className={filter==='unclassified'?'active':''} onClick={()=>setFilter('unclassified')}>Sin clasificar</button></div></div>
   {error&&<div className="errorBox supplierPageError">{error}</div>}
   <section className="card tableCard masterTableCard">{filtered.length?<table className="masterTable"><thead><tr><th>Proveedor</th><th>CIF/VAT</th><th>Tipo</th><th>Contacto</th><th className="right">Facturas</th><th className="right">Gasto periodo</th><th>Última factura</th><th></th></tr></thead><tbody>{paged.map(s=>{const metric=metrics.get(s.id)||{count:0,total:0,lastDate:null,recent:[]};return <tr className="clickableRow" key={s.id} onClick={()=>setSelected(s)}><td><div className="masterEntityCell"><div className="masterAvatar"><Building2 size={17}/></div><div><strong>{s.name}</strong><small>{supplierTypeLabel(s.supplierType)}</small></div></div></td><td>{s.taxId||<span className="muted">Pendiente</span>}</td><td><span className={`masterTypeTag ${s.supplierType}`}>{supplierTypeLabel(s.supplierType)}</span></td><td><div className="masterContactCell"><span>{s.email||'—'}</span><small>{s.phone||''}</small></div></td><td className="right"><strong>{metric.count}</strong></td><td className="right"><strong>{money(metric.total)}</strong></td><td>{dateLabel(metric.lastDate)}</td><td className="right"><ChevronRight size={17}/></td></tr>})}</tbody></table>:<div className="emptyState large">No hay proveedores para los filtros seleccionados.</div>}</section>
   {filtered.length>0&&<div className="masterMobileList">{paged.map(s=>{const metric=metrics.get(s.id)||{count:0,total:0,lastDate:null,recent:[]};return <button className="card masterMobileRow" key={s.id} onClick={()=>setSelected(s)}><div className="masterEntityCell"><div className="masterAvatar"><Package size={17}/></div><div><strong>{s.name}</strong><small>{supplierTypeLabel(s.supplierType)} · {s.taxId||'CIF pendiente'}</small></div></div><div className="masterMobileAmounts"><span>Facturas <strong>{metric.count}</strong></span><span>Gasto periodo <strong>{money(metric.total)}</strong></span></div><ChevronRight size={18}/></button>})}</div>}
   {filtered.length>0&&<Pagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage}/>}
   {!suppliers.length&&<div className="card emptyState large">Los proveedores también se crearán automáticamente al registrar facturas nuevas.</div>}
   {selected&&<SupplierDrawer supplier={selected} metric={metrics.get(selected.id)||{count:0,total:0,lastDate:null,recent:[]}} period={periodLabel} onClose={()=>setSelected(null)} onEdit={()=>edit(selected)} onDelete={()=>remove(selected)} busy={busyId===selected.id}/>} 
 </div>
}
