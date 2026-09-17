import { supabase } from './supabase';

export type AmazonMarketplaceStatus={id:string;countryCode:string;name:string;currencyCode:string;active:boolean};
export type AmazonStatus={
  configured:boolean;connected:boolean;status:'not_configured'|'pending'|'connected'|'error'|'disabled'|string;
  account:{displayName:string;initialSyncFrom:string;lastSuccessfulSyncAt:string|null}|null;
  marketplaces:AmazonMarketplaceStatus[];
  sync:{latestRun:{source:string;mode:string;status:string;started_at:string;finished_at:string|null;rows_processed:number;error_message:string|null}|null;jobCounts:{queued:number;running:number;success:number;failed:number}};
  error:string|null;
};

export type AmazonRangeKey='today'|'7d'|'30d'|'current_month'|'previous_month'|'current_quarter'|'current_year'|'custom';
export type AmazonAnalyticsFilters={from:string;to:string;marketplaceIds:string[]};
export type AmazonCompleteness={
  profitComplete:boolean;unmappedSkuCount:number;unmappedUnits:number;missingHistoricalCostCount:number;missingHistoricalCostUnits:number;
  missingFxEventCount:number;missingVatOrderCount:number;syncQueued:number;syncRunning:number;syncFailed:number;adsExcluded:boolean;
};
export type AmazonSummary=AmazonCompleteness&{
  grossSales:number;salesVat:number;netSales:number;orders:number;units:number;
  amazonFees:number;amazonFeeVat:number;refunds:number;adsCost:number;amazonAdjustments:number;
  productCost:number;fbmShippingCost:number;netProfit:number|null;marginPct:number|null;
};
export type AmazonSeriesPoint={
  period:string;grossSales:number;salesVat:number;netSales:number;amazonFees:number;refunds:number;adsCost:number;
  productCost:number;fbmShippingCost:number;netProfit:number|null;orders:number;units:number;profitComplete:boolean;
};
export type AmazonProductAnalytics={sellerSku:string;asin:string|null;productId:string|null;productName:string|null;consumptionFactor:number;units:number;netSales:number;amazonFees:number;refunds:number;productCost:number;profitBeforeAds:number;marginPct:number|null;profitComplete:boolean};
export type AmazonMarketplaceAnalytics={marketplaceId:string;countryCode:string;name:string;orders:number;units:number;netSales:number;amazonFees:number;refunds:number;productCost:number;profitBeforeAds:number;marginPct:number|null;profitComplete:boolean};
export type AmazonOrderAnalytics={amazonOrderId:string;purchaseDate:string;marketplaceId:string;status:string|null;units:number;netSales:number;amazonFees:number;refunds:number;productCost:number;profitBeforeAds:number;profitComplete:boolean};
export type AmazonInventoryAnalytics={sellerSku:string;asin:string|null;marketplaceId:string;fulfillable:number;reserved:number;inbound:number;unfulfillable:number;researching:number;total:number;lastSync:string};
export type AmazonUnmappedSku={sellerSku:string;asin:string|null;marketplaceIds:string[];orders:number;units:number;recentNetSales:number};
export type AmazonProductOption={id:string;name:string;sku:string|null};
export type AmazonPageResult<T>={items:T[];page:number;pageSize:number;total:number};

function message(data:any,error:any,fallback:string){const detail=String(data?.error||error?.message||'').trim();return detail||fallback;}
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
async function rpc<T>(name:string,params:Record<string,unknown>,fallback:string):Promise<T>{const {data,error}=await supabase.rpc(name,params);if(error)throw new Error(message(data,error,fallback));return data as T;}

export async function loadAmazonStatus():Promise<AmazonStatus>{const {data,error}=await supabase.functions.invoke('amazon-status',{body:{}});if(error||!data||data.error)throw new Error(message(data,error,'No se pudo consultar el estado de Amazon.'));return data as AmazonStatus;}
export async function requestAmazonSync(){const {data,error}=await supabase.functions.invoke('amazon-sync-manual',{body:{}});if(error||!data||data.error)throw new Error(message(data,error,'No se pudo iniciar la sincronización de Amazon.'));return data as {ok:true;accounts:number;jobs:number};}
export function loadAmazonSummary(filters:AmazonAnalyticsFilters){return rpc<AmazonSummary>('amazon_analytics_summary',rpcParams(filters),'No se pudo cargar el resumen de Amazon.');}
export function loadAmazonSeries(filters:AmazonAnalyticsFilters,grain:'day'|'month'='day'){return rpc<AmazonSeriesPoint[]>('amazon_analytics_series',{...rpcParams(filters),grain},'No se pudo cargar la evolución de Amazon.');}
export function loadAmazonProducts(filters:AmazonAnalyticsFilters,search='',page=1,pageSize=25){return rpc<AmazonPageResult<AmazonProductAnalytics>>('amazon_analytics_products',{...rpcParams(filters),search:search||null,page,page_size:pageSize},'No se pudieron cargar los productos de Amazon.');}
export function loadAmazonMarketplaces(filters:AmazonAnalyticsFilters){return rpc<{items:AmazonMarketplaceAnalytics[]}>('amazon_analytics_marketplaces',rpcParams(filters),'No se pudieron cargar los marketplaces de Amazon.');}
export function loadAmazonOrders(filters:AmazonAnalyticsFilters,search='',page=1,pageSize=25){return rpc<AmazonPageResult<AmazonOrderAnalytics>>('amazon_analytics_orders',{...rpcParams(filters),search:search||null,page,page_size:pageSize},'No se pudieron cargar los pedidos de Amazon.');}
export function loadAmazonInventory(filters:Pick<AmazonAnalyticsFilters,'marketplaceIds'>,search='',page=1,pageSize=25){return rpc<AmazonPageResult<AmazonInventoryAnalytics>>('amazon_analytics_inventory',{marketplace_ids:filters.marketplaceIds.length?filters.marketplaceIds:null,search:search||null,page,page_size:pageSize},'No se pudo cargar el inventario de Amazon.');}
export function loadAmazonUnmapped(search='',page=1,pageSize=25){return rpc<AmazonPageResult<AmazonUnmappedSku>>('amazon_analytics_unmapped_skus',{search:search||null,page,page_size:pageSize},'No se pudieron cargar los SKU sin vincular.');}
export function setAmazonProductMapping(input:{sellerSku:string;productId:string;consumptionFactor:number}){return rpc<{ok:true}>('amazon_set_product_mapping',{seller_sku:input.sellerSku,product_id:input.productId,consumption_factor:input.consumptionFactor},'No se pudo guardar el vínculo del producto.');}
export function deleteAmazonProductMapping(sellerSku:string){return rpc<{ok:true;deleted:number}>('amazon_delete_product_mapping',{seller_sku:sellerSku},'No se pudo eliminar el vínculo del producto.');}
export async function loadAmazonProductOptions(search=''):Promise<AmazonProductOption[]>{
  let query=supabase.from('products').select('id,name,sku').eq('active',true).order('name').limit(100);
  const term=search.trim();if(term)query=query.or(`name.ilike.%${term.replace(/[,%()]/g,'')}%,sku.ilike.%${term.replace(/[,%()]/g,'')}%`);
  const {data,error}=await query;if(error)throw error;return (data||[]).map((row:any)=>({id:row.id,name:row.name,sku:row.sku||null}));
}
