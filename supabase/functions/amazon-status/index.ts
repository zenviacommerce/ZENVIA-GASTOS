import { createAdminClient, authenticateUser } from '../_shared/amazon/supabase.ts';
import { ensureAmazonAccountAndMarketplaces } from '../_shared/amazon/marketplaces.ts';

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
    const caller=await authenticateUser(req,admin);
    if(caller.role!=='admin'&&!(caller.permissions||[]).includes('amazon'))return response({error:'No tienes permiso para consultar Amazon.'},403);
    const configured=Boolean((Deno.env.get('AMAZON_SPAPI_CREDENTIALS')||'').trim());
    let connectionError:string|null=null;

    let {data:account,error:accountError}=await admin.from('amazon_accounts')
      .select('id,owner_id,display_name,status,initial_sync_from,last_successful_sync_at')
      .eq('owner_id',caller.data_owner_id).neq('status','disabled')
      .order('updated_at',{ascending:false}).limit(1).maybeSingle();
    if(accountError)throw accountError;

    if(configured&&(!account||account.status!=='connected')){
      try{
        const bootstrap=await ensureAmazonAccountAndMarketplaces(admin,caller.data_owner_id);
        account=bootstrap.account;
      }catch(error){
        connectionError=error instanceof Error?error.message:'No se pudo comprobar la conexión con Amazon.';
        const refreshed=await admin.from('amazon_accounts')
          .select('id,owner_id,display_name,status,initial_sync_from,last_successful_sync_at')
          .eq('owner_id',caller.data_owner_id).neq('status','disabled')
          .order('updated_at',{ascending:false}).limit(1).maybeSingle();
        if(refreshed.error)throw refreshed.error;
        account=refreshed.data;
      }
    }

    let marketplaces:any[]=[];
    let latestRun:any=null;
    let jobs:any[]=[];
    if(account){
      const marketResult=await admin.from('amazon_marketplaces')
        .select('marketplace_id,country_code,name,currency_code,active')
        .eq('owner_id',caller.data_owner_id).eq('amazon_account_id',account.id)
        .order('country_code',{ascending:true});
      if(marketResult.error)throw marketResult.error;
      marketplaces=marketResult.data||[];

      const runResult=await admin.from('amazon_sync_runs')
        .select('source,mode,status,started_at,finished_at,rows_processed,error_message')
        .eq('owner_id',caller.data_owner_id).eq('amazon_account_id',account.id)
        .order('started_at',{ascending:false}).limit(1).maybeSingle();
      if(runResult.error)throw runResult.error;
      latestRun=runResult.data;

      const jobResult=await admin.from('amazon_sync_jobs').select('status')
        .eq('owner_id',caller.data_owner_id).eq('amazon_account_id',account.id).limit(10000);
      if(jobResult.error)throw jobResult.error;
      jobs=jobResult.data||[];
    }

    const jobCounts={queued:0,running:0,success:0,failed:0};
    for(const job of jobs){
      const key=String(job.status||'') as keyof typeof jobCounts;
      if(key in jobCounts)jobCounts[key]+=1;
    }

    return response({
      configured,
      connected:Boolean(configured&&account?.status==='connected'),
      status:configured?(account?.status||'pending'):'not_configured',
      account:account?{
        displayName:account.display_name,
        initialSyncFrom:account.initial_sync_from,
        lastSuccessfulSyncAt:account.last_successful_sync_at,
      }:null,
      marketplaces:marketplaces.map(item=>({
        id:item.marketplace_id,
        countryCode:item.country_code,
        name:item.name,
        currencyCode:item.currency_code,
        active:Boolean(item.active),
      })),
      sync:{latestRun,jobCounts},
      error:connectionError||latestRun?.error_message||null,
    });
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo consultar Amazon.';
    const status=/sesión|permiso|acceso/i.test(message)?403:500;
    return response({error:message},status);
  }
});
