import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { loadAmazonProducts, loadAmazonSeries, loadAmazonSummary, type AmazonAnalyticsFilters, type AmazonProductAnalytics, type AmazonSummary as AmazonSummaryData } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { AmazonCompleteness } from './AmazonCompleteness';

const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'});
const integer=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
function spanDays(filters:AmazonAnalyticsFilters){return Math.max(1,Math.round((new Date(`${filters.to}T00:00:00`).getTime()-new Date(`${filters.from}T00:00:00`).getTime())/86400000)+1);}

export function AmazonSummary({filters,onLoaded}:{filters:AmazonAnalyticsFilters;onLoaded?:(summary:AmazonSummaryData)=>void}){
  const [summary,setSummary]=useState<AmazonSummaryData|null>(null);
  const [series,setSeries]=useState<any[]>([]);
  const [products,setProducts]=useState<AmazonProductAnalytics[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const grain=spanDays(filters)>93?'month':'day';

  useEffect(()=>{
    let alive=true;setLoading(true);setError('');
    Promise.all([loadAmazonSummary(filters),loadAmazonSeries(filters,grain),loadAmazonProducts(filters,'',1,100)])
      .then(([nextSummary,nextSeries,nextProducts])=>{if(!alive)return;setSummary(nextSummary);setSeries(nextSeries);setProducts(nextProducts.items);onLoaded?.(nextSummary);})
      .catch(reason=>{if(alive)setError(errorMessage(reason,'No se pudo cargar Amazon Analytics.'));})
      .finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[filters.from,filters.to,filters.marketplaceIds.join(','),grain,onLoaded]);

  const topProfit=useMemo(()=>[...products].filter(row=>row.profitComplete).sort((a,b)=>b.profitBeforeAds-a.profitBeforeAds).slice(0,5),[products]);
  const weakMargin=useMemo(()=>[...products].filter(row=>row.profitComplete&&row.marginPct!=null).sort((a,b)=>(a.marginPct??0)-(b.marginPct??0)).slice(0,5),[products]);

  if(loading&&!summary)return <div className="card amazonLoading">Cargando resumen de Amazon…</div>;
  if(error&&!summary)return <div className="card amazonError">{error}</div>;
  if(!summary)return null;
  const cards=[
    ['Ventas',money.format(summary.grossSales)],['IVA ventas',money.format(summary.salesVat)],['Ventas sin IVA',money.format(summary.netSales)],
    ['Pedidos',integer.format(summary.orders)],['Unidades vendidas',integer.format(summary.units)],['Tarifas Amazon sin IVA',money.format(summary.amazonFees)],
    ['Publicidad',money.format(summary.adsCost)],['Reembolsos',money.format(summary.refunds)],['Coste producto',money.format(summary.productCost)],
    ['Coste envíos FBM',money.format(summary.fbmShippingCost)],['Ganancia neta',money.format(summary.netProfit??0)],['Margen neto',summary.marginPct==null?'—':`${summary.marginPct.toFixed(1)} %`],
  ];
  return <div className="amazonSummary">
    <AmazonCompleteness data={summary}/>
    <div className="amazonKpiGrid">{cards.map(([label,value])=><article className="card amazonKpiCard" key={label}><span>{label}</span><strong>{value}</strong>{(label==='Ganancia neta'||label==='Margen neto')&&!summary.profitComplete&&<small>Incompleto</small>}</article>)}</div>
    <section className="card amazonChartCard"><div className="amazonCardHeading"><div><span className="amazonSectionLabel">EVOLUCIÓN</span><strong>Ventas y ganancia neta</strong></div><span className="amazonCountBadge">{grain==='day'?'Diario':'Mensual'}</span></div>
      <div className="amazonChart"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{top:8,right:16,bottom:0,left:0}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period" tickFormatter={value=>String(value).slice(5)}/><YAxis tickFormatter={value=>`${Math.round(Number(value))}€`}/><Tooltip formatter={(value:any)=>money.format(Number(value))}/><Legend/><Line type="monotone" dataKey="netSales" name="Ventas sin IVA" stroke="currentColor" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="netProfit" name="Ganancia neta" stroke="currentColor" strokeDasharray="6 4" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div>
    </section>
    <div className="amazonBreakdownGrid"><section className="card amazonMiniCard"><span className="amazonSectionLabel">DESGLOSE DE COSTES</span><div className="amazonCostRows"><div><span>Tarifas Amazon sin IVA</span><strong>{money.format(summary.amazonFees)}</strong></div><div><span>IVA soportado tarifas Amazon</span><strong>{money.format(summary.amazonFeeVat)}</strong></div><div><span>Publicidad</span><strong>{money.format(summary.adsCost)}</strong></div><div><span>Coste producto</span><strong>{money.format(summary.productCost)}</strong></div><div><span>Coste envíos FBM</span><strong>{money.format(summary.fbmShippingCost)}</strong></div><div><span>Reembolsos</span><strong>{money.format(summary.refunds)}</strong></div><div><span>Ajustes Amazon</span><strong>{money.format(summary.amazonAdjustments)}</strong></div></div></section>
      <section className="card amazonMiniCard"><span className="amazonSectionLabel">MAYOR BENEFICIO DE PRODUCTO</span>{topProfit.length?topProfit.map(row=><div className="amazonRankRow" key={`${row.sellerSku}-${row.asin}`}><span>{row.productName||row.sellerSku}</span><strong>{money.format(row.profitBeforeAds)}</strong></div>):<p className="amazonEmpty">Aún no hay productos con beneficio completo.</p>}</section>
      <section className="card amazonMiniCard"><span className="amazonSectionLabel">MENOR MARGEN DE PRODUCTO</span>{weakMargin.length?weakMargin.map(row=><div className="amazonRankRow" key={`${row.sellerSku}-${row.asin}`}><span>{row.productName||row.sellerSku}</span><strong>{row.marginPct?.toFixed(1)} %</strong></div>):<p className="amazonEmpty">Aún no hay productos con margen completo.</p>}</section>
    </div>
  </div>;
}
