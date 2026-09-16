import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { syncFinancesJob } from '../_shared/amazon/finances.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const body=await req.json().catch(()=>({}));
    if(!body?.job)return response({error:'Falta el job financiero.'},400);
    const rowsProcessed=await syncFinancesJob(createAdminClient(),body.job);
    return response({ok:true,rowsProcessed});
  }catch(error){return response({error:error instanceof Error?error.message:'No se pudieron sincronizar las finanzas Amazon.'},500);}
});
