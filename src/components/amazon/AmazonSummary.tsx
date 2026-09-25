import { useEffect, useState } from 'react';
import { ChevronRight, RefreshCw, X } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { isAmazonConnectivityError, loadAmazonDetail, loadAmazonSeries, loadAmazonSummary, type AmazonAnalyticsFilters, type AmazonDetail, type AmazonKpiKey, type AmazonSummary as AmazonSummaryData } from '../../services/amazon';
import { errorMessage } from '../../services/toast';
import { AmazonCompleteness } from './AmazonCompleteness';
import { AmazonProducts } from './AmazonProducts';
import { readViewCache, stableCacheKey, writeViewCache } from '../../services/viewCache';
import { useSettings } from '../../context/SettingsContext';

const integer=new Intl.NumberFormat('es-ES',{maximumFractionDigits:0});
function spanDays(filters:AmazonAnalyticsFilters){return Math.max(1,Math.round((new Date(`${filters.to}T00:00:00`).getTime()-new Date(`${filters.from}T00:00:00`).getTime())/86400000)+1);}
function dateRangeLabel(filters:AmazonAnalyticsFilters){const fmt=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-ES');return fmt(filters.from)+' – '+fmt(filters.to);}
function chartPeriodDate(value:unknown){
  const raw=String(value||'').slice(0,10);
  const parsed=new Date(`${raw}T12:00:00`);
  return Number.isNaN(parsed.getTime())?null:parsed;
}
function chartTickLabel(value:unknown,grain:'day'|'month'){
  const date=chartPeriodDate(value);
  if(!date)return String(value||'');
  if(grain==='month')return date.toLocaleDateString('es-ES',{month:'short',year:'2-digit'}).replace('.','');
  return date.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}).replace('.','');
}
function chartTooltipLabel(value:unknown,grain:'day'|'month'){
  const date=chartPeriodDate(value);
  if(!date)return String(value||'');
  return grain==='month'
    ?date.toLocaleDateString('es-ES',{month:'long',year:'numeric'})
    :date.toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'long',year:'numeric'});
}
function chartMoneyTick(value:unknown,currency:string){
  const amount=Number(value);
  if(!Number.isFinite(amount))return '';
  return new Intl.NumberFormat('es-ES',{
    style:'currency',
    currency,
    maximumFractionDigits:0,
    minimumFractionDigits:0,
  }).format(amount);
}
function DetailRow({label,value,note}:{label:string;value:string;note?:string}){return <div className="amazonDetailsRow"><div><span>{label}</span>{note&&<small>{note}</small>}</div><strong>{value}</strong></div>;}

export function AmazonSummary({filters,onLoaded,refreshToken=0,visibleKpis}:{filters:AmazonAnalyticsFilters;onLoaded?:(summary:AmazonSummaryData)=>void;refreshToken?:number;visibleKpis?:AmazonKpiKey[]}){
  const {settings}=useSettings();
  const money=new Intl.NumberFormat('es-ES',{style:'currency',currency:settings.amazon.consolidatedCurrency});
  const summaryCacheKey=stableCacheKey('amazon:summary',filters);
  const detailCacheKey=stableCacheKey('amazon:detail',filters);
  const seriesCacheKey=stableCacheKey('amazon:series',{...filters,grain:spanDays(filters)>93?'month':'day'});
  const [summary,setSummary]=useState<AmazonSummaryData|null>(()=>readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [detail,setDetail]=useState<AmazonDetail|null>(()=>readViewCache<AmazonDetail>(detailCacheKey));
  const [series,setSeries]=useState<any[]>(()=>readViewCache<any[]>(seriesCacheKey)||[]);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [loading,setLoading]=useState(()=>!readViewCache<AmazonSummaryData>(summaryCacheKey));
  const [error,setError]=useState('');
  const [retryToken,setRetryToken]=useState(0);
  const grain=spanDays(filters)>93?'month':'day';

  useEffect(()=>{
    let alive=true;
    const currentSummaryKey=stableCacheKey('amazon:summary',filters);
    const currentDetailKey=stableCacheKey('amazon:detail',filters);
    const currentSeriesKey=stableCacheKey('amazon:series',{...filters,grain});
    const cachedSummary=readViewCache<AmazonSummaryData>(currentSummaryKey);
    const cachedDetail=readViewCache<AmazonDetail>(currentDetailKey);
    const cachedSeries=readViewCache<any[]>(currentSeriesKey);
    if(cachedSummary){setSummary(cachedSummary);onLoaded?.(cachedSummary);}
    if(cachedDetail)setDetail(cachedDetail);
    if(cachedSeries)setSeries(cachedSeries);
    setLoading(!cachedSummary);setError('');
    const run=async()=>{
      try{
        const nextSummary=await loadAmazonSummary(filters);
        if(!alive)return;
        setSummary(nextSummary);writeViewCache(currentSummaryKey,nextSummary);onLoaded?.(nextSummary);
        // The KPIs are the primary content. Show them as soon as the summary is
        // ready; detail and chart data can finish in parallel without blocking
        // the whole Amazon page.
        setLoading(false);

        const [detailResult,seriesResult]=await Promise.allSettled([
          loadAmazonDetail(filters),
          loadAmazonSeries(filters,grain),
        ]);
        if(!alive)return;
        if(detailResult.status==='fulfilled'){
          setDetail(detailResult.value);writeViewCache(currentDetailKey,detailResult.value);
        }else if(!isAmazonConnectivityError(detailResult.reason)){
          setError(errorMessage(detailResult.reason,'No se pudo cargar el detalle de Amazon.'));
        }
        if(seriesResult.status==='fulfilled'){
          setSeries(seriesResult.value);writeViewCache(currentSeriesKey,seriesResult.value);
        }else if(!isAmazonConnectivityError(seriesResult.reason)){
          setError(errorMessage(seriesResult.reason,'No se pudo cargar la evolución de Amazon.'));
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

  const visibleKpiSet=new Set<AmazonKpiKey>(visibleKpis||[]);
  const showAllKpis=!visibleKpis?.length;
  const cards=[
    {kpiKey:'grossSales' as const,label:'Ventas',value:money.format(summary.grossSales)},
    {kpiKey:'salesVat' as const,label:'IVA ventas',value:money.format(summary.salesVat)},
    {kpiKey:'netSales' as const,label:'Ventas sin IVA',value:money.format(summary.netSales)},
    {kpiKey:'orders' as const,label:'Pedidos',value:integer.format(summary.orders)},
    {kpiKey:'businessOrders' as const,label:'Pedidos B2B',value:integer.format(summary.businessOrders||0)},
    {kpiKey:'units' as const,label:'Unidades vendidas',value:integer.format(summary.units)},
    {kpiKey:'amazonFees' as const,label:'Tarifas Amazon sin IVA',value:money.format(summary.amazonFees)},
    {kpiKey:'adsCost' as const,label:'Publicidad',value:money.format(summary.adsCost)},
    {kpiKey:'refunds' as const,label:'Reembolsos',value:money.format(summary.refunds),note:detail?integer.format(detail.refundTransactions)+' operaciones · '+integer.format(detail.refundOrders)+' pedidos':undefined},
    {kpiKey:'productCost' as const,label:'Coste producto',value:money.format(summary.productCost)},
    {kpiKey:'fbmShippingCost' as const,label:'Coste envíos FBM',value:money.format(summary.fbmShippingCost)},
    {kpiKey:'netProfit' as const,label:'Ganancia neta',value:money.format(summary.netProfit??0),note:!summary.profitComplete?'Provisional':undefined},
    {kpiKey:'marginPct' as const,label:'Margen neto',value:summary.marginPct==null?'—':summary.marginPct.toFixed(1)+' %',note:!summary.profitComplete?'Provisional':undefined},
  ].filter(card=>showAllKpis||visibleKpiSet.has(card.kpiKey));

  return <div className="amazonSummary">
    {error&&<div className="card amazonQueryError"><span>{error}</span><button className="secondary" onClick={()=>setRetryToken(value=>value+1)}><RefreshCw size={15}/> Reintentar</button></div>}
    <AmazonCompleteness data={summary}/>
    <div className="amazonKpiGrid">{cards.map(card=><article className="card amazonKpiCard" key={card.label}><span>{card.label}</span><strong>{card.value}</strong>{card.note&&<small>{card.note}</small>}</article>)}</div>
    <button className="amazonMoreButton" onClick={()=>setDetailsOpen(true)}>Más detalles <ChevronRight size={15}/></button>

    {detailsOpen&&<div className="amazonDetailsBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setDetailsOpen(false)}}>
      <section className="amazonDetailsModal" role="dialog" aria-modal="true" aria-label="Detalle de Amazon">
        <header className="amazonDetailsHead">
          <div><span className="amazonSectionLabel">DETALLE DEL PERIODO</span><h3>Amazon · {dateRangeLabel(filters)}</h3><p>Desglose de los datos que ZENVIA está utilizando en el resumen.</p></div>
          <button onClick={()=>setDetailsOpen(false)} aria-label="Cerrar"><X size={18}/></button>
        </header>
        <div className="amazonDetailsBody">
          <section><h4>Ventas y actividad</h4>
            <DetailRow label="Ventas" value={money.format(summary.grossSales)}/>
            <DetailRow label="Ventas sin IVA" value={money.format(summary.netSales)}/>
            <DetailRow label="IVA ventas" value={money.format(summary.salesVat)}/>
            <DetailRow label="Pedidos únicos" value={integer.format(summary.orders)}/>
            <DetailRow label="Líneas de pedido" value={detail?integer.format(detail.orderLines):'—'} note="Una misma orden puede contener varias líneas/SKU."/>
            <DetailRow label="Pedidos B2B" value={integer.format(summary.businessOrders||0)}/>
            <DetailRow label="Unidades vendidas" value={integer.format(summary.units)}/>
            <DetailRow label="Promociones registradas" value={detail?money.format(-detail.promotionDiscounts):'—'}/>
            <DetailRow label="Envío cobrado al cliente" value={detail?money.format(detail.shippingCharged):'—'} note="No es el coste logístico."/>
          </section>
          <section><h4>Tarifas Amazon</h4>
            <DetailRow label="Tarifas Amazon sin IVA" value={money.format(summary.amazonFees)}/>
            <DetailRow label="Comisiones" value={detail?money.format(detail.commissionFees):'—'}/>
            <DetailRow label="Tarifas FBA" value={detail?money.format(detail.fbaFees):'—'}/>
            <DetailRow label="Digital Services Fee" value={detail?money.format(detail.digitalServicesFees):'—'}/>
            <DetailRow label="Almacenamiento" value={detail?money.format(detail.storageFees):'—'}/>
            <DetailRow label="Otras tarifas Amazon" value={detail?money.format(detail.otherAmazonFees):'—'}/>
            <DetailRow label="IVA soportado tarifas" value={money.format(summary.amazonFeeVat)}/>
            <DetailRow label="Publicidad" value={money.format(summary.adsCost)}/>
          </section>
          <section><h4>Reembolsos</h4>
            <DetailRow label="Operaciones de reembolso" value={detail?integer.format(detail.refundTransactions):'—'} note="Transacciones financieras únicas detectadas por Amazon."/>
            <DetailRow label="Pedidos con reembolso" value={detail?integer.format(detail.refundOrders):'—'}/>
            <DetailRow label="Impacto neto sin IVA" value={money.format(summary.refunds)}/>
            <DetailRow label="Impacto bruto" value={detail?money.format(detail.refundGrossImpact):'—'}/>
            <DetailRow label="IVA asociado" value={detail?money.format(detail.refundTaxImpact):'—'}/>
          </section>
          <section><h4>Costes y rentabilidad</h4>
            <DetailRow label="Coste de producto" value={money.format(summary.productCost)} note={summary.unmappedUnits?integer.format(summary.unmappedUnits)+' uds. todavía sin coste vinculado.':undefined}/>
            <DetailRow label="Coste envíos FBM" value={money.format(summary.fbmShippingCost)}/>
            <DetailRow label="Ajustes Amazon" value={money.format(summary.amazonAdjustments)}/>
            <DetailRow label="Ganancia neta" value={money.format(summary.netProfit??0)} note={!summary.profitComplete?'Provisional por datos pendientes.':undefined}/>
            <DetailRow label="Margen neto" value={summary.marginPct==null?'—':summary.marginPct.toFixed(2)+' %'}/>
          </section>
          <section><h4>Calidad del dato</h4>
            <DetailRow label="SKU sin vincular" value={integer.format(summary.unmappedSkuCount)}/>
            <DetailRow label="Unidades sin vincular" value={integer.format(summary.unmappedUnits)}/>
            <DetailRow label="Pedidos con IVA pendiente" value={integer.format(summary.missingVatOrderCount)}/>
            <DetailRow label="FBM sin coste de envío" value={integer.format(summary.missingFbmShippingCostCount)}/>
            <DetailRow label="Sincronizaciones en cola" value={integer.format(summary.syncQueued)}/>
            <DetailRow label="Sincronizaciones ejecutándose" value={integer.format(summary.syncRunning)}/>
            <DetailRow label="Sincronizaciones con error" value={integer.format(summary.syncFailed)}/>
          </section>
        </div>
      </section>
    </div>}

    <section className="card amazonChartCard">
      <div className="amazonCardHeading"><div><span className="amazonSectionLabel">EVOLUCIÓN</span><strong>Ventas y ganancia neta</strong></div><span className="amazonCountBadge">{grain==='day'?'Diario':'Mensual'}</span></div>
      <div className="amazonChart"><ResponsiveContainer width="100%" height="100%"><LineChart data={series} margin={{top:8,right:16,bottom:0,left:10}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="period" tickFormatter={value=>chartTickLabel(value,grain)} interval="preserveStartEnd" minTickGap={34}/><YAxis width={86} domain={['auto','auto']} tickFormatter={value=>chartMoneyTick(value,settings.amazon.consolidatedCurrency)}/><Tooltip labelFormatter={value=>chartTooltipLabel(value,grain)} formatter={(value:any)=>money.format(Number(value))}/><Legend/><Line type="monotone" dataKey="netSales" name="Ventas sin IVA" stroke="currentColor" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="netProfit" name="Ganancia neta" stroke="currentColor" strokeDasharray="6 4" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div>
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
