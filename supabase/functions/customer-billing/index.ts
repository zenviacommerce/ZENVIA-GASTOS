import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};

function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string;}catch{}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function fail(message:string,status=400){return new Response(JSON.stringify({error:message}),{status,headers:jsonHeaders});}
function ok(data:unknown){return new Response(JSON.stringify(data),{headers:jsonHeaders});}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  try{
    const url=Deno.env.get('SUPABASE_URL')||'';
    const adminKey=getAdminKey();
    if(!url||!adminKey)return fail('Configuración de facturación no disponible.',500);
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return fail('Sesión no válida.',401);

    const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await admin.auth.getUser(token);
    if(userError||!userData.user)return fail('Sesión no válida.',401);

    const {data:caller,error:callerError}=await admin.from('app_users')
      .select('user_id,workspace_id,data_owner_id,role,active')
      .eq('user_id',userData.user.id).maybeSingle();
    if(callerError)throw callerError;
    if(!caller?.active||caller.role!=='admin')return fail('Solo un administrador puede consultar el plan y la facturación.',403);
    const workspaceId=caller.workspace_id||caller.data_owner_id;
    if(!workspaceId)return fail('Workspace no configurado.',403);

    const {data:workspace,error:workspaceError}=await admin.from('workspaces')
      .select('id,status').eq('id',workspaceId).maybeSingle();
    if(workspaceError)throw workspaceError;
    if(!workspace||!['active','trialing'].includes(workspace.status))return fail('La suscripción de tu empresa no está activa.',403);

    const now=new Date();
    const monthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
    const nextMonthStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();

    const [
      {data:plans,error:plansError},
      {data:entitlements,error:entitlementsError},
      {data:subscription,error:subscriptionError},
      {count:userCount,error:userCountError},
      {data:amazonAccounts,error:amazonError},
      {count:monthlyOrders,error:ordersError},
    ]=await Promise.all([
      admin.from('billing_plans')
        .select('plan_key,name,description,is_public,active,monthly_price_cents,yearly_price_cents,sort_order')
        .eq('active',true).order('sort_order',{ascending:true}),
      admin.from('plan_entitlements')
        .select('plan_key,entitlement_key,enabled,limit_value,config')
        .order('entitlement_key',{ascending:true}),
      admin.from('workspace_subscriptions')
        .select('workspace_id,plan_key,status,billing_provider,trial_ends_at,current_period_ends_at,cancel_at_period_end')
        .eq('workspace_id',workspaceId).maybeSingle(),
      admin.from('app_users').select('user_id',{count:'exact',head:true}).eq('workspace_id',workspaceId).eq('active',true),
      admin.from('amazon_accounts').select('id,status').eq('owner_id',workspaceId),
      admin.from('fulfillment_orders').select('id',{count:'exact',head:true})
        .eq('owner_id',workspaceId).gte('order_created_at',monthStart).lt('order_created_at',nextMonthStart),
    ]);
    if(plansError)throw plansError;
    if(entitlementsError)throw entitlementsError;
    if(subscriptionError)throw subscriptionError;
    if(userCountError)throw userCountError;
    if(amazonError)throw amazonError;
    if(ordersError)throw ordersError;

    return ok({
      plans:plans||[],
      entitlements:entitlements||[],
      subscription:subscription||null,
      usage:{
        users:Number(userCount||0),
        amazonAccounts:(amazonAccounts||[]).filter((row:any)=>row.status!=='disabled').length,
        monthlyOrders:Number(monthlyOrders||0),
      },
    });
  }catch(error){
    console.error(error);
    return fail(error instanceof Error?error.message:'No se pudo cargar la facturación.',500);
  }
});