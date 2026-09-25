import { supabase } from './supabase';

export type SupportTicketType='incident'|'request';
export type SupportTicketStatus='open'|'in_progress'|'waiting_user'|'resolved'|'closed';
export type SupportTicketPriority='low'|'normal'|'high'|'urgent';

export type SupportTicket={
  id:string;
  ticketNumber:string;
  createdBy:string;
  createdByEmail:string;
  createdByName:string|null;
  type:SupportTicketType;
  subject:string;
  description:string;
  status:SupportTicketStatus;
  priority:SupportTicketPriority;
  assignedTo:string|null;
  createdAt:string;
  updatedAt:string;
  lastActivityAt:string;
  resolvedAt:string|null;
  closedAt:string|null;
};

export type SupportMessage={
  id:string;
  ticketId:string;
  authorUserId:string;
  authorEmail:string;
  authorName:string|null;
  authorRole:'user'|'admin';
  body:string;
  createdAt:string;
};

export type SupportAttachment={
  id:string;
  ticketId:string;
  messageId:string|null;
  fileName:string;
  mimeType:string|null;
  fileSize:number;
  storagePath:string;
  createdAt:string;
};

export type SupportTicketDetail={
  ticket:SupportTicket;
  messages:SupportMessage[];
  attachments:SupportAttachment[];
};

function mapTicket(row:any):SupportTicket{
  return {
    id:String(row.id),
    ticketNumber:String(row.ticket_number),
    createdBy:String(row.created_by),
    createdByEmail:String(row.created_by_email||''),
    createdByName:row.created_by_name?String(row.created_by_name):null,
    type:row.type as SupportTicketType,
    subject:String(row.subject||''),
    description:String(row.description||''),
    status:row.status as SupportTicketStatus,
    priority:row.priority as SupportTicketPriority,
    assignedTo:row.assigned_to?String(row.assigned_to):null,
    createdAt:String(row.created_at),
    updatedAt:String(row.updated_at),
    lastActivityAt:String(row.last_activity_at),
    resolvedAt:row.resolved_at?String(row.resolved_at):null,
    closedAt:row.closed_at?String(row.closed_at):null,
  };
}

function mapMessage(row:any):SupportMessage{
  return {
    id:String(row.id),
    ticketId:String(row.ticket_id),
    authorUserId:String(row.author_user_id),
    authorEmail:String(row.author_email||''),
    authorName:row.author_name?String(row.author_name):null,
    authorRole:row.author_role as 'user'|'admin',
    body:String(row.body||''),
    createdAt:String(row.created_at),
  };
}

function mapAttachment(row:any):SupportAttachment{
  return {
    id:String(row.id),
    ticketId:String(row.ticket_id),
    messageId:row.message_id?String(row.message_id):null,
    fileName:String(row.file_name||'archivo'),
    mimeType:row.mime_type?String(row.mime_type):null,
    fileSize:Number(row.file_size)||0,
    storagePath:String(row.storage_path),
    createdAt:String(row.created_at),
  };
}

export async function listSupportTickets(scope:'mine'|'all'='mine'):Promise<SupportTicket[]>{
  const {data:userData}=await supabase.auth.getUser();
  const user=userData.user;
  if(!user)throw new Error('Sesión no válida.');
  let query=supabase.from('support_tickets').select('*').order('last_activity_at',{ascending:false});
  if(scope==='mine')query=query.eq('created_by',user.id);
  const {data,error}=await query;
  if(error)throw error;
  return (data||[]).map(mapTicket);
}

export async function loadSupportTicket(ticketId:string):Promise<SupportTicketDetail>{
  const [ticketResult,messageResult,attachmentResult]=await Promise.all([
    supabase.from('support_tickets').select('*').eq('id',ticketId).single(),
    supabase.from('support_messages').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
    supabase.from('support_attachments').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
  ]);
  if(ticketResult.error)throw ticketResult.error;
  if(messageResult.error)throw messageResult.error;
  if(attachmentResult.error)throw attachmentResult.error;
  return {
    ticket:mapTicket(ticketResult.data),
    messages:(messageResult.data||[]).map(mapMessage),
    attachments:(attachmentResult.data||[]).map(mapAttachment),
  };
}

function safeFileName(name:string){
  const cleaned=name.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  return cleaned.slice(-120)||'archivo';
}

async function uploadSupportFiles(ticketId:string,messageId:string|null,files:File[]){
  if(!files.length)return;
  for(const file of files){
    if(file.size>10*1024*1024)throw new Error(`${file.name}: el máximo por archivo es 10 MB.`);
    const token=typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const folder=messageId?`${ticketId}/${messageId}`:`${ticketId}/initial`;
    const path=`${folder}/${token}-${safeFileName(file.name)}`;
    const upload=await supabase.storage.from('support-attachments').upload(path,file,{upsert:false,contentType:file.type||undefined});
    if(upload.error)throw upload.error;
    const inserted=await supabase.from('support_attachments').insert({
      ticket_id:ticketId,
      message_id:messageId,
      file_name:file.name,
      mime_type:file.type||null,
      file_size:file.size,
      storage_path:path,
    });
    if(inserted.error){
      await supabase.storage.from('support-attachments').remove([path]);
      throw inserted.error;
    }
  }
}

async function notifySupport(input:{ticketId:string;event:'created'|'reply'|'status';messageId?:string|null}){
  try{
    const {data,error}=await supabase.functions.invoke('support-notify',{body:input});
    if(error)return {delivered:false,reason:error.message};
    return {delivered:Boolean(data?.delivered),reason:String(data?.reason||'')};
  }catch(error){
    return {delivered:false,reason:error instanceof Error?error.message:'No se pudo enviar la notificación.'};
  }
}

export async function createSupportTicket(input:{type:SupportTicketType;subject:string;description:string;files?:File[]}){
  const subject=input.subject.trim(),description=input.description.trim();
  if(subject.length<3)throw new Error('Escribe un asunto de al menos 3 caracteres.');
  if(description.length<3)throw new Error('Describe la incidencia o petición.');
  const {data,error}=await supabase.from('support_tickets').insert({
    ticket_number:'',
    type:input.type,
    subject,
    description,
    owner_id:'00000000-0000-0000-0000-000000000000',
    created_by:'00000000-0000-0000-0000-000000000000',
    created_by_email:'',
  }).select('*').single();
  if(error)throw error;
  const ticket=mapTicket(data);
  await uploadSupportFiles(ticket.id,null,input.files||[]);
  const notification=await notifySupport({ticketId:ticket.id,event:'created'});
  return {ticket,notification};
}

export async function replySupportTicket(ticketId:string,body:string,files:File[]=[]){
  const clean=body.trim();
  if(!clean)throw new Error('Escribe una respuesta.');
  const {data,error}=await supabase.from('support_messages').insert({
    ticket_id:ticketId,
    owner_id:'00000000-0000-0000-0000-000000000000',
    author_user_id:'00000000-0000-0000-0000-000000000000',
    author_email:'',
    author_role:'user',
    body:clean,
  }).select('*').single();
  if(error)throw error;
  const message=mapMessage(data);
  await uploadSupportFiles(ticketId,message.id,files);
  const notification=await notifySupport({ticketId,event:'reply',messageId:message.id});
  return {message,notification};
}

export async function updateSupportTicket(ticketId:string,changes:{status?:SupportTicketStatus;priority?:SupportTicketPriority;assignedTo?:string|null}){
  const payload:any={updated_at:new Date().toISOString()};
  if(changes.status){
    payload.status=changes.status;
    payload.resolved_at=changes.status==='resolved'?new Date().toISOString():null;
    payload.closed_at=changes.status==='closed'?new Date().toISOString():null;
  }
  if(changes.priority)payload.priority=changes.priority;
  if('assignedTo' in changes)payload.assigned_to=changes.assignedTo||null;
  const {data,error}=await supabase.from('support_tickets').update(payload).eq('id',ticketId).select('*').single();
  if(error)throw error;
  const ticket=mapTicket(data);
  if(changes.status)await notifySupport({ticketId,event:'status'});
  return ticket;
}

export async function supportAttachmentUrl(storagePath:string){
  const {data,error}=await supabase.storage.from('support-attachments').createSignedUrl(storagePath,300);
  if(error)throw error;
  return data.signedUrl;
}
