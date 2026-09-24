import { spApiRequest } from './sp-api.ts';
import { loadAmazonSpApiCredentials } from './config.ts';

const INCLUDED_DATA=['PROCEEDS','EXPENSE','PROMOTION','CANCELLATION','FULFILLMENT','TAX'];
const SAFE_LAG_MS=2*60*1000;

type Money={amount?:string|number|null;currencyCode?:string|null}|null|undefined;
function money(value:Money){const n=Number(value?.amount);return Number.isFinite(n)?n:null;}
function currency(value:Money){return value?.currencyCode?String(value.currencyCode):null;}
function minIso(value:string|undefined|null,limit:Date){if(!value)return limit.toISOString();const date=new Date(value);return (date<limit?date:limit).toISOString();}
function programs(order:any){return (Array.isArray(order?.programs)?order.programs:[]).map((value:any)=>String(value||'').trim().toUpperCase()).filter(Boolean);}

function proceedsBreakdown(proceeds:any,matcher:(type:string)=>boolean){
  const item=(proceeds?.breakdowns||[]).find((entry:any)=>matcher(String(entry?.type||'').toUpperCase()));
  return item?.subtotal||item?.value||null;
}
function taxMoney(proceeds:any){return proceedsBreakdown(proceeds,type=>type==='TAX');}
function shippingMoney(proceeds:any){return proceedsBreakdown(proceeds,type=>type.includes('SHIPPING')||type.includes('DELIVERY'));}
function discountMoney(proceeds:any){return proceedsBreakdown(proceeds,type=>type.includes('DISCOUNT')||type.includes('PROMOTION'));}

export function normalizeAmazonOrder(order:any,job:any){
  const marketplaceId=String(order?.salesChannel?.marketplaceId||job.marketplace_id||'');
  const grandTotal=order?.proceeds?.grandTotal||null;
  const tax=taxMoney(order?.proceeds);
  const shipping=shippingMoney(order?.proceeds);
  const discount=discountMoney(order?.proceeds);
  const orderPrograms=programs(order);
  return {
    owner_id:job.owner_id,
    amazon_account_id:job.amazon_account_id,
    amazon_order_id:String(order?.orderId||''),
    marketplace_id:marketplaceId,
    purchase_date:order?.createdTime||null,
    last_update_date:order?.lastUpdatedTime||null,
    order_status:order?.fulfillment?.fulfillmentStatus||null,
    fulfillment_channel:order?.fulfillment?.fulfilledBy||null,
    sales_channel:order?.salesChannel?.channelName||null,
    currency_code:currency(grandTotal)||currency(tax)||null,
    gross_sales:money(grandTotal),
    vat_amount:money(tax),
    shipping_amount:money(shipping),
    promotion_discount:money(discount),
    order_total:money(grandTotal),
    programs:orderPrograms,
    is_business_order:orderPrograms.includes('AMAZON_BUSINESS'),
    synced_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
  };
}

export function normalizeAmazonOrderItems(order:any,job:any){
  const marketplaceId=String(order?.salesChannel?.marketplaceId||job.marketplace_id||'');
  return (order?.orderItems||[]).filter((item:any)=>item?.orderItemId).map((item:any)=>{
    const proceeds=item?.proceeds||null;
    const itemAmount=proceedsBreakdown(proceeds,type=>type==='ITEM')||proceeds?.proceedsTotal||null;
    const tax=taxMoney(proceeds);
    const shipping=shippingMoney(proceeds);
    const discount=discountMoney(proceeds);
    const unitPrice=item?.product?.price?.unitPrice||null;
    const quantity=Number(item?.quantityOrdered)||0;
    const derivedPrice=money(itemAmount)??(money(unitPrice)!=null?money(unitPrice)!*quantity:null);
    return {
      owner_id:job.owner_id,
      amazon_account_id:job.amazon_account_id,
      amazon_order_id:String(order?.orderId||''),
      marketplace_id:marketplaceId,
      order_item_id:String(item.orderItemId),
      asin:item?.product?.asin?String(item.product.asin):null,
      seller_sku:item?.product?.sellerSku?String(item.product.sellerSku):null,
      quantity_ordered:quantity,
      quantity_shipped:Number(item?.fulfillment?.quantityFulfilled)||0,
      item_price:derivedPrice,
      item_tax:money(tax),
      shipping_price:money(shipping),
      shipping_tax:null,
      promotion_discount:money(discount),
      currency_code:currency(itemAmount)||currency(unitPrice)||currency(tax)||null,
      synced_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    };
  });
}

async function upsertPage(admin:any,orders:any[],job:any){
  const orderRows=orders.filter(order=>order?.orderId).map(order=>normalizeAmazonOrder(order,job));
  const itemRows=orders.flatMap(order=>normalizeAmazonOrderItems(order,job));
  if(orderRows.length){
    const {error}=await admin.from('amazon_orders').upsert(orderRows,{onConflict:'owner_id,amazon_account_id,marketplace_id,amazon_order_id'});
    if(error)throw error;
  }
  if(itemRows.length){
    const {error}=await admin.from('amazon_order_items').upsert(itemRows,{onConflict:'owner_id,amazon_account_id,marketplace_id,amazon_order_id,order_item_id'});
    if(error)throw error;
  }
  return orderRows.length+itemRows.length;
}

export async function syncOrdersJob(admin:any,job:any){
  if(!job?.marketplace_id||!job?.window_from)throw new Error('Job de pedidos incompleto.');
  const mode=String(job?.payload?.mode||'hourly');
  const safeBefore=new Date(Date.now()-SAFE_LAG_MS);
  const before=minIso(job.window_to,safeBefore);
  if(new Date(job.window_from)>=new Date(before))return 0;
  const baseQuery:any={
    marketplaceIds:[job.marketplace_id],
    maxResultsPerPage:100,
    includedData:INCLUDED_DATA,
  };
  if(mode==='initial'){
    baseQuery.createdAfter=job.window_from;
    baseQuery.createdBefore=before;
  }else{
    baseQuery.lastUpdatedAfter=job.window_from;
    baseQuery.lastUpdatedBefore=before;
  }
  const credentials=await loadAmazonSpApiCredentials(admin,{amazonAccountId:job.amazon_account_id});
  let paginationToken:string|undefined;
  let processed=0;
  do{
    const query={...baseQuery,...(paginationToken?{paginationToken}:{})};
    const data:any=await spApiRequest('/orders/2026-01-01/orders',{query},credentials);
    const orders=Array.isArray(data?.orders)?data.orders:[];
    processed+=await upsertPage(admin,orders,job);
    paginationToken=data?.pagination?.nextToken||undefined;
  }while(paginationToken);
  return processed;
}
