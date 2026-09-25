import { createClient } from 'npm:@supabase/supabase-js@2';
import { enforceWorkspaceLimit, requireWorkspaceEntitlement } from '../_shared/saas/entitlements.ts';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const headers={...corsHeaders,'Content-Type':'application/json'};
const PROVIDERS=new Set(['amazon','sendcloud','shopify','gmail']);
const SENDCLOUD_BASE='https://panel.sendcloud.sc/api/v3';
const SP_API_BASE='https://sellingpartnerapi-eu.amazon.com';

type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};
type Provider='amazon'|'sendcloud'|'shopify'|'gmail';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers});}
function clean(v:unknown){return String(v??'').trim();}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(typeof parsed?.default==='string'&&parsed.default.trim())return parsed.default.trim()}catch{/* fallback */}}
  return clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
}
function sanitize(value:unknown){
  return clean(value)
    .replace(/Atz[ar]\|[A-Za-z0-9._|\-]+/g,'[redacted-token]')
    .replace(/("(?:client_secret|refresh_token|access_token|secretKey|secret_key)"\s*:\s*")([^"]+)(")/gi,'$1[redacted]$3')
    .slice(0,700);
}
async function authenticate(req:Request,admin:any):Promise<Caller>{
  const token=clean(req.headers.get('Authorization')).replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData?.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users')
    .select('user_id,data_owner_id,role,active,permissions')
    .eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  if(caller.role!=='admin')throw new Error('Solo un administrador puede gestionar integraciones.');
  return caller as Caller;
}
function publicAccount(row:any){
  return {
    id:row.id,
    provider:row.provider,
    displayName:row.display_name,
    externalAccountId:row.external_account_id,
    status:row.status,
    enabled:Boolean(row.enabled),
    isDefault:Boolean(row.is_default),
    credentialSource:row.credential_source,
    credentialsConfigured:Boolean(row.secret_id)||['environment','session','derived'].includes(row.credential_source),
    parentAccountId:row.parent_account_id,
    linkedResourceId:row.linked_resource_id,
    config:row.config||{},
    lastTestedAt:row.last_tested_at,
    lastSuccessAt:row.last_success_at,
    lastError:row.last_error,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  };
}
async function listAccounts(admin:any,ownerId:string){
  const {data,error}=await admin.from('integration_accounts')
    .select('*').eq('owner_id',ownerId).order('provider').order('is_default',{ascending:false}).order('display_name');
  if(error)throw error;
  return (data||[]).map(publicAccount);
}
async function readVault(admin:any,secretId:string|null){
  if(!secretId)return {};
  const {data,error}=await admin.rpc('integration_read_secret',{p_secret_id:secretId});
  if(error)throw error;
  try{return JSON.parse(String(data||'{}'))}catch{throw new Error('Las credenciales almacenadas no tienen un formato válido.')}
}
async function writeVault(admin:any,accountId:string,provider:Provider,credentials:Record<string,unknown>,existingId:string|null){
  const payload=JSON.stringify(credentials);
  const {data,error}=await admin.rpc('integration_store_secret',{
    p_secret:payload,
    p_name:`integration:${provider}:${accountId}`,
    p_description:`Credenciales cifradas para ${provider} (${accountId})`,
    p_existing_secret_id:existingId,
  });
  if(error)throw error;
  return String(data);
}
async function loadAccount(admin:any,ownerId:string,id:string){
  const {data,error}=await admin.from('integration_accounts').select('*').eq('owner_id',ownerId).eq('id',id).maybeSingle();
  if(error)throw error;
  if(!data)throw new Error('Integración no encontrada.');
  return data;
}
async function makeDefault(admin:any,ownerId:string,provider:Provider,id:string){
  const clear=await admin.from('integration_accounts').update({is_default:false,updated_at:new Date().toISOString()}).eq('owner_id',ownerId).eq('provider',provider).neq('id',id);
  if(clear.error)throw clear.error;
  const set=await admin.from('integration_accounts').update({is_default:true,updated_at:new Date().toISOString()}).eq('owner_id',ownerId).eq('id',id);
  if(set.error)throw set.error;
}
function envAmazonCredentials(){
  const raw=clean(Deno.env.get('AMAZON_SPAPI_CREDENTIALS'));
  if(!raw)return {};
  try{return JSON.parse(raw)}catch{return {}}
}
async function amazonCredentials(admin:any,account:any){
  const stored=account.secret_id?await readVault(admin,account.secret_id):{};
  const env=envAmazonCredentials() as any;
  const legacyEnvironment=account.credential_source==='environment';
  const credentials={
    clientId:clean((stored as any).clientId||(stored as any).client_id||env.client_id||env.clientId),
    clientSecret:clean((stored as any).clientSecret||(stored as any).client_secret||env.client_secret||env.clientSecret),
    refreshToken:clean((stored as any).refreshToken||(stored as any).refresh_token||(legacyEnvironment?(env.refresh_token||env.refreshToken):'')),
    sellerId:clean((stored as any).sellerId||(stored as any).seller_id||account.external_account_id||(legacyEnvironment?(env.seller_id||env.sellerId):'')),
  };
  if(!credentials.clientId||!credentials.clientSecret||!credentials.refreshToken||!credentials.sellerId){
    throw new Error('Faltan credenciales de Amazon. Se necesitan Seller ID, refresh token y credenciales de la aplicación SP-API.');
  }
  return credentials;
}
async function amazonToken(c:any){
  const body=new URLSearchParams();
  body.set('grant_type','refresh_token');
  body.set('refresh_token',c.refreshToken);
  body.set('client_id',c.clientId);
  body.set('client_secret',c.clientSecret);
  const res=await fetch('https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok||!data?.access_token)throw new Error(`Amazon LWA (${res.status}): ${sanitize(data?.error_description||data?.error||text)}`);
  return String(data.access_token);
}
async function amazonParticipations(admin:any,ownerId:string,account:any){
  const credentials=await amazonCredentials(admin,account);
  const token=await amazonToken(credentials);
  const res=await fetch(`${SP_API_BASE}/sellers/v1/marketplaceParticipations`,{headers:{
    Accept:'application/json',
    'user-agent':'ZENVIA-Gestion/1.0 (Integration Manager)',
    'x-amz-access-token':token,
    'x-amz-date':new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),
  }});
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok)throw new Error(`Amazon SP-API (${res.status}): ${sanitize(data?.errors?.[0]?.message||data?.message||text)}`);
  const rows=(data?.payload||[]).filter((x:any)=>x?.marketplace?.id&&x?.marketplace?.countryCode);
  const now=new Date().toISOString();
  let amazonAccountId=account.linked_resource_id as string|null;
  if(!amazonAccountId){
    const upsert=await admin.from('amazon_accounts').upsert({
      owner_id:ownerId,seller_id:credentials.sellerId,display_name:account.display_name||'Amazon',
      region:'EU',status:'connected',integration_account_id:account.id,updated_at:now,
    },{onConflict:'owner_id,seller_id'}).select('id').single();
    if(upsert.error)throw upsert.error;
    amazonAccountId=upsert.data.id;
    const link=await admin.from('integration_accounts').update({linked_resource_id:amazonAccountId}).eq('id',account.id).eq('owner_id',ownerId);
    if(link.error)throw link.error;
  }else{
    const update=await admin.from('amazon_accounts').update({status:'connected',display_name:account.display_name,updated_at:now,integration_account_id:account.id})
      .eq('id',amazonAccountId).eq('owner_id',ownerId);
    if(update.error)throw update.error;
  }
  const inactive=await admin.from('amazon_marketplaces').update({active:false,updated_at:now}).eq('owner_id',ownerId).eq('amazon_account_id',amazonAccountId);
  if(inactive.error)throw inactive.error;
  const markets=rows.map((item:any)=>({
    owner_id:ownerId,amazon_account_id:amazonAccountId,marketplace_id:String(item.marketplace.id),
    country_code:String(item.marketplace.countryCode||'').toUpperCase(),
    name:String(item.marketplace.name||item.marketplace.countryCode||item.marketplace.id),
    currency_code:String(item.marketplace.defaultCurrencyCode||'EUR').toUpperCase(),
    active:Boolean(item.participation?.isParticipating),updated_at:now,
  }));
  if(markets.length){
    const upsert=await admin.from('amazon_marketplaces').upsert(markets,{onConflict:'owner_id,amazon_account_id,marketplace_id'});
    if(upsert.error)throw upsert.error;
  }
  return {amazonAccountId,marketplaces:markets.filter((x:any)=>x.active)};
}
async function sendcloudCredentials(admin:any,account:any){
  const stored=account.secret_id?await readVault(admin,account.secret_id):{};
  let publicKey=clean((stored as any).publicKey||(stored as any).public_key);
  let secretKey=clean((stored as any).secretKey||(stored as any).secret_key);
  if(account.credential_source==='environment'){
    publicKey=publicKey||clean(Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY'));
    secretKey=secretKey||clean(Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET'));
  }
  if(!publicKey||!secretKey)throw new Error('Faltan las claves Public y Secret de Sendcloud.');
  return {publicKey,secretKey};
}
async function sendcloudIntegrations(admin:any,account:any){
  const c=await sendcloudCredentials(admin,account);
  const auth=`Basic ${btoa(`${c.publicKey}:${c.secretKey}`)}`;
  const res=await fetch(`${SENDCLOUD_BASE}/integrations`,{headers:{Authorization:auth,Accept:'application/json'}});
  const text=await res.text();let data:any={};try{data=JSON.parse(text)}catch{}
  if(!res.ok)throw new Error(`Sendcloud (${res.status}): ${sanitize(data?.message||data?.error||text)}`);
  return (data?.data||[]).map((item:any)=>{
    const value=`${item?.type||''} ${item?.shop_name||''} ${item?.shop_url||''}`.toLowerCase();
    return {
      id:Number(item.id),shopName:String(item.shop_name||item.type||`Integración ${item.id}`),
      type:String(item.type||''),shopUrl:item.shop_url||null,
      channel:value.includes('shopify')?'shopify':value.includes('amazon')?'amazon':'other',
    };
  });
}
async function testAccount(admin:any,ownerId:string,account:any){
  const now=new Date().toISOString();
  try{
    let detail:any={};
    if(account.provider==='amazon'){
      const result=await amazonParticipations(admin,ownerId,account);
      detail={marketplaces:result.marketplaces.length};
    }else if(account.provider==='sendcloud'){
      const integrations=await sendcloudIntegrations(admin,account);
      detail={integrations:integrations.length};
    }else if(account.provider==='shopify'){
      if(!account.parent_account_id)throw new Error('La tienda Shopify no tiene una cuenta de Sendcloud asociada.');
      const parent=await loadAccount(admin,ownerId,account.parent_account_id);
      const integrations=await sendcloudIntegrations(admin,parent);
      const wanted=Number(account.config?.sendcloudIntegrationId||account.external_account_id);
      const shop=integrations.find((x:any)=>x.channel==='shopify'&&x.id===wanted);
      if(!shop)throw new Error('La tienda Shopify ya no aparece entre las integraciones de Sendcloud.');
      detail={shopName:shop.shopName,shopUrl:shop.shopUrl};
    }else if(account.provider==='gmail'){
      detail={requiresBrowserSession:true};
    }
    const update=await admin.from('integration_accounts').update({
      status:'connected',last_tested_at:now,last_success_at:now,last_error:null,updated_at:now,
    }).eq('id',account.id).eq('owner_id',ownerId);
    if(update.error)throw update.error;
    return {ok:true,checkedAt:now,detail};
  }catch(error){
    const message=sanitize(error instanceof Error?error.message:error);
    await admin.from('integration_accounts').update({status:'error',last_tested_at:now,last_error:message,updated_at:now})
      .eq('id',account.id).eq('owner_id',ownerId);
    throw new Error(message||'No se pudo comprobar la integración.');
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  const url=clean(Deno.env.get('SUPABASE_URL')),key=getAdminKey();
  if(!url||!key)return response({error:'Configuración interna de Supabase no disponible.'},500);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin);
    const body=await req.json().catch(()=>({}));
    const action=clean(body?.action||'list');

    if(action==='list')return response({accounts:await listAccounts(admin,caller.data_owner_id)});

    if(action==='discover_shopify'){
      const parentId=clean(body?.parentAccountId);
      const parent=await loadAccount(admin,caller.data_owner_id,parentId);
      if(parent.provider!=='sendcloud')throw new Error('Selecciona una cuenta de Sendcloud.');
      const integrations=await sendcloudIntegrations(admin,parent);
      return response({shops:integrations.filter((x:any)=>x.channel==='shopify')});
    }

    if(action==='create'){
      const provider=clean(body?.provider) as Provider;
      if(!PROVIDERS.has(provider))throw new Error('Proveedor de integración no válido.');

      const providerEntitlement:Record<string,{key:string;message:string}>={
        amazon:{key:'integration.amazon',message:'Tu plan no incluye la integración con Amazon.'},
        sendcloud:{key:'integration.sendcloud',message:'Tu plan no incluye la integración con Sendcloud.'},
        gmail:{key:'integration.gmail',message:'Tu plan no incluye la integración con Gmail.'},
      };
      const configuredEntitlement=providerEntitlement[provider];
      if(configuredEntitlement){
        await requireWorkspaceEntitlement(admin,caller.data_owner_id,configuredEntitlement.key,configuredEntitlement.message);
      }
      if(provider==='amazon'){
        const {count,error:amazonCountError}=await admin.from('integration_accounts')
          .select('id',{count:'exact',head:true})
          .eq('owner_id',caller.data_owner_id)
          .eq('provider','amazon')
          .neq('status','disabled');
        if(amazonCountError)throw amazonCountError;
        await enforceWorkspaceLimit(
          admin,
          caller.data_owner_id,
          'amazon_accounts',
          Number(count||0),
          'Tu plan no permite conectar cuentas de Amazon.',
          limit=>`Has alcanzado el límite de ${limit} cuentas Amazon de tu plan.`,
        );
      }
      let displayName=clean(body?.displayName);
      let externalAccountId=clean(body?.externalAccountId)||null;
      let credentialSource='vault';
      let parentAccountId=clean(body?.parentAccountId)||null;
      let config=(body?.config&&typeof body.config==='object'&&!Array.isArray(body.config))?body.config:{};
      const credentials=(body?.credentials&&typeof body.credentials==='object'&&!Array.isArray(body.credentials))?body.credentials:{};
      if(provider==='amazon'){
        externalAccountId=clean((credentials as any).sellerId||(credentials as any).seller_id||externalAccountId);
        if(!externalAccountId)throw new Error('Indica el Seller ID de Amazon.');
        if(!clean((credentials as any).refreshToken||(credentials as any).refresh_token))throw new Error('Indica el refresh token de Amazon.');
        displayName=displayName||`Amazon · ${externalAccountId}`;
      }else if(provider==='sendcloud'){
        if(!clean((credentials as any).publicKey||(credentials as any).public_key)||!clean((credentials as any).secretKey||(credentials as any).secret_key))throw new Error('Indica las claves Public y Secret de Sendcloud.');
        externalAccountId=externalAccountId||`sendcloud-${crypto.randomUUID()}`;
        displayName=displayName||'Sendcloud';
      }else if(provider==='shopify'){
        if(!parentAccountId)throw new Error('Selecciona la cuenta de Sendcloud donde está conectada la tienda.');
        const parent=await loadAccount(admin,caller.data_owner_id,parentAccountId);
        if(parent.provider!=='sendcloud')throw new Error('La cuenta padre debe ser Sendcloud.');
        const remoteId=Number(config?.sendcloudIntegrationId||externalAccountId);
        if(!Number.isFinite(remoteId)||remoteId<=0)throw new Error('Selecciona una tienda Shopify detectada en Sendcloud.');
        const linked=await sendcloudIntegrations(admin,parent);
        const shop=linked.find((x:any)=>x.channel==='shopify'&&x.id===remoteId);
        if(!shop)throw new Error('La tienda Shopify seleccionada no está disponible en Sendcloud.');
        externalAccountId=String(remoteId);displayName=displayName||shop.shopName;
        config={...config,sendcloudIntegrationId:remoteId,shopUrl:shop.shopUrl};credentialSource='derived';
      }else{
        if(!externalAccountId)throw new Error('Indica el correo de la cuenta de Gmail.');
        displayName=displayName||externalAccountId;credentialSource='session';
      }
      const existing=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id).eq('provider',provider).eq('external_account_id',externalAccountId).maybeSingle();
      if(existing.error)throw existing.error;
      if(existing.data)throw new Error('Esta cuenta ya está añadida.');

      const count=await admin.from('integration_accounts').select('id',{count:'exact',head:true}).eq('owner_id',caller.data_owner_id).eq('provider',provider).neq('status','disabled');
      if(count.error)throw count.error;
      const isDefault=Number(count.count||0)===0;
      const inserted=await admin.from('integration_accounts').insert({
        owner_id:caller.data_owner_id,provider,display_name:displayName,external_account_id:externalAccountId,
        status:'pending',enabled:true,is_default:isDefault,credential_source:credentialSource,
        parent_account_id:parentAccountId,config,
      }).select('*').single();
      if(inserted.error)throw inserted.error;
      let account=inserted.data;
      if(provider==='amazon'||provider==='sendcloud'){
        const secretId=await writeVault(admin,account.id,provider,credentials,null);
        const saved=await admin.from('integration_accounts').update({secret_id:secretId,updated_at:new Date().toISOString()})
          .eq('id',account.id).eq('owner_id',caller.data_owner_id).select('*').single();
        if(saved.error)throw saved.error;account=saved.data;
      }
      if(body?.test!==false)await testAccount(admin,caller.data_owner_id,account);
      return response({account:publicAccount(await loadAccount(admin,caller.data_owner_id,account.id))});
    }

    const id=clean(body?.id);
    if(!id)throw new Error('Falta la cuenta de integración.');
    const account=await loadAccount(admin,caller.data_owner_id,id);

    if(action==='test'){
      const result=await testAccount(admin,caller.data_owner_id,account);
      return response({...result,account:publicAccount(await loadAccount(admin,caller.data_owner_id,id))});
    }
    if(action==='set_default'){
      await makeDefault(admin,caller.data_owner_id,account.provider,id);
      return response({accounts:await listAccounts(admin,caller.data_owner_id)});
    }
    if(action==='update'){
      if(body?.enabled===true&&account.enabled===false){
        const providerEntitlement:Record<string,{key:string;message:string}>={
          amazon:{key:'integration.amazon',message:'Tu plan no incluye la integración con Amazon.'},
          sendcloud:{key:'integration.sendcloud',message:'Tu plan no incluye la integración con Sendcloud.'},
          gmail:{key:'integration.gmail',message:'Tu plan no incluye la integración con Gmail.'},
        };
        const configuredEntitlement=providerEntitlement[account.provider];
        if(configuredEntitlement){
          await requireWorkspaceEntitlement(admin,caller.data_owner_id,configuredEntitlement.key,configuredEntitlement.message);
        }
        if(account.provider==='amazon'){
          const {count,error:amazonCountError}=await admin.from('integration_accounts')
            .select('id',{count:'exact',head:true})
            .eq('owner_id',caller.data_owner_id)
            .eq('provider','amazon')
            .eq('enabled',true)
            .neq('status','disabled');
          if(amazonCountError)throw amazonCountError;
          await enforceWorkspaceLimit(
            admin,
            caller.data_owner_id,
            'amazon_accounts',
            Number(count||0),
            'Tu plan no permite conectar cuentas de Amazon.',
            limit=>`Has alcanzado el límite de ${limit} cuentas Amazon de tu plan.`,
          );
        }
      }
      const patch:any={updated_at:new Date().toISOString()};
      if(typeof body?.displayName==='string'&&clean(body.displayName))patch.display_name=clean(body.displayName);
      if(typeof body?.enabled==='boolean')patch.enabled=body.enabled;
      if(body?.config&&typeof body.config==='object'&&!Array.isArray(body.config))patch.config={...(account.config||{}),...body.config};
      const credentials=(body?.credentials&&typeof body.credentials==='object'&&!Array.isArray(body.credentials))?body.credentials:null;
      if(credentials&&(account.provider==='amazon'||account.provider==='sendcloud')){
        const existing=account.secret_id?await readVault(admin,account.secret_id):{};
        const merged={...existing,...Object.fromEntries(Object.entries(credentials).filter(([,v])=>clean(v)))};
        patch.secret_id=await writeVault(admin,account.id,account.provider,merged,account.secret_id);
        patch.status='pending';patch.last_error=null;
      }
      const saved=await admin.from('integration_accounts').update(patch).eq('id',id).eq('owner_id',caller.data_owner_id).select('*').single();
      if(saved.error)throw saved.error;
      if(body?.isDefault===true)await makeDefault(admin,caller.data_owner_id,account.provider,id);
      return response({account:publicAccount(await loadAccount(admin,caller.data_owner_id,id))});
    }
    if(action==='disconnect'){
      if(account.secret_id){
        await writeVault(admin,account.id,account.provider,{revoked:true,revokedAt:new Date().toISOString()},account.secret_id);
      }
      const disabled=await admin.from('integration_accounts').update({
        enabled:false,status:'disabled',is_default:false,last_error:null,updated_at:new Date().toISOString(),
      }).eq('id',id).eq('owner_id',caller.data_owner_id);
      if(disabled.error)throw disabled.error;
      if(account.provider==='amazon'&&account.linked_resource_id){
        await admin.from('amazon_accounts').update({status:'disabled',updated_at:new Date().toISOString()})
          .eq('id',account.linked_resource_id).eq('owner_id',caller.data_owner_id);
      }
      const replacement=await admin.from('integration_accounts').select('id').eq('owner_id',caller.data_owner_id)
        .eq('provider',account.provider).neq('status','disabled').order('updated_at',{ascending:false}).limit(1).maybeSingle();
      if(replacement.data)await makeDefault(admin,caller.data_owner_id,account.provider,replacement.data.id);
      return response({accounts:await listAccounts(admin,caller.data_owner_id)});
    }
    throw new Error('Acción no válida.');
  }catch(error){
    const message=sanitize(error instanceof Error?error.message:error)||'Error interno.';
    const status=/Sesión no válida/.test(message)?401:/administrador|acceso desactivado/.test(message)?403:/no encontrada/.test(message)?404:400;
    return response({error:message},status);
  }
});