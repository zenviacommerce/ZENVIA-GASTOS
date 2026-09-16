import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { ensureAmazonAccountAndMarketplaces } from '../_shared/amazon/marketplaces.ts';
import { enqueueHourlySync, enqueueInitialBackfill } from '../_shared/amazon/sync.ts';

const jsonHeaders={'Content-Type':'application/json'};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:jsonHeaders});}

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
      const marketplaces=bootstrap.marketplaces;
      processedAccounts+=1;
      const started=new Date().toISOString();
      const {data:run,error:runError}=await admin.from('amazon_sync_runs').insert({owner_id:account.owner_id,amazon_account_id:account.id,source:'orchestrator',mode,status:'running',started_at:started}).select('id').single();
      if(runError)throw runError;
      try{
        let created:any[]=[];
        if(mode==='initial'){
          created=await enqueueInitialBackfill(admin,account,marketplaces);
        }else if(mode==='hourly'){
          const {data:stateRows,error:stateError}=await admin.from('amazon_sync_state')
            .select('id')
            .eq('owner_id',account.owner_id)
            .eq('amazon_account_id',account.id)
            .limit(1);
          if(stateError)throw stateError;
          if(!(stateRows||[]).length){
            const historical=await enqueueInitialBackfill(admin,account,marketplaces);
            created.push(...historical);
          }
          const incremental=await enqueueHourlySync(admin,account,marketplaces,'hourly');
          created.push(...incremental);
        }else{
          created=await enqueueHourlySync(admin,account,marketplaces,'reconcile');
        }
        jobs+=created.length;
        await admin.from('amazon_sync_runs').update({status:'success',finished_at:new Date().toISOString(),rows_processed:created.length,checkpoint:{queued_jobs:created.length},updated_at:new Date().toISOString()}).eq('id',run.id);
      }catch(error){
        await admin.from('amazon_sync_runs').update({status:'failed',finished_at:new Date().toISOString(),error_message:error instanceof Error?error.message.slice(0,700):'Error de orquestación',updated_at:new Date().toISOString()}).eq('id',run.id);
        throw error;
      }
    }
    return response({ok:true,mode,accounts:processedAccounts,jobs});
  }catch(error){return response({error:error instanceof Error?error.message:'Error interno de sincronización.'},401);}
});
