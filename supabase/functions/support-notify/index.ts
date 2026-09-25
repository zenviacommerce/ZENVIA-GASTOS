import { adminClient } from '../_shared/support/supabase.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const SUPPORT_TO=(Deno.env.get('SUPPORT_EMAIL_TO')||'soporte@zenviacommerce.com').trim();
const SUPPORT_FROM=(Deno.env.get('SUPPORT_EMAIL_FROM')||'ZENVIA Soporte <soporte@zenviacommerce.com>').trim();

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});}
function esc(value:unknown){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch));}
function typeLabel(value:string){return value==='incident'?'Incidencia':'Petición';}
function statusLabel(value:string){return ({open:'Abierto',in_progress:'En curso',waiting_user:'Esperando usuario',resolved:'Resuelto',closed:'Cerrado'} as Record<string,string>)[value]||value;}

async function sendEmail(to:string,subject:string,html:string){
  const apiKey=(Deno.env.get('RESEND_API_KEY')||'').trim();
  if(!apiKey)return {delivered:false,reason:'RESEND_API_KEY no configurada'};
  const result=await fetch('https://api.resend.com/emails',{
    method:'POST',
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:SUPPORT_FROM,to:[to],reply_to:SUPPORT_TO,subject,html}),
  });
  if(!result.ok){
    const detail=await result.text();
    return {delivered:false,reason:`Resend ${result.status}: ${detail.slice(0,400)}`};
  }
  return {delivered:true,reason:''};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const admin=adminClient();
  try{
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return response({error:'Sesión no válida.'},401);
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData?.user)return response({error:'Sesión no válida.'},401);
    const authUser=userData.user;
    const [{data:who,error:whoError},{data:platform,error:platformError}]=await Promise.all([
      admin.from('app_users').select('user_id,data_owner_id,email,full_name,role,active').eq('user_id',authUser.id).maybeSingle(),
      admin.from('platform_admins').select('user_id,role,active').eq('user_id',authUser.id).maybeSingle(),
    ]);
    if(whoError)throw whoError;
    if(platformError)throw platformError;
    const isPlatform=Boolean(platform?.active);
    if(!isPlatform&&!who?.active)return response({error:'Usuario no autorizado.'},403);

    const body=await req.json().catch(()=>({}));
    const ticketId=String(body?.ticketId||'').trim();
    const event=String(body?.event||'').trim();
    const messageId=String(body?.messageId||'').trim();
    if(!ticketId||!['created','reply','status'].includes(event))return response({error:'Solicitud de notificación no válida.'},400);

    const {data:ticket,error:ticketError}=await admin.from('support_tickets').select('*').eq('id',ticketId).maybeSingle();
    if(ticketError)throw ticketError;
    if(!ticket)return response({error:'Ticket no accesible.'},404);
    if(!isPlatform){
      if(ticket.owner_id!==who?.data_owner_id)return response({error:'Ticket no accesible.'},404);
      if(who?.role!=='admin'&&ticket.created_by!==who?.user_id)return response({error:'Ticket no accesible.'},403);
    }

    let message:any=null;
    if(event==='reply'){
      if(!messageId)return response({error:'Falta la respuesta.'},400);
      const result=await admin.from('support_messages').select('*').eq('id',messageId).eq('ticket_id',ticketId).maybeSingle();
      if(result.error)throw result.error;
      message=result.data;
      if(!message)return response({error:'Respuesta no encontrada.'},404);
    }
    if(event==='status'&&!isPlatform&&who?.role!=='admin')return response({error:'Solo un administrador puede notificar cambios de estado.'},403);

    const adminEvent=event==='status'||message?.author_role==='admin';
    const recipient=adminEvent?String(ticket.created_by_email||'').trim():SUPPORT_TO;
    if(!recipient)return response({ok:true,delivered:false,reason:'No hay destinatario configurado.'});

    const subjectPrefix=event==='created'?'Nuevo ticket':event==='status'?'Ticket actualizado':'Nueva respuesta';
    const subject=`[${ticket.ticket_number}] ${subjectPrefix}: ${ticket.subject}`;
    const author=message?String(message.author_name||message.author_email||'Usuario'):String(ticket.created_by_name||ticket.created_by_email||'Usuario');
    const bodyText=event==='created'?ticket.description:event==='reply'?message.body:`Estado: ${statusLabel(ticket.status)}`;
    const html=`
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033">
        <h2 style="margin-bottom:4px">ZENVIA Gestión · Soporte</h2>
        <p style="color:#64748b;margin-top:0">${esc(ticket.ticket_number)} · ${typeLabel(ticket.type)}</p>
        <h3>${esc(ticket.subject)}</h3>
        <p><strong>Estado:</strong> ${esc(statusLabel(ticket.status))}</p>
        ${event==='reply'?'<p><strong>Respuesta de:</strong> '+esc(author)+'</p>':''}
        <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">${esc(bodyText)}</div>
        <p style="font-size:12px;color:#64748b">Abre ZENVIA Gestión → Soporte para consultar el historial completo, responder y ver los adjuntos. También puedes escribir a soporte@zenviacommerce.com.</p>
      </div>`;

    const sent=await sendEmail(recipient,subject,html);
    await admin.from('support_email_events').insert({
      ticket_id:ticketId,
      message_id:message?.id||null,
      event_type:event,
      recipient,
      status:sent.delivered?'sent':(sent.reason.includes('no configurada')?'skipped':'failed'),
      error_message:sent.reason||null,
    });
    return response({ok:true,...sent});
  }catch(error){
    return response({error:error instanceof Error?error.message:'No se pudo enviar la notificación de soporte.'},500);
  }
});
