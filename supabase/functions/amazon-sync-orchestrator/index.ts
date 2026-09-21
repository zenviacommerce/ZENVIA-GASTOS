import { createAdminClient, getAdminKey, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { ensureAmazonAccountAndMarketplaces } from '../_shared/amazon/marketplaces.ts';
import { enqueueHourlySync, enqueueInitialBackfill } from '../_shared/amazon/sync.ts';
import { filterAutomaticMarketplaces, loadAmazonAutomaticSyncSettings } from '../_shared/amazon/settings.ts';

const jsonHeaders={'Content-Type':'application/json'};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:jsonHeaders});}

async function requestAutomaticImageSync(ownerId:string){
  const url=(Deno.env.get('SUPABASE_URL')||'').trim();
  const key=getAdminKey();
  if(!url||!key)throw new Error('Configuración interna de Supabase no disponible para imágenes Amazon.');
  const result=await fetch(`${url.replace(/\/$/,'')}/functions/v1/amazon-sync-product-images`,{
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':key},
    body:JSON.stringify({ownerId,limit:10}),
  });
  const payload=await result.json().catch(()=>({}));
  if(!result.ok||payload?.error)throw new Error(String(payload?.error||`Error HTTP ${result.status} sincronizando imágenes Amazon.`));
  return payload;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const body=await req.json().catch(()=>({}));
    const mode=String(body?.mode||'hourly');
    if(!['initial','hourly','reconcile'].includes(mode))return response({error:'Modo de sincronización no válido.'},400);
    const {data:accounts,error:accountError}=await admin.from('amazon_accounts').select('owner_id').neq('status','disabled');
    if(accountError)throw accountError;
    const ownerIds=[...new Set((accounts||[]).map((item:any)=>String(item.owner_id)).filter(Boolean))];
    let jobs=0;
    let processedAccounts=0;
    for(const ownerId of ownerIds){
      const bootstrap=await ensureAmazonAccountAndMarketplaces(admin,ownerId);
      const account=bootstrap.account;
      const automaticSettings=await loadAmazonAutomaticSyncSettings(admin,ownerId);
      const marketplaces=filterAutomaticMarketplaces(bootstrap.marketplaces,automaticSettings.activeMarketplaceIds);
      const enabledSources=automaticSettings.enabledSources;
      processedAccounts+=1;
      const started=new Date().toISOString();
      const {data:run,error:runError}=await admin.from('amazon_sync_runs').insert({owner_id:account.owner_id,amazon_account_id:account.id,source:'orchestrator',mode,status:'running',started_at:started}).select('id').single();
      if(runError)throw runError;
      try{
        let created:any[]=[];
        if(mode==='initial'){
          created=await enqueueInitialBackfill(admin,account,marketplaces,new Date(),enabledSources);
        }else if(mode==='hourly'){
          const {data:stateRows,error:stateError}=await admin.from('amazon_sync_state')
            .select('id')
            .eq('owner_id',account.owner_id)
            .eq('amazon_account_id',account.id)
            .limit(1);
          if(stateError)throw stateError;
          if(!(stateRows||[]).length){
            const historical=await enqueueInitialBackfill(admin,account,marketplaces,new Date(),enabledSources);
            created.push(...historical);
          }
          const incremental=await enqueueHourlySync(admin,account,marketplaces,'hourly',new Date(),enabledSources);
          created.push(...incremental);
        }else{
          created=await enqueueHourlySync(admin,account,marketplaces,'reconcile',new Date(),enabledSources);
        }
        jobs+=created.length;
        let imageSync:Record<string,unknown>|null=null;
        let imageSyncError:string|null=null;
        if(automaticSettings.autoSyncImages){
          try{imageSync=await requestAutomaticImageSync(ownerId);}
          catch(error){imageSyncError=error instanceof Error?error.message:'No se pudieron actualizar las imágenes Amazon.';}
        }
        await admin.from('amazon_sync_runs').update({
          status:'success',
          finished_at:new Date().toISOString(),
          rows_processed:created.length,
          checkpoint:{queued_jobs:created.length,image_sync:imageSync,image_sync_error:imageSyncError},
          updated_at:new Date().toISOString()
        }).eq('id',run.id);
      }catch(error){
        await admin.from('amazon_sync_runs').update({status:'failed',finished_at:new Date().toISOString(),error_message:error instanceof Error?error.message.slice(0,700):'Error de orquestación',updated_at:new Date().toISOString()}).eq('id',run.id);
        throw error;
      }
    }
    return response({ok:true,mode,accounts:processedAccounts,jobs});
  }catch(error){return response({error:error instanceof Error?error.message:'Error interno de sincronización.'},401);}
});
