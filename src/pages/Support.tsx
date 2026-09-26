import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bug, CheckCircle2, Clock3, FilePlus2, Lightbulb, LifeBuoy, MessageCircle, Paperclip, RefreshCw, Search, Send, X } from 'lucide-react';
import { SelectField } from '../components/forms/SelectField';
import { createSupportTicket, listSupportTickets, loadSupportTicket, replySupportTicket, supportAttachmentUrl, type SupportAttachment, type SupportTicket, type SupportTicketDetail, type SupportTicketPriority, type SupportTicketStatus, type SupportTicketType } from '../services/support';
import { errorMessage, showError, showSuccess } from '../services/toast';
import '../support.css';

const statusLabels:Record<SupportTicketStatus,string>={
  open:'Abierto',
  in_progress:'En curso',
  waiting_user:'Esperando usuario',
  resolved:'Resuelto',
  closed:'Cerrado',
};
const priorityLabels:Record<SupportTicketPriority,string>={low:'Baja',normal:'Normal',high:'Alta',urgent:'Urgente'};
const typeLabels:Record<SupportTicketType,string>={incident:'Incidencia',request:'Petición'};

function dateTime(value:string){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'—':date.toLocaleString('es-ES',{dateStyle:'short',timeStyle:'short'});
}
function fileSize(value:number){
  if(value<1024)return String(value)+' B';
  if(value<1024*1024)return (value/1024).toFixed(1)+' KB';
  return (value/(1024*1024)).toFixed(1)+' MB';
}

export function SupportPage({isAdmin,currentUserId}:{isAdmin:boolean;currentUserId:string}){
  const [scope,setScope]=useState<'mine'|'all'>(isAdmin?'all':'mine');
  const [tickets,setTickets]=useState<SupportTicket[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [creating,setCreating]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState('');
  const [type,setType]=useState('');

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{setTickets(await listSupportTickets(scope))}
    catch(e){setError(errorMessage(e,'No se pudieron cargar los tickets.'))}
    finally{setLoading(false)}
  },[scope]);
  useEffect(()=>{void refresh()},[refresh]);

  const shown=useMemo(()=>{
    const q=query.trim().toLowerCase();
    return tickets.filter(ticket=>{
      if(status&&ticket.status!==status)return false;
      if(type&&ticket.type!==type)return false;
      const haystack=[ticket.ticketNumber,ticket.subject,ticket.createdByName||'',ticket.createdByEmail].join(' ').toLowerCase();
      if(q&&!haystack.includes(q))return false;
      return true;
    });
  },[tickets,query,status,type]);

  const openCount=tickets.filter(item=>!['resolved','closed'].includes(item.status)).length;
  const waitingCount=tickets.filter(item=>item.status==='waiting_user').length;
  const resolvedCount=tickets.filter(item=>item.status==='resolved'||item.status==='closed').length;

  return <div className="page supportPage">
    <header className="pageHead">
      <div><div className="eyebrow">SOPORTE</div><h1>Soporte</h1><p>Reporta incidencias, solicita mejoras y sigue cada conversación sin salir de ZENVIA Gestión.</p></div>
      <button className="primary" onClick={()=>setCreating(true)}><FilePlus2 size={17}/> Nuevo ticket</button>
    </header>

    {isAdmin&&<div className="supportScopeTabs">
      <button className={scope==='all'?'active':''} onClick={()=>setScope('all')}><LifeBuoy size={16}/> Tickets de la empresa</button>
      <button className={scope==='mine'?'active':''} onClick={()=>setScope('mine')}><MessageCircle size={16}/> Mis tickets</button>
    </div>}

    <div className="supportStats">
      <div className="card supportStat"><AlertCircle/><div><span>Abiertos</span><strong>{openCount}</strong></div></div>
      <div className="card supportStat"><Clock3/><div><span>Esperando usuario</span><strong>{waitingCount}</strong></div></div>
      <div className="card supportStat"><CheckCircle2/><div><span>Resueltos</span><strong>{resolvedCount}</strong></div></div>
    </div>

    <section className="card supportListCard">
      <div className="supportListHead">
        <div><strong>{scope==='all'?'Todos los tickets':'Mis tickets'}</strong><span>{shown.length} visibles</span></div>
        <button className="secondary" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={15} className={loading?'spin':''}/> Actualizar</button>
      </div>
      <div className="supportFilters">
        <label className="search supportSearch"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar nº, asunto o usuario…"/></label>
        <SelectField ariaLabel="Estado del ticket" value={status} onChange={setStatus} options={[{value:'',label:'Todos los estados'},...Object.entries(statusLabels).map(([value,label])=>({value,label}))]}/>
        <SelectField ariaLabel="Tipo de ticket" value={type} onChange={setType} options={[{value:'',label:'Todos los tipos'},...Object.entries(typeLabels).map(([value,label])=>({value,label}))]}/>
      </div>
      {error&&<div className="errorBox">{error}</div>}
      <div className="supportTicketList">
        {shown.map(ticket=><button className="supportTicketRow" key={ticket.id} onClick={()=>setSelectedId(ticket.id)}>
          <span className={'supportTypeIcon '+ticket.type}>{ticket.type==='incident'?<Bug size={17}/>:<Lightbulb size={17}/>}</span>
          <span className="supportTicketIdentity"><strong>{ticket.subject}</strong><small>{ticket.ticketNumber} · {typeLabels[ticket.type]}{scope==='all'?' · '+(ticket.createdByName||ticket.createdByEmail):''}</small></span>
          <span className={'supportStatus status-'+ticket.status}>{statusLabels[ticket.status]}</span>
          <span className={'supportPriority priority-'+ticket.priority}>{priorityLabels[ticket.priority]}</span>
          <span className="supportTicketDate">{dateTime(ticket.lastActivityAt)}</span>
        </button>)}
        {!loading&&!shown.length&&<div className="emptyState large">No hay tickets para los filtros seleccionados.</div>}
        {loading&&!tickets.length&&<div className="emptyState large">Cargando soporte…</div>}
      </div>
    </section>

    {creating&&<NewTicketModal onClose={()=>setCreating(false)} onCreated={async ticket=>{setCreating(false);await refresh();setSelectedId(ticket.id)}}/>}
    {selectedId&&<TicketDrawer ticketId={selectedId} isAdmin={isAdmin} currentUserId={currentUserId} onClose={()=>setSelectedId(null)} onChanged={refresh}/>}
  </div>;
}

function NewTicketModal({onClose,onCreated}:{onClose:()=>void;onCreated:(ticket:SupportTicket)=>Promise<void>}){
  const [type,setType]=useState<SupportTicketType>('incident');
  const [subject,setSubject]=useState('');
  const [description,setDescription]=useState('');
  const [files,setFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const inputRef=useRef<HTMLInputElement|null>(null);

  const submit=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const result=await createSupportTicket({type,subject,description,files});
      showSuccess('Ticket '+result.ticket.ticketNumber+' creado correctamente.');
      if(!result.notification.delivered&&result.notification.reason)showError('Ticket creado, pero la notificación por correo no pudo enviarse.');
      await onCreated(result.ticket);
    }catch(e){setError(errorMessage(e,'No se pudo crear el ticket.'))}
    finally{setBusy(false)}
  };

  return <div className="modalBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <form className="modal supportCreateModal" onSubmit={submit}>
      <div className="modalHead"><div><h3>Nuevo ticket</h3><p>Describe una incidencia o una mejora que necesites.</p></div><button type="button" onClick={onClose}><X size={18}/></button></div>
      <div className="supportTypePicker">
        <button type="button" className={type==='incident'?'active':''} onClick={()=>setType('incident')}><Bug size={18}/><span><strong>Incidencia</strong><small>Algo no funciona como debería.</small></span></button>
        <button type="button" className={type==='request'?'active':''} onClick={()=>setType('request')}><Lightbulb size={18}/><span><strong>Petición</strong><small>Una mejora o función nueva.</small></span></button>
      </div>
      <label className="settingsField"><span>Asunto</span><input value={subject} onChange={e=>setSubject(e.target.value)} maxLength={180} placeholder="Resume el problema o petición" required/></label>
      <label className="settingsField"><span>Descripción</span><textarea value={description} onChange={e=>setDescription(e.target.value)} rows={7} maxLength={10000} placeholder="Cuéntanos qué ocurre, qué esperabas que pasara y cualquier detalle que pueda ayudar." required/></label>
      <input ref={inputRef} className="supportHiddenInput" type="file" multiple onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,5))}/>
      <div className="supportAttachmentsBox">
        <div><Paperclip size={17}/><span><strong>Adjuntos</strong><small>Hasta 5 archivos de 10 MB. Puedes añadir capturas, PDF, documentos o logs.</small></span></div>
        <button type="button" className="secondary" onClick={()=>inputRef.current?.click()}>Adjuntar archivos</button>
      </div>
      {files.length>0&&<div className="supportSelectedFiles">{files.map((file,index)=><span key={file.name+'-'+index}><Paperclip size={13}/>{file.name}<button type="button" onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}><X size={12}/></button></span>)}</div>}
      {error&&<div className="errorBox">{error}</div>}
      <div className="modalActions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Creando ticket…':'Crear ticket'}</button></div>
    </form>
  </div>;
}

function TicketDrawer({ticketId,isAdmin,currentUserId,onClose,onChanged}:{ticketId:string;isAdmin:boolean;currentUserId:string;onClose:()=>void;onChanged:()=>Promise<void>}){
  const [detail,setDetail]=useState<SupportTicketDetail|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [reply,setReply]=useState('');
  const [files,setFiles]=useState<File[]>([]);
  const [busy,setBusy]=useState(false);
  const inputRef=useRef<HTMLInputElement|null>(null);

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    try{setDetail(await loadSupportTicket(ticketId))}
    catch(e){setError(errorMessage(e,'No se pudo cargar el ticket.'))}
    finally{setLoading(false)}
  },[ticketId]);
  useEffect(()=>{void refresh()},[refresh]);

  const sendReply=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      const result=await replySupportTicket(ticketId,reply,files);
      setReply('');setFiles([]);
      showSuccess('Respuesta añadida al ticket.');
      if(!result.notification.delivered&&result.notification.reason)showError('La respuesta se guardó, pero no se pudo enviar el aviso por correo.');
      await refresh();await onChanged();
    }catch(e){setError(errorMessage(e,'No se pudo enviar la respuesta.'))}
    finally{setBusy(false)}
  };

  const openAttachment=async(attachment:SupportAttachment)=>{
    try{window.open(await supportAttachmentUrl(attachment.storagePath),'_blank','noopener,noreferrer')}
    catch(e){showError(errorMessage(e,'No se pudo abrir el adjunto.'))}
  };

  const ticket=detail?.ticket;
  const initialAttachments=detail?.attachments.filter(item=>!item.messageId)||[];
  return <div className="masterDrawerBackdrop supportDrawerBackdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <aside className="masterDrawer supportDrawer">
      <header className="masterDrawerHead supportDrawerHead">
        <div>{ticket&&<span className="supportTicketNumber">{ticket.ticketNumber}</span>}<h3>{ticket?.subject||'Ticket de soporte'}</h3>{ticket&&<p>{typeLabels[ticket.type]} · {dateTime(ticket.createdAt)}</p>}</div>
        <button className="iconBtn" onClick={onClose} aria-label="Cerrar"><X size={18}/></button>
      </header>
      {loading&&!detail?<div className="supportDrawerLoading">Cargando ticket…</div>:ticket&&<>
        <div className="supportDrawerMeta">
          <span className={'supportStatus status-'+ticket.status}>{statusLabels[ticket.status]}</span>
          <span className={'supportPriority priority-'+ticket.priority}>{priorityLabels[ticket.priority]}</span>
          {isAdmin&&<span className="supportRequester">{ticket.createdByName||ticket.createdByEmail}<small>{ticket.createdByEmail}</small></span>}
        </div>

        <div className="supportThread">
          <article className={ticket.createdBy===currentUserId?'supportMessage mine':'supportMessage'}>
            <div className="supportMessageMeta"><strong>{ticket.createdByName||ticket.createdByEmail}</strong><span>{dateTime(ticket.createdAt)}</span></div>
            <p>{ticket.description}</p>
            <AttachmentList items={initialAttachments} onOpen={openAttachment}/>
          </article>
          {detail.messages.map(message=><article className={message.authorUserId===currentUserId?'supportMessage mine':message.authorRole==='admin'?'supportMessage admin':'supportMessage'} key={message.id}>
            <div className="supportMessageMeta"><strong>{message.authorRole==='admin'?'Soporte · ':''}{message.authorName||message.authorEmail}</strong><span>{dateTime(message.createdAt)}</span></div>
            <p>{message.body}</p>
            <AttachmentList items={detail.attachments.filter(item=>item.messageId===message.id)} onOpen={openAttachment}/>
          </article>)}
        </div>

        {ticket.status!=='closed'&&<form className="supportReplyBox" onSubmit={sendReply}>
          <textarea value={reply} onChange={e=>setReply(e.target.value)} rows={4} placeholder="Escribe una respuesta…" maxLength={10000} required/>
          <input ref={inputRef} className="supportHiddenInput" type="file" multiple onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,5))}/>
          {files.length>0&&<div className="supportSelectedFiles">{files.map((file,index)=><span key={file.name+'-'+index}><Paperclip size={13}/>{file.name}<button type="button" onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}><X size={12}/></button></span>)}</div>}
          <div className="supportReplyActions"><button type="button" className="secondary" onClick={()=>inputRef.current?.click()}><Paperclip size={15}/> Adjuntar</button><button className="primary" disabled={busy||!reply.trim()}><Send size={15}/>{busy?'Enviando…':'Responder'}</button></div>
        </form>}
        {ticket.status==='closed'&&<div className="supportClosedNotice">Este ticket está cerrado. Si necesitas reabrirlo, responde o contacta con Soporte ZENVIA.</div>}
      </>}
      {error&&<div className="errorBox supportDrawerError">{error}</div>}
    </aside>
  </div>;
}
function AttachmentList({items,onOpen}:{items:SupportAttachment[];onOpen:(item:SupportAttachment)=>void}){
  if(!items.length)return null;
  return <div className="supportAttachmentList">{items.map(item=><button type="button" key={item.id} onClick={()=>onOpen(item)}><Paperclip size={13}/><span>{item.fileName}</span><small>{fileSize(item.fileSize)}</small></button>)}</div>;
}
