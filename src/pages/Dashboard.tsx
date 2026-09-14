import { useEffect, useMemo, useState } from 'react';
import { Euro, ReceiptText, BadgeEuro, AlertCircle, TrendingUp, ArrowUpRight, Banknote, Scale } from 'lucide-react';
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { Invoice, Product, Supplier } from '../types';
import { StatCard } from '../components/StatCard';
import { InvoiceFilters } from '../components/InvoiceFilters';
import { defaultInvoiceFilter, filterInvoices, periodLabel } from '../services/filters';
import { loadSalesInvoices, type SalesInvoice } from '../services/sales';

const colors = ['#0f766e','#2563eb','#7c3aed','#d97706','#64748b','#dc2626','#0891b2'];
const money=(value:number)=>`${value.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2})} €`;
export function Dashboard({invoices,products,suppliers,onUpload,onProducts}:{invoices:Invoice[];products:Product[];suppliers:Supplier[];onUpload?:()=>void;onProducts?:()=>void}){
  const [filter,setFilter]=useState(defaultInvoiceFilter);
  const [sales,setSales]=useState<SalesInvoice[]>([]);
  useEffect(()=>{loadSalesInvoices().then(setSales).catch(()=>setSales([]))},[]);
  const selectedInvoices=useMemo(()=>filterInvoices(invoices,filter),[invoices,filter]);
  const periodExpenses=useMemo(()=>filterInvoices(invoices,{...filter,supplierId:''}),[invoices,filter]);
  const selectedSales=useMemo(()=>sales.filter(invoice=>{
    if(invoice.status==='draft')return false;
    if(filter.from&&invoice.issueDate<filter.from)return false;
    if(filter.to&&invoice.issueDate>filter.to)return false;
    return true;
  }),[sales,filter.from,filter.to]);
  const selectedPeriod=periodLabel(filter);
  const expenseTotal=periodExpenses.reduce((s,i)=>s+i.total,0);
  const inputVat=periodExpenses.reduce((s,i)=>s+i.vat,0);
  const salesTotal=selectedSales.reduce((s,i)=>s+i.totalAmount,0);
  const outputVat=selectedSales.reduce((s,i)=>s+i.taxAmount,0);
  const result=salesTotal-expenseTotal;
  const vatBalance=outputVat-inputVat;
  const receivable=selectedSales.reduce((s,i)=>s+Math.max(0,i.totalAmount-i.paidAmount),0);
  const pending=selectedInvoices.filter(i=>i.status==='pending').length;
  const byCategory=Object.entries(selectedInvoices.reduce<Record<string,number>>((a,i)=>{a[i.category]=(a[i.category]||0)+i.total;return a;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const changed=products.filter(p=>p.lastPrice!=null&&p.previousPrice!=null).sort((a,b)=>Math.abs(((b.lastPrice!-b.previousPrice!)/b.previousPrice!))-Math.abs(((a.lastPrice!-a.previousPrice!)/a.previousPrice!)))[0];
  const delta=changed?.previousPrice?((changed.lastPrice!-changed.previousPrice)/changed.previousPrice)*100:null;
  return <div className="page">
    <div className="pageHead"><div><div className="eyebrow">{selectedPeriod}</div><h1>Resumen</h1><p>Ventas, gastos, IVA, cobros y costes de ZENVIA COMMERCE en un solo sitio.</p></div>{onUpload&&<button className="primary" onClick={onUpload}>+ Factura de gasto</button>}</div>
    <InvoiceFilters filter={filter} onChange={setFilter} invoices={invoices} suppliers={suppliers}/>
    <div className="stats filteredStats"><StatCard label="Facturación" value={money(salesTotal)} sub={selectedPeriod} icon={<Banknote/>}/><StatCard label="Gastos" value={money(expenseTotal)} sub={selectedPeriod} icon={<Euro/>}/><StatCard label="Resultado" value={money(result)} sub="Ventas − gastos" icon={<Scale/>}/><StatCard label="IVA neto" value={money(vatBalance)} sub={`${money(outputVat)} repercutido · ${money(inputVat)} soportado`} icon={<BadgeEuro/>}/><StatCard label="Pendiente de cobro" value={money(receivable)} sub="Facturas de venta emitidas" icon={<ReceiptText/>}/><StatCard label="Gastos por revisar" value={String(pending)} sub={filter.supplierId?'Proveedor filtrado':selectedPeriod} icon={<AlertCircle/>}/></div>
    <div className="grid2">
      <section className="card"><div className="cardHead"><div><h3>Gasto por categoría</h3><p>Distribución · {selectedPeriod}</p></div></div>{byCategory.length?<div className="chartWrap"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3}>{byCategory.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Pie><Tooltip formatter={(v)=>`${Number(v).toFixed(2)} €`}/></PieChart></ResponsiveContainer><div className="legend">{byCategory.map((x,i)=><div key={x.name}><i style={{background:colors[i%colors.length]}}/><span>{x.name}</span><strong>{x.value.toLocaleString('es-ES',{maximumFractionDigits:0})} €</strong></div>)}</div></div>:<Empty text="No hay facturas de gastos para los filtros seleccionados."/>}</section>
      <section className="card"><div className="cardHead"><div><h3>Últimos movimientos</h3><p>Ventas y gastos · {selectedPeriod}</p></div></div>{selectedSales.length||periodExpenses.length?<div className="invoiceList">
        {[...selectedSales.slice(0,3).map(i=>({id:`s-${i.id}`,name:i.clientName,date:i.issueDate,detail:i.invoiceNumber||'Factura de venta',amount:i.totalAmount,status:'Venta'})),...periodExpenses.slice(0,3).map(i=>({id:`e-${i.id}`,name:i.supplierName,date:i.invoiceDate,detail:i.category,amount:-i.total,status:'Gasto'}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(item=><div className="invoiceRow" key={item.id}><div className="supplierBadge">{item.name.slice(0,2).toUpperCase()}</div><div className="invoiceMain"><strong>{item.name}</strong><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString('es-ES')} · {item.detail}</span></div><div className="invoiceAmount"><strong>{item.amount>0?'+':''}{money(item.amount)}</strong><span className={item.status==='Venta'?'pill ok':'pill warn'}>{item.status}</span></div></div>)}
      </div>:<Empty text="Todavía no hay movimientos en este periodo."/>}</section>
    </div>
    <section className="card alertCard"><div className="trendIcon"><TrendingUp/></div><div><h3>Control de costes de producto</h3>{changed&&delta!=null?<p>Último cambio destacado: <strong>{changed.name}</strong> está a <strong>{changed.lastPrice!.toLocaleString('es-ES',{maximumFractionDigits:4})} €/{changed.unit}</strong> ({delta>0?'+':''}{delta.toFixed(1)} % frente al precio anterior).</p>:<p>Cuando una línea de mercancía se vincule a un producto, aquí verás las variaciones de coste automáticamente.</p>}</div>{onProducts&&<button className="secondary" onClick={onProducts}>Ver productos <ArrowUpRight size={14}/></button>}</section>
  </div>
}
function Empty({text}:{text:string}){return <div className="emptyState">{text}</div>}
