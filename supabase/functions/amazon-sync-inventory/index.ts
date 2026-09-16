import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { syncInventoryJob } from '../_shared/amazon/inventory.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const body=await req.json().catch(()=>({}));
    if(!body?.job)return response({error:'Falta el job de inventario.'},400);
    const rowsProcessed=await syncInventoryJob(createAdminClient(),body.job);
    return response({ok:true,rowsProcessed});
  }catch(error){return response({error:error instanceof Error?error.message:'No se pudo sincronizar el inventario FBA.'},500);}
});
