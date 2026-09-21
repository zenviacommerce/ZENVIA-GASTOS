import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowUpRight, BadgeEuro, Banknote, Euro, PackageCheck,
  ReceiptText, Scale, ShoppingBag, Truck, XCircle,
} from 'lucide-react';
import { PieChart, Pie, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { Invoice, Product, Supplier } from '../types';
import { StatCard } from '../components/StatCard';
import { PeriodFilterPanel } from '../components/PeriodFilterPanel';
import { defaultDateFilter, periodLabel } from '../services/filters';
import { loadSalesInvoices, type SalesInvoice } from '../services/sales';
import { listFulfillmentOrders, syncSendcloudOrders, type FulfillmentOrder } from '../services/orders';
import { isCancelledOrder, isPendingOrder, orderStatusCode } from '../services/orderStatus';
import { readViewCache, writeViewCache } from '../services/viewCache';
import { useSettings } from '../context/SettingsContext';
import { DASHBOARD_KPI_DEFAULTS, persistRememberedFilter, rememberedFilter, selectedPreferenceKeys } from '../services/uiPreferences';

const colors = ['#0f766e','#2563eb','#7c3aed','#d97706','#64748b','#dc2626','#0891b2'];
const DASHBOARD_SALES_CACHE='dashboard:sales';
const DASHBOARD_ORDERS_CACHE='dashboard:orders';

function orderDate(order:FulfillmentOrder){return order.orderCreatedAt?.slice(0,10)||'';}
function isShippedOrder(order:FulfillmentOrder){
  const status=orderStatusCode(order);
  return ['shipped','fulfilled','delivered','processed','completed'].includes(status);
}

export function Dashboard({invoices,products,suppliers,onUpload,onProducts}:{invoices:Invoice[];products:Product[];suppliers:Supplier[];onUpload?:()=>void;onProducts?:()=>void}){
  const {settings,preferences,updatePreferences}=useSettings();
  const money=(value:number,maximumFractionDigits=2)=>formatAppMoney(value,settings.general.currencyCode,settings.general,{minimumFractionDigits:2,maximumFractionDigits});
  const [filter,setFilter]=useState(()=>rememberedFilter(preferences,'dashboard.period',defaultDateFilter(preferences.defaultPeriod)));
  const [sales,setSales]=useState<SalesInvoice[]>(()=>readViewCache<SalesInvoice[]>(DASHBOARD_SALES_CACHE)||[]);
  const [orders,setOrders]=useState<FulfillmentOrder[]>(()=>readViewCache<FulfillmentOrder[]>(DASHBOARD_ORDERS_CACHE)||[]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void persistRememberedFilter(preferences,updatePreferences,'dashboard.period',filter)},350);
    return()=>window.clearTimeout(timer);
  },[filter,preferences.rememberFilters]);

  useEffect(()=>{
    loadSalesInvoices().then(next=>{setSales(next);writeViewCache(DASHBOARD_SALES_CACHE,next);}).catch(()=>{/* conserva el último valor cacheado */});
  },[]);

  useEffect(()=>{
    let alive=true;
    let inFlight=false;
    const publish=(next:FulfillmentOrder[])=>{if(!alive)return;setOrders(next);writeViewCache(DASHBOARD_ORDERS_CACHE,next);};
    const loadPersisted=async()=>{
      try{publish(await listFulfillmentOrders());}catch{/* El caché mantiene el KPI visible mientras se recupera la lectura. */}
    };
    const refreshOrders=async()=>{
      if(inFlight)return;
      inFlight=true;
      try{
        if(settings.integrations.sendcloudEnabled){try{await syncSendcloudOrders(false,true,true);}catch{/* Sendcloud puede fallar sin vaciar el resumen. */}}
        publish(await listFulfillmentOrders());
      }catch{/* Conserva los KPI existentes ante un fallo puntual de sincronización o lectura. */}
      finally{inFlight=false;}
    };
    // Primero pintamos el estado persistido de Supabase; la sincronización externa ocurre después.
    void loadPersisted();
    void refreshOrders();
    const timer=window.setInterval(()=>void refreshOrders(),Math.max(30,settings.orders.refreshSeconds)*1000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[settings.integrations.sendcloudEnabled,settings.orders.refreshSeconds]);

  const periodExpenses=useMemo(()=>invoices.filter(invoice=>(!filter.from||invoice.invoiceDate>=filter.from)&&(!filter.to||invoice.invoiceDate<=filter.to)),[invoices,filter]);
  const selectedSales=useMemo(()=>sales.filter(invoice=>{
    if(invoice.status==='draft')return false;
    if(filter.from&&invoice.issueDate<filter.from)return false;
    if(filter.to&&invoice.issueDate>filter.to)return false;
    return true;
  }),[sales,filter.from,filter.to]);
  const selectedOrders=useMemo(()=>orders.filter(order=>{
    const date=orderDate(order);
    if(!date)return false;
    if(filter.from&&date<filter.from)return false;
    if(filter.to&&date>filter.to)return false;
    return true;
  }),[orders,filter.from,filter.to]);

  const visibleKpis=new Set(selectedPreferenceKeys(preferences.dashboardKpis,DASHBOARD_KPI_DEFAULTS));
  const showKpi=(key:string)=>visibleKpis.has(key);
  const selectedPeriod=periodLabel(filter);
  const expenseTotal=periodExpenses.reduce((s,i)=>s+i.total,0);
  const inputVat=periodExpenses.reduce((s,i)=>s+i.vat,0);
  const salesTotal=selectedSales.reduce((s,i)=>s+i.totalAmount,0);
  const outputVat=selectedSales.reduce((s,i)=>s+i.taxAmount,0);
  const result=salesTotal-expenseTotal;
  const vatBalance=outputVat-inputVat;
  const receivable=selectedSales.reduce((s,i)=>s+Math.max(0,i.totalAmount-i.paidAmount),0);
  const pending=periodExpenses.filter(i=>i.status==='pending').length;

  const validOrders=selectedOrders.filter(order=>!isCancelledOrder(order));
  const orderCount=validOrders.length;
  const pendingOrders=validOrders.filter(isPendingOrder).length;
  const shippedOrders=validOrders.filter(isShippedOrder).length;
  const cancelledOrders=selectedOrders.filter(isCancelledOrder).length;
  const amazonOrders=validOrders.filter(order=>order.sourceChannel==='amazon').length;
  const shopifyOrders=validOrders.filter(order=>order.sourceChannel==='shopify').length;
  const orderValue=validOrders.reduce((sum,order)=>sum+((order.currency==null||order.currency==='EUR')?(order.totalAmount||0):0),0);

  const byCategory=Object.entries(periodExpenses.reduce<Record<string,number>>((a,i)=>{a[i.category]=(a[i.category]||0)+i.total;return a;},{})).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  const changed=products.filter(p=>p.lastPrice!=null&&p.previousPrice!=null).sort((a,b)=>Math.abs(((b.lastPrice!-b.previousPrice!)/b.previousPrice!))-Math.abs(((a.lastPrice!-a.previousPrice!)/a.previousPrice!)))[0];
  const delta=changed?.previousPrice?((changed.lastPrice!-changed.previousPrice)/changed.previousPrice)*100:null;

  return <div className="page">
    <div className="pageHead"><div><div className="eyebrow">{selectedPeriod}</div><h1>Resumen</h1><p>Visión global de ventas, gastos, pedidos, logística, IVA, cobros y costes de ZENVIA COMMERCE.</p></div>{onUpload&&<button className="primary" onClick={onUpload}>+ Factura de gasto</button>}</div>
    <PeriodFilterPanel filter={filter} onChange={setFilter} title="Periodo global" note="Este periodo se aplica de forma consistente a ventas, gastos y pedidos del resumen."/>

    {[...['sales','expenses','result','vatBalance','receivable','pendingExpenses']].some(showKpi)&&<><div className="dashboardSectionHead"><div><div className="eyebrow">FINANZAS</div><h2>Facturación y gastos</h2><p>{selectedPeriod}</p></div></div>
    <div className="stats filteredStats">{showKpi('sales')&&<StatCard label="Facturación" value={money(salesTotal)} sub={selectedPeriod} icon={<Banknote/>}/>}
      {showKpi('expenses')&&<StatCard label="Gastos" value={money(expenseTotal)} sub={selectedPeriod} icon={<Euro/>}/>}
      {showKpi('result')&&<StatCard label="Resultado" value={money(result)} sub="Ventas − gastos" icon={<Scale/>}/>}
      {showKpi('vatBalance')&&<StatCard label="IVA neto" value={money(vatBalance)} sub={`${money(outputVat)} repercutido · ${money(inputVat)} soportado`} icon={<BadgeEuro/>}/>}
      {showKpi('receivable')&&<StatCard label="Pendiente de cobro" value={money(receivable)} sub="Facturas de venta emitidas" icon={<ReceiptText/>}/>}
      {showKpi('pendingExpenses')&&<StatCard label="Gastos por revisar" value={String(pending)} sub={selectedPeriod} icon={<AlertCircle/>}/>}</div></>}

    {[...['orders','orderValue','pendingOrders','shippedOrders','cancelledOrders']].some(showKpi)&&<><div className="dashboardSectionHead orders"><div><div className="eyebrow">OPERATIVA</div><h2>Pedidos y logística</h2><p>Amazon, Shopify y pedidos manuales · {selectedPeriod}</p></div></div>
    <div className="stats dashboardOrderStats">
      {showKpi('orders')&&<StatCard label="Pedidos" value={String(orderCount)} sub={`Amazon ${amazonOrders} · Shopify ${shopifyOrders}`} icon={<ShoppingBag/>}/>}
      {showKpi('orderValue')&&<StatCard label="Valor de pedidos" value={money(orderValue)} sub="Pedidos no cancelados · no fiscal" icon={<BadgeEuro/>}/>}
      {showKpi('pendingOrders')&&<StatCard className={pendingOrders>0?'dashboardPendingOrders':''} label="Pendientes" value={String(pendingOrders)} sub={pendingOrders>0?'Hay pedidos por preparar / etiquetar':'Sin pedidos pendientes'} icon={<PackageCheck/>}/>}
      {showKpi('shippedOrders')&&<StatCard label="Enviados" value={String(shippedOrders)} sub={selectedPeriod} icon={<Truck/>}/>}
      {showKpi('cancelledOrders')&&<StatCard label="Cancelados" value={String(cancelledOrders)} sub={selectedPeriod} icon={<XCircle/>}/>}
    </div></>}

    <div className="grid2">
      <section className="card"><div className="cardHead"><div><h3>Gasto por categoría</h3><p>Distribución · {selectedPeriod}</p></div></div>{byCategory.length?<div className="chartWrap"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={65} outerRadius={95} paddingAngle={3}>{byCategory.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Pie><Tooltip formatter={(v)=>money(Number(v))}/></PieChart></ResponsiveContainer><div className="legend">{byCategory.map((x,i)=><div key={x.name}><i style={{background:colors[i%colors.length]}}/><span>{x.name}</span><strong>{money(x.value,0)}</strong></div>)}</div></div>:<Empty text="No hay facturas de gastos para los filtros seleccionados."/>}</section>
      <section className="card"><div className="cardHead"><div><h3>Últimos movimientos</h3><p>Ventas y gastos · {selectedPeriod}</p></div></div>{selectedSales.length||periodExpenses.length?<div className="invoiceList">
        {[...selectedSales.slice(0,3).map(i=>({id:`s-${i.id}`,name:i.clientName,date:i.issueDate,detail:i.invoiceNumber||'Factura de venta',amount:i.totalAmount,status:'Venta'})),...periodExpenses.slice(0,3).map(i=>({id:`e-${i.id}`,name:i.supplierName,date:i.invoiceDate,detail:i.category,amount:-i.total,status:'Gasto'}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(item=><div className="invoiceRow" key={item.id}><div className="supplierBadge">{item.name.slice(0,2).toUpperCase()}</div><div className="invoiceMain"><strong>{item.name}</strong><span>{new Date(`${item.date}T12:00:00`).toLocaleDateString('es-ES')} · {item.detail}</span></div><div className="invoiceAmount"><strong>{item.amount>0?'+':''}{money(item.amount)}</strong><span className={item.status==='Venta'?'pill ok':'pill warn'}>{item.status}</span></div></div>)}
      </div>:<Empty text="Todavía no hay movimientos en este periodo."/>}</section>
    </div>
    <section className="card alertCard"><div className="trendIcon"><PackageCheck/></div><div><h3>Control de costes de producto</h3>{changed&&delta!=null?<p>Último cambio destacado: <strong>{changed.name}</strong> está a <strong>{money(changed.lastPrice!,4)}/{changed.unit}</strong> ({delta>0?'+':''}{delta.toFixed(1)} % frente al precio anterior).</p>:<p>Cuando una línea de mercancía se vincule a un producto, aquí verás las variaciones de coste automáticamente.</p>}</div>{onProducts&&<button className="secondary" onClick={onProducts}>Ver productos <ArrowUpRight size={14}/></button>}</section>
  </div>
}
function Empty({text}:{text:string}){return <div className="emptyState">{text}</div>}
