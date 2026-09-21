export type AmazonAutomaticSyncSettings={
  automaticEnabled:boolean;
  activeMarketplaceIds:string[];
  enabledSources:Array<'orders'|'finances'|'inventory'>;
  autoSyncImages:boolean;
};

function bool(value:unknown,fallback=true){
  return typeof value==='boolean'?value:fallback;
}

function strings(value:unknown){
  if(!Array.isArray(value))return [];
  return Array.from(new Set(value.map(item=>String(item||'').trim()).filter(Boolean)));
}

export async function loadAmazonAutomaticSyncSettings(admin:any,ownerId:string):Promise<AmazonAutomaticSyncSettings>{
  const {data,error}=await admin
    .from('app_settings')
    .select('config')
    .eq('owner_id',ownerId)
    .maybeSingle();
  if(error)throw error;

  const root=(data?.config&&typeof data.config==='object'&&!Array.isArray(data.config))?(data.config as any):{};
  const amazon=root.amazon;
  const raw=amazon&&typeof amazon==='object'&&!Array.isArray(amazon)?amazon:{};
  const enabledSources:Array<'orders'|'finances'|'inventory'>=[];
  if(bool(raw.autoSyncOrders,true))enabledSources.push('orders');
  if(bool(raw.autoSyncFinance,true))enabledSources.push('finances');
  if(bool(raw.autoSyncInventory,true))enabledSources.push('inventory');

  const automaticEnabled=bool(root?.integrations?.amazonEnabled,true);
  return {
    automaticEnabled,
    activeMarketplaceIds:strings(raw.activeMarketplaceIds),
    enabledSources:automaticEnabled?enabledSources:[],
    autoSyncImages:automaticEnabled&&bool(raw.autoSyncImages,true),
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
