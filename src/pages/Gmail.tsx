import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, FileText, Link2, Link2Off, LoaderCircle, Mail, Paperclip, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import type { ExpenseCategory } from '../types';
import { connectGmail, disconnectGmail, getCachedGmailConnection, gmailMessageUrl, gmailOAuthConfigured, saveGmailCandidates, searchGmailInvoiceCandidates, updateGmailImport, type GmailCandidate, type GmailConnection } from '../services/gmail';
import { importGmailCandidate } from '../services/gmailImport';
import { loadRecoverableGmailImports } from '../services/invoiceLifecycle';

const formatBytes = (value?: number | null) => {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const statusLabel = (status: GmailCandidate['status']) => status === 'imported' ? 'Importada' : status === 'ignored' ? 'Ignorada' : status === 'error' ? 'Error' : 'Pendiente';

export function GmailPage({ categories, onImported }:{ categories:ExpenseCategory[]; onImported:()=>Promise<void> | void }) {
  const [connection,setConnection]=useState<GmailConnection|null>(()=>getCachedGmailConnection());
  const [imports,setImports]=useState<GmailCandidate[]>([]);
  const [query,setQuery]=useState('');
  const [months,setMonths]=useState(12);
  const [connecting,setConnecting]=useState(false);
  const [scanning,setScanning]=useState(false);
  const [importingId,setImportingId]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');

  const refreshImports=async()=>{
    try { setImports(await loadRecoverableGmailImports()); }
    catch(e){ setError(e instanceof Error?e.message:'No se pudo cargar el historial de Gmail.'); }
  };

  useEffect(()=>{ void refreshImports(); },[]);

  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return !q ? imports : imports.filter(item=>[item.sender||'',item.subject||'',item.attachmentName].some(value=>value.toLowerCase().includes(q)));
  },[imports,query]);

  const connect=async(forceConsent=false)=>{
    setConnecting(true);setError('');setMessage('Abriendo autorización de Google…');
    try{
      const next=await connectGmail(forceConsent);
      setConnection(next);
      setMessage(`Gmail conectado: ${next.email}`);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo conectar Gmail.');setMessage('');}
    finally{setConnecting(false);}
  };

  const disconnect=async()=>{
    setError('');
    await disconnectGmail();
    setConnection(null);
    setMessage('Gmail desconectado de esta sesión.');
  };

  const ensureConnection=async()=>{
    const cached=getCachedGmailConnection();
    if(cached){setConnection(cached);return cached;}
    const next=await connectGmail(false);
    setConnection(next);
    return next;
  };

  const scan=async()=>{
    setScanning(true);setError('');setMessage('Conectando con Gmail…');
    try{
      const active=await ensureConnection();
      const candidates=await searchGmailInvoiceCandidates(active.accessToken,months,setMessage);
      const merged=await saveGmailCandidates(candidates);
      setImports(merged);
      setMessage(candidates.length?`Búsqueda completada: ${candidates.length} adjunto${candidates.length===1?'':'s'} candidato${candidates.length===1?'':'s'} encontrado${candidates.length===1?'':'s'}.`:'Búsqueda completada. No encontramos adjuntos candidatos en ese periodo.');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo buscar en Gmail.');setConnection(getCachedGmailConnection());}
    finally{setScanning(false);}
  };

  const importOne=async(candidate:GmailCandidate)=>{
    if(!candidate.id)return;
    setImportingId(candidate.id);setError('');setMessage(`Importando ${candidate.attachmentName}…`);
    try{
      const active=await ensureConnection();
      await importGmailCandidate(active.accessToken,candidate,categories,setMessage);
      await refreshImports();
      await onImported();
      setMessage(`${candidate.attachmentName} importada como factura pendiente.`);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo importar la factura.');await refreshImports();}
    finally{setImportingId(null);}
  };

  const ignore=async(candidate:GmailCandidate)=>{
    if(!candidate.id)return;
    setError('');
    try{await updateGmailImport(candidate.id,candidate.status==='ignored'?'found':'ignored',candidate.invoiceId||null);await refreshImports();}
    catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar el adjunto.');}
  };

  const pendingCount=imports.filter(item=>item.status==='found'||item.status==='error').length;
  const importedCount=imports.filter(item=>item.status==='imported').length;

  return <div className="page">
    <div className="pageHead"><div><div className="eyebrow">AUTOMATIZACIÓN</div><h1>Facturas desde Gmail</h1><p>Busca adjuntos de facturas, revísalos e impórtalos directamente en ZENVIA Gastos.</p></div><div className="actions">{connection?<><button className="secondary" onClick={disconnect}><Link2Off size={16}/> Desconectar</button><button className="primary" disabled={scanning} onClick={scan}>{scanning?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} Buscar facturas</button></>:<button className="primary" disabled={connecting||!gmailOAuthConfigured()} onClick={()=>connect(true)}>{connecting?<LoaderCircle className="spin" size={16}/>:<Link2 size={16}/>} Conectar Gmail</button>}</div></div>

    {!gmailOAuthConfigured()?<section className="gmailSetup card"><AlertCircle/><div><h3>Falta el Client ID de Google</h3><p>La integración está implementada, pero Google exige un OAuth Client ID para autorizar el acceso de solo lectura a Gmail. Configura <code>VITE_GOOGLE_CLIENT_ID</code> en Vercel y añade el dominio de la aplicación como origen JavaScript autorizado.</p></div></section>:null}

    <section className="gmailHero card"><div className="gmailIcon"><Mail/></div><div className="gmailHeroBody"><h2>{connection?`Conectado a ${connection.email}`:'Conecta el buzón de facturas'}</h2><p>La app solicita únicamente permiso de lectura de Gmail. Busca PDFs e imágenes adjuntas y no elimina, mueve ni modifica correos.</p><div className="gmailControls"><label>Periodo<select value={months} onChange={e=>setMonths(Number(e.target.value))}><option value={3}>3 meses</option><option value={6}>6 meses</option><option value={12}>12 meses</option><option value={24}>24 meses</option></select></label><span><ShieldCheck size={15}/> Acceso solo lectura</span></div></div></section>

    <div className="stats gmailStats"><div className="stat"><div className="statIcon"><Paperclip/></div><div><span>Pendientes</span><strong>{pendingCount}</strong><small>Adjuntos por revisar</small></div></div><div className="stat"><div className="statIcon"><CheckCircle2/></div><div><span>Importadas</span><strong>{importedCount}</strong><small>Facturas creadas</small></div></div><div className="stat"><div className="statIcon"><Sparkles/></div><div><span>Automático</span><strong>IA/OCR</strong><small>Lectura de importes y líneas</small></div></div></div>

    {message&&<div className="success"><CheckCircle2 size={17}/>{message}</div>}
    {error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}

    <div className="toolbar gmailToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por proveedor, asunto o archivo…"/></div>{connection&&<button className="secondary" disabled={scanning} onClick={scan}><RefreshCw size={16}/> Actualizar Gmail</button>}</div>

    <section className="card gmailImports">{shown.length?<div className="gmailImportList">{shown.map(item=>{
      const busy=importingId===item.id;
      const imported=item.status==='imported';
      const reimportable=item.status==='found'&&item.metadata?.reopenReason==='invoice_deleted';
      return <article className="gmailImportRow" key={item.id||`${item.messageId}-${item.attachmentId}`}><div className="gmailFileIcon"><FileText/></div><div className="gmailImportMain"><div className="gmailImportTop"><strong>{item.attachmentName}</strong><span className={`gmailStatus ${item.status}`}>{statusLabel(item.status)}</span></div><span className="gmailSubject">{item.subject||'Sin asunto'}</span><small>{item.sender||'Remitente desconocido'}{item.receivedAt?` · ${new Date(item.receivedAt).toLocaleDateString('es-ES')}`:''}{item.size?` · ${formatBytes(item.size)}`:''}</small>{item.status==='error'&&typeof item.metadata?.lastError==='string'?<em>{item.metadata.lastError}</em>:null}</div><div className="gmailImportActions"><a className="secondary gmailLink" href={gmailMessageUrl(item)} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Ver correo</a>{!imported&&item.status!=='ignored'?<button className="primary" disabled={busy||scanning} onClick={()=>importOne(item)}>{busy?<LoaderCircle className="spin" size={15}/>:<Sparkles size={15}/>} {busy?'Importando…':reimportable?'Reimportar':'Importar'}</button>:null}{!imported?<button className="link" disabled={busy} onClick={()=>ignore(item)}>{item.status==='ignored'?'Recuperar':'Ignorar'}</button>:null}</div></article>})}</div>:<div className="emptyState large">{connection?'Pulsa “Buscar facturas” para revisar los adjuntos encontrados en Gmail.':'Conecta Gmail para empezar a localizar facturas.'}</div>}</section>

    <div className="grid2 gmailFeatures"><section className="card feature"><Sparkles/><h3>Misma lectura inteligente</h3><p>Cada adjunto importado pasa por el mismo lector de PDF/OCR: proveedor, número, fecha, base, IVA, total y líneas de producto. Si es mercancía, los productos nuevos se crean automáticamente.</p></section><section className="card feature"><ShieldCheck/><h3>Siempre pendiente primero</h3><p>Importar desde Gmail crea la factura en estado pendiente. Después puedes abrir el documento original, revisar los datos y decidir cuándo marcarla como revisada o contabilizada.</p></section></div>
  </div>;
}
