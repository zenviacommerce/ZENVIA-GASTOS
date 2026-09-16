import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { syncOrdersJob } from '../_shared/amazon/orders.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const body=await req.json().catch(()=>({}));
    if(!body?.job)return response({error:'Falta el job de pedidos.'},400);
    const rowsProcessed=await syncOrdersJob(createAdminClient(),body.job);
    return response({ok:true,rowsProcessed});
  }catch(error){return response({error:error instanceof Error?error.message:'No se pudieron sincronizar los pedidos Amazon.'},500);}
});
