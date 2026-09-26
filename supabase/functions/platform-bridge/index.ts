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
function safeFileName(value:string){
  const cleaned=value.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  return cleaned.slice(-120)||'archivo';
}
function integerOrNull(value:unknown){
  if(value===null||value===''||value===undefined)return null;
  const parsed=Number(value);
  return Number.isInteger(parsed)&&parsed>=0?parsed:null;
}
async function loadUserLimit(admin:any,workspaceId:string){
  const {data:subscription,error:subscriptionError}=await admin.from('workspace_subscriptions').select('plan_key').eq('workspace_id',workspaceId).maybeSingle();
  if(subscriptionError)throw subscriptionError;
  if(!subscription?.plan_key)return null;
  const {data:entitlement,error:entitlementError}=await admin.from('plan_entitlements').select('enabled,limit_value').eq('plan_key',subscription.plan_key).eq('entitlement_key','users').maybeSingle();
  if(entitlementError)throw entitlementError;
  if(!entitlement)return null;
  if(entitlement.enabled===false)return 0;
  return entitlement.limit_value==null?null:Number(entitlement.limit_value);
}
function sanitizePermissions(value:unknown){
  if(!Array.isArray(value))return [];
  const allowed=new Set(modulePermissions);
  return value.filter((item):item is string=>typeof item==='string'&&allowed.has(item));
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

    if(action==='workspace_detail'){
      const workspaceId=asText(body?.workspaceId,80);if(!workspaceId)return fail('Falta el cliente.');
      const [
        {data:workspace,error:workspaceError},
        {data:business,error:businessError},
        {data:branding,error:brandingError},
        {data:users,error:usersError},
        {data:integrations,error:integrationsError},
        {data:subscription,error:subscriptionError},
      ]=await Promise.all([
        admin.from('workspaces').select('id,slug,name,legal_name,status,created_at,updated_at').eq('id',workspaceId).maybeSingle(),
        admin.from('business_settings').select('owner_id,legal_name,trade_name,tax_id,address_line1,address_line2,postal_code,city,province,country_code,email,phone,website').eq('owner_id',workspaceId).maybeSingle(),
        admin.from('company_branding').select('owner_id,logo_path').eq('owner_id',workspaceId).maybeSingle(),
        admin.from('app_users').select('user_id,email,full_name,role,active,permissions,created_at,updated_at').eq('workspace_id',workspaceId).order('created_at',{ascending:true}),
        admin.from('integration_accounts').select('id,provider,display_name,external_account_id,status,enabled,is_default,last_tested_at,last_success_at,last_error,created_at').eq('owner_id',workspaceId).order('provider').order('created_at'),
        admin.from('workspace_subscriptions').select('workspace_id,plan_key,status,billing_provider,trial_ends_at,current_period_ends_at,cancel_at_period_end').eq('workspace_id',workspaceId).maybeSingle(),
      ]);
      if(workspaceError)throw workspaceError;if(!workspace)return fail('Cliente no encontrado.',404);
      if(businessError)throw businessError;if(brandingError)throw brandingError;if(usersError)throw usersError;if(integrationsError)throw integrationsError;if(subscriptionError)throw subscriptionError;
      let logoUrl:string|null=null;
      if(branding?.logo_path){
        const {data:signed}=await admin.storage.from('company-assets').createSignedUrl(String(branding.logo_path),3600);
        logoUrl=signed?.signedUrl||null;
      }
      const {data:authUsers}=await admin.auth.admin.listUsers({page:1,perPage:1000});
      const authById=new Map((authUsers?.users||[]).map((item:any)=>[item.id,item]));
      const userLimit=await loadUserLimit(admin,workspaceId);
      return ok({
        workspace,business:business||null,branding:{logoPath:branding?.logo_path||null,logoUrl},
        users:(users||[]).map((item:any)=>({...item,last_sign_in_at:authById.get(item.user_id)?.last_sign_in_at||null})),
        integrations:integrations||[],subscription:subscription||null,
        userLimit,
        onboarding:{
          company:Boolean(business?.trade_name&&business?.legal_name&&business?.email),
          branding:Boolean(branding?.logo_path),
          owner:Boolean((users||[]).some((item:any)=>item.role==='admin'&&item.active)),
          plan:Boolean(subscription?.plan_key),
          integrations:Boolean((integrations||[]).some((item:any)=>item.enabled&&item.status!=='disabled')),
        },
      });
    }

    if(action==='update_workspace_profile'){
      const workspaceId=asText(body?.workspaceId,80);if(!workspaceId)return fail('Falta el cliente.');
      const name=asText(body?.name,120),legalName=asText(body?.legalName,180);
      if(name.length<2)return fail('Indica el nombre comercial.');
      const {error:workspaceError}=await admin.from('workspaces').update({name,legal_name:legalName||null,updated_at:new Date().toISOString()}).eq('id',workspaceId);
      if(workspaceError)throw workspaceError;
      const business=body?.business&&typeof body.business==='object'?body.business:{};
      const businessPatch={
        owner_id:workspaceId,
        trade_name:name,
        legal_name:legalName||name,
        tax_id:asText(business.taxId,40)||null,
        address_line1:asText(business.addressLine1,180)||null,
        address_line2:asText(business.addressLine2,180)||null,
        postal_code:asText(business.postalCode,20)||null,
        city:asText(business.city,100)||null,
        province:asText(business.province,100)||null,
        country_code:(asText(business.countryCode,2)||'ES').toUpperCase(),
        email:asText(business.email,254)||null,
        phone:asText(business.phone,50)||null,
        website:asText(business.website,240)||null,
        updated_at:new Date().toISOString(),
      };
      const {error:businessError}=await admin.from('business_settings').upsert(businessPatch,{onConflict:'owner_id'});
      if(businessError)throw businessError;
      return ok({ok:true});
    }

    if(action==='prepare_workspace_logo'){
      const workspaceId=asText(body?.workspaceId,80),fileName=safeFileName(asText(body?.fileName,240));
      const mimeType=asText(body?.mimeType,100),fileSize=Number(body?.fileSize||0);
      if(!workspaceId||!fileName)return fail('Falta el logotipo.');
      if(!['image/png','image/jpeg','image/webp'].includes(mimeType))return fail('El logotipo debe ser PNG, JPG o WebP.');
      if(!Number.isFinite(fileSize)||fileSize<=0||fileSize>5*1024*1024)return fail('El logotipo no puede superar 5 MB.');
      const extension=mimeType==='image/jpeg'?'jpg':mimeType==='image/webp'?'webp':'png';
      const storagePath=`${workspaceId}/branding/platform-${Date.now()}-${crypto.randomUUID().slice(0,8)}.${extension}`;
      const {data,error}=await admin.storage.from('company-assets').createSignedUploadUrl(storagePath);
      if(error||!data?.signedUrl)return fail(error?.message||'No se pudo preparar la subida.',500);
      return ok({storagePath,signedUrl:data.signedUrl,token:data.token});
    }

    if(action==='finalize_workspace_logo'){
      const workspaceId=asText(body?.workspaceId,80),storagePath=asText(body?.storagePath,500);
      if(!workspaceId||!storagePath.startsWith(`${workspaceId}/branding/`))return fail('Ruta de branding no válida.');
      const {data:current,error:currentError}=await admin.from('company_branding').select('logo_path').eq('owner_id',workspaceId).maybeSingle();
      if(currentError)throw currentError;
      const {error}=await admin.from('company_branding').upsert({owner_id:workspaceId,logo_path:storagePath,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
      if(error)throw error;
      if(current?.logo_path&&current.logo_path!==storagePath)await admin.storage.from('company-assets').remove([String(current.logo_path)]).catch(()=>undefined);
      return ok({ok:true});
    }

    if(action==='remove_workspace_logo'){
      const workspaceId=asText(body?.workspaceId,80);if(!workspaceId)return fail('Falta el cliente.');
      const {data:current,error:currentError}=await admin.from('company_branding').select('logo_path').eq('owner_id',workspaceId).maybeSingle();
      if(currentError)throw currentError;
      const {error}=await admin.from('company_branding').upsert({owner_id:workspaceId,logo_path:null,updated_at:new Date().toISOString()},{onConflict:'owner_id'});
      if(error)throw error;
      if(current?.logo_path)await admin.storage.from('company-assets').remove([String(current.logo_path)]).catch(()=>undefined);
      return ok({ok:true});
    }

    if(action==='invite_workspace_user'){
      const workspaceId=asText(body?.workspaceId,80),email=asText(body?.email,254).toLowerCase(),fullName=asText(body?.fullName,150);
      const role=body?.role==='admin'?'admin':'user',permissions=role==='admin'?[...modulePermissions]:sanitizePermissions(body?.permissions);
      if(!workspaceId)return fail('Falta el cliente.');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email))return fail('Indica un email válido.');
      if(fullName.length<2)return fail('Indica el nombre del usuario.');
      if(role==='user'&&!permissions.length)return fail('Selecciona al menos un permiso.');
      const userLimit=await loadUserLimit(admin,workspaceId);
      if(userLimit!==null){
        const {count,error:countError}=await admin.from('app_users').select('user_id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('active',true);
        if(countError)throw countError;
        if((count||0)>=userLimit)return fail(userLimit===0?'El plan no permite usuarios adicionales.':`Se ha alcanzado el límite de ${userLimit} usuarios activos.`,403);
      }
      const {data:invite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{data:{full_name:fullName,onboarding_pending:true},redirectTo:customerAppUrl});
      if(inviteError||!invite.user)throw inviteError||new Error('No se pudo enviar la invitación.');
      const {error:metaError}=await admin.auth.admin.updateUserById(invite.user.id,{app_metadata:{...(invite.user.app_metadata||{}),zenvia_managed:true,workspace_id:workspaceId}});
      if(metaError){await admin.auth.admin.deleteUser(invite.user.id).catch(()=>undefined);throw metaError;}
      const {error:profileError}=await admin.from('app_users').insert({user_id:invite.user.id,email,full_name:fullName,role,active:true,workspace_id:workspaceId,data_owner_id:workspaceId,permissions});
      if(profileError){await admin.auth.admin.deleteUser(invite.user.id).catch(()=>undefined);throw profileError;}
      return ok({ok:true,userId:invite.user.id});
    }

    if(action==='update_workspace_user'){
      const workspaceId=asText(body?.workspaceId,80),userId=asText(body?.userId,80);
      if(!workspaceId||!userId)return fail('Falta el usuario.');
      const {data:target,error:targetError}=await admin.from('app_users').select('user_id,role,active').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();
      if(targetError)throw targetError;if(!target)return fail('Usuario no encontrado.',404);
      const role=body?.role==='admin'?'admin':'user',active=body?.active!==false,permissions=role==='admin'?[...modulePermissions]:sanitizePermissions(body?.permissions);
      if(role==='user'&&!permissions.length)return fail('Selecciona al menos un permiso.');
      if((target.role==='admin'&&target.active)&&(!active||role!=='admin')){
        const {count,error:adminCountError}=await admin.from('app_users').select('user_id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('role','admin').eq('active',true);
        if(adminCountError)throw adminCountError;if((adminCount||0)<=1)return fail('El cliente debe conservar al menos un administrador activo.');
      }
      if(active&&!target.active){
        const userLimit=await loadUserLimit(admin,workspaceId);
        if(userLimit!==null){
          const {count,error:countError}=await admin.from('app_users').select('user_id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('active',true);
          if(countError)throw countError;if((count||0)>=userLimit)return fail(`Se ha alcanzado el límite de ${userLimit} usuarios activos.`,403);
        }
      }
      const {error}=await admin.from('app_users').update({role,active,permissions,updated_at:new Date().toISOString()}).eq('workspace_id',workspaceId).eq('user_id',userId);
      if(error)throw error;return ok({ok:true});
    }

    if(action==='delete_workspace_user'){
      const workspaceId=asText(body?.workspaceId,80),userId=asText(body?.userId,80);
      if(!workspaceId||!userId)return fail('Falta el usuario.');
      const {data:target,error:targetError}=await admin.from('app_users').select('user_id,role,active').eq('workspace_id',workspaceId).eq('user_id',userId).maybeSingle();
      if(targetError)throw targetError;if(!target)return fail('Usuario no encontrado.',404);
      if(target.role==='admin'&&target.active){
        const {count,error:adminCountError}=await admin.from('app_users').select('user_id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('role','admin').eq('active',true);
        if(adminCountError)throw adminCountError;if((adminCount||0)<=1)return fail('No puedes eliminar el último administrador activo.');
      }
      const {error}=await admin.from('app_users').delete().eq('workspace_id',workspaceId).eq('user_id',userId);
      if(error)throw error;
      await admin.auth.admin.deleteUser(userId);
      return ok({ok:true});
    }

    if(action==='create_workspace'){
      const name=asText(body?.name,120),legalName=asText(body?.legalName,180);
      const ownerEmail=asText(body?.ownerEmail,254).toLowerCase(),ownerFullName=asText(body?.ownerFullName,150);
      const planKey=asText(body?.planKey,50)||'starter';
      const initialBusiness=body?.business&&typeof body.business==='object'?body.business:{};
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
        const {error:businessError}=await admin.from('business_settings').insert({
          owner_id:workspaceId,legal_name:legalName||name,trade_name:name,
          tax_id:asText(initialBusiness.taxId,40)||null,address_line1:asText(initialBusiness.addressLine1,180)||null,
          postal_code:asText(initialBusiness.postalCode,20)||null,city:asText(initialBusiness.city,100)||null,
          province:asText(initialBusiness.province,100)||null,country_code:(asText(initialBusiness.countryCode,2)||'ES').toUpperCase(),
          email:asText(initialBusiness.email,254)||ownerEmail,phone:asText(initialBusiness.phone,50)||null,website:asText(initialBusiness.website,240)||null,
        });if(businessError)throw businessError;
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
      if('sortOrder' in body)patch.sort_order=integerOrNull(body.sortOrder)??100;
      const existingMetadata=body?.metadata&&typeof body.metadata==='object'&&!Array.isArray(body.metadata)?body.metadata:{};
      if('trialDays' in body)patch.metadata={...existingMetadata,trial_days:integerOrNull(body.trialDays)??0};
      else if(Object.keys(existingMetadata).length)patch.metadata=existingMetadata;
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
      const signedAttachments=await Promise.all((attachments||[]).map(async(attachment:any)=>{
        const {data:signed,error:signedError}=await admin.storage.from('support-attachments').createSignedUrl(String(attachment.storage_path),3600);
        return {...attachment,signed_url:signedError?null:signed?.signedUrl||null};
      }));
      return ok({ticket:{...ticket,workspace_name:w?.name||'Workspace'},messages:messages||[],attachments:signedAttachments});
    }

    if(action==='prepare_ticket_attachment'){
      const ticketId=asText(body?.ticketId,80),messageId=asText(body?.messageId,80);
      const fileName=asText(body?.fileName,240),mimeType=asText(body?.mimeType,160);
      const fileSize=Number(body?.fileSize||0);
      if(!ticketId||!fileName)return fail('Falta el archivo.');
      if(!actor.id||!actor.email)return fail('Falta la identidad del operador.',400);
      if(!Number.isFinite(fileSize)||fileSize<=0||fileSize>10*1024*1024)return fail('El máximo por archivo es 10 MB.');
      const {data:ticket,error:ticketError}=await admin.from('support_tickets').select('id,owner_id').eq('id',ticketId).maybeSingle();
      if(ticketError)throw ticketError;if(!ticket)return fail('Ticket no encontrado.',404);
      if(messageId){
        const {data:message,error:messageError}=await admin.from('support_messages').select('id').eq('id',messageId).eq('ticket_id',ticketId).maybeSingle();
        if(messageError)throw messageError;if(!message)return fail('El mensaje no pertenece al ticket.');
      }
      const folder=messageId?`${ticketId}/${messageId}`:`${ticketId}/platform`;
      const storagePath=`${folder}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
      const {data:signed,error:signedError}=await admin.storage.from('support-attachments').createSignedUploadUrl(storagePath);
      if(signedError)throw signedError;
      return ok({storagePath,signedUrl:signed.signedUrl,token:signed.token,fileName,mimeType:mimeType||null,fileSize});
    }

    if(action==='finalize_ticket_attachment'){
      const ticketId=asText(body?.ticketId,80),messageId=asText(body?.messageId,80);
      const storagePath=asText(body?.storagePath,600),fileName=asText(body?.fileName,240),mimeType=asText(body?.mimeType,160);
      const fileSize=Number(body?.fileSize||0);
      if(!ticketId||!storagePath||!fileName)return fail('Faltan datos del adjunto.');
      if(!actor.id||!actor.email)return fail('Falta la identidad del operador.',400);
      if(!storagePath.startsWith(`${ticketId}/`))return fail('Ruta de adjunto no válida.');
      if(!Number.isFinite(fileSize)||fileSize<=0||fileSize>10*1024*1024)return fail('El máximo por archivo es 10 MB.');
      const {data:ticket,error:ticketError}=await admin.from('support_tickets').select('id,owner_id').eq('id',ticketId).maybeSingle();
      if(ticketError)throw ticketError;if(!ticket)return fail('Ticket no encontrado.',404);
      if(messageId){
        const {data:message,error:messageError}=await admin.from('support_messages').select('id').eq('id',messageId).eq('ticket_id',ticketId).maybeSingle();
        if(messageError)throw messageError;if(!message)return fail('El mensaje no pertenece al ticket.');
      }
      const {data:attachment,error}=await admin.from('support_attachments').insert({
        ticket_id:ticketId,message_id:messageId||null,owner_id:ticket.owner_id,uploaded_by:actor.id,
        file_name:fileName,mime_type:mimeType||null,file_size:fileSize,storage_path:storagePath,
      }).select('id,ticket_id,message_id,file_name,mime_type,file_size,storage_path,created_at').single();
      if(error)throw error;
      return ok({ok:true,attachment});
    }

    if(action==='discard_ticket_attachment'){
      const ticketId=asText(body?.ticketId,80),storagePath=asText(body?.storagePath,600);
      if(!ticketId||!storagePath||!storagePath.startsWith(`${ticketId}/`))return fail('Ruta de adjunto no válida.');
      const {error}=await admin.storage.from('support-attachments').remove([storagePath]);
      if(error)throw error;
      return ok({ok:true});
    }

    if(action==='update_ticket'){
      const ticketId=asText(body?.ticketId,80);if(!ticketId)return fail('Falta el ticket.');
      const patch:any={updated_at:new Date().toISOString()};
      if(['incident','request'].includes(body?.type))patch.type=body.type;
      if('subject' in body){
        const subject=asText(body?.subject,180);
        if(subject.length<3)return fail('El asunto debe tener al menos 3 caracteres.');
        patch.subject=subject;
      }
      if('description' in body){
        const description=asText(body?.description,10000);
        if(description.length<3)return fail('La descripción debe tener al menos 3 caracteres.');
        patch.description=description;
      }
      if(['open','in_progress','waiting_user','resolved','closed'].includes(body?.status))patch.status=body.status;
      if(['low','normal','high','urgent'].includes(body?.priority))patch.priority=body.priority;
      if('assignedTo' in body)patch.assigned_to=body.assignedTo||null;
      if('status' in patch){
        patch.resolved_at=patch.status==='resolved'?new Date().toISOString():null;
        patch.closed_at=patch.status==='closed'?new Date().toISOString():null;
      }
      const {data:updated,error}=await admin.from('support_tickets').update(patch).eq('id',ticketId).select('id,owner_id,ticket_number,type,subject,description,status,priority').single();
      if(error)throw error;return ok({ok:true,ticket:updated});
    }

    if(action==='delete_ticket'){
      const ticketId=asText(body?.ticketId,80);if(!ticketId)return fail('Falta el ticket.');
      const [{data:ticket,error:ticketError},{data:attachments,error:attachmentsError}]=await Promise.all([
        admin.from('support_tickets').select('id,ticket_number,owner_id,subject').eq('id',ticketId).maybeSingle(),
        admin.from('support_attachments').select('storage_path').eq('ticket_id',ticketId),
      ]);
      if(ticketError)throw ticketError;if(attachmentsError)throw attachmentsError;
      if(!ticket)return fail('Ticket no encontrado.',404);
      const {error:deleteError}=await admin.from('support_tickets').delete().eq('id',ticketId);
      if(deleteError)throw deleteError;
      const paths=(attachments||[]).map((row:any)=>String(row.storage_path||'')).filter(Boolean);
      let storageCleanup=true,warning='';
      if(paths.length){
        const removed=await admin.storage.from('support-attachments').remove(paths);
        if(removed.error){storageCleanup=false;warning=removed.error.message;}
      }
      return ok({ok:true,ticketNumber:ticket.ticket_number,subject:ticket.subject,storageCleanup,warning});
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