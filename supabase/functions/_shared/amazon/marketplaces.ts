import { readAmazonSpApiCredentials } from './config.ts';
import { spApiRequest } from './sp-api.ts';

const EUROPE_COUNTRY_CODES=new Set(['BE','DE','ES','FR','GB','IE','IT','NL','PL','SE']);

type MarketplaceParticipation={
  marketplace?:{id?:string;name?:string;countryCode?:string;defaultCurrencyCode?:string};
  storeName?:string;
  participation?:{isParticipating?:boolean;hasSuspendedListings?:boolean};
};

type MarketplaceResponse={payload?:MarketplaceParticipation[]};

export async function ensureAmazonAccountAndMarketplaces(admin:any,ownerId:string){
  const credentials=readAmazonSpApiCredentials();
  const now=new Date().toISOString();
  const {data:account,error:accountError}=await admin.from('amazon_accounts').upsert({
    owner_id:ownerId,
    seller_id:credentials.sellerId,
    display_name:'Amazon Europe',
    region:'EU',
    status:'pending',
    updated_at:now,
  },{onConflict:'owner_id,seller_id'}).select('id,owner_id,seller_id,display_name,status,initial_sync_from,last_successful_sync_at').single();
  if(accountError)throw accountError;

  try{
    const result=await spApiRequest<MarketplaceResponse>('/sellers/v1/marketplaceParticipations');
    const participations=(result?.payload||[]).filter(item=>{
      const marketplace=item?.marketplace;
      return Boolean(marketplace?.id&&marketplace?.countryCode&&EUROPE_COUNTRY_CODES.has(String(marketplace.countryCode).toUpperCase()));
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

    const displayName=participations.find(item=>item.storeName)?.storeName||'Amazon Europe';
    const {error:statusError}=await admin.from('amazon_accounts').update({display_name:displayName,status:'connected',updated_at:now}).eq('id',account.id).eq('owner_id',ownerId);
    if(statusError)throw statusError;

    const {data:marketplaces,error:listError}=await admin.from('amazon_marketplaces')
      .select('marketplace_id,country_code,name,currency_code,active')
      .eq('owner_id',ownerId).eq('amazon_account_id',account.id).eq('active',true)
      .order('country_code',{ascending:true});
    if(listError)throw listError;

    return {account:{...account,display_name:displayName,status:'connected'},marketplaces:marketplaces||[]};
  }catch(error){
    await admin.from('amazon_accounts').update({status:'error',updated_at:new Date().toISOString()}).eq('id',account.id).eq('owner_id',ownerId);
    throw error;
  }
}
