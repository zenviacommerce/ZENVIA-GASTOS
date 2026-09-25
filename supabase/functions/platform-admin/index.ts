import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};
const modulePermissions=['dashboard','sales','orders','invoices','clients','products','suppliers','amazon','support'];
const customerAppUrl=(Deno.env.get('CUSTOMER_APP_URL')||'https://gestion.zenviacommerce.com').replace(/\/$/,'');

function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){
    try{
      const parsed=JSON.parse(secretKeys);
      if(parsed?.default)return parsed.default as string;
    }catch{/* fallback */}
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}

function fail(message:string,status=400){
  return new Response(JSON.stringify({error:message}),{status,headers:jsonHeaders});
}
function ok(data:unknown){
  return new Response(JSON.stringify(data),{headers:jsonHeaders});
}
function asText(value:unknown,max=200){
  return typeof value==='string'?value.trim().slice(0,max):'';
}
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

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);

  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    const adminKey=getAdminKey();
    if(!url||!adminKey)return fail('Configuración de plataforma no disponible.',500);

    const authHeader=req.headers.get('Authorization')||'';
    const token=authHeader.replace(/^Bearer\s+/i,'').trim();
    if(!token)return fail('Sesión no válida.',401);

    const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData.user)return fail('Sesión no válida.',401);
    const caller=userData.user;

    const {data:platform,error:platformError}=await admin
      .from('platform_admins')
      .select('user_id,role,active')
      .eq('user_id',caller.id)
      .maybeSingle();
    if(platformError)throw platformError;
    if(!platform?.active)return fail('Acceso reservado a administradores de plataforma.',403);

    const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')||'',{
      global:{headers:{Authorization:`Bearer ${token}`}},
      auth:{persistSession:false,autoRefreshToken:false},
    });

    const body=await req.json().catch(()=>({}));
    const action=asText(body?.action,80)||'bootstrap';

    const audit=async(input:{workspaceId?:string|null;action:string;entityType:string;entityId?:string|null;summary:string;details?:Record<string,unknown>})=>{
      const {error}=await admin.from('platform_audit_logs').insert({
        actor_user_id:caller.id,
        workspace_id:input.workspaceId||null,
        action:input.action,
        entity_type:input.entityType,
        entity_id:input.entityId||null,
        summary:input.summary,
        details:input.details||{},
      });
      if(error)console.error('platform audit:',error.message);
    };

    if(action==='bootstrap'){
      const [workspaces,subscriptions,tickets,plans]=await Promise.all([
        admin.from('workspaces').select('id',{count:'exact',head:true}),
        admin.from('workspace_subscriptions').select('workspace_id',{count:'exact',head:true}).in('status',['active','trialing']),
        admin.from('support_tickets').select('id',{count:'exact',head:true}).in('status',['open','in_progress','waiting_user']),
        admin.from('billing_plans').select('plan_key',{count:'exact',head:true}).eq('active',true),
      ]);
      return ok({
        actor:{id:caller.id,email:caller.email||'',role:platform.role},
        stats:{
          workspaces:workspaces.count||0,
          subscriptions:subscriptions.count||0,
          openTickets:tickets.count||0,
          activePlans:plans.count||0,
        },
      });
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
      if(workspacesError)throw workspacesError;
      if(subscriptionsError)throw subscriptionsError;
      if(usersError)throw usersError;
      if(amazonError)throw amazonError;
      if(usageEntitlementsError)throw usageEntitlementsError;

      const subscriptionMap=new Map((subscriptions||[]).map((row:any)=>[row.workspace_id,row]));
      const userCounts=new Map<string,{total:number;active:number}>();
      for(const row of users||[]){
        const item=userCounts.get(row.workspace_id)||{total:0,active:0};
        item.total+=1;if(row.active)item.active+=1;userCounts.set(row.workspace_id,item);
      }
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
        const {count,error}=await admin.from('fulfillment_orders')
          .select('id',{count:'exact',head:true})
          .eq('owner_id',row.id)
          .gte('order_created_at',monthStart)
          .lt('order_created_at',nextMonthStart);
        if(error)throw error;
        monthlyOrderCounts.set(row.id,Number(count||0));
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
        return {
          ...row,
          subscription:subscriptionMap.get(row.id)||null,
          users:usersForWorkspace,
          amazonAccounts:amazonForWorkspace,
          usage:{
            users:{value:usersForWorkspace.active,limit:limitFor(row.id,'users')},
            amazonAccounts:{value:amazonForWorkspace,limit:limitFor(row.id,'amazon_accounts')},
            monthlyOrders:{value:monthlyOrders,limit:limitFor(row.id,'monthly_orders')},
          },
        };
      })});
    }

    if(action==='create_workspace'){
      if(platform.role!=='super_admin')return fail('Solo el superadministrador puede crear clientes.',403);
      const name=asText(body?.name,120);
      const legalName=asText(body?.legalName,180);
      const ownerEmail=asText(body?.ownerEmail,254).toLowerCase();
      const ownerFullName=asText(body?.ownerFullName,150);
      const planKey=asText(body?.planKey,50)||'starter';
      if(name.length<2)return fail('Indica el nombre de la empresa.');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(ownerEmail))return fail('Indica un email válido para el propietario.');
      if(ownerFullName.length<2)return fail('Indica el nombre del propietario.');

      const {data:plan,error:planError}=await admin.from('billing_plans').select('plan_key,name').eq('plan_key',planKey).maybeSingle();
      if(planError)throw planError;
      if(!plan)return fail('El plan seleccionado no existe.');

      const workspaceId=crypto.randomUUID();
      const slug=`${slugify(name)}-${workspaceId.slice(0,6)}`;
      const {error:workspaceError}=await admin.from('workspaces').insert({
        id:workspaceId,slug,name,legal_name:legalName||null,status:'active',created_by:null,
      });
      if(workspaceError)throw workspaceError;

      let invitedUserId='';
      try{
        const {data:invite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(ownerEmail,{
          data:{full_name:ownerFullName,onboarding_pending:true},
          redirectTo:customerAppUrl,
        });
        if(inviteError||!invite.user)throw inviteError||new Error('No se pudo crear la invitación.');
        invitedUserId=invite.user.id;
        const {error:metaError}=await admin.auth.admin.updateUserById(invitedUserId,{
          user_metadata:{...(invite.user.user_metadata||{}),full_name:ownerFullName,onboarding_pending:true},
          app_metadata:{...(invite.user.app_metadata||{}),zenvia_managed:true,workspace_id:workspaceId},
        });
        if(metaError)throw metaError;

        const {error:ownerError}=await admin.from('app_users').insert({
          user_id:invitedUserId,
          email:ownerEmail,
          full_name:ownerFullName,
          role:'admin',
          active:true,
          workspace_id:workspaceId,
          data_owner_id:workspaceId,
          permissions:modulePermissions,
        });
        if(ownerError)throw ownerError;

        const {error:creatorError}=await admin.from('workspaces').update({created_by:invitedUserId}).eq('id',workspaceId);
        if(creatorError)throw creatorError;

        const {error:subscriptionError}=await admin.from('workspace_subscriptions').insert({
          workspace_id:workspaceId,plan_key:planKey,status:'active',billing_provider:'manual',
        });
        if(subscriptionError)throw subscriptionError;

        const {error:businessError}=await admin.from('business_settings').insert({
          owner_id:workspaceId,
          legal_name:legalName||name,
          trade_name:name,
          country_code:'ES',
          email:ownerEmail,
        });
        if(businessError)throw businessError;

        const defaultCategories=[
          ['Mercancía',10],
          ['Transporte y logística',20],
          ['Publicidad y marketing',30],
          ['Software y suscripciones',40],
          ['Embalaje y consumibles',50],
          ['Servicios profesionales',60],
          ['Suministros',70],
          ['Viajes y dietas',80],
          ['Comisiones marketplaces',90],
          ['Otros',100],
        ].map(([categoryName,sortOrder])=>({
          owner_id:workspaceId,
          name:String(categoryName),
          sort_order:Number(sortOrder),
          active:true,
        }));
        const {error:categoryError}=await admin.from('expense_categories').insert(defaultCategories);
        if(categoryError)throw categoryError;
      }catch(error){
        await admin.from('workspace_subscriptions').delete().eq('workspace_id',workspaceId);
        await admin.from('expense_categories').delete().eq('owner_id',workspaceId);
        await admin.from('business_settings').delete().eq('owner_id',workspaceId);
        await admin.from('audit_logs').delete().eq('workspace_owner_id',workspaceId);
        if(invitedUserId)await admin.auth.admin.deleteUser(invitedUserId).catch(()=>undefined);
        await admin.from('workspaces').delete().eq('id',workspaceId);
        throw error;
      }

      await audit({workspaceId,action:'create_workspace',entityType:'workspace',entityId:workspaceId,summary:`Creó el cliente ${name}`,details:{owner_email:ownerEmail,plan_key:planKey}});
      return ok({ok:true,workspaceId});
    }

    if(action==='list_plans'){
      const [{data:plans,error:plansError},{data:entitlements,error:entitlementsError},{data:subscriptions,error:subscriptionsError}]=await Promise.all([
        admin.from('billing_plans').select('*').order('sort_order',{ascending:true}),
        admin.from('plan_entitlements').select('*').order('entitlement_key',{ascending:true}),
        admin.from('workspace_subscriptions').select('workspace_id,plan_key,status'),
      ]);
      if(plansError)throw plansError;if(entitlementsError)throw entitlementsError;if(subscriptionsError)throw subscriptionsError;
      const entByPlan=new Map<string,any[]>();
      for(const item of entitlements||[]){
        const list=entByPlan.get(item.plan_key)||[];list.push(item);entByPlan.set(item.plan_key,list);
      }
      const subCounts=new Map<string,number>();
      for(const item of subscriptions||[])if(['active','trialing'].includes(item.status))subCounts.set(item.plan_key,(subCounts.get(item.plan_key)||0)+1);
      return ok({plans:(plans||[]).map((plan:any)=>({...plan,entitlements:entByPlan.get(plan.plan_key)||[],subscriptions:subCounts.get(plan.plan_key)||0}))});
    }

    if(action==='update_plan'){
      if(platform.role!=='super_admin'&&platform.role!=='billing_admin')return fail('No tienes permiso para gestionar planes.',403);
      const planKey=asText(body?.planKey,50);
      if(!planKey)return fail('Falta el plan.');
      const patch:any={updated_at:new Date().toISOString()};
      if(typeof body?.name==='string')patch.name=asText(body.name,100);
      if(typeof body?.description==='string')patch.description=asText(body.description,500)||null;
      if(typeof body?.isPublic==='boolean')patch.is_public=body.isPublic;
      if(typeof body?.active==='boolean')patch.active=body.active;
      if('monthlyPriceCents' in body)patch.monthly_price_cents=integerOrNull(body.monthlyPriceCents);
      if('yearlyPriceCents' in body)patch.yearly_price_cents=integerOrNull(body.yearlyPriceCents);
      if(planKey==='internal'){patch.is_public=false;patch.active=true;}

      const {error}=await admin.from('billing_plans').update(patch).eq('plan_key',planKey);
      if(error)throw error;

      if(Array.isArray(body?.entitlements)){
        for(const raw of body.entitlements){
          const key=asText(raw?.key,120);
          if(!key)continue;
          const limitValue=integerOrNull(raw?.limit);
          const {error:entError}=await admin.from('plan_entitlements').upsert({
            plan_key:planKey,
            entitlement_key:key,
            enabled:raw?.enabled!==false,
            limit_value:limitValue,
            config:raw?.config&&typeof raw.config==='object'?raw.config:{},
            updated_at:new Date().toISOString(),
          },{onConflict:'plan_key,entitlement_key'});
          if(entError)throw entError;
        }
      }
      await audit({action:'update_plan',entityType:'billing_plan',entityId:planKey,summary:`Actualizó el plan ${planKey}`,details:patch});
      return ok({ok:true});
    }

    if(action==='assign_plan'){
      if(platform.role!=='super_admin'&&platform.role!=='billing_admin')return fail('No tienes permiso para cambiar suscripciones.',403);
      const workspaceId=asText(body?.workspaceId,80);
      const planKey=asText(body?.planKey,50);
      if(!workspaceId||!planKey)return fail('Falta cliente o plan.');
      const {error}=await admin.from('workspace_subscriptions').upsert({
        workspace_id:workspaceId,plan_key:planKey,status:'active',billing_provider:'manual',updated_at:new Date().toISOString(),
      },{onConflict:'workspace_id'});
      if(error)throw error;
      await audit({workspaceId,action:'assign_plan',entityType:'workspace_subscription',entityId:workspaceId,summary:`Cambió el plan del cliente a ${planKey}`,details:{plan_key:planKey}});
      return ok({ok:true});
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
      const ticketId=asText(body?.ticketId,80);
      if(!ticketId)return fail('Falta el ticket.');
      const [{data:ticket,error:ticketError},{data:messages,error:messagesError},{data:attachments,error:attachmentsError},{data:workspace,error:workspaceError}]=await Promise.all([
        admin.from('support_tickets').select('*').eq('id',ticketId).maybeSingle(),
        admin.from('support_messages').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
        admin.from('support_attachments').select('*').eq('ticket_id',ticketId).order('created_at',{ascending:true}),
        admin.from('support_tickets').select('owner_id').eq('id',ticketId).maybeSingle(),
      ]);
      if(ticketError)throw ticketError;if(messagesError)throw messagesError;if(attachmentsError)throw attachmentsError;
      if(!ticket)return fail('Ticket no encontrado.',404);
      let workspaceName='Workspace';
      if(workspace?.owner_id){
        const {data:w,error:wError}=await admin.from('workspaces').select('name').eq('id',workspace.owner_id).maybeSingle();
        if(wError)throw wError;if(w?.name)workspaceName=w.name;
      }
      return ok({ticket:{...ticket,workspace_name:workspaceName},messages:messages||[],attachments:attachments||[]});
    }

    if(action==='update_ticket'){
      const ticketId=asText(body?.ticketId,80);
      if(!ticketId)return fail('Falta el ticket.');
      const patch:any={updated_at:new Date().toISOString()};
      if(['open','in_progress','waiting_user','resolved','closed'].includes(body?.status))patch.status=body.status;
      if(['low','normal','high','urgent'].includes(body?.priority))patch.priority=body.priority;
      if('assignedTo' in body)patch.assigned_to=body.assignedTo||null;
      if(patch.status==='resolved')patch.resolved_at=new Date().toISOString();
      if(patch.status==='closed')patch.closed_at=new Date().toISOString();
      const {data:updated,error}=await userClient.from('support_tickets').update(patch).eq('id',ticketId).select('id,owner_id,ticket_number').single();
      if(error)throw error;
      await audit({workspaceId:updated.owner_id,action:'update_ticket',entityType:'support_ticket',entityId:ticketId,summary:`Actualizó el ticket ${updated.ticket_number}`,details:patch});
      return ok({ok:true});
    }

    if(action==='reply_ticket'){
      const ticketId=asText(body?.ticketId,80);
      const message=asText(body?.message,10000);
      if(!ticketId||!message)return fail('Escribe una respuesta.');
      const {data:ticket,error:ticketError}=await admin.from('support_tickets').select('id,owner_id,ticket_number').eq('id',ticketId).maybeSingle();
      if(ticketError)throw ticketError;if(!ticket)return fail('Ticket no encontrado.',404);
      const {data:inserted,error}=await userClient.from('support_messages').insert({
        ticket_id:ticketId,
        owner_id:ticket.owner_id,
        author_user_id:caller.id,
        author_email:caller.email||'',
        author_name:caller.user_metadata?.full_name||caller.email||'Soporte',
        author_role:'admin',
        body:message,
      }).select('id').single();
      if(error)throw error;
      await userClient.from('support_tickets').update({status:'waiting_user',updated_at:new Date().toISOString()}).eq('id',ticketId);

      let notified=false;
      let notificationReason='';
      try{
        const anonKey=Deno.env.get('SUPABASE_ANON_KEY')||'';
        const notification=await fetch(`${url}/functions/v1/support-notify`,{
          method:'POST',
          headers:{
            Authorization:`Bearer ${token}`,
            apikey:anonKey,
            'Content-Type':'application/json',
          },
          body:JSON.stringify({ticketId,event:'reply',messageId:inserted.id}),
        });
        const payload=await notification.json().catch(()=>({}));
        notified=notification.ok&&payload?.delivered===true;
        notificationReason=String(payload?.reason||payload?.error||'');
      }catch(notificationError){
        notificationReason=notificationError instanceof Error?notificationError.message:'No se pudo enviar la notificación.';
      }

      await audit({
        workspaceId:ticket.owner_id,
        action:'reply_ticket',
        entityType:'support_message',
        entityId:inserted.id,
        summary:`Respondió al ticket ${ticket.ticket_number}`,
        details:{ticket_id:ticketId,notified,notification_reason:notificationReason||null},
      });
      return ok({ok:true,messageId:inserted.id,notified,notificationReason});
    }

    if(action==='list_platform_audit'){
      const {data,error}=await admin.from('platform_audit_logs').select('*').order('created_at',{ascending:false}).limit(300);
      if(error)throw error;return ok({entries:data||[]});
    }

    return fail('Acción no válida.');
  }catch(error){
    console.error(error);
    const message=error instanceof Error?error.message:String((error as any)?.message||'Error interno.');
    return fail(message,500);
  }
});
