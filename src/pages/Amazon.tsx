import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, Megaphone, RefreshCw, ShoppingBag, WifiOff } from 'lucide-react';
import { AMAZON_CONNECTIVITY_EVENT, amazonInitialRange, isAmazonConnectivityError, loadAmazonStatus, requestAmazonSync, resolveAmazonMarketplaceSelection, resolveAmazonVisibleKpis, type AmazonAnalyticsFilters, type AmazonStatus, type AmazonSummary as AmazonSummaryData } from '../services/amazon';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { AmazonFilters } from '../components/amazon/AmazonFilters';
import { AmazonSummary } from '../components/amazon/AmazonSummary';
import { AmazonProducts } from '../components/amazon/AmazonProducts';
import { AmazonMarketplaces } from '../components/amazon/AmazonMarketplaces';
import { AmazonOrders } from '../components/amazon/AmazonOrders';
import { AmazonInventory } from '../components/amazon/AmazonInventory';
import { AmazonUnmapped } from '../components/amazon/AmazonUnmapped';
import { readViewCache, writeViewCache } from '../services/viewCache';
import { useSettings } from '../context/SettingsContext';
import { clearActivities } from '../services/activity';

const externalLinks=[{label:'Seller Central',href:'https://sellercentral.amazon.es/',Icon:ShoppingBag},{label:'Sellerboard',href:'https://sellerboard.com/',Icon:Megaphone}] as const;
const tabs=[['summary','Resumen'],['products','Productos'],['marketplaces','Marketplaces'],['orders','Pedidos'],['inventory','Inventario'],['unmapped','Sin vincular']] as const;
type AmazonTab=(typeof tabs)[number][0];

const AMAZON_STATUS_CACHE='amazon:status';
function statusLabel(status:AmazonStatus|null,loading:boolean){if(loading&&!status)return 'Comprobando';if(!status?.configured)return 'Pendiente de configurar';if(status.connected)return 'Conectado';if(status.status==='error')return 'Error';return 'Configurado';}

export function AmazonPage({isAdmin}:{isAdmin:boolean}){
  const {settings}=useSettings();
  const amazonSettings=settings.amazon;
  const [status,setStatus]=useState<AmazonStatus|null>(()=>readViewCache<AmazonStatus>(AMAZON_STATUS_CACHE));const [loading,setLoading]=useState(()=>!readViewCache<AmazonStatus>(AMAZON_STATUS_CACHE));const [syncing,setSyncing]=useState(false);const [error,setError]=useState('');
  const [activeTab,setActiveTab]=useState<AmazonTab>('summary');
  const [filters,setFilters]=useState<AmazonAnalyticsFilters>(()=>({...amazonInitialRange(amazonSettings,new Date()),marketplaceIds:[]}));
  const [summaryMeta,setSummaryMeta]=useState<AmazonSummaryData|null>(null);
  const [analyticsRefresh,setAnalyticsRefresh]=useState(0);
  const [refreshingAnalytics,setRefreshingAnalytics]=useState(false);
  const [connectivityIssue,setConnectivityIssue]=useState(()=>typeof navigator!=='undefined'&&!navigator.onLine);

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const next=await loadAmazonStatus();
      setStatus(next);writeViewCache(AMAZON_STATUS_CACHE,next);setConnectivityIssue(false);
    }catch(e){
      if(isAmazonConnectivityError(e)){setConnectivityIssue(true);setError('');}
      else setError(errorMessage(e,'No se pudo consultar Amazon.'));
    }finally{setLoading(false);}
  },[]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>()=>clearActivities('amazon'),[]);
  useEffect(()=>{
    const markOffline=()=>{setConnectivityIssue(true);setError('');};
    const markOnline=()=>{setConnectivityIssue(false);void refresh();setAnalyticsRefresh(value=>value+1);};
    const onAmazonConnectivity=()=>markOffline();
    window.addEventListener('offline',markOffline);
    window.addEventListener('online',markOnline);
    window.addEventListener(AMAZON_CONNECTIVITY_EVENT,onAmazonConnectivity);
    return()=>{
      window.removeEventListener('offline',markOffline);
      window.removeEventListener('online',markOnline);
      window.removeEventListener(AMAZON_CONNECTIVITY_EVENT,onAmazonConnectivity);
    };
  },[refresh]);
  const handleSummary=useCallback((summary:AmazonSummaryData)=>setSummaryMeta(summary),[]);
  const syncNow=async()=>{
    if(connectivityIssue){showError('No hay conexión a Internet. La sincronización se reanudará cuando vuelva la conexión.');return;}
    setSyncing(true);
    try{
      const result=await requestAmazonSync();
      showSuccess(result.jobs?`Sincronización solicitada: ${result.jobs} trabajos en cola.`:'Amazon está al día; no se han creado trabajos nuevos.');
      await refresh();
    }catch(e){
      if(!isAmazonConnectivityError(e))showError(errorMessage(e,'No se pudo iniciar la sincronización de Amazon.'));
    }finally{setSyncing(false);}
  };
  const refreshAnalytics=()=>{
    if(connectivityIssue){setError('');return;}
    setRefreshingAnalytics(true);
    setAnalyticsRefresh(value=>value+1);
    window.setTimeout(()=>setRefreshingAnalytics(false),1200);
  };

  const connected=Boolean(status?.connected);
  const marketplaceSelection=resolveAmazonMarketplaceSelection(status?.marketplaces||[],amazonSettings);
  const marketplaces=marketplaceSelection.marketplaces;
  const visibleKpis=resolveAmazonVisibleKpis(amazonSettings);
  const defaultPreset=amazonSettings.defaultPeriod==='all'?'custom':amazonSettings.defaultPeriod;
  const jobs=status?.sync.jobCounts;

  useEffect(()=>{
    if(!connected||!marketplaces.length)return;
    setFilters(current=>{
      // An empty selection means "Todos" and is the default. Only clean up
      // marketplaces that are no longer available; never force the primary one.
      if(!current.marketplaceIds.length)return current;
      const valid=current.marketplaceIds.filter(id=>marketplaces.some(item=>item.id===id));
      return valid.length===current.marketplaceIds.length?current:{...current,marketplaceIds:valid};
    });
  },[connected,marketplaces.map(item=>item.id).join(',')]);
  return <div className="page amazonPage">
    <header className="pageHead amazonPageHead"><div><div className="eyebrow">AMAZON ANALYTICS</div><h1>Amazon</h1><p>Ventas, costes, rentabilidad e inventario de tus marketplaces europeos.</p></div><div className="actions amazonExternalLinks">{externalLinks.map(({label,href,Icon})=><a key={label} className="secondary amazonExternalLink" href={href} target="_blank" rel="noopener noreferrer"><Icon size={17}/><span>{label}</span><ExternalLink size={14}/></a>)}{connected&&<button className="secondary amazonRefreshView" onClick={refreshAnalytics} disabled={refreshingAnalytics}>{<RefreshCw size={17} className={refreshingAnalytics?'spin':''}/>}<span>{refreshingAnalytics?'Actualizando…':'Actualizar datos'}</span></button>}{isAdmin&&<button className="primary amazonSyncButton" onClick={()=>void syncNow()} disabled={syncing||loading||!status?.configured}>{syncing?<LoaderCircle size={17} className="spin"/>:<RefreshCw size={17}/>}<span>{syncing?'Sincronizando…':'Sincronizar ahora'}</span></button>}</div></header>

    <section aria-label="Estado de conexión" className={`card amazonCompactStatus ${connected?'isConnected':status?.status==='error'?'isError':''}`}><div className="amazonCompactState">{connected?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}<strong>{statusLabel(status,loading)}</strong><span>{status?.account?.displayName||'Amazon SP-API'}</span></div><div className="amazonCompactMeta"><span>{marketplaces.length} marketplaces</span><span>{jobs?.running||0} en curso</span><span>{jobs?.queued||0} en cola</span>{jobs?.failed? <span className="amazonFailed">{jobs.failed} con error</span>:null}{status?.account?.lastSuccessfulSyncAt&&<span>Última sync {new Date(status.account.lastSuccessfulSyncAt).toLocaleString('es-ES')}</span>}</div></section>
    {connectivityIssue&&<div className="amazonOfflineNotice card"><WifiOff size={18}/><div><strong>Sin conexión a Internet</strong><span>Mostrando los últimos datos guardados. Amazon se actualizará automáticamente cuando vuelva la conexión.</span></div><button className="secondary" onClick={()=>{if(navigator.onLine){setConnectivityIssue(false);void refresh();setAnalyticsRefresh(value=>value+1);}}}><RefreshCw size={15}/> Reintentar</button></div>}
    {error&&<div className="amazonQueryError card"><span>{error}</span><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={15}/> Reintentar</button></div>}

    {connected?<>
      <AmazonFilters filters={filters} marketplaces={marketplaces} initialPreset={defaultPreset} onChange={setFilters}/>
      <nav className="amazonTabs" aria-label="Secciones de Amazon Analytics">{tabs.map(([key,label])=><button key={key} className={activeTab===key?'isActive':''} onClick={()=>setActiveTab(key)}>{label}{key==='unmapped'&&summaryMeta?.unmappedSkuCount? <span>{summaryMeta.unmappedSkuCount}</span>:null}</button>)}</nav>
      {activeTab==='summary'&&<AmazonSummary filters={filters} onLoaded={handleSummary} refreshToken={analyticsRefresh} visibleKpis={visibleKpis}/>} 
      {activeTab==='products'&&<AmazonProducts filters={filters} refreshToken={analyticsRefresh}/>} 
      {activeTab==='marketplaces'&&<AmazonMarketplaces filters={filters} refreshToken={analyticsRefresh}/>} 
      {activeTab==='orders'&&<AmazonOrders filters={filters} marketplaces={marketplaces} refreshToken={analyticsRefresh}/>} 
      {activeTab==='inventory'&&<AmazonInventory filters={filters} marketplaces={marketplaces} refreshToken={analyticsRefresh}/>} 
      {activeTab==='unmapped'&&<AmazonUnmapped onChanged={()=>setSummaryMeta(null)} refreshToken={analyticsRefresh} defaultConsumptionFactor={amazonSettings.defaultConsumptionFactor}/>} 
    </>:<section className="card amazonDisconnected"><strong>Amazon Analytics todavía no está disponible.</strong><p>{loading?'Comprobando la conexión segura con Amazon SP-API…':status?.configured?'Las credenciales están configuradas, pero la conexión no está operativa.':isAdmin?'Completa la configuración segura de Amazon SP-API en el backend.':'El administrador debe completar la conexión con Amazon.'}</p></section>}
  </div>;
}
