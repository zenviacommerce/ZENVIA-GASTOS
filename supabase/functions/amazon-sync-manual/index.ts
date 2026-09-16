import { authenticateAdminUser, createAdminClient } from '../_shared/amazon/supabase.ts';
import { ensureAmazonAccountAndMarketplaces } from '../_shared/amazon/marketplaces.ts';
import { enqueueHourlySync } from '../_shared/amazon/sync.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const admin=createAdminClient();
  try{
    const caller=await authenticateAdminUser(req,admin);
    if(caller.role!=='admin')return response({error:'Solo un administrador puede sincronizar Amazon.'},403);
    const bootstrap=await ensureAmazonAccountAndMarketplaces(admin,caller.data_owner_id);
    const created=await enqueueHourlySync(admin,bootstrap.account,bootstrap.marketplaces,'manual');
    return response({ok:true,accounts:1,jobs:created.length});
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo solicitar la sincronización de Amazon.';
    const status=/sesión|administrador|acceso/i.test(message)?403:500;
    return response({error:message},status);
  }
});
