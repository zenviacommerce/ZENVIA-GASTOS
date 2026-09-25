import { authenticateAdminUser, createAdminClient, getAdminKey } from '../_shared/amazon/supabase.ts';
import { ensureAmazonAccountAndMarketplaces } from '../_shared/amazon/marketplaces.ts';
import { enqueueHourlySync } from '../_shared/amazon/sync.ts';
import { filterAutomaticMarketplaces, loadAmazonAutomaticSyncSettings } from '../_shared/amazon/settings.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});}


async function kickWorker(){
  const url=(Deno.env.get('SUPABASE_URL')||'').trim();
  const key=getAdminKey();
  if(!url||!key)return false;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8_000);
  try{
    const result=await fetch(`${url.replace(/\/$/,'')}/functions/v1/amazon-sync-worker`,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':key},
      body:'{}',
      signal:controller.signal,
    });
    return result.ok;
  }catch{return false;}
  finally{clearTimeout(timeout);}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const admin=createAdminClient();
  try{
    const caller=await authenticateAdminUser(req,admin);
    if(caller.role!=='admin')return response({error:'Solo un administrador puede sincronizar Amazon.'},403);
    const body=await req.json().catch(()=>({}));
    const requestedId=String(body?.integrationAccountId||'').trim();

    let integrationIds:Array<string|null>=[];
    if(requestedId){
      const {data,error}=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id).eq('provider','amazon').eq('id',requestedId).neq('status','disabled').maybeSingle();
      if(error)throw error;
      if(!data)return response({error:'La cuenta de Amazon seleccionada no está disponible.'},404);
      integrationIds=[data.id];
    }else{
      const {data,error}=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id).eq('provider','amazon').eq('enabled',true).neq('status','disabled').order('is_default',{ascending:false});
      if(error)throw error;
      integrationIds=(data||[]).map((row:any)=>String(row.id));
      if(!integrationIds.length)return response({error:'Amazon todavía no está conectado para este workspace.'},409);
    }

    let jobs=0,processed=0;
    for(const integrationAccountId of integrationIds){
      const bootstrap=await ensureAmazonAccountAndMarketplaces(admin,caller.data_owner_id,integrationAccountId);
      const settings=await loadAmazonAutomaticSyncSettings(admin,caller.data_owner_id,integrationAccountId);
      const marketplaces=filterAutomaticMarketplaces(bootstrap.marketplaces,settings.activeMarketplaceIds);
      const created=await enqueueHourlySync(admin,bootstrap.account,marketplaces,'manual',new Date(),settings.enabledSources);
      jobs+=created.length;processed+=1;
    }
    const workerKicked=jobs>0?await kickWorker():false;
    return response({ok:true,accounts:processed,jobs,workerKicked});
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo solicitar la sincronización de Amazon.';
    const status=/sesión|administrador|acceso/i.test(message)?403:500;
    return response({error:message},status);
  }
});
