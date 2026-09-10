import { Euro, ReceiptText, BadgeEuro, AlertCircle, TrendingUp, ArrowUpRight } from 'lucide-react';
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { Invoice, Product } from '../types';
import { StatCard } from '../components/StatCard';

const colors = ['#0f766e','#2563eb','#7c3aed','#d97706','#64748b','#dc2626','#0891b2'];
export function Dashboard({invoices,products,onUpload,onProducts}:{invoices:Invoice[];products:Product[];onUpload:()=>void;onProducts:()=>void}){
  const now=new Date(); const quarter=Math.floor(now.getMonth()/3)+1; const year=now.getFullYear();
  const current=invoices.filter(i=>i.fiscalYear===year&&i.fiscalQuarter===quarter);
  const total=current.reduce((s,i)=>s+i.total,0); const vat=current.reduce((s,i)=>s+i.vat,0); const pending=current.filter(i=>i.status==='pending').length;
  const byCategory=Object.entries(current.reduce<Record<string,number>>((a,i)=>{a[i.category]=(a[i.category]||0)+i.total;return a;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const changed=products.filter(p=>p.lastPrice!=null&&p.previousPrice!=null).sort((a,b)=>Math.abs(((b.lastPrice!-b.previousPrice!)/b.previousPrice!))-Math.abs(((a.lastPrice!-a.previousPrice!)/a.previousPrice!)))[0];
  const delta=changed?.previousPrice?((changed.lastPrice!-changed.previousPrice)/changed.previousPrice)*100:null;
  return <div className="page">
    <div className="pageHead"><div><div className="eyebrow">{quarter}T {year}</div><h1>Resumen de gastos</h1><p>Control fiscal y costes de ZENVIA COMMERCE en un solo sitio.</p></div><button className="primary" onClick={onUpload}>+ Nueva factura</button></div>
    <div className="stats"><StatCard label="Gasto acumulado" value={`${total.toLocaleString('es-ES',{minimumFractionDigits:2})} €`} sub={`${quarter}T ${year}`} icon={<Euro/>}/><StatCard label="IVA soportado" value={`${vat.toLocaleString('es-ES',{minimumFractionDigits:2})} €`} sub="Según facturas cargadas" icon={<BadgeEuro/>}/><StatCard label="Facturas" value={String(current.length)} sub="Este trimestre" icon={<ReceiptText/>}/><StatCard label="Pendientes" value={String(pending)} sub="Necesitan revisión" icon={<AlertCircle/>}/></div>
    <div className="grid2">
      <section className="card"><div className="cardHead"><div><h3>Gasto por categoría</h3><p>Distribución del trimestre actual</p></div></div>{byCategory.length?<div className="chartWrap"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3}>{byCategory.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Pie><Tooltip formatter={(v)=>`${Number(v).toFixed(2)} €`}/></PieChart></ResponsiveContainer><div className="legend">{byCategory.map((x,i)=><div key={x.name}><i style={{background:colors[i%colors.length]}}/><span>{x.name}</span><strong>{x.value.toLocaleString('es-ES',{maximumFractionDigits:0})} €</strong></div>)}</div></div>:<Empty text="Todavía no hay facturas en este trimestre."/>}</section>
      <section className="card"><div className="cardHead"><div><h3>Últimas facturas</h3><p>Actividad más reciente</p></div></div>{invoices.length?<div className="invoiceList">{invoices.slice(0,5).map(i=><div className="invoiceRow" key={i.id}><div className="supplierBadge">{i.supplierName.slice(0,2).toUpperCase()}</div><div className="invoiceMain"><strong>{i.supplierName}</strong><span>{new Date(`${i.invoiceDate}T12:00:00`).toLocaleDateString('es-ES')} · {i.category}</span></div><div className="invoiceAmount"><strong>{i.total.toLocaleString('es-ES',{minimumFractionDigits:2})} €</strong><span className={i.status==='pending'?'pill warn':'pill ok'}>{i.status==='pending'?'Revisar':i.status==='accounted'?'Contabilizada':'Revisada'}</span></div></div>)}</div>:<Empty text="Sube tu primera factura para empezar."/>}</section>
    </div>
    <section className="card alertCard"><div className="trendIcon"><TrendingUp/></div><div><h3>Control de costes de producto</h3>{changed&&delta!=null?<p>Último cambio destacado: <strong>{changed.name}</strong> está a <strong>{changed.lastPrice!.toLocaleString('es-ES',{maximumFractionDigits:4})} €/{changed.unit}</strong> ({delta>0?'+':''}{delta.toFixed(1)} % frente al precio anterior).</p>:<p>Cuando una línea de mercancía se vincule a un producto, aquí verás las variaciones de coste automáticamente.</p>}</div><button className="secondary" onClick={onProducts}>Ver productos <ArrowUpRight size={14}/></button></section>
  </div>
}
function Empty({text}:{text:string}){return <div className="emptyState">{text}</div>}
