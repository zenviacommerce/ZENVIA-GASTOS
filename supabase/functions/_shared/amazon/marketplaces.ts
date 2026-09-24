import { loadAmazonSpApiCredentials } from './config.ts';
import { spApiRequest } from './sp-api.ts';

const EUROPE_COUNTRY_CODES=new Set(['BE','DE','ES','FR','GB','IE','IT','NL','PL','SE']);

type MarketplaceParticipation={
  marketplace?:{id?:string;name?:string;countryCode?:string;defaultCurrencyCode?:string};
  storeName?:string;
  participation?:{isParticipating?:boolean;hasSuspendedListings?:boolean};
};

type MarketplaceResponse={payload?:MarketplaceParticipation[]};

async function resolveIntegrationAccount(admin:any,ownerId:string,sellerId:string,preferredId?:string|null){
  if(preferredId){
    const {data,error}=await admin.from('integration_accounts')
      .select('id,display_name,status,enabled')
      .eq('owner_id',ownerId).eq('provider','amazon').eq('id',preferredId).maybeSingle();
    if(error)throw error;
    if(!data)throw new Error('La cuenta de integración Amazon no existe.');
    return data;
  }
  const {data,error}=await admin.from('integration_accounts')
    .select('id,display_name,status,enabled')
    .eq('owner_id',ownerId).eq('provider','amazon').eq('external_account_id',sellerId).maybeSingle();
  if(error)throw error;
  return data||null;
}

export async function ensureAmazonAccountAndMarketplaces(admin:any,ownerId:string,integrationAccountId?:string|null){
  const credentials=await loadAmazonSpApiCredentials(admin,{integrationAccountId});
  const integration=await resolveIntegrationAccount(admin,ownerId,credentials.sellerId,integrationAccountId);
  if(integration&&(integration.status==='disabled'||integration.enabled===false))throw new Error('La cuenta de Amazon está deshabilitada.');
  const now=new Date().toISOString();
  const displayAlias=String(integration?.display_name||'Amazon Europe');
  const {data:account,error:accountError}=await admin.from('amazon_accounts').upsert({
    owner_id:ownerId,
    seller_id:credentials.sellerId,
    display_name:displayAlias,
    region:'EU',
    status:'pending',
    integration_account_id:integration?.id||null,
    updated_at:now,
  },{onConflict:'owner_id,seller_id'}).select('id,owner_id,seller_id,display_name,status,initial_sync_from,last_successful_sync_at,integration_account_id').single();
  if(accountError)throw accountError;

  if(integration){
    const link=await admin.from('integration_accounts').update({linked_resource_id:account.id,updated_at:now})
      .eq('id',integration.id).eq('owner_id',ownerId);
    if(link.error)throw link.error;
  }

  try{
    const result=await spApiRequest<MarketplaceResponse>('/sellers/v1/marketplaceParticipations',{},credentials);
    const participations=(result?.payload||[]).filter(item=>{
      const marketplace=item?.marketplace;
      const marketplaceName=String(marketplace?.name||'').trim();
      return Boolean(
        marketplace?.id&&
        marketplace?.countryCode&&
        EUROPE_COUNTRY_CODES.has(String(marketplace.countryCode).toUpperCase())&&
        marketplaceName.startsWith('Amazon.')
      );
    });

    const inactive=await admin.from('amazon_marketplaces').update({active:false,updated_at:now})
      .eq('owner_id',ownerId).eq('amazon_account_id',account.id);
    if(inactive.error)throw inactive.error;

    const rows=participations.map(item=>{
      const marketplace=item.marketplace!;
      return {
        owner_id:ownerId,
        amazon_account_id:account.id,
        marketplace_id:String(marketplace.id),
        country_code:String(marketplace.countryCode||'').toUpperCase(),
        name:String(marketplace.name||marketplace.countryCode||marketplace.id),
        currency_code:String(marketplace.defaultCurrencyCode||'EUR').toUpperCase(),
        active:Boolean(item.participation?.isParticipating),
        updated_at:now,
      };
    });

    if(rows.length){
      const {error:marketError}=await admin.from('amazon_marketplaces').upsert(rows,{onConflict:'owner_id,amazon_account_id,marketplace_id'});
      if(marketError)throw marketError;
    }

    const remoteName=participations.find(item=>item.storeName)?.storeName;
    const displayName=integration?.display_name||remoteName||displayAlias;
    const {error:statusError}=await admin.from('amazon_accounts').update({display_name:displayName,status:'connected',integration_account_id:integration?.id||null,updated_at:now}).eq('id',account.id).eq('owner_id',ownerId);
    if(statusError)throw statusError;
    if(integration){
      const {error:integrationError}=await admin.from('integration_accounts').update({
        status:'connected',linked_resource_id:account.id,last_tested_at:now,last_success_at:now,last_error:null,updated_at:now,
      }).eq('id',integration.id).eq('owner_id',ownerId);
      if(integrationError)throw integrationError;
    }

    const {data:marketplaces,error:listError}=await admin.from('amazon_marketplaces')
      .select('marketplace_id,country_code,name,currency_code,active')
      .eq('owner_id',ownerId).eq('amazon_account_id',account.id).eq('active',true)
      .order('country_code',{ascending:true});
    if(listError)throw listError;

    return {account:{...account,display_name:displayName,status:'connected',integration_account_id:integration?.id||null},marketplaces:marketplaces||[]};
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo comprobar Amazon.';
    await admin.from('amazon_accounts').update({status:'error',updated_at:new Date().toISOString()}).eq('id',account.id).eq('owner_id',ownerId);
    if(integration)await admin.from('integration_accounts').update({status:'error',last_tested_at:new Date().toISOString(),last_error:message.slice(0,700),updated_at:new Date().toISOString()}).eq('id',integration.id).eq('owner_id',ownerId);
    throw error;
  }
}
