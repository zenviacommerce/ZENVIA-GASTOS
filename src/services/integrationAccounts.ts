import { supabase } from './supabase';

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

export async function loadIntegrationAccounts(){
  const result=await invoke<{accounts:IntegrationAccount[]}>({action:'list'},'No se pudieron cargar las cuentas de integración.');
  return result.accounts||[];
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
