import { authenticateAdminUser, createAdminClient } from '../_shared/amazon/supabase.ts';
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
    const {data:accounts,error:accountError}=await admin.from('amazon_accounts').select('id,owner_id,initial_sync_from,status').eq('owner_id',caller.data_owner_id).neq('status','disabled');
    if(accountError)throw accountError;
    let jobs=0;
    for(const account of accounts||[]){
      const {data:marketplaces,error:marketError}=await admin.from('amazon_marketplaces').select('marketplace_id,active').eq('owner_id',caller.data_owner_id).eq('amazon_account_id',account.id).eq('active',true);
      if(marketError)throw marketError;
      const created=await enqueueHourlySync(admin,account,marketplaces||[],'manual');
      jobs+=created.length;
    }
    return response({ok:true,accounts:(accounts||[]).length,jobs});
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo solicitar la sincronización de Amazon.';
    const status=/sesión|administrador|acceso/i.test(message)?403:500;
    return response({error:message},status);
  }
});
