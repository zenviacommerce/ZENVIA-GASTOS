import { supabase } from './supabase';
import type { AmazonSettings } from './settingsSchema';
import { startActivity } from './activity';

export type AmazonMarketplaceStatus={id:string;countryCode:string;name:string;currencyCode:string;active:boolean};
export type AmazonStatus={
  configured:boolean;connected:boolean;status:'not_configured'|'pending'|'connected'|'error'|'disabled'|string;
  account:{id:string;integrationAccountId:string|null;displayName:string;initialSyncFrom:string;lastSuccessfulSyncAt:string|null}|null;
  marketplaces:AmazonMarketplaceStatus[];
  sync:{latestRun:{source:string;mode:string;status:string;started_at:string;finished_at:string|null;rows_processed:number;error_message:string|null}|null;jobCounts:{queued:number;running:number;success:number;failed:number}};
  error:string|null;
};

export type AmazonRangeKey='today'|'7d'|'30d'|'current_month'|'previous_month'|'current_quarter'|'current_year'|'custom';
export type AmazonAnalyticsFilters={from:string;to:string;marketplaceIds:string[]};
export type AmazonCompleteness={
  profitComplete:boolean;unmappedSkuCount:number;unmappedUnits:number;missingHistoricalCostCount:number;missingHistoricalCostUnits:number;
  missingFxEventCount:number;missingVatOrderCount:number;missingFbmShippingCostCount:number;syncQueued:number;syncRunning:number;syncFailed:number;adsExcluded:boolean;
};
export type AmazonSummary=AmazonCompleteness&{
  grossSales:number;salesVat:number;netSales:number;orders:number;businessOrders:number;units:number;
  amazonFees:number;amazonFeeVat:number;refunds:number;adsCost:number;amazonAdjustments:number;
  productCost:number;fbmShippingCost:number;netProfit:number|null;marginPct:number|null;
};
export type AmazonDetail={
  orderLines:number;promotionDiscounts:number;shippingCharged:number;shippingTax:number;
  refundTransactions:number;refundOrders:number;refundGrossImpact:number;refundTaxImpact:number;
  commissionFees:number;fbaFees:number;digitalServicesFees:number;storageFees:number;otherAmazonFees:number;
};
export type AmazonSeriesPoint={
  period:string;grossSales:number;salesVat:number;netSales:number;amazonFees:number;refunds:number;adsCost:number;
  productCost:number;fbmShippingCost:number;netProfit:number|null;orders:number;units:number;profitComplete:boolean;
};
export type AmazonProductSort='product_name'|'orders'|'units'|'gross_sales'|'net_sales'|'product_cost'|'amazon_fees'|'refunds'|'profit_before_ads'|'margin_pct';
export type AmazonSortDirection='asc'|'desc';
export type AmazonProductAnalytics={
  sellerSku:string;asin:string|null;productId:string|null;productName:string|null;consumptionFactor:number;
  orders:number;businessOrders:number;units:number;grossSales:number;salesVat:number;netSales:number;
  amazonFees:number;amazonFeeVat:number;refunds:number;amazonAdjustments:number;productCost:number;
  profitBeforeAds:number;marginPct:number|null;missingVatOrders:number;profitComplete:boolean;
};
export type AmazonMarketplaceAnalytics={marketplaceId:string;countryCode:string;name:string;orders:number;units:number;netSales:number;amazonFees:number;refunds:number;productCost:number;profitBeforeAds:number;marginPct:number|null;profitComplete:boolean};
export type AmazonOrderAnalytics={amazonOrderId:string;purchaseDate:string;marketplaceId:string;status:string|null;units:number;netSales:number;amazonFees:number;refunds:number;productCost:number;profitBeforeAds:number;profitComplete:boolean};
export type AmazonInventoryAnalytics={sellerSku:string;asin:string|null;marketplaceId:string;fulfillable:number;reserved:number;inbound:number;unfulfillable:number;researching:number;total:number;lastSync:string};
export type AmazonUnmappedSku={sellerSku:string;asin:string|null;marketplaceIds:string[];orders:number;units:number;recentNetSales:number};
export type AmazonProductOption={id:string;name:string;sku:string|null};
export type AmazonPageResult<T>={items:T[];page:number;pageSize:number;total:number};

export const AMAZON_KPI_KEYS=[
  'grossSales','salesVat','netSales','orders','businessOrders','units','amazonFees',
  'adsCost','refunds','productCost','fbmShippingCost','netProfit','marginPct'
] as const;
export type AmazonKpiKey=(typeof AMAZON_KPI_KEYS)[number];

export function resolveAmazonHistoryDays(value:unknown,fallback=90){
  const days=Number(value);
  return Number.isInteger(days)&&days>=1&&days<=3650?days:fallback;
}

export function amazonInitialRange(settings:Pick<AmazonSettings,'defaultPeriod'|'historyDays'>,now=new Date()){
  if(settings.defaultPeriod==='all'){
    const today=startOfDay(now);
    const from=new Date(today);
    from.setDate(from.getDate()-resolveAmazonHistoryDays(settings.historyDays)+1);
    return range(from,today);
  }
  return amazonQuickRange(settings.defaultPeriod,now);
}

export function resolveAmazonMarketplaceSelection(
  marketplaces:AmazonMarketplaceStatus[],
  settings:Pick<AmazonSettings,'activeMarketplaceIds'|'primaryMarketplaceId'>,
){
  const available=marketplaces.filter(item=>item.active);
  const configured=new Set(settings.activeMarketplaceIds);
  const filtered=configured.size?available.filter(item=>configured.has(item.id)):available;
  const selected=filtered.length||!configured.size?filtered:available;
  const primaryMarketplaceId=settings.primaryMarketplaceId&&selected.some(item=>item.id===settings.primaryMarketplaceId)
    ?settings.primaryMarketplaceId
    :(selected[0]?.id||null);
  return {marketplaces:selected,primaryMarketplaceId};
}

export function resolveAmazonVisibleKpis(settings:Pick<AmazonSettings,'visibleKpis'>):AmazonKpiKey[]{
  const allowed=new Set<string>(AMAZON_KPI_KEYS);
  const configured=settings.visibleKpis.filter((key):key is AmazonKpiKey=>allowed.has(key));
  return configured.length?Array.from(new Set(configured)):[...AMAZON_KPI_KEYS];
}

function message(data:any,error:any,fallback:string){const detail=String(data?.error||error?.message||'').trim();return detail||fallback;}
export const AMAZON_CONNECTIVITY_EVENT='zenvia:amazon-connectivity-error';

export function isAmazonConnectivityError(error:unknown){
  const detail=String(error instanceof Error?error.message:error||'').toLowerCase();
  return (typeof navigator!=='undefined'&&!navigator.onLine)
    || /failed to fetch|fetch failed|networkerror|network error|load failed|connection.*(?:lost|failed|closed)|internet|offline|err_network|timeout.*fetch/.test(detail);
}

function notifyAmazonConnectivityError(error:unknown){
  if(typeof window==='undefined'||!isAmazonConnectivityError(error))return;
  window.dispatchEvent(new CustomEvent(AMAZON_CONNECTIVITY_EVENT,{detail:{message:String(error instanceof Error?error.message:error||'')}}));
}

function offlineError(){
  const error=new Error('Sin conexión a Internet. Se mantienen los últimos datos guardados.');
  error.name='AmazonConnectivityError';
  notifyAmazonConnectivityError(error);
  return error;
}
function ymd(date:Date){const y=date.getFullYear();const m=String(date.getMonth()+1).padStart(2,'0');const d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function startOfDay(date:Date){return new Date(date.getFullYear(),date.getMonth(),date.getDate());}
function range(from:Date,to:Date){return {from:ymd(from),to:ymd(to)};}

export function amazonQuickRange(key:AmazonRangeKey,now=new Date()){
  const today=startOfDay(now);
  if(key==='today'||key==='custom')return range(today,today);
  if(key==='7d'){const from=new Date(today);from.setDate(from.getDate()-6);return range(from,today);}
  if(key==='30d'){const from=new Date(today);from.setDate(from.getDate()-29);return range(from,today);}
  if(key==='current_month')return range(new Date(today.getFullYear(),today.getMonth(),1),today);
  if(key==='previous_month')return range(new Date(today.getFullYear(),today.getMonth()-1,1),new Date(today.getFullYear(),today.getMonth(),0));
  if(key==='current_quarter'){const month=Math.floor(today.getMonth()/3)*3;return range(new Date(today.getFullYear(),month,1),today);}
  return range(new Date(today.getFullYear(),0,1),today);
}

function rpcParams(filters:AmazonAnalyticsFilters){return {from_date:filters.from,to_date:filters.to,marketplace_ids:filters.marketplaceIds.length?filters.marketplaceIds:null};}
const AMAZON_ACTIVITY_LABELS:Record<string,string>={
  amazon_analytics_summary:'Cargando resumen de Amazon',
  amazon_analytics_detail:'Cargando detalle de Amazon',
  amazon_analytics_series:'Cargando evolución de Amazon',
  amazon_analytics_products:'Cargando productos de Amazon',
  amazon_analytics_marketplaces:'Cargando marketplaces de Amazon',
  amazon_analytics_orders:'Cargando pedidos de Amazon',
  amazon_analytics_inventory:'Cargando inventario de Amazon',
  amazon_analytics_unmapped_skus:'Cargando SKU sin vincular',
  amazon_set_product_mapping:'Guardando vínculo de Amazon',
  amazon_delete_product_mapping:'Eliminando vínculo de Amazon',
};

async function rpc<T>(name:string,params:Record<string,unknown>,fallback:string):Promise<T>{
  const activity=startActivity({
    label:AMAZON_ACTIVITY_LABELS[name]||'Cargando datos de Amazon',
    detail:'Esperando respuesta de Amazon Analytics…',
    showAfterMs:300,
  });
  try{
    if(typeof navigator!=='undefined'&&!navigator.onLine)throw offlineError();
    const call=()=>supabase.rpc(name,params);
    let result;
    try{result=await call();}
    catch(error){notifyAmazonConnectivityError(error);throw error;}
    const firstMessage=message(result.data,result.error,'');
    if(result.error&&/statement timeout|canceling statement|57014/i.test(firstMessage)){
      activity.update({detail:'La consulta está tardando más de lo normal. Reintentando…'});
      await new Promise(resolve=>setTimeout(resolve,350));
      if(typeof navigator!=='undefined'&&!navigator.onLine)throw offlineError();
      try{result=await call();}
      catch(error){notifyAmazonConnectivityError(error);throw error;}
    }
    if(result.error){
      const error=new Error(message(result.data,result.error,fallback));
      notifyAmazonConnectivityError(error);
      throw error;
    }
    return result.data as T;
  }finally{
    activity.finish();
  }
}

export async function loadAmazonStatus(integrationAccountId?:string):Promise<AmazonStatus>{
  const activity=startActivity({label:'Comprobando conexión con Amazon',detail:'Consultando el estado de SP-API…',showAfterMs:300});
  try{
    if(typeof navigator!=='undefined'&&!navigator.onLine)throw offlineError();
    try{
      const {data,error}=await supabase.functions.invoke('amazon-status',{body:integrationAccountId?{integrationAccountId}:{}});
      if(error||!data||data.error){
        const next=new Error(message(data,error,'No se pudo consultar el estado de Amazon.'));
        notifyAmazonConnectivityError(next);
        throw next;
      }
      return data as AmazonStatus;
    }catch(error){notifyAmazonConnectivityError(error);throw error;}
  }finally{activity.finish();}
}
export async function requestAmazonSync(integrationAccountId?:string){
  const activity=startActivity({label:'Sincronizando Amazon',detail:'Solicitando trabajos de sincronización…',showAfterMs:200});
  try{
    if(typeof navigator!=='undefined'&&!navigator.onLine)throw offlineError();
    try{
      const {data,error}=await supabase.functions.invoke('amazon-sync-manual',{body:integrationAccountId?{integrationAccountId}:{}});
      if(error||!data||data.error){
        const next=new Error(message(data,error,'No se pudo iniciar la sincronización de Amazon.'));
        notifyAmazonConnectivityError(next);
        throw next;
      }
      return data as {ok:true;accounts:number;jobs:number};
    }catch(error){notifyAmazonConnectivityError(error);throw error;}
  }finally{activity.finish();}
}
export function loadAmazonSummary(filters:AmazonAnalyticsFilters){return rpc<AmazonSummary>('amazon_analytics_summary',rpcParams(filters),'No se pudo cargar el resumen de Amazon.');}
export function loadAmazonDetail(filters:AmazonAnalyticsFilters){return rpc<AmazonDetail>('amazon_analytics_detail',rpcParams(filters),'No se pudo cargar el detalle de Amazon.');}
export function loadAmazonSeries(filters:AmazonAnalyticsFilters,grain:'day'|'month'='day'){return rpc<AmazonSeriesPoint[]>('amazon_analytics_series',{...rpcParams(filters),grain},'No se pudo cargar la evolución de Amazon.');}
export function loadAmazonProducts(filters:AmazonAnalyticsFilters,search='',page=1,pageSize=50,sortBy:AmazonProductSort='profit_before_ads',sortDir:AmazonSortDirection='desc'){return rpc<AmazonPageResult<AmazonProductAnalytics>>('amazon_analytics_products',{...rpcParams(filters),search:search||null,page,page_size:pageSize,sort_by:sortBy,sort_dir:sortDir},'No se pudieron cargar los productos de Amazon.');}
export function loadAmazonMarketplaces(filters:AmazonAnalyticsFilters){return rpc<{items:AmazonMarketplaceAnalytics[]}>('amazon_analytics_marketplaces',rpcParams(filters),'No se pudieron cargar los marketplaces de Amazon.');}
export function loadAmazonOrders(filters:AmazonAnalyticsFilters,search='',page=1,pageSize=25){return rpc<AmazonPageResult<AmazonOrderAnalytics>>('amazon_analytics_orders',{...rpcParams(filters),search:search||null,page,page_size:pageSize},'No se pudieron cargar los pedidos de Amazon.');}
export function loadAmazonInventory(filters:Pick<AmazonAnalyticsFilters,'marketplaceIds'>,search='',page=1,pageSize=25){return rpc<AmazonPageResult<AmazonInventoryAnalytics>>('amazon_analytics_inventory',{marketplace_ids:filters.marketplaceIds.length?filters.marketplaceIds:null,search:search||null,page,page_size:pageSize},'No se pudo cargar el inventario de Amazon.');}
export function loadAmazonUnmapped(search='',page=1,pageSize=25){return rpc<AmazonPageResult<AmazonUnmappedSku>>('amazon_analytics_unmapped_skus',{search:search||null,page,page_size:pageSize},'No se pudieron cargar los SKU sin vincular.');}
export function setAmazonProductMapping(input:{sellerSku:string;productId:string;consumptionFactor:number}){return rpc<{ok:true;skuAssigned?:boolean}>('amazon_set_product_mapping',{seller_sku:input.sellerSku,product_id:input.productId,consumption_factor:input.consumptionFactor},'No se pudo guardar el vínculo del producto.');}
export function deleteAmazonProductMapping(sellerSku:string){return rpc<{ok:true;deleted:number}>('amazon_delete_product_mapping',{seller_sku:sellerSku},'No se pudo eliminar el vínculo del producto.');}
export async function loadAmazonProductImages(asins:string[]):Promise<Record<string,string>>{
  const unique=Array.from(new Set(asins.map(value=>String(value||'').trim()).filter(Boolean)));
  if(!unique.length)return {};
  const {data,error}=await supabase.from('amazon_product_images').select('asin,image_url,fetched_at').in('asin',unique).not('image_url','is',null).order('fetched_at',{ascending:false});
  if(error)throw error;
  const result:Record<string,string>={};
  for(const row of data||[]){const asin=String((row as any).asin||'');const url=String((row as any).image_url||'');if(asin&&url&&!result[asin])result[asin]=url;}
  return result;
}

export async function loadAmazonProductOptions(search=''):Promise<AmazonProductOption[]>{
  let query=supabase.from('products').select('id,name,sku').eq('active',true).order('name').limit(100);
  const term=search.trim();if(term)query=query.or(`name.ilike.%${term.replace(/[,%()]/g,'')}%,sku.ilike.%${term.replace(/[,%()]/g,'')}%`);
  const {data,error}=await query;if(error)throw error;return (data||[]).map((row:any)=>({id:row.id,name:row.name,sku:row.sku||null}));
}
