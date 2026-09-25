import { createClient } from 'npm:@supabase/supabase-js@2';

const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type, apikey, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};

function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string;}catch{}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
async function sha256(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    const adminKey=getAdminKey();
    if(!url||!adminKey)return response({error:'Configuración no disponible.'},500);
    const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});

    const {count,error:countError}=await admin.from('platform_users').select('user_id',{count:'exact',head:true});
    if(countError)throw countError;
    if((count||0)>0)return response({error:'La activación inicial ya se realizó.'},409);

    const body=await req.json().catch(()=>({}));
    const email=String(body?.email||'').trim().toLowerCase();
    const password=String(body?.password||'');
    const fullName=String(body?.fullName||'').trim().slice(0,150);
    const code=String(body?.code||'').trim();
    if(email!=='soporte@zenviacommerce.com')return response({error:'El administrador inicial debe ser soporte@zenviacommerce.com.'},403);
    if(password.length<10)return response({error:'La contraseña debe tener al menos 10 caracteres.'},400);
    if(fullName.length<2)return response({error:'Indica el nombre del administrador.'},400);
    if(!code)return response({error:'Falta el código de activación.'},400);

    const {data:secret,error:secretError}=await admin.from('platform_secrets').select('secret_value').eq('secret_key','bootstrap_code_sha256').maybeSingle();
    if(secretError)throw secretError;
    if(!secret?.secret_value||await sha256(code)!==secret.secret_value)return response({error:'Código de activación no válido.'},403);

    const {data:created,error:createError}=await admin.auth.admin.createUser({
      email,password,email_confirm:true,user_metadata:{full_name:fullName},
      app_metadata:{zenvia_platform:true},
    });
    if(createError||!created.user)throw createError||new Error('No se pudo crear el administrador inicial.');

    const {data:profile,error:profileError}=await admin.from('platform_users')
      .select('user_id,email,full_name,role_key,active')
      .eq('user_id',created.user.id).maybeSingle();
    if(profileError)throw profileError;
    if(!profile?.active){
      await admin.auth.admin.deleteUser(created.user.id).catch(()=>undefined);
      throw new Error('No se pudo asignar el rol inicial.');
    }

    await admin.from('platform_audit_logs').insert({
      actor_user_id:created.user.id,
      action:'bootstrap_platform',
      entity_type:'platform_user',
      entity_id:created.user.id,
      summary:'Activó el administrador inicial de ZENVIA Platform',
      details:{email},
    });
    await admin.from('platform_secrets').delete().eq('secret_key','bootstrap_code_sha256');
    return response({ok:true});
  }catch(error){
    console.error(error);
    return response({error:error instanceof Error?error.message:'No se pudo activar ZENVIA Platform.'},500);
  }
});