import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { markJobFailed, markJobSuccess } from '../_shared/amazon/sync.ts';
import { syncOrdersJob } from '../_shared/amazon/orders.ts';
import { syncFinancesJob } from '../_shared/amazon/finances.ts';
import { syncInventoryJob } from '../_shared/amazon/inventory.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}

async function dispatch(admin:any,job:any){
  if(job.source==='orders')return syncOrdersJob(admin,job);
  if(job.source==='finances')return syncFinancesJob(admin,job);
  if(job.source==='inventory')return syncInventoryJob(admin,job);
  throw new Error(`Fuente Amazon no soportada: ${String(job.source)}`);
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const {data:jobs,error}=await admin.rpc('amazon_claim_sync_jobs',{limit_count:6});
    if(error)throw error;
    const results:any[]=[];
    for(const job of jobs||[]){
      try{
        const rowsProcessed=await dispatch(admin,job);
        await markJobSuccess(admin,job,rowsProcessed);
        results.push({id:job.id,source:job.source,status:'success',rowsProcessed});
      }catch(jobError){
        await markJobFailed(admin,job,jobError);
        results.push({id:job.id,source:job.source,status:'retry_or_failed'});
      }
    }
    return response({ok:true,claimed:(jobs||[]).length,results});
  }catch(error){return response({error:error instanceof Error?error.message:'Error interno del worker.'},401);}
});
