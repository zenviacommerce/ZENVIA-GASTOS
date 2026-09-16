import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Link2, LoaderCircle, Megaphone, RefreshCw, ShoppingBag, Store } from 'lucide-react';
import { loadAmazonStatus, requestAmazonSync, type AmazonStatus } from '../services/amazon';
import { errorMessage, showError, showSuccess } from '../services/toast';

const externalLinks = [
  { label: 'Seller Central', href: 'https://sellercentral.amazon.es/', Icon: ShoppingBag },
  { label: 'Sellerboard', href: 'https://sellerboard.com/', Icon: Megaphone },
] as const;

function statusLabel(status:AmazonStatus|null,loading:boolean){
  if(loading)return 'Comprobando conexión';
  if(!status?.configured)return 'Pendiente de configurar';
  if(status.connected)return 'Conectado';
  if(status.status==='error')return 'Error de conexión';
  return 'Configurado';
}

export function AmazonPage({ isAdmin }: { isAdmin: boolean }) {
  const [status,setStatus]=useState<AmazonStatus|null>(null);
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [error,setError]=useState('');

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{setStatus(await loadAmazonStatus());}
    catch(e){setError(errorMessage(e,'No se pudo consultar Amazon.'));}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void refresh();},[refresh]);

  const syncNow=async()=>{
    setSyncing(true);
    try{
      const result=await requestAmazonSync();
      showSuccess(result.jobs?`Sincronización solicitada: ${result.jobs} trabajos en cola.`:'Amazon está al día; no se han creado trabajos nuevos.');
      await refresh();
    }catch(e){showError(errorMessage(e,'No se pudo iniciar la sincronización de Amazon.'));}
    finally{setSyncing(false);}
  };

  const connected=Boolean(status?.connected);
  const activeMarketplaces=(status?.marketplaces||[]).filter(item=>item.active);
  const connectionText=status?.configured
    ? connected
      ? `SP-API conectada. ${activeMarketplaces.length} marketplace${activeMarketplaces.length===1?'':'s'} europeo${activeMarketplaces.length===1?'':'s'} activo${activeMarketplaces.length===1?'':'s'}.`
      : status?.error||'Las credenciales están configuradas, pero la conexión todavía no está disponible.'
    : isAdmin
      ? 'Falta completar la configuración segura de Amazon SP-API en el backend.'
      : 'Amazon Analytics todavía no está conectado. El administrador debe completar la configuración.';

  return <div className="page amazonPage">
    <header className="pageHead amazonPageHead">
      <div>
        <div className="eyebrow">AMAZON ANALYTICS</div>
        <h1>Amazon</h1>
        <p>Ventas, costes y rentabilidad de los marketplaces europeos en un único lugar.</p>
      </div>
      <div className="actions amazonExternalLinks">
        {externalLinks.map(({ label, href, Icon }) => <a
          key={label}
          className="secondary amazonExternalLink"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon size={17}/><span>{label}</span><ExternalLink size={14}/>
        </a>)}
        {isAdmin&&<button className="primary amazonSyncButton" onClick={()=>void syncNow()} disabled={syncing||loading||!status?.configured}>
          {syncing?<LoaderCircle size={17} className="spin"/>:<RefreshCw size={17}/>}<span>{syncing?'Sincronizando…':'Sincronizar ahora'}</span>
        </button>}
      </div>
    </header>

    <section className={`card amazonConnectionCard ${connected?'isConnected':status?.status==='error'?'isError':''}`} aria-labelledby="amazon-connection-title">
      <div className="amazonConnectionIcon">{connected?<CheckCircle2 size={23}/>:status?.status==='error'?<AlertTriangle size={23}/>:<Link2 size={23}/>}</div>
      <div className="amazonConnectionBody">
        <span className="amazonSectionLabel">Estado de conexión</span>
        <div className="amazonStatusRow" id="amazon-connection-title">
          <span className="amazonStatusDot" aria-hidden="true"/>
          <strong>{statusLabel(status,loading)}</strong>
        </div>
        <p>{loading?'Comprobando la conexión segura con Amazon SP-API…':error||connectionText}</p>
        {status?.account&&<div className="amazonConnectionMeta">
          <span>{status.account.displayName}</span>
          {status.account.lastSuccessfulSyncAt&&<span>Última sincronización: {new Date(status.account.lastSuccessfulSyncAt).toLocaleString('es-ES')}</span>}
        </div>}
      </div>
    </section>

    <section className="card amazonMarketplacesCard" aria-labelledby="amazon-marketplaces-title">
      <div className="amazonCardHeading">
        <div>
          <span className="amazonSectionLabel">EUROPA</span>
          <strong id="amazon-marketplaces-title">Marketplaces</strong>
        </div>
        <span className="amazonCountBadge">{activeMarketplaces.length} activos</span>
      </div>
      {activeMarketplaces.length?<div className="amazonMarketplaceGrid">
        {activeMarketplaces.map(item=><div className="amazonMarketplaceItem" key={item.id}>
          <div className="amazonMarketplaceFlag">{item.countryCode}</div>
          <div><strong>{item.name}</strong><span>{item.currencyCode} · {item.id}</span></div>
        </div>)}
      </div>:<p className="amazonEmpty">{loading?'Cargando marketplaces…':'No hay marketplaces europeos activos detectados.'}</p>}
    </section>

    <div className="amazonPreviewGrid" aria-label="Fuentes de Amazon Analytics">
      <article className="card amazonPreviewCard">
        <div className="amazonPreviewIcon"><ShoppingBag size={20}/></div>
        <span>SP-API</span>
        <strong>Pedidos, finanzas e inventario</strong>
        <p>{connected?'Backend preparado para sincronizar datos operativos y financieros de Amazon.':'Se activará cuando la conexión SP-API esté disponible.'}</p>
      </article>
      <article className="card amazonPreviewCard">
        <div className="amazonPreviewIcon"><Megaphone size={20}/></div>
        <span>AMAZON ADS</span>
        <strong>Publicidad y atribución</strong>
        <p>La integración de Ads llegará en la siguiente fase para completar ACOS, TACOS y rentabilidad.</p>
      </article>
      <article className="card amazonPreviewCard">
        <div className="amazonPreviewIcon"><Store size={20}/></div>
        <span>SINCRONIZACIÓN</span>
        <strong>{status?.sync.jobCounts.running||0} en curso · {status?.sync.jobCounts.queued||0} en cola</strong>
        <p>{status?.sync.jobCounts.failed?`${status.sync.jobCounts.failed} trabajos requieren reintento.`:'La cola está preparada para cargas incrementales y backfill histórico.'}</p>
      </article>
    </div>
  </div>;
}
