import { createClient } from 'npm:@supabase/supabase-js@2';

const jsonHeaders={'Content-Type':'application/json'};
const modulePermissions=['dashboard','sales','orders','invoices','clients','products','suppliers','amazon','support'];
const customerAppUrl=(Deno.env.get('CUSTOMER_APP_URL')||'https://gestion.zenviacommerce.com').replace(/\/$/,'');

function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){
    try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string;}catch{}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function fail(message:string,status=400){return new Response(JSON.stringify({error:message}),{status,headers:jsonHeaders});}
function ok(data:unknown){return new Response(JSON.stringify(data),{headers:jsonHeaders});}
function asText(value:unknown,max=200){return typeof value==='string'?value.trim().slice(0,max):'';}
function slugify(value:string){
  const base=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
  return base||'empresa';
}
function integerOrNull(value:unknown){
  if(value===null||value===''||value===undefined)return null;
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>=0?parsed:null;
}
async function sha256(value:string){
  const encoded=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',encoded);
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return fail('Método no permitido.',405);
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    const adminKey=getAdminKey();
    if(!url||!adminKey)return fail('Configuración no disponible.',500);
    const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const supplied=(req.headers.get('x-platform-token')||'').trim();
    if(!supplied)return fail('Puente no autorizado.',401);
    const {data:bridgeSecret,error:bridgeError}=await admin.from('platform_bridge_secrets')
      .select('token_sha256,active').eq('secret_id','primary').maybeSingle();
    if(bridgeError)throw bridgeError;
    if(!bridgeSecret?.active||await sha256(supplied)!==bridgeSecret.token_sha256)return fail('Puente no autorizado.',401);

    const body=await req.json().catch(()=>({}));
    const action=asText(body?.action,80);
    const actor={
      id:asText(body?.actor?.id,80),
      email:asText(body?.actor?.email,254),
      name:asText(body?.actor?.name,150)||asText(body?.actor?.email,254)||'ZENVIA Platform',
    };

    if(action==='bootstrap'){
      const [workspaces,subscriptions,tickets,plans]=await Promise.all([
        admin.from('workspaces').select('id',{count:'exact',head:true}),
        admin.from('workspace_subscriptions').select('workspace_id',{count:'exact',head:true}).in('status',['active','trialing']),
        admin.from('support_tickets').select('id',{count:'exact',head:true}).in('status',['open','in_progress','waiting_user']),
        admin.from('billing_plans').select('plan_key',{count:'exact',head:true}).eq('active',true),
      ]);
      return ok({stats:{
        workspaces:workspaces.count||0,
        subscriptions:subscriptions.count||0,
        openTickets:tickets.count||0,
        activePlans:plans.count||0,
      }});
    }

    if(action==='list_workspaces'){
      const [
        {data:workspaces,error:workspacesError},
        {data:subscriptions,error:subscriptionsError},
        {data:users,error:usersError},
        {data:amazonAccounts,error:amazonError},
        {data:usageEntitlements,error:usageEntitlementsError},
      ]=await Promise.all([
        admin.from('workspaces').select('id,slug,name,legal_name,status,created_at,updated_at').order('created_at',{ascending:false}),
        admin.from('workspace_subscriptions').select('workspace_id,plan_key,status,billing_provider,trial_ends_at,current_period_ends_at,cancel_at_period_end'),
        admin.from('app_users').select('workspace_id,user_id,active,role'),
        admin.from('amazon_accounts').select('owner_id,id,status'),
        admin.from('plan_entitlements').select('plan_key,entitlement_key,enabled,limit_value').in('entitlement_key',['users','amazon_accounts','monthly_orders']),
      ]);
      if(workspacesError)throw workspacesError;if(subscriptionsError)throw subscriptionsError;if(usersError)throw usersError;if(amazonError)throw amazonError;if(usageEntitlementsError)throw usageEntitlementsError;
      const subscriptionMap=new Map((subscriptions||[]).map((row:any)=>[row.workspace_id,row]));
      const userCounts=new Map<string,{total:number;active:number}>();
      for(const row of users||[]){const item=userCounts.get(row.workspace_id)||{total:0,active:0};item.total+=1;if(row.active)item.active+=1;userCounts.set(row.workspace_id,item);}
      const amazonCounts=new Map<string,number>();
      for(const row of amazonAccounts||[])if(row.status!=='disabled')amazonCounts.set(row.owner_id,(amazonCounts.get(row.owner_id)||0)+1);
      const entitlementLimits=new Map<string,number|null>();
      for(const entitlement of usageEntitlements||[]){
        const key=`${entitlement.plan_key}:${entitlement.entitlement_key}`;
        entitlementLimits.set(key,entitlement.enabled===false?0:(entitlement.limit_value==null?null:Number(entitlement.limit_value)));
      }
      const now=new Date();
      const monthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
      const nextMonthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();
      const monthlyOrderCounts=new Map<string,number>();
      await Promise.all((workspaces||[]).map(async(row:any)=>{
        const {count,error}=await admin.from('fulfillment_orders').select('id',{count:'exact',head:true}).eq('owner_id',row.id).gte('order_created_at',monthStart).lt('order_created_at',nextMonthStart);
        if(error)throw error;monthlyOrderCounts.set(row.id,Number(count||0));
      }));
      const limitFor=(workspaceId:string,key:string)=>{
        const planKey=subscriptionMap.get(workspaceId)?.plan_key;
        if(!planKey)return null;
        return entitlementLimits.has(`${planKey}:${key}`)?entitlementLimits.get(`${planKey}:${key}`)??null:null;
      };
      return ok({workspaces:(workspaces||[]).map((row:any)=>{
        const usersForWorkspace=userCounts.get(row.id)||{total:0,active:0};
        const amazonForWorkspace=amazonCounts.get(row.id)||0;
        const monthlyOrders=monthlyOrderCounts.get(row.id)||0;
        return {...row,subscription:subscriptionMap.get(row.id)||null,users:usersForWorkspace,amazonAccounts:amazonForWorkspace,usage:{
          users:{value:usersForWorkspace.active,limit:limitFor(row.id,'users')},
          amazonAccounts:{value:amazonForWorkspace,limit:limitFor(row.id,'amazon_accounts')},
          monthlyOrders:{value:monthlyOrders,limit:limitFor(row.id,'monthly_orders')},
        }};
      })});
    }

    if(action==='create_workspace'){
      const name=asText(body?.name,120),legalName=asText(body?.legalName,180);
      const ownerEmail=asText(body?.ownerEmail,254).toLowerCase(),ownerFullName=asText(body?.ownerFullName,150);
      const planKey=asText(body?.planKey,50)||'starter';
      if(name.length<2)return fail('Indica el nombre de la empresa.');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(ownerEmail))return fail('Indica un email válido para el propietario.');
      if(ownerFullName.length<2)return fail('Indica el nombre del propietario.');
      const {data:plan,error:planError}=await admin.from('billing_plans').select('plan_key').eq('plan_key',planKey).maybeSingle();
      if(planError)throw planError;if(!plan)return fail('El plan seleccionado no existe.');
      const workspaceId=crypto.randomUUID(),slug=`${slugify(name)}-${workspaceId.slice(0,6)}`;
      const {error:workspaceError}=await admin.from('workspaces').insert({id:workspaceId,slug,name,legal_name:legalName||null,status:'active',created_by:null});
      if(workspaceError)throw workspaceError;
      let invitedUserId='';
      try{
        const {data:invite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(ownerEmail,{data:{full_name:ownerFullName,onboarding_pending:true},redirectTo:customerAppUrl});
        if(inviteError||!invite.user)throw inviteError||new Error('No se pudo crear la invitación.');
        invitedUserId=invite.user.id;
        const {error:metaError}=await admin.auth.admin.updateUserById(invitedUserId,{
          user_metadata:{...(invite.user.user_metadata||{}),full_name:ownerFullName,onboarding_pending:true},
          app_metadata:{...(invite.user.app_metadata||{}),zenvia_managed:true,workspace_id:workspaceId},
        });
        if(metaError)throw metaError;
        const {error:ownerError}=await admin.from('app_users').insert({user_id:invitedUserId,email:ownerEmail,full_name:ownerFullName,role:'admin',active:true,workspace_id:workspaceId,data_owner_id:workspaceId,permissions:modulePermissions});
        if(ownerError)throw ownerError;
        const {error:creatorError}=await admin.from('workspaces').update({created_by:invitedUserId}).eq('id',workspaceId);if(creatorError)throw creatorError;
        const {error:subscriptionError}=await admin.from('workspace_subscriptions').insert({workspace_id:workspaceId,plan_key:planKey,status:'active',billing_provider:'manual'});if(subscriptionError)throw subscriptionError;
        const {error:businessError}=await admin.from('business_settings').insert({owner_id:workspaceId,legal_name:legalName||name,trade_name:name,country_code:'ES',email:ownerEmail});if(businessError)throw businessError;
        const categories=[['Mercancía',10],['Transporte y logística',20],['Publicidad y marketing',30],['Software y suscripciones',40],['Embalaje y consumibles',50],['Servicios profesionales',60],['Suministros',70],['Viajes y dietas',80],['Comisiones marketplaces',90],['Otros',100]]
          .map(([categoryName,sortOrder])=>({owner_id:workspaceId,name:String(categoryName),sort_order:Number(sortOrder),active:true}));
        const {error:categoryError}=await admin.from('expense_categories').insert(categories);if(categoryError)throw categoryError;
      }catch(error){
        await admin.from('workspace_subscriptions').delete().eq('workspace_id',workspaceId);
        await admin.from('expense_categories').delete().eq('owner_id',workspaceId);
        await admin.from('business_settings').delete().eq('owner_id',workspaceId);
        await admin.from('audit_logs').delete().eq('workspace_owner_id',workspaceId);
        if(invitedUserId)await admin.auth.admin.deleteUser(invitedUserId).catch(()=>undefined);
        await admin.from('workspaces').delete().eq('id',workspaceId);throw error;
      }
      return ok({ok:true,workspaceId});
    }

    if(action==='update_workspace'){
      const workspaceId=asText(body?.workspaceId,80),status=asText(body?.status,30);
      if(!workspaceId||!['active','trialing','suspended','cancelled'].includes(status))return fail('Estado de cliente no válido.');
      const {data:workspace,error:workspaceError}=await admin.from('workspaces').select('id,name,status').eq('id',workspaceId).maybeSingle();
      if(workspaceError)throw workspaceError;if(!workspace)return fail('Cliente no encontrado.',404);
      if(workspace.status===status)return ok({ok:true,status});
      const {error}=await admin.from('workspaces').update({status,updated_at:new Date().toISOString()}).eq('id',workspaceId);if(error)throw error;
      return ok({ok:true,status,previousStatus:workspace.status,name:workspace.name});
    }

    if(action==='list_plans'){
      const [{data:plans,error:plansError},{data:entitlements,error:entitlementsError},{data:subscriptions,error:subscriptionsError}]=await Promise.all([
        admin.from('billing_plans').select('*').order('sort_order',{ascending:true}),
        admin.from('plan_entitlements').select('*').order('entitlement_key',{ascending:true}),
        admin.from('workspace_subscriptions').select('workspace_id,plan_key,status'),
      ]);
      if(plansError)throw plansError;if(entitlementsError)throw entitlementsError;if(subscriptionsError)throw subscriptionsError;
      const entByPlan=new Map<string,any[]>();
      for(const item of entitlements||[]){const list=entByPlan.get(item.plan_key)||[];list.push(item);entByPlan.set(item.plan_key,list);}
      const subCounts=new Map<string,number>();
      for(const item of subscriptions||[])if(['active','trialing'].includes(item.status))subCounts.set(item.plan_key,(subCounts.get(item.plan_key)||0)+1);
      return ok({plans:(plans||[]).map((plan:any)=>({...plan,entitlements:entByPlan.get(plan.plan_key)||[],subscriptions:subCounts.get(plan.plan_key)||0}))});
    }

    if(action==='update_plan'){
      const planKey=asText(body?.planKey,50);if(!planKey)return fail('Falta el plan.');
      const patch:any={updated_at:new Date().toISOString()};
      if(typeof body?.name==='string')patch.name=asText(body.name,100);
      if(typeof body?.description==='string')patch.description=asText(body.description,500)||null;
      if(typeof body?.isPublic==='boolean')patch.is_public=body.isPublic;
      if(typeof body?.active==='boolean')patch.active=body.active;
      if('monthlyPriceCents' in body)patch.monthly_price_cents=integerOrNull(body.monthlyPriceCents);
      if('yearlyPriceCents' in body)patch.yearly_price_cents=integerOrNull(body.yearlyPriceCents);
      if(planKey==='internal'){patch.is_public=false;patch.active=true;}
      const {error}=await admin.from('billing_plans').update(patch).eq('plan_key',planKey);if(error)throw error;
      if(Array.isArray(body?.entitlements)){
        for(const raw of body.entitlements){
          const key=asText(raw?.key,120);if(!key)continue;
          const {error:entError}=await admin.from('plan_entitlements').upsert({plan_key:planKey,entitlement_key:key,enabled:raw?.enabled!==false,limit_value:integerOrNull(raw?.limit),config:raw?.config&&typeof raw.config==='object'?raw.config:{},updated_at:new Date().toISOString()},{onConflict:'plan_key,entitlement_key'});
          if(entError)throw entError;
        }
      }
      return ok({ok:true});
    }

    if(action==='assign_plan'){
      const workspaceId=asText(body?.workspaceId,80),planKey=asText(body?.planKey,50);
      if(!workspaceId||!planKey)return fail('Falta cliente o plan.');
      const {error}=await admin.from('workspace_subscriptions').upsert({workspace_id:workspaceId,plan_key:planKey,status:'active',billing_provider:'manual',updated_at:new Date().toISOString()},{onConflict:'workspace_id'});
      if(error)throw error;return ok({ok:true});
    }

    if(action==='list_tickets'){
      const [{data:tickets,error:ticketsError},{data:workspaces,error:workspacesError}]=await Promise.all([
        admin.from('support_tickets').select('id,owner_id,ticket_number,created_by,created_by_email,created_by_name,type,subject,status,priority,assigned_to,created_at,updated_at,last_activity_at,resolved_at,closed_at').order('last_activity_at',{ascending:false}).limit(500),
        admin.from('workspaces').select('id,name,slug'),
      ]);
      if(ticketsError)throw ticketsError;if(workspacesError)throw workspacesError;
      const names=new Map((workspaces||[]).map((row:any)=>[row.id,row.name]));
      return ok({tickets:(tickets||[]).map((ticket:any)=>({...ticket,workspace_name:names.get(ticket.owner_id)||'Workspace'}))});
    }

    if(action==='ticket_detail'){
      const ticketId=asText(body?.ticketId,80);if(!ticketId)return fail('Falta el ticket.');
      const [{data:ticket,error:ticketError},{data:messages,error:messagesError},{data:attachments,error:attachmentsError}]=await Promise.all([
        admin.from('support_tickets').select('*').eq('id',ticketId).maybeSingle(),
        admin.from('support_messages').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
        admin.from('support_attachments').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
      ]);
      if(ticketError)throw ticketError;if(messagesError)throw messagesError;if(attachmentsError)throw attachmentsError;if(!ticket)return fail('Ticket no encontrado.',404);
      const {data:w,error:wError}=await admin.from('workspaces').select('name').eq('id',ticket.owner_id).maybeSingle();
      if(wError)throw wError;
      return ok({ticket:{...ticket,workspace_name:w?.name||'Workspace'},messages:messages||[],attachments:attachments||[]});
    }

    if(action==='update_ticket'){
      const ticketId=asText(body?.ticketId,80);if(!ticketId)return fail('Falta el ticket.');
      const patch:any={updated_at:new Date().toISOString()};
      if(['open','in_progress','waiting_user','resolved','closed'].includes(body?.status))patch.status=body.status;
      if(['low','normal','high','urgent'].includes(body?.priority))patch.priority=body.priority;
      if('assignedTo' in body)patch.assigned_to=body.assignedTo||null;
      if(patch.status==='resolved')patch.resolved_at=new Date().toISOString();
      if(patch.status==='closed')patch.closed_at=new Date().toISOString();
      const {data:updated,error}=await admin.from('support_tickets').update(patch).eq('id',ticketId).select('id,owner_id,ticket_number').single();
      if(error)throw error;return ok({ok:true,ticket:updated});
    }

    if(action==='reply_ticket'){
      const ticketId=asText(body?.ticketId,80),message=asText(body?.message,10000);
      if(!ticketId||!message)return fail('Escribe una respuesta.');
      if(!actor.id||!actor.email)return fail('Falta la identidad del operador.',400);
      const {data:ticket,error:ticketError}=await admin.from('support_tickets').select('id,owner_id,ticket_number').eq('id',ticketId).maybeSingle();
      if(ticketError)throw ticketError;if(!ticket)return fail('Ticket no encontrado.',404);
      const {data:inserted,error}=await admin.from('support_messages').insert({
        ticket_id:ticketId,owner_id:ticket.owner_id,author_user_id:actor.id,author_email:actor.email,author_name:actor.name,author_role:'admin',body:message,
      }).select('id').single();
      if(error)throw error;
      await admin.from('support_tickets').update({status:'waiting_user',updated_at:new Date().toISOString()}).eq('id',ticketId);
      let notified=false,notificationReason='';
      try{
        const notification=await fetch(`${url}/functions/v1/support-notify`,{
          method:'POST',
          headers:{'x-platform-token':supplied,'Content-Type':'application/json'},
          body:JSON.stringify({ticketId,event:'reply',messageId:inserted.id}),
        });
        const payload=await notification.json().catch(()=>({}));
        notified=notification.ok&&payload?.delivered===true;
        notificationReason=String(payload?.reason||payload?.error||'');
      }catch(e){notificationReason=e instanceof Error?e.message:'No se pudo enviar la notificación.';}
      return ok({ok:true,messageId:inserted.id,notified,notificationReason});
    }

    return fail('Acción no válida.',404);
  }catch(error){
    console.error(error);
    return fail(error instanceof Error?error.message:'Error interno.',500);
  }
});