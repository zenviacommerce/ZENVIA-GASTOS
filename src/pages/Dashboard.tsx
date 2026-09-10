import { useMemo, useState } from 'react';
import { Euro, ReceiptText, BadgeEuro, AlertCircle, TrendingUp, ArrowUpRight } from 'lucide-react';
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { Invoice, Product, Supplier } from '../types';
import { StatCard } from '../components/StatCard';
import { InvoiceFilters } from '../components/InvoiceFilters';
import { defaultInvoiceFilter, filterInvoices, periodLabel } from '../services/filters';

const colors = ['#0f766e','#2563eb','#7c3aed','#d97706','#64748b','#dc2626','#0891b2'];
export function Dashboard({invoices,products,suppliers,onUpload,onProducts}:{invoices:Invoice[];products:Product[];suppliers:Supplier[];onUpload:()=>void;onProducts:()=>void}){
  const [filter,setFilter]=useState(defaultInvoiceFilter);
  const selectedInvoices=useMemo(()=>filterInvoices(invoices,filter),[invoices,filter]);
  const selectedPeriod=periodLabel(filter);
  const total=selectedInvoices.reduce((s,i)=>s+i.total,0);
  const vat=selectedInvoices.reduce((s,i)=>s+i.vat,0);
  const pending=selectedInvoices.filter(i=>i.status==='pending').length;
  const byCategory=Object.entries(selectedInvoices.reduce<Record<string,number>>((a,i)=>{a[i.category]=(a[i.category]||0)+i.total;return a;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const changed=products.filter(p=>p.lastPrice!=null&&p.previousPrice!=null).sort((a,b)=>Math.abs(((b.lastPrice!-b.previousPrice!)/b.previousPrice!))-Math.abs(((a.lastPrice!-a.previousPrice!)/a.previousPrice!)))[0];
  const delta=changed?.previousPrice?((changed.lastPrice!-changed.previousPrice)/changed.previousPrice)*100:null;
  return <div className="page">
    <div className="pageHead"><div><div className="eyebrow">{selectedPeriod}</div><h1>Resumen de gastos</h1><p>Control fiscal y costes de ZENVIA COMMERCE en un solo sitio.</p></div><button className="primary" onClick={onUpload}>+ Nueva factura</button></div>
    <InvoiceFilters filter={filter} onChange={setFilter} invoices={invoices} suppliers={suppliers}/>
    <div className="stats filteredStats"><StatCard label="Gasto acumulado" value={`${total.toLocaleString('es-ES',{minimumFractionDigits:2})} €`} sub={selectedPeriod} icon={<Euro/>}/><StatCard label="IVA soportado" value={`${vat.toLocaleString('es-ES',{minimumFractionDigits:2})} €`} sub="Según facturas filtradas" icon={<BadgeEuro/>}/><StatCard label="Facturas" value={String(selectedInvoices.length)} sub={selectedPeriod} icon={<ReceiptText/>}/><StatCard label="Pendientes" value={String(pending)} sub="Necesitan revisión" icon={<AlertCircle/>}/></div>
    <div className="grid2">
      <section className="card"><div className="cardHead"><div><h3>Gasto por categoría</h3><p>Distribución · {selectedPeriod}</p></div></div>{byCategory.length?<div className="chartWrap"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3}>{byCategory.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Pie><Tooltip formatter={(v)=>`${Number(v).toFixed(2)} €`}/></PieChart></ResponsiveContainer><div className="legend">{byCategory.map((x,i)=><div key={x.name}><i style={{background:colors[i%colors.length]}}/><span>{x.name}</span><strong>{x.value.toLocaleString('es-ES',{maximumFractionDigits:0})} €</strong></div>)}</div></div>:<Empty text="No hay facturas para los filtros seleccionados."/>}</section>
      <section className="card"><div className="cardHead"><div><h3>Últimas facturas</h3><p>{selectedPeriod}</p></div></div>{selectedInvoices.length?<div className="invoiceList">{selectedInvoices.slice(0,5).map(i=><div className="invoiceRow" key={i.id}><div className="supplierBadge">{i.supplierName.slice(0,2).toUpperCase()}</div><div className="invoiceMain"><strong>{i.supplierName}</strong><span>{new Date(`${i.invoiceDate}T12:00:00`).toLocaleDateString('es-ES')} · {i.category}</span></div><div className="invoiceAmount"><strong>{i.total.toLocaleString('es-ES',{minimumFractionDigits:2})} €</strong><span className={i.status==='pending'?'pill warn':'pill ok'}>{i.status==='pending'?'Revisar':i.status==='accounted'?'Contabilizada':'Revisada'}</span></div></div>)}</div>:<Empty text="No hay facturas para los filtros seleccionados."/>}</section>
    </div>
    <section className="card alertCard"><div className="trendIcon"><TrendingUp/></div><div><h3>Control de costes de producto</h3>{changed&&delta!=null?<p>Último cambio destacado: <strong>{changed.name}</strong> está a <strong>{changed.lastPrice!.toLocaleString('es-ES',{maximumFractionDigits:4})} €/{changed.unit}</strong> ({delta>0?'+':''}{delta.toFixed(1)} % frente al precio anterior).</p>:<p>Cuando una línea de mercancía se vincule a un producto, aquí verás las variaciones de coste automáticamente.</p>}</div><button className="secondary" onClick={onProducts}>Ver productos <ArrowUpRight size={14}/></button></section>
  </div>
}
function Empty({text}:{text:string}){return <div className="emptyState">{text}</div>}
