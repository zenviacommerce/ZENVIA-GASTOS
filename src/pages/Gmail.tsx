import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Eye, FileText,
  Link2, Link2Off, LoaderCircle, Mail, Paperclip, RefreshCw, Search, ShieldCheck,
  Sparkles, X,
} from 'lucide-react';
import type { ExpenseCategory } from '../types';
import {
  connectGmail, disconnectGmail, downloadGmailAttachment, getCachedGmailConnection,
  gmailMessageUrl, gmailOAuthConfigured, saveGmailCandidates, updateGmailImport,
  type GmailCandidate, type GmailConnection,
} from '../services/gmail';
import { isDecorativeGmailImage, searchGmailInvoiceCandidatesStable } from '../services/gmailStableSearch';
import { importGmailCandidate } from '../services/gmailImport';
import { loadRecoverableGmailImports } from '../services/invoiceLifecycle';

const PAGE_SIZE = 20;

const formatBytes = (value?: number | null) => {
  if (!value) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const statusLabel = (status: GmailCandidate['status']) => (
  status === 'imported' ? 'Importada' : status === 'ignored' ? 'Ignorada' : status === 'error' ? 'Error' : 'Pendiente'
);

export function GmailPage({ categories, onImported }:{ categories:ExpenseCategory[]; onImported:()=>Promise<void> | void }) {
  const [connection,setConnection]=useState<GmailConnection|null>(()=>getCachedGmailConnection());
  const [imports,setImports]=useState<GmailCandidate[]>([]);
  const [query,setQuery]=useState('');
  const [months,setMonths]=useState(12);
  const [page,setPage]=useState(1);
  const [connecting,setConnecting]=useState(false);
  const [scanning,setScanning]=useState(false);
  const [importingId,setImportingId]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [previewItem,setPreviewItem]=useState<GmailCandidate|null>(null);
  const [previewUrl,setPreviewUrl]=useState('');
  const [previewLoading,setPreviewLoading]=useState(false);
  const [previewError,setPreviewError]=useState('');

  const refreshImports=async()=>{
    try { setImports(await loadRecoverableGmailImports()); }
    catch(e){ setError(e instanceof Error?e.message:'No se pudo cargar el historial de Gmail.'); }
  };

  useEffect(()=>{ void refreshImports(); },[]);
  useEffect(()=>()=>{ if(previewUrl) URL.revokeObjectURL(previewUrl); },[previewUrl]);
  useEffect(()=>{ setPage(1); },[query]);

  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return imports
      // Conservamos las ya importadas por trazabilidad, pero ocultamos falsos positivos
      // decorativos pendientes/ignorados que vinieron de firmas de correo.
      .filter(item=>item.status==='imported'||!isDecorativeGmailImage(item))
      .filter(item=>!q||[item.sender||'',item.subject||'',item.attachmentName].some(value=>value.toLowerCase().includes(q)));
  },[imports,query]);

  const totalPages=Math.max(1,Math.ceil(shown.length/PAGE_SIZE));
  useEffect(()=>{ setPage(current=>Math.min(current,totalPages)); },[totalPages]);
  const paged=useMemo(()=>shown.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[shown,page]);
  const pageFrom=shown.length?(page-1)*PAGE_SIZE+1:0;
  const pageTo=Math.min(page*PAGE_SIZE,shown.length);

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
      const knownMessageIds=new Set(imports.map(item=>item.messageId).filter(Boolean));
      const result=await searchGmailInvoiceCandidatesStable(active.accessToken,months,active.email,knownMessageIds,setMessage);
      const merged=await saveGmailCandidates(result.candidates);
      setImports(merged);
      setPage(1);

      const totalLabel=`${result.truncated?'al menos ':''}${result.totalMessages}`;
      const foundLabel=result.candidates.length
        ? ` Se encontraron ${result.candidates.length} adjunto${result.candidates.length===1?'':'s'} candidato${result.candidates.length===1?'':'s'} nuevo${result.candidates.length===1?'':'s'}.`
        : '';

      if(result.remainingMessages>0){
        setMessage(`Gmail encontró ${totalLabel} correos con adjuntos compatibles en el periodo. En esta pasada se revisaron ${result.newMessages} nuevos; ${result.cachedMessages} ya estaban revisados y quedan ${result.remainingMessages} por revisar.${foundLabel} Pulsa «Actualizar Gmail» para continuar.`);
      }else if(result.skippedMessages>0){
        setMessage(`Actualización completada sobre ${totalLabel} correos localizados. ${result.skippedMessages} correo${result.skippedMessages===1?'':'s'} se omitieron temporalmente por límites de Gmail.${foundLabel} Puedes volver a actualizar más tarde.`);
      }else if(result.newMessages===0){
        setMessage(`Gmail al día. Se localizaron ${totalLabel} correos con adjuntos compatibles y todos ya estaban revisados.`);
      }else if(result.candidates.length){
        setMessage(`Búsqueda completada: ${totalLabel} correos con adjuntos compatibles en el periodo; se revisaron ${result.newMessages} nuevos y se encontraron ${result.candidates.length} adjunto${result.candidates.length===1?'':'s'} candidato${result.candidates.length===1?'':'s'}.`);
      }else{
        setMessage(`Gmail actualizado. Se localizaron ${totalLabel} correos con adjuntos compatibles; se revisaron ${result.newMessages} nuevos y no contenían nuevas facturas.`);
      }
    }catch(e){
      setError(e instanceof Error?e.message:'No se pudo buscar en Gmail.');
      setConnection(getCachedGmailConnection());
    }finally{setScanning(false);}
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

  const closePreview=()=>{
    setPreviewItem(null);setPreviewUrl('');setPreviewError('');setPreviewLoading(false);
  };

  const previewOne=async(candidate:GmailCandidate)=>{
    setPreviewItem(candidate);setPreviewUrl('');setPreviewError('');setPreviewLoading(true);
    try{
      const active=await ensureConnection();
      const file=await downloadGmailAttachment(active.accessToken,candidate);
      setPreviewUrl(URL.createObjectURL(file));
    }catch(e){
      setPreviewError(e instanceof Error?e.message:'No se pudo abrir el adjunto de Gmail.');
      setConnection(getCachedGmailConnection());
    }finally{setPreviewLoading(false);}
  };

  const pendingCount=imports.filter(item=>(item.status==='found'||item.status==='error')&&!isDecorativeGmailImage(item)).length;
  const importedCount=imports.filter(item=>item.status==='imported').length;
  const previewIsPdf=Boolean(previewItem&&(previewItem.mimeType==='application/pdf'||previewItem.attachmentName.toLowerCase().endsWith('.pdf')));
  const previewCanImport=Boolean(previewItem&&previewItem.status!=='imported'&&previewItem.status!=='ignored');

  return <div className="page">
    <div className="pageHead">
      <div><div className="eyebrow">AUTOMATIZACIÓN</div><h1>Facturas desde Gmail</h1><p>Busca adjuntos de facturas, revísalos e impórtalos directamente en ZENVIA Gastos.</p></div>
      <div className="actions">{connection?<><button className="secondary" onClick={disconnect}><Link2Off size={16}/> Desconectar</button><button className="primary" disabled={scanning} onClick={scan}>{scanning?<LoaderCircle className="spin" size={16}/>:<RefreshCw size={16}/>} Buscar facturas</button></>:<button className="primary" disabled={connecting||!gmailOAuthConfigured()} onClick={()=>connect(true)}>{connecting?<LoaderCircle className="spin" size={16}/>:<Link2 size={16}/>} Conectar Gmail</button>}</div>
    </div>

    {!gmailOAuthConfigured()?<section className="gmailSetup card"><AlertCircle/><div><h3>Falta el Client ID de Google</h3><p>La integración está implementada, pero Google exige un OAuth Client ID para autorizar el acceso de solo lectura a Gmail. Configura <code>VITE_GOOGLE_CLIENT_ID</code> en Vercel y añade el dominio de la aplicación como origen JavaScript autorizado.</p></div></section>:null}

    <section className="gmailHero card"><div className="gmailIcon"><Mail/></div><div className="gmailHeroBody"><h2>{connection?`Conectado a ${connection.email}`:'Conecta el buzón de facturas'}</h2><p>La app solicita únicamente permiso de lectura de Gmail. Busca PDFs e imágenes adjuntas y no elimina, mueve ni modifica correos.</p><div className="gmailControls"><label>Periodo<select value={months} onChange={e=>setMonths(Number(e.target.value))}><option value={3}>3 meses</option><option value={6}>6 meses</option><option value={12}>12 meses</option><option value={24}>24 meses</option></select></label><span><ShieldCheck size={15}/> Acceso solo lectura</span></div></div></section>

    <div className="stats gmailStats"><div className="stat"><div className="statIcon"><Paperclip/></div><div><span>Pendientes</span><strong>{pendingCount}</strong><small>Adjuntos por revisar</small></div></div><div className="stat"><div className="statIcon"><CheckCircle2/></div><div><span>Importadas</span><strong>{importedCount}</strong><small>Facturas creadas</small></div></div><div className="stat"><div className="statIcon"><Sparkles/></div><div><span>Automático</span><strong>IA/OCR</strong><small>Lectura de importes y líneas</small></div></div></div>

    {message&&<div className="success"><CheckCircle2 size={17}/>{message}</div>}
    {error&&<div className="errorBox"><AlertCircle size={17}/>{error}</div>}

    <div className="toolbar gmailToolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar por proveedor, asunto o archivo…"/></div>{connection&&<button className="secondary" disabled={scanning} onClick={scan}><RefreshCw size={16}/> Actualizar Gmail</button>}</div>

    <section className="card gmailImports">
      {shown.length?<>
        <div className="gmailImportList">{paged.map(item=>{
          const busy=importingId===item.id;
          const imported=item.status==='imported';
          const reimportable=item.status==='found'&&item.metadata?.reopenReason==='invoice_deleted';
          return <article className="gmailImportRow" key={item.id||`${item.messageId}-${item.attachmentId}`}>
            <div className="gmailFileIcon"><FileText/></div>
            <div className="gmailImportMain"><div className="gmailImportTop"><strong>{item.attachmentName}</strong><span className={`gmailStatus ${item.status}`}>{statusLabel(item.status)}</span></div><span className="gmailSubject">{item.subject||'Sin asunto'}</span><small>{item.sender||'Remitente desconocido'}{item.receivedAt?` · ${new Date(item.receivedAt).toLocaleDateString('es-ES')}`:''}{item.size?` · ${formatBytes(item.size)}`:''}</small>{item.status==='error'&&typeof item.metadata?.lastError==='string'?<em>{item.metadata.lastError}</em>:null}</div>
            <div className="gmailImportActions"><button className="secondary" disabled={busy||previewLoading} onClick={()=>previewOne(item)}><Eye size={15}/> Ver factura</button><a className="secondary gmailLink" href={gmailMessageUrl(item)} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Ver correo</a>{!imported&&item.status!=='ignored'?<button className="primary" disabled={busy||scanning} onClick={()=>importOne(item)}>{busy?<LoaderCircle className="spin" size={15}/>:<Sparkles size={15}/>} {busy?'Importando…':reimportable?'Reimportar':'Importar'}</button>:null}{!imported?<button className="link" disabled={busy} onClick={()=>ignore(item)}>{item.status==='ignored'?'Recuperar':'Ignorar'}</button>:null}</div>
          </article>})}</div>
        <div className="gmailPagination"><span>Mostrando <strong>{pageFrom}-{pageTo}</strong> de <strong>{shown.length}</strong></span><div><button className="secondary" disabled={page<=1} onClick={()=>setPage(current=>Math.max(1,current-1))}><ChevronLeft size={15}/> Anterior</button><span>Página {page} de {totalPages}</span><button className="secondary" disabled={page>=totalPages} onClick={()=>setPage(current=>Math.min(totalPages,current+1))}>Siguiente <ChevronRight size={15}/></button></div></div>
      </>:<div className="emptyState large">{connection?'No hay adjuntos de factura que coincidan con la búsqueda.':'Conecta Gmail para empezar a localizar facturas.'}</div>}
    </section>

    <div className="grid2 gmailFeatures"><section className="card feature"><Sparkles/><h3>Misma lectura inteligente</h3><p>Cada adjunto importado pasa por el mismo lector de PDF/OCR: proveedor, número, fecha, base, IVA, total y líneas de producto. Si es mercancía, los productos nuevos se crean automáticamente.</p></section><section className="card feature"><ShieldCheck/><h3>Siempre pendiente primero</h3><p>Importar desde Gmail crea la factura en estado pendiente. Después puedes abrir el documento original, revisar los datos y decidir cuándo marcarla como revisada o contabilizada.</p></section></div>

    {previewItem&&<div className="modalBackdrop gmailPreviewBackdrop" onMouseDown={closePreview}><section className="modal gmailPreviewModal" onMouseDown={e=>e.stopPropagation()}><div className="gmailPreviewHead"><div><span className={`gmailStatus ${previewItem.status}`}>{statusLabel(previewItem.status)}</span><h3>{previewItem.attachmentName}</h3><small>{previewItem.sender||'Remitente desconocido'}{previewItem.receivedAt?` · ${new Date(previewItem.receivedAt).toLocaleDateString('es-ES')}`:''}</small></div><button className="iconBtn" onClick={closePreview} aria-label="Cerrar vista previa"><X size={18}/></button></div><div className="gmailPreviewBody">{previewLoading?<div className="gmailPreviewLoading"><LoaderCircle className="spin"/><span>Descargando adjunto desde Gmail…</span></div>:previewError?<div className="gmailPreviewError"><AlertCircle/><span>{previewError}</span></div>:previewUrl?(previewIsPdf?<iframe className="gmailPdfFrame" src={previewUrl} title={`Vista previa de ${previewItem.attachmentName}`}/>:<img className="gmailImagePreview" src={previewUrl} alt={previewItem.attachmentName}/>):null}</div><div className="gmailPreviewActions"><a className="secondary gmailLink" href={gmailMessageUrl(previewItem)} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Ver correo</a>{previewUrl&&<a className="secondary gmailLink" href={previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Abrir aparte</a>}{previewCanImport&&<button className="primary" disabled={importingId===previewItem.id||previewLoading||Boolean(previewError)} onClick={()=>{const item=previewItem;closePreview();void importOne(item)}}><Sparkles size={15}/> {previewItem.metadata?.reopenReason==='invoice_deleted'?'Reimportar':'Importar'}</button>}<button className="link" onClick={closePreview}>Cerrar</button></div></section></div>}
  </div>;
}
