import { createClient } from 'npm:@supabase/supabase-js@2';

export type AppCaller={
  user_id:string;
  data_owner_id:string;
  role:string;
  active:boolean;
  permissions:string[]|null;
};

export function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){
    try{
      const parsed=JSON.parse(secretKeys);
      if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim();
    }catch{/* legacy fallback below */}
  }
  return (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'').trim();
}

export function createAdminClient(){
  const url=(Deno.env.get('SUPABASE_URL')||'').trim();
  const key=getAdminKey();
  if(!url||!key)throw new Error('Configuración interna de Supabase no disponible.');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

export function requireInternalSecret(req:Request){
  const expected=getAdminKey();
  const presented=(req.headers.get('apikey')||'').trim();
  if(!expected||!presented||presented!==expected)throw new Error('Llamada interna no autorizada.');
}

export async function authenticateUser(req:Request,admin:any):Promise<AppCaller>{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users')
    .select('user_id,data_owner_id,role,active,permissions')
    .eq('user_id',userData.user.id)
    .maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const {data:workspace,error:workspaceError}=await admin.from('workspaces').select('status').eq('id',caller.data_owner_id).maybeSingle();
  if(workspaceError)throw workspaceError;
  if(!workspace||!['active','trialing'].includes(workspace.status))throw new Error('El acceso de tu empresa está suspendido.');
  return caller as AppCaller;
}

export async function authenticateAdminUser(req:Request,admin:any){
  const caller=await authenticateUser(req,admin);
  if(caller.role!=='admin')throw new Error('Solo un administrador puede iniciar una sincronización manual de Amazon.');
  return caller;
}
