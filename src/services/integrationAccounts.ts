import { supabase } from './supabase';
import { loadAmazonStatus } from './amazon';
import { listCachedGmailConnections } from './gmail';
import { getSendcloudStatus } from './orders';

export type IntegrationProvider='amazon'|'sendcloud'|'shopify'|'gmail';

export type IntegrationAccount={
  id:string;
  provider:IntegrationProvider;
  displayName:string;
  externalAccountId:string|null;
  status:'pending'|'connected'|'error'|'disabled'|string;
  enabled:boolean;
  isDefault:boolean;
  credentialSource:'vault'|'environment'|'session'|'derived'|string;
  credentialsConfigured:boolean;
  parentAccountId:string|null;
  linkedResourceId:string|null;
  config:Record<string,unknown>;
  lastTestedAt:string|null;
  lastSuccessAt:string|null;
  lastError:string|null;
  createdAt:string;
  updatedAt:string;
  legacy?:boolean;
};

export type ShopifyDiscovery={
  id:number;
  shopName:string;
  type:string;
  shopUrl:string|null;
  channel:'shopify';
};

export type CreateIntegrationAccountInput={
  provider:IntegrationProvider;
  displayName?:string;
  externalAccountId?:string;
  parentAccountId?:string|null;
  config?:Record<string,unknown>;
  credentials?:Record<string,string>;
  test?:boolean;
};

export type UpdateIntegrationAccountInput={
  displayName?:string;
  enabled?:boolean;
  isDefault?:boolean;
  config?:Record<string,unknown>;
  credentials?:Record<string,string>;
};

function message(data:any,error:any,fallback:string){
  const detail=String(data?.error||error?.message||'').trim();
  return detail||fallback;
}

async function invoke<T>(body:Record<string,unknown>,fallback:string):Promise<T>{
  const {data,error}=await supabase.functions.invoke('integration-accounts',{body});
  if(error||!data||data.error)throw new Error(message(data,error,fallback));
  return data as T;
}

async function loadLegacyAmazonRows(){
  const {data,error}=await supabase.from('amazon_accounts')
    .select('id,seller_id,display_name,status,last_successful_sync_at,created_at,updated_at')
    .order('updated_at',{ascending:false});
  if(error)throw error;
  return data||[];
}

async function loadLegacyIntegrationAccounts():Promise<IntegrationAccount[]>{
  const now=new Date().toISOString();
  const [amazonRowsResult,amazonStatusResult,sendcloudResult]=await Promise.allSettled([
    loadLegacyAmazonRows(),
    loadAmazonStatus(),
    getSendcloudStatus(),
  ]);
  const accounts:IntegrationAccount[]=[];

  const amazonStatus=amazonStatusResult.status==='fulfilled'?amazonStatusResult.value:null;
  const amazonRows=amazonRowsResult.status==='fulfilled'?amazonRowsResult.value:[];
  if(amazonRows.length){
    const currentId=amazonStatus?.account?.id||null;
    amazonRows.forEach((row:any,index:number)=>accounts.push({
      id:`legacy-amazon-${row.id}`,
      provider:'amazon',
      displayName:String(row.display_name||amazonStatus?.account?.displayName||'Amazon'),
      externalAccountId:row.seller_id?String(row.seller_id):null,
      status:String(row.status||amazonStatus?.status||'connected'),
      enabled:String(row.status||'connected')!=='disabled',
      isDefault:currentId?String(row.id)===currentId:index===0,
      credentialSource:'environment',
      credentialsConfigured:true,
      parentAccountId:null,
      linkedResourceId:String(row.id),
      config:{legacy:true},
      lastTestedAt:amazonStatus?.sync?.latestRun?.started_at||null,
      lastSuccessAt:row.last_successful_sync_at||amazonStatus?.account?.lastSuccessfulSyncAt||null,
      lastError:amazonStatus?.error||null,
      createdAt:row.created_at||now,
      updatedAt:row.updated_at||now,
      legacy:true,
    }));
  }else if(amazonStatus?.account){
    accounts.push({
      id:`legacy-amazon-${amazonStatus.account.id}`,
      provider:'amazon',
      displayName:amazonStatus.account.displayName||'Amazon',
      externalAccountId:null,
      status:amazonStatus.connected?'connected':amazonStatus.status,
      enabled:amazonStatus.status!=='disabled',
      isDefault:true,
      credentialSource:'environment',
      credentialsConfigured:Boolean(amazonStatus.configured),
      parentAccountId:null,
      linkedResourceId:amazonStatus.account.id,
      config:{legacy:true},
      lastTestedAt:amazonStatus.sync?.latestRun?.started_at||null,
      lastSuccessAt:amazonStatus.account.lastSuccessfulSyncAt||null,
      lastError:amazonStatus.error||null,
      createdAt:now,
      updatedAt:now,
      legacy:true,
    });
  }

  if(sendcloudResult.status==='fulfilled'&&sendcloudResult.value.configured){
    const status=sendcloudResult.value;
    const sendcloudId='legacy-sendcloud-current';
    accounts.push({
      id:sendcloudId,
      provider:'sendcloud',
      displayName:status.accounts?.[0]?.displayName||'Sendcloud',
      externalAccountId:'legacy',
      status:'connected',
      enabled:true,
      isDefault:true,
      credentialSource:'environment',
      credentialsConfigured:true,
      parentAccountId:null,
      linkedResourceId:null,
      config:{legacy:true,syncOrders:true,shippingEnabled:true},
      lastTestedAt:null,
      lastSuccessAt:null,
      lastError:null,
      createdAt:now,
      updatedAt:now,
      legacy:true,
    });
    const shops=status.integrations.filter(item=>item.channel==='shopify');
    shops.forEach((shop,index)=>accounts.push({
      id:`legacy-shopify-${shop.id}`,
      provider:'shopify',
      displayName:shop.shopName||`Shopify #${shop.id}`,
      externalAccountId:String(shop.id),
      status:'connected',
      enabled:true,
      isDefault:index===0,
      credentialSource:'derived',
      credentialsConfigured:true,
      parentAccountId:sendcloudId,
      linkedResourceId:null,
      config:{legacy:true,sendcloudIntegrationId:shop.id,shopUrl:shop.shopUrl||null,syncOrders:true},
      lastTestedAt:null,
      lastSuccessAt:null,
      lastError:null,
      createdAt:now,
      updatedAt:now,
      legacy:true,
    }));
  }

  if(typeof window!=='undefined'){
    const gmail=listCachedGmailConnections();
    gmail.forEach((connection,index)=>accounts.push({
      id:`legacy-gmail-${connection.email.toLowerCase()}`,
      provider:'gmail',
      displayName:connection.email,
      externalAccountId:connection.email,
      status:'connected',
      enabled:true,
      isDefault:index===0,
      credentialSource:'session',
      credentialsConfigured:true,
      parentAccountId:null,
      linkedResourceId:null,
      config:{legacy:true,months:12,invoiceImportEnabled:true},
      lastTestedAt:null,
      lastSuccessAt:null,
      lastError:null,
      createdAt:now,
      updatedAt:now,
      legacy:true,
    }));
  }
  return accounts;
}

export async function loadIntegrationAccounts(){
  try{
    const result=await invoke<{accounts:IntegrationAccount[]}>({action:'list'},'No se pudieron cargar las cuentas de integración.');
    return result.accounts||[];
  }catch(error){
    const legacy=await loadLegacyIntegrationAccounts();
    if(legacy.length)return legacy;
    throw error;
  }
}

export async function createIntegrationAccount(input:CreateIntegrationAccountInput){
  const result=await invoke<{account:IntegrationAccount}>({action:'create',...input},'No se pudo añadir la cuenta de integración.');
  return result.account;
}

export async function updateIntegrationAccount(id:string,input:UpdateIntegrationAccountInput){
  const result=await invoke<{account:IntegrationAccount}>({action:'update',id,...input},'No se pudo actualizar la cuenta de integración.');
  return result.account;
}

export async function testIntegrationAccount(id:string){
  return invoke<{ok:true;checkedAt:string;account:IntegrationAccount;detail?:Record<string,unknown>}>(
    {action:'test',id},
    'No se pudo comprobar la conexión.',
  );
}

export async function setDefaultIntegrationAccount(id:string){
  const result=await invoke<{accounts:IntegrationAccount[]}>({action:'set_default',id},'No se pudo cambiar la cuenta predeterminada.');
  return result.accounts||[];
}

export async function disconnectIntegrationAccount(id:string){
  const result=await invoke<{accounts:IntegrationAccount[]}>({action:'disconnect',id},'No se pudo desconectar la cuenta.');
  return result.accounts||[];
}

export async function discoverShopifyStores(parentAccountId:string){
  const result=await invoke<{shops:ShopifyDiscovery[]}>(
    {action:'discover_shopify',parentAccountId},
    'No se pudieron consultar las tiendas Shopify de Sendcloud.',
  );
  return result.shops||[];
}

export async function loadAmazonAccountMarketplaces(linkedResourceId:string){
  const {data,error}=await supabase.from('amazon_marketplaces')
    .select('marketplace_id,country_code,name,currency_code,active')
    .eq('amazon_account_id',linkedResourceId)
    .order('country_code');
  if(error)throw error;
  return (data||[]).map((row:any)=>({
    id:String(row.marketplace_id),
    countryCode:String(row.country_code||''),
    name:String(row.name||row.country_code||row.marketplace_id),
    currencyCode:String(row.currency_code||'EUR'),
    active:Boolean(row.active),
  }));
}


export async function syncSendcloudIntegrationAccount(id:string,history=false){
  const {data,error}=await supabase.functions.invoke('sendcloud-orders',{body:{action:'sync',integrationAccountId:id,history}});
  if(error||!data||data.error)throw new Error(message(data,error,'No se pudo sincronizar la cuenta de Sendcloud.'));
  return data as {ok:true;synced:number;enriched:number;accounts?:Array<{accountId:string|null;displayName:string;synced:number;enriched:number}>};
}
