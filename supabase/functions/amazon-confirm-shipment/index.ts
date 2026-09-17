import { createAdminClient, authenticateUser } from '../_shared/amazon/supabase.ts';
import { retryPendingAmazonTracking, syncAmazonTracking } from '../_shared/amazon/shipment-confirmation.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});}
function allowed(caller:any){const permissions=Array.isArray(caller?.permissions)?caller.permissions:[];return caller?.role==='admin'||permissions.includes('orders');}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    const admin=createAdminClient(),caller=await authenticateUser(req,admin);if(!allowed(caller))return response({error:'No tienes permiso para gestionar pedidos.'},403);
    const body=await req.json().catch(()=>({})),action=String(body?.action||'confirm_order_tracking');
    if(action==='confirm_order_tracking'){
      const orderId=String(body?.orderId||'').trim();if(!orderId)return response({error:'Falta el pedido.'},400);
      const {data:order,error}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();if(error)throw error;if(!order)return response({error:'Pedido no encontrado.'},404);
      const result=await syncAmazonTracking(admin,order);return response({ok:true,...result});
    }
    if(action==='retry_pending'){
      const result=await retryPendingAmazonTracking(admin,caller.data_owner_id,Number(body?.limit)||5,Boolean(body?.force));return response({ok:true,...result});
    }
    return response({error:'Acción no válida.'},400);
  }catch(error){
    const message=error instanceof Error?error.message:String(error||'Error interno.');
    const status=/Sesión no válida/.test(message)?401:/permiso/i.test(message)?403:500;
    return response({error:message},status);
  }
});
