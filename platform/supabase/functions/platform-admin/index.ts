import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};
const gestionBridgeUrl='https://sjkxxbedkkmgmqnvaqjh.supabase.co/functions/v1/platform-bridge';
const adminAppUrl='https://admin.zenviacommerce.com';

function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string;}catch{}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function ok(data:unknown){return new Response(JSON.stringify(data),{headers:jsonHeaders});}
function fail(message:string,status=400){return new Response(JSON.stringify({error:message}),{status,headers:jsonHeaders});}
function clean(value:unknown,max=250){return typeof value==='string'?value.trim().slice(0,max):'';}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    const adminKey=getAdminKey();
    if(!url||!adminKey)return fail('Configuración no disponible.',500);
    const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return fail('Sesión no válida.',401);
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData.user)return fail('Sesión no válida.',401);
    const authUser=userData.user;

    const {data:profile,error:profileError}=await admin.from('platform_users')
      .select('user_id,email,full_name,role_key,active')
      .eq('user_id',authUser.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active)return fail('Acceso reservado a usuarios internos de ZENVIA Platform.',403);

    const [{data:rolePerms,error:rolePermsError},{data:overrides,error:overridesError}]=await Promise.all([
      admin.from('platform_role_permissions').select('permission_key').eq('role_key',profile.role_key),
      admin.from('platform_user_permissions').select('permission_key,allowed').eq('user_id',profile.user_id),
    ]);
    if(rolePermsError)throw rolePermsError;if(overridesError)throw overridesError;
    const permissions=new Set<string>((rolePerms||[]).map((row:any)=>String(row.permission_key)));
    for(const row of overrides||[]){
      if(row.allowed)permissions.add(row.permission_key);else permissions.delete(row.permission_key);
    }
    const has=(permission:string)=>profile.role_key==='super_admin'||permissions.has(permission);

    const audit=async(action:string,entityType:string,entityId:string|null,summary:string,details:Record<string,unknown>={})=>{
      const {error}=await admin.from('platform_audit_logs').insert({
        actor_user_id:profile.user_id,action,entity_type:entityType,entity_id:entityId,summary,details,
      });
      if(error)console.error('platform audit',error.message);
    };

    const bridge=async(action:string,payload:Record<string,unknown>={})=>{
      const {data:secret,error:secretError}=await admin.from('platform_secrets').select('secret_value').eq('secret_key','gestion_bridge_token').maybeSingle();
      if(secretError)throw secretError;
      if(!secret?.secret_value)throw new Error('El puente con ZENVIA Gestión no está configurado.');
      const response=await fetch(gestionBridgeUrl,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-platform-token':secret.secret_value},
        body:JSON.stringify({action,actor:{id:profile.user_id,email:profile.email,name:profile.full_name||profile.email},...payload}),
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(String(data?.error||'ZENVIA Gestión rechazó la operación.'));
      return data;
    };

    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action,80)||'bootstrap';

    if(action==='bootstrap'){
      if(!has('dashboard.view'))return fail('No tienes permiso para acceder al resumen.',403);
      const remote=await bridge('bootstrap');
      await admin.from('platform_users').update({last_login_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('user_id',profile.user_id);
      return ok({actor:{id:profile.user_id,email:profile.email,name:profile.full_name||'',role:profile.role_key,permissions:[...permissions]},stats:remote.stats});
    }

    if(action==='list_workspaces'){
      if(!has('clients.view'))return fail('No tienes permiso para consultar clientes.',403);
      return ok(await bridge('list_workspaces'));
    }
    if(action==='create_workspace'){
      if(!has('clients.create'))return fail('No tienes permiso para crear clientes.',403);
      const remote=await bridge('create_workspace',{name:body.name,legalName:body.legalName,ownerEmail:body.ownerEmail,ownerFullName:body.ownerFullName,planKey:body.planKey});
      await audit('create_workspace','workspace',remote.workspaceId||null,`Creó el cliente ${clean(body.name,120)}`,{owner_email:clean(body.ownerEmail,254),plan_key:clean(body.planKey,50)});
      return ok(remote);
    }
    if(action==='update_workspace'){
      if(!has('clients.update'))return fail('No tienes permiso para editar clientes.',403);
      const remote=await bridge('update_workspace',{workspaceId:body.workspaceId,status:body.status});
      await audit('update_workspace_status','workspace',clean(body.workspaceId,80)||null,`Cambió el estado de ${remote.name||'un cliente'} a ${remote.status||body.status}`,{previous_status:remote.previousStatus||null,status:remote.status||body.status});
      return ok(remote);
    }

    if(action==='list_plans'){
      if(!has('plans.view'))return fail('No tienes permiso para consultar planes.',403);
      return ok(await bridge('list_plans'));
    }
    if(action==='update_plan'){
      if(!has('plans.manage'))return fail('No tienes permiso para gestionar planes.',403);
      const remote=await bridge('update_plan',body);
      await audit('update_plan','billing_plan',clean(body.planKey,50)||null,`Actualizó el plan ${clean(body.planKey,50)}`,{});
      return ok(remote);
    }
    if(action==='assign_plan'){
      if(!has('plans.manage')&&!has('billing.manage'))return fail('No tienes permiso para cambiar suscripciones.',403);
      const remote=await bridge('assign_plan',{workspaceId:body.workspaceId,planKey:body.planKey});
      await audit('assign_plan','workspace_subscription',clean(body.workspaceId,80)||null,`Cambió el plan de un cliente a ${clean(body.planKey,50)}`,{plan_key:clean(body.planKey,50)});
      return ok(remote);
    }

    if(action==='list_tickets'){
      if(!has('tickets.view'))return fail('No tienes permiso para consultar tickets.',403);
      return ok(await bridge('list_tickets'));
    }
    if(action==='ticket_detail'){
      if(!has('tickets.view'))return fail('No tienes permiso para consultar tickets.',403);
      return ok(await bridge('ticket_detail',{ticketId:body.ticketId}));
    }
    if(action==='update_ticket'){
      if(!has('tickets.manage'))return fail('No tienes permiso para gestionar tickets.',403);
      const remote=await bridge('update_ticket',{ticketId:body.ticketId,status:body.status,priority:body.priority,assignedTo:body.assignedTo});
      await audit('update_ticket','support_ticket',clean(body.ticketId,80)||null,'Actualizó un ticket',{status:body.status||null,priority:body.priority||null});
      return ok(remote);
    }
    if(action==='reply_ticket'){
      if(!has('tickets.reply'))return fail('No tienes permiso para responder tickets.',403);
      const remote=await bridge('reply_ticket',{ticketId:body.ticketId,message:body.message});
      await audit('reply_ticket','support_message',remote.messageId||null,'Respondió a un ticket',{ticket_id:clean(body.ticketId,80),notified:Boolean(remote.notified)});
      return ok(remote);
    }

    if(action==='list_users'){
      if(!has('users.view'))return fail('No tienes permiso para consultar usuarios internos.',403);
      const [
        {data:users,error:usersError},
        {data:roles,error:rolesError},
        {data:allPermissions,error:permissionsError},
        {data:userOverrides,error:userOverridesError},
        {data:rolePermissions,error:rolePermissionsError},
      ]=await Promise.all([
        admin.from('platform_users').select('user_id,email,full_name,role_key,active,last_login_at,created_at,updated_at').order('created_at',{ascending:true}),
        admin.from('platform_roles').select('role_key,name,description,active').eq('active',true).order('name'),
        admin.from('platform_permissions').select('permission_key,module,name,description').order('module').order('permission_key'),
        admin.from('platform_user_permissions').select('user_id,permission_key,allowed'),
        admin.from('platform_role_permissions').select('role_key,permission_key'),
      ]);
      if(usersError)throw usersError;if(rolesError)throw rolesError;if(permissionsError)throw permissionsError;if(userOverridesError)throw userOverridesError;if(rolePermissionsError)throw rolePermissionsError;
      const overrideMap=new Map<string,any[]>();
      for(const row of userOverrides||[]){const list=overrideMap.get(row.user_id)||[];list.push(row);overrideMap.set(row.user_id,list);}
      return ok({users:(users||[]).map((u:any)=>({...u,permission_overrides:overrideMap.get(u.user_id)||[]})),roles:roles||[],permissions:allPermissions||[],rolePermissions:rolePermissions||[]});
    }

    if(action==='invite_user'){
      if(!has('users.manage'))return fail('No tienes permiso para crear usuarios internos.',403);
      const email=clean(body?.email,254).toLowerCase(),fullName=clean(body?.fullName,150),roleKey=clean(body?.roleKey,80);
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email))return fail('Indica un email válido.');
      if(fullName.length<2)return fail('Indica el nombre del usuario.');
      const {data:role,error:roleError}=await admin.from('platform_roles').select('role_key').eq('role_key',roleKey).eq('active',true).maybeSingle();
      if(roleError)throw roleError;if(!role)return fail('Rol no válido.');
      const {data:invite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{data:{full_name:fullName,platform_onboarding_pending:true},redirectTo:adminAppUrl});
      if(inviteError||!invite.user)throw inviteError||new Error('No se pudo enviar la invitación.');
      const {error:userInsertError}=await admin.from('platform_users').upsert({user_id:invite.user.id,email,full_name:fullName,role_key:roleKey,active:true,updated_at:new Date().toISOString()},{onConflict:'user_id'});
      if(userInsertError)throw userInsertError;
      await audit('invite_platform_user','platform_user',invite.user.id,`Invitó a ${email}`,{role_key:roleKey});
      return ok({ok:true,userId:invite.user.id});
    }

    if(action==='update_user'){
      if(!has('users.manage'))return fail('No tienes permiso para gestionar usuarios internos.',403);
      const userId=clean(body?.userId,80);
      if(!userId)return fail('Falta el usuario.');
      const {data:target,error:targetError}=await admin.from('platform_users').select('user_id,email,role_key,active').eq('user_id',userId).maybeSingle();
      if(targetError)throw targetError;if(!target)return fail('Usuario no encontrado.',404);
      const patch:any={updated_at:new Date().toISOString()};
      if(typeof body?.active==='boolean'){
        if(userId===profile.user_id&&body.active===false)return fail('No puedes desactivar tu propio usuario.',400);
        patch.active=body.active;
      }
      if(typeof body?.roleKey==='string'){
        const roleKey=clean(body.roleKey,80);
        const {data:role,error:roleError}=await admin.from('platform_roles').select('role_key').eq('role_key',roleKey).eq('active',true).maybeSingle();
        if(roleError)throw roleError;if(!role)return fail('Rol no válido.');
        if(userId===profile.user_id&&profile.role_key==='super_admin'&&roleKey!=='super_admin')return fail('No puedes retirarte a ti mismo el rol de superadministrador.',400);
        patch.role_key=roleKey;
      }
      if(Object.keys(patch).length>1){
        const {error:updateError}=await admin.from('platform_users').update(patch).eq('user_id',userId);
        if(updateError)throw updateError;
      }
      if(Array.isArray(body?.permissionOverrides)){
        const {error:deleteError}=await admin.from('platform_user_permissions').delete().eq('user_id',userId);if(deleteError)throw deleteError;
        const rows=body.permissionOverrides
          .filter((row:any)=>typeof row?.permissionKey==='string'&&typeof row?.allowed==='boolean')
          .map((row:any)=>({user_id:userId,permission_key:clean(row.permissionKey,120),allowed:row.allowed}));
        if(rows.length){const {error:insertError}=await admin.from('platform_user_permissions').insert(rows);if(insertError)throw insertError;}
      }
      await audit('update_platform_user','platform_user',userId,`Actualizó el usuario ${target.email}`,{role_key:patch.role_key||target.role_key,active:'active' in patch?patch.active:target.active,permission_overrides:Array.isArray(body?.permissionOverrides)?body.permissionOverrides.length:null});
      return ok({ok:true});
    }

    if(action==='list_platform_audit'){
      if(!has('audit.view'))return fail('No tienes permiso para consultar la auditoría.',403);
      const {data,error}=await admin.from('platform_audit_logs').select('*').order('created_at',{ascending:false}).limit(500);
      if(error)throw error;return ok({entries:data||[]});
    }

    return fail('Acción no válida.',404);
  }catch(error){
    console.error(error);
    return fail(error instanceof Error?error.message:'Error interno.',500);
  }
});