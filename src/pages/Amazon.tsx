import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, LoaderCircle, Megaphone, RefreshCw, ShoppingBag } from 'lucide-react';
import { amazonQuickRange, loadAmazonStatus, requestAmazonSync, type AmazonAnalyticsFilters, type AmazonStatus, type AmazonSummary as AmazonSummaryData } from '../services/amazon';
import { errorMessage, showError, showSuccess } from '../services/toast';
import { AmazonFilters } from '../components/amazon/AmazonFilters';
import { AmazonSummary } from '../components/amazon/AmazonSummary';
import { AmazonProducts } from '../components/amazon/AmazonProducts';
import { AmazonMarketplaces } from '../components/amazon/AmazonMarketplaces';
import { AmazonOrders } from '../components/amazon/AmazonOrders';
import { AmazonInventory } from '../components/amazon/AmazonInventory';
import { AmazonUnmapped } from '../components/amazon/AmazonUnmapped';

const externalLinks=[{label:'Seller Central',href:'https://sellercentral.amazon.es/',Icon:ShoppingBag},{label:'Sellerboard',href:'https://sellerboard.com/',Icon:Megaphone}] as const;
const tabs=[['summary','Resumen'],['products','Productos'],['marketplaces','Marketplaces'],['orders','Pedidos'],['inventory','Inventario'],['unmapped','Sin vincular']] as const;
type AmazonTab=(typeof tabs)[number][0];

function statusLabel(status:AmazonStatus|null,loading:boolean){if(loading)return 'Comprobando';if(!status?.configured)return 'Pendiente';if(status.connected)return 'Conectado';if(status.status==='error')return 'Error';return 'Configurado';}

export function AmazonPage({isAdmin}:{isAdmin:boolean}){
  const [status,setStatus]=useState<AmazonStatus|null>(null);const [loading,setLoading]=useState(true);const [syncing,setSyncing]=useState(false);const [error,setError]=useState('');
  const [activeTab,setActiveTab]=useState<AmazonTab>('summary');
  const [filters,setFilters]=useState<AmazonAnalyticsFilters>(()=>({...amazonQuickRange('current_month',new Date()),marketplaceIds:[]}));
  const [summaryMeta,setSummaryMeta]=useState<AmazonSummaryData|null>(null);

  const refresh=useCallback(async()=>{setLoading(true);setError('');try{setStatus(await loadAmazonStatus());}catch(e){setError(errorMessage(e,'No se pudo consultar Amazon.'));}finally{setLoading(false);}},[]);
  useEffect(()=>{void refresh();},[refresh]);
  const handleSummary=useCallback((summary:AmazonSummaryData)=>setSummaryMeta(summary),[]);
  const syncNow=async()=>{setSyncing(true);try{const result=await requestAmazonSync();showSuccess(result.jobs?`Sincronización solicitada: ${result.jobs} trabajos en cola.`:'Amazon está al día; no se han creado trabajos nuevos.');await refresh();}catch(e){showError(errorMessage(e,'No se pudo iniciar la sincronización de Amazon.'));}finally{setSyncing(false);}};

  const connected=Boolean(status?.connected);const marketplaces=(status?.marketplaces||[]).filter(item=>item.active);const jobs=status?.sync.jobCounts;
  return <div className="page amazonPage">
    <header className="pageHead amazonPageHead"><div><div className="eyebrow">AMAZON ANALYTICS</div><h1>Amazon</h1><p>Ventas, costes, rentabilidad e inventario de tus marketplaces europeos.</p></div><div className="actions amazonExternalLinks">{externalLinks.map(({label,href,Icon})=><a key={label} className="secondary amazonExternalLink" href={href} target="_blank" rel="noopener noreferrer"><Icon size={17}/><span>{label}</span><ExternalLink size={14}/></a>)}{isAdmin&&<button className="primary amazonSyncButton" onClick={()=>void syncNow()} disabled={syncing||loading||!status?.configured}>{syncing?<LoaderCircle size={17} className="spin"/>:<RefreshCw size={17}/>}<span>{syncing?'Sincronizando…':'Sincronizar ahora'}</span></button>}</div></header>

    <section className={`card amazonCompactStatus ${connected?'isConnected':status?.status==='error'?'isError':''}`}><div className="amazonCompactState">{connected?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}<strong>{statusLabel(status,loading)}</strong><span>{status?.account?.displayName||'Amazon SP-API'}</span></div><div className="amazonCompactMeta"><span>{marketplaces.length} marketplaces</span><span>{jobs?.running||0} en curso</span><span>{jobs?.queued||0} en cola</span>{jobs?.failed? <span className="amazonFailed">{jobs.failed} con error</span>:null}{status?.account?.lastSuccessfulSyncAt&&<span>Última sync {new Date(status.account.lastSuccessfulSyncAt).toLocaleString('es-ES')}</span>}</div></section>
    {error&&<div className="amazonError card">{error}</div>}

    {connected?<>
      <AmazonFilters filters={filters} marketplaces={marketplaces} onChange={setFilters}/>
      <nav className="amazonTabs" aria-label="Secciones de Amazon Analytics">{tabs.map(([key,label])=><button key={key} className={activeTab===key?'isActive':''} onClick={()=>setActiveTab(key)}>{label}{key==='unmapped'&&summaryMeta?.unmappedSkuCount? <span>{summaryMeta.unmappedSkuCount}</span>:null}</button>)}</nav>
      {activeTab==='summary'&&<AmazonSummary filters={filters} onLoaded={handleSummary}/>} 
      {activeTab==='products'&&<AmazonProducts filters={filters}/>} 
      {activeTab==='marketplaces'&&<AmazonMarketplaces filters={filters}/>} 
      {activeTab==='orders'&&<AmazonOrders filters={filters}/>} 
      {activeTab==='inventory'&&<AmazonInventory filters={filters}/>} 
      {activeTab==='unmapped'&&<AmazonUnmapped onChanged={()=>setSummaryMeta(null)}/>} 
    </>:<section className="card amazonDisconnected"><strong>Amazon Analytics todavía no está disponible.</strong><p>{loading?'Comprobando la conexión segura con Amazon SP-API…':status?.configured?'Las credenciales están configuradas, pero la conexión no está operativa.':isAdmin?'Completa la configuración segura de Amazon SP-API en el backend.':'El administrador debe completar la conexión con Amazon.'}</p></section>}
  </div>;
}
