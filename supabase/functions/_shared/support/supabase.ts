import { createClient } from 'npm:@supabase/supabase-js@2';

export function adminClient(){
  const url=(Deno.env.get('SUPABASE_URL')||'').trim();
  const key=(Deno.env.get('SUPABASE_SECRET_KEYS')||'').trim();
  let secret='';
  if(key){
    try{const parsed=JSON.parse(key);secret=String(parsed?.default||'').trim();}catch{/* fallback */}
  }
  secret=secret||(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'').trim();
  if(!url||!secret)throw new Error('Configuración interna de Supabase no disponible.');
  return createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
}

export async function caller(req:Request,admin:any){
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data,error}=await admin.from('app_users').select('user_id,data_owner_id,email,full_name,role,active').eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!data?.active)throw new Error('Usuario no autorizado.');
  const {data:workspace,error:workspaceError}=await admin.from('workspaces').select('status').eq('id',data.data_owner_id).maybeSingle();
  if(workspaceError)throw workspaceError;
  if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('El acceso de tu empresa está suspendido.');
  return data;
}
