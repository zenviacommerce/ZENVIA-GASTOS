import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { syncFxRates } from '../_shared/amazon/fx.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function dateOnly(date:Date){return date.toISOString().slice(0,10);}
function daysAgo(days:number){const date=new Date();date.setUTCDate(date.getUTCDate()-days);return dateOnly(date);}
function validDate(value:unknown){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const body=await req.json().catch(()=>({}));
    const from=validDate(body?.from)?String(body.from):daysAgo(7);
    const to=validDate(body?.to)?String(body.to):dateOnly(new Date());
    if(from>to)throw new Error('El rango FX no es válido.');

    const {data:marketplaces,error}=await admin
      .from('amazon_marketplaces')
      .select('currency_code')
      .eq('active',true);
    if(error)throw error;
    const currencies=[...new Set((marketplaces||[]).map((row:any)=>String(row.currency_code||'').trim().toUpperCase()).filter(Boolean))];
    const result=await syncFxRates(admin,currencies,from,to);
    return response({ok:true,from,to,...result});
  }catch(error){
    return response({error:error instanceof Error?error.message:'Error interno de FX.'},401);
  }
});
