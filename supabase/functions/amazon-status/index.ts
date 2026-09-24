import { createAdminClient, authenticateUser } from '../_shared/amazon/supabase.ts';
import { ensureAmazonAccountAndMarketplaces } from '../_shared/amazon/marketplaces.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});}
function errText(error:unknown,fallback:string){return error instanceof Error?error.message:fallback;}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);

  const admin=createAdminClient();
  try{
    const caller=await authenticateUser(req,admin);
    if(caller.role!=='admin'&&!(caller.permissions||[]).includes('amazon'))return response({error:'No tienes permiso para consultar Amazon.'},403);
    const body=await req.json().catch(()=>({}));
    const requestedIntegrationId=String(body?.integrationAccountId||'').trim();

    let integration:any=null;
    if(requestedIntegrationId){
      const result=await admin.from('integration_accounts').select('id,display_name,status,enabled,secret_id,credential_source,linked_resource_id,last_error')
        .eq('owner_id',caller.data_owner_id).eq('provider','amazon').eq('id',requestedIntegrationId).maybeSingle();
      if(result.error)throw result.error;integration=result.data;
    }else{
      const preferred=await admin.from('integration_accounts').select('id,display_name,status,enabled,secret_id,credential_source,linked_resource_id,last_error')
        .eq('owner_id',caller.data_owner_id).eq('provider','amazon').neq('status','disabled')
        .order('is_default',{ascending:false}).order('updated_at',{ascending:false}).limit(1).maybeSingle();
      if(preferred.error)throw preferred.error;integration=preferred.data;
    }

    const envConfigured=Boolean((Deno.env.get('AMAZON_SPAPI_CREDENTIALS')||'').trim());
    const configured=Boolean(integration?.secret_id)||Boolean(integration&&integration.credential_source==='environment'&&envConfigured)||(!integration&&envConfigured);
    let connectionError:string|null=null;
    let transientWarning:string|null=null;

    let accountQuery=admin.from('amazon_accounts')
      .select('id,owner_id,display_name,status,initial_sync_from,last_successful_sync_at,integration_account_id')
      .eq('owner_id',caller.data_owner_id).neq('status','disabled');
    if(integration?.id)accountQuery=accountQuery.eq('integration_account_id',integration.id);
    const accountResult=await accountQuery.order('updated_at',{ascending:false}).limit(1).maybeSingle();
    if(accountResult.error)throw accountResult.error;
    let account=accountResult.data;

    if(configured&&caller.role==='admin'&&(!account||account.status!=='connected')){
      try{
        const bootstrap=await ensureAmazonAccountAndMarketplaces(admin,caller.data_owner_id,integration?.id||null);
        account=bootstrap.account;
      }catch(error){
        connectionError=errText(error,'No se pudo comprobar la conexión con Amazon.');
        let refreshedQuery=admin.from('amazon_accounts')
          .select('id,owner_id,display_name,status,initial_sync_from,last_successful_sync_at,integration_account_id')
          .eq('owner_id',caller.data_owner_id).neq('status','disabled');
        if(integration?.id)refreshedQuery=refreshedQuery.eq('integration_account_id',integration.id);
        const refreshed=await refreshedQuery.order('updated_at',{ascending:false}).limit(1).maybeSingle();
        if(!refreshed.error)account=refreshed.data;
        else transientWarning=errText(refreshed.error,'No se pudo refrescar el estado almacenado.');
      }
    }

    let marketplaces:any[]=[];
    let latestRun:any=null;
    const jobCounts={queued:0,running:0,success:0,failed:0};

    if(account){
      const [marketResult,runResult,...countResults]=await Promise.all([
        admin.from('amazon_marketplaces')
          .select('marketplace_id,country_code,name,currency_code,active')
          .eq('owner_id',caller.data_owner_id).eq('amazon_account_id',account.id)
          .order('country_code',{ascending:true}),
        admin.from('amazon_sync_runs')
          .select('source,mode,status,started_at,finished_at,rows_processed,error_message')
          .eq('owner_id',caller.data_owner_id).eq('amazon_account_id',account.id)
          .order('started_at',{ascending:false}).limit(1).maybeSingle(),
        ...(['queued','running','success','failed'] as const).map(status=>
          admin.from('amazon_sync_jobs').select('id',{count:'exact',head:true})
            .eq('owner_id',caller.data_owner_id).eq('amazon_account_id',account.id).eq('status',status)
        ),
      ]);
      if(!marketResult.error)marketplaces=marketResult.data||[];
      else transientWarning=transientWarning||errText(marketResult.error,'No se pudieron leer los marketplaces.');
      if(!runResult.error)latestRun=runResult.data;
      else transientWarning=transientWarning||errText(runResult.error,'No se pudo leer la última sincronización.');
      (['queued','running','success','failed'] as const).forEach((status,index)=>{
        const result=countResults[index];
        if(!result?.error)jobCounts[status]=Number(result?.count||0);
        else transientWarning=transientWarning||errText(result.error,'No se pudo contar la cola de sincronización.');
      });
    }

    return response({
      configured,
      connected:Boolean(configured&&account?.status==='connected'),
      status:configured?(account?.status||integration?.status||'pending'):'not_configured',
      account:account?{
        id:account.id,
        integrationAccountId:account.integration_account_id||integration?.id||null,
        displayName:account.display_name,
        initialSyncFrom:account.initial_sync_from,
        lastSuccessfulSyncAt:account.last_successful_sync_at,
      }:null,
      marketplaces:marketplaces.map(item=>({
        id:item.marketplace_id,countryCode:item.country_code,name:item.name,currencyCode:item.currency_code,active:Boolean(item.active),
      })),
      sync:{latestRun,jobCounts},
      error:connectionError||latestRun?.error_message||integration?.last_error||null,
      warning:transientWarning,
    });
  }catch(error){
    const message=errText(error,'No se pudo consultar Amazon.');
    const status=/sesión|permiso|acceso/i.test(message)?403:500;
    return response({error:message},status);
  }
});
