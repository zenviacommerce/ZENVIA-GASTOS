export type AmazonAutomaticSyncSettings={
  automaticEnabled:boolean;
  activeMarketplaceIds:string[];
  enabledSources:Array<'orders'|'finances'|'inventory'>;
  autoSyncImages:boolean;
};

function bool(value:unknown,fallback=true){return typeof value==='boolean'?value:fallback;}
function strings(value:unknown){
  if(!Array.isArray(value))return [];
  return Array.from(new Set(value.map(item=>String(item||'').trim()).filter(Boolean)));
}

export async function loadAmazonAutomaticSyncSettings(admin:any,ownerId:string,integrationAccountId?:string|null):Promise<AmazonAutomaticSyncSettings>{
  const {data,error}=await admin.from('app_settings').select('config').eq('owner_id',ownerId).maybeSingle();
  if(error)throw error;

  const root=(data?.config&&typeof data.config==='object'&&!Array.isArray(data.config))?(data.config as any):{};
  const amazon=root.amazon;
  const global=amazon&&typeof amazon==='object'&&!Array.isArray(amazon)?amazon:{};

  let accountConfig:any={};
  let accountEnabled=true;
  if(integrationAccountId){
    const {data:account,error:accountError}=await admin.from('integration_accounts')
      .select('config,enabled,status').eq('owner_id',ownerId).eq('id',integrationAccountId).eq('provider','amazon').maybeSingle();
    if(accountError)throw accountError;
    if(account){
      accountConfig=account.config&&typeof account.config==='object'&&!Array.isArray(account.config)?account.config:{};
      accountEnabled=account.enabled!==false&&account.status!=='disabled';
    }
  }

  const enabledSources:Array<'orders'|'finances'|'inventory'>=[];
  if(bool(accountConfig.syncOrders,bool(global.autoSyncOrders,true)))enabledSources.push('orders');
  if(bool(accountConfig.syncFinance,bool(global.autoSyncFinance,true)))enabledSources.push('finances');
  if(bool(accountConfig.syncInventory,bool(global.autoSyncInventory,true)))enabledSources.push('inventory');

  const globalEnabled=bool(root?.integrations?.amazonEnabled,true);
  const automaticEnabled=globalEnabled&&accountEnabled;
  const accountMarketplaces=strings(accountConfig.activeMarketplaceIds);
  return {
    automaticEnabled,
    activeMarketplaceIds:accountMarketplaces.length?accountMarketplaces:strings(global.activeMarketplaceIds),
    enabledSources:automaticEnabled?enabledSources:[],
    autoSyncImages:automaticEnabled&&bool(accountConfig.syncImages,bool(global.autoSyncImages,true)),
  };
}

export function filterAutomaticMarketplaces<T extends {marketplace_id:string;active?:boolean}>(
  marketplaces:T[],
  activeMarketplaceIds:string[],
){
  const available=marketplaces.filter(item=>item.active!==false);
  if(!activeMarketplaceIds.length)return available;
  const configured=new Set(activeMarketplaceIds);
  const filtered=available.filter(item=>configured.has(String(item.marketplace_id)));
  return filtered.length?filtered:available;
}
