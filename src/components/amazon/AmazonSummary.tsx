import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { isAmazonConnectivityError, loadAmazonSeries, loadAmazonSummary, type AmazonAnalyticsFilters, type AmazonSummary as AmazonSummaryData } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { AmazonCompleteness } from './AmazonCompleteness';
import { AmazonProducts } from './AmazonProducts';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';

const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'});
const integer=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
function spanDays(filters:AmazonAnalyticsFilters){return Math.max(1,Math.round((new Date(`${filters.to}T00:00:00`).getTime()-new Date(`${filters.from}T00:00:00`).getTime())/86400000)+1);}

export function AmazonSummary({filters,onLoaded,refreshToken=0}:{filters:AmazonAnalyticsFilters;onLoaded?:(summary:AmazonSummaryData)=>void;refreshToken?:number}){
  const summaryCacheKey=stableCacheKey('amazon:summary',filters);
  const seriesCacheKey=stableCacheKey('amazon:series',{...filters,grain:spanDays(filters)>93?'month':'day'});
  const [summary,setSummary]=useState<AmazonSummaryData|null>(()=>readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [series,setSeries]=useState<any[]>(()=>readViewCache<any[]>(seriesCacheKey)||[]);
  const [loading,setLoading]=useState(()=>!readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [error,setError]=useState('');
  const [retryToken,setRetryToken]=useState(0);
  const grain=spanDays(filters)>93?'month':'day';

  useEffect(()=>{
    let alive=true;
    const currentSummaryKey=stableCacheKey('amazon:summary',filters);
    const currentSeriesKey=stableCacheKey('amazon:series',{...filters,grain});
    const cachedSummary=readViewCache<AmazonSummaryData>(currentSummaryKey);
    const cachedSeries=readViewCache<any[]>(currentSeriesKey);
    if(cachedSummary){setSummary(cachedSummary);onLoaded?.(cachedSummary);}
    if(cachedSeries)setSeries(cachedSeries);
    setLoading(!cachedSummary);setError('');
    const run=async()=>{
      try{
        const nextSummary=await loadAmazonSummary(filters);
        if(!alive)return;
        setSummary(nextSummary);writeViewCache(currentSummaryKey,nextSummary);onLoaded?.(nextSummary);
        try{
          const nextSeries=await loadAmazonSeries(filters,grain);
          if(alive){setSeries(nextSeries);writeViewCache(currentSeriesKey,nextSeries);}
        }catch(reason){
          if(alive&&!isAmazonConnectivityError(reason))setError(errorMessage(reason,'No se pudo cargar la evolución de Amazon.'));
        }
      }catch(reason){
        if(alive&&!isAmazonConnectivityError(reason))setError(errorMessage(reason,'No se pudo cargar Amazon Analytics.'));
      }finally{
        if(alive)setLoading(false);
      }
    };
    void run();
    return()=>{alive=false;};
  },[filters.from,filters.to,filters.marketplaceIds.join(','),grain,onLoaded,refreshToken,retryToken]);

  if(loading&&!summary)return <div className="card amazonLoading">Cargando resumen de Amazon…</div>;
  if(error&&!summary)return <div className="card amazonQueryError"><span>{error}</span><button className="secondary" onClick={()=>setRetryToken(value=>value+1)}><RefreshCw size={15}/> Reintentar</button></div>;
  if(!summary)return null;

  const cards=[
    ['Ventas',money.format(summary.grossSales)],
    ['IVA ventas',money.format(summary.salesVat)],
    ['Ventas sin IVA',money.format(summary.netSales)],
    ['Pedidos',integer.format(summary.orders)],
    ['Pedidos B2B',integer.format(summary.businessOrders||0)],
    ['Unidades vendidas',integer.format(summary.units)],
    ['Tarifas Amazon sin IVA',money.format(summary.amazonFees)],
    ['Publicidad',money.format(summary.adsCost)],
    ['Reembolsos',money.format(summary.refunds)],
    ['Coste producto',money.format(summary.productCost)],
    ['Coste envíos FBM',money.format(summary.fbmShippingCost)],
    ['Ganancia neta',money.format(summary.netProfit??0)],
    ['Margen neto',summary.marginPct==null?'—':`${summary.marginPct.toFixed(1)} %`],
  ];

  return <div className="amazonSummary">
    {error&&<div className="card amazonQueryError"><span>{error}</span><button className="secondary" onClick={()=>setRetryToken(value=>value+1)}><RefreshCw size={15}/> Reintentar</button></div>}
    <AmazonCompleteness data={summary}/>
    <div className="amazonKpiGrid">{cards.map(([label,value])=><article className="card amazonKpiCard" key={label}><span>{label}</span><strong>{value}</strong>{(label==='Ganancia neta'||label==='Margen neto')&&!summary.profitComplete&&<small>Provisional</small>}</article>)}</div>

    <section className="card amazonChartCard">
      <div className="amazonCardHeading"><div><span className="amazonSectionLabel">EVOLUCIÓN</span><strong>Ventas y ganancia neta</strong></div><span className="amazonCountBadge">{grain==='day'?'Diario':'Mensual'}</span></div>
      <div className="amazonChart"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{top:8,right:16,bottom:0,left:0}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period" tickFormatter={value=>String(value).slice(5)}/><YAxis tickFormatter={value=>`${Math.round(Number(value))}€`}/><Tooltip formatter={(value:any)=>money.format(Number(value))}/><Legend/><Line type="monotone" dataKey="netSales" name="Ventas sin IVA" stroke="currentColor" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="netProfit" name="Ganancia neta" stroke="currentColor" strokeDasharray="6 4" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div>
    </section>

    {!loading&&<AmazonProducts filters={filters} embedded refreshToken={refreshToken}/>} 

    <section className="card amazonMiniCard amazonCostBreakdownWide">
      <span className="amazonSectionLabel">DESGLOSE DE COSTES</span>
      <div className="amazonCostRows amazonCostRowsGrid">
        <div><span>Tarifas Amazon sin IVA</span><strong>{money.format(summary.amazonFees)}</strong></div>
        <div><span>IVA soportado tarifas Amazon</span><strong>{money.format(summary.amazonFeeVat)}</strong></div>
        <div><span>Publicidad</span><strong>{money.format(summary.adsCost)}</strong></div>
        <div><span>Coste producto</span><strong>{money.format(summary.productCost)}</strong></div>
        <div><span>Coste envíos FBM</span><strong>{money.format(summary.fbmShippingCost)}</strong></div>
        <div><span>Reembolsos</span><strong>{money.format(summary.refunds)}</strong></div>
        <div><span>Ajustes Amazon</span><strong>{money.format(summary.amazonAdjustments)}</strong></div>
      </div>
    </section>
  </div>;
}
