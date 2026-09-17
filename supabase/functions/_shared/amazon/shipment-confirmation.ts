import { sanitizeAmazonError } from './http.ts';
import { spApiRequest } from './sp-api.ts';

type FulfillmentOrderRow={
  id:string;owner_id:string;order_id?:string|null;order_number?:string|null;source_channel?:string|null;
  tracking_number?:string|null;sendcloud_parcel_id?:number|string|null;carrier_code?:string|null;carrier_name?:string|null;
  shipping_service_name?:string|null;label_created_at?:string|null;fulfilled_at?:string|null;tracking_updated_at?:string|null;
  order_updated_at?:string|null;amazon_tracking_sync_attempts?:number|null;amazon_tracking_last_attempt_at?:string|null;
};

type AmazonOrderContext={amazonOrderId:string;marketplaceId:string;orderItems:Array<{orderItemId:string;quantity:number}>};
export type AmazonTrackingSyncResult={orderId:string;amazonOrderId:string;status:'confirmed'|'already_synced';trackingNumber:string;packageReferenceId:string};

function clean(value:unknown){return String(value??'').trim();}
function amazonOrderId(order:FulfillmentOrderRow){
  const candidates=[order.order_id,order.order_number].map(clean).filter(Boolean);
  const found=candidates.find(value=>/^\d{3}-\d{7}-\d{7}$/.test(value));
  if(!found)throw new Error('El pedido de Sendcloud no contiene un Amazon Order ID válido.');
  return found;
}
function positivePackageReference(value:unknown){const text=clean(value);return /^\d+$/.test(text)&&Number(text)>0?text:null;}
function attempts(order:FulfillmentOrderRow){return Math.max(0,Number(order.amazon_tracking_sync_attempts)||0)+1;}
function attemptDue(order:FulfillmentOrderRow,now=Date.now()){
  if(!order.amazon_tracking_last_attempt_at)return true;
  const last=new Date(order.amazon_tracking_last_attempt_at).getTime();if(!Number.isFinite(last))return true;
  const previous=Math.max(0,Number(order.amazon_tracking_sync_attempts)||0);
  const delayMinutes=Math.min(60,Math.max(1,2**Math.min(previous,6)));
  return now-last>=delayMinutes*60_000;
}
function carrier(order:FulfillmentOrderRow){
  const raw=`${clean(order.carrier_code)} ${clean(order.carrier_name)} ${clean(order.shipping_service_name)}`.toLowerCase();
  if(raw.includes('mrw'))return {carrierCode:'MRW',carrierName:'MRW'};
  if(raw.includes('correos express'))return {carrierCode:'Correos Express',carrierName:'Correos Express'};
  if(raw.includes('correos'))return {carrierCode:'Correos',carrierName:'Correos'};
  if(raw.includes('seur'))return {carrierCode:'SEUR',carrierName:'SEUR'};
  if(raw.includes('gls'))return {carrierCode:'GLS',carrierName:'GLS'};
  if(raw.includes('ups'))return {carrierCode:'UPS',carrierName:'UPS'};
  if(raw.includes('dhl'))return {carrierCode:'DHL',carrierName:'DHL'};
  const name=clean(order.carrier_name)||clean(order.carrier_code)||'Transportista';
  return {carrierCode:'Other',carrierName:name};
}
async function markSuccess(admin:any,order:FulfillmentOrderRow){
  const now=new Date().toISOString();
  const {error}=await admin.from('fulfillment_orders').update({amazon_tracking_synced_at:now,amazon_tracking_last_attempt_at:now,amazon_tracking_sync_error:null,amazon_tracking_sync_attempts:attempts(order)}).eq('id',order.id).eq('owner_id',order.owner_id);
  if(error)throw error;
}
async function markFailure(admin:any,order:FulfillmentOrderRow,errorValue:unknown){
  const now=new Date().toISOString(),message=sanitizeAmazonError(errorValue instanceof Error?errorValue.message:errorValue);
  const {error}=await admin.from('fulfillment_orders').update({amazon_tracking_last_attempt_at:now,amazon_tracking_sync_error:message,amazon_tracking_sync_attempts:attempts(order)}).eq('id',order.id).eq('owner_id',order.owner_id);
  if(error)throw error;
}
async function loadContext(admin:any,order:FulfillmentOrderRow):Promise<AmazonOrderContext>{
  const orderId=amazonOrderId(order);
  const {data:amazonRows,error:amazonError}=await admin.from('amazon_orders').select('marketplace_id,fulfillment_channel').eq('owner_id',order.owner_id).eq('amazon_order_id',orderId).limit(2);
  if(amazonError)throw amazonError;
  if(!amazonRows?.length)throw new Error(`Amazon todavía no ha sincronizado el pedido ${orderId}.`);
  if(amazonRows.length!==1)throw new Error(`El pedido ${orderId} aparece en más de un marketplace de Amazon.`);
  const marketplaceId=clean(amazonRows[0].marketplace_id);if(!marketplaceId)throw new Error(`El pedido ${orderId} no tiene marketplace asociado.`);
  const {data:itemRows,error:itemError}=await admin.from('amazon_order_items').select('order_item_id,quantity_ordered').eq('owner_id',order.owner_id).eq('amazon_order_id',orderId).eq('marketplace_id',marketplaceId).gt('quantity_ordered',0);
  if(itemError)throw itemError;
  const orderItems=(itemRows||[]).map((item:any)=>({orderItemId:clean(item.order_item_id),quantity:Math.max(1,Math.trunc(Number(item.quantity_ordered)||0))})).filter((item:any)=>item.orderItemId);
  if(!orderItems.length)throw new Error(`Amazon todavía no ha sincronizado las líneas del pedido ${orderId}.`);
  return {amazonOrderId:orderId,marketplaceId,orderItems};
}
async function currentPackages(orderId:string){
  const data:any=await spApiRequest(`/orders/2026-01-01/orders/${encodeURIComponent(orderId)}`,{query:{includedData:['PACKAGES']}});
  const current=data?.order||data?.Order||data||{};
  return Array.isArray(current?.packages)?current.packages:[];
}
function packageReference(packages:any[],trackingNumber:string,parcelId:unknown){
  const exact=packages.filter(item=>clean(item?.trackingNumber)===trackingNumber);
  if(exact.length){
    const ref=positivePackageReference(exact[0]?.packageReferenceId);
    if(!ref)throw new Error('Amazon devolvió un packageReferenceId no numérico para el tracking existente.');
    return {packageReferenceId:ref,alreadySynced:true};
  }
  if(packages.length===1){
    const ref=positivePackageReference(packages[0]?.packageReferenceId);
    if(!ref)throw new Error('Amazon devolvió un packageReferenceId no numérico para el paquete existente.');
    return {packageReferenceId:ref,alreadySynced:false};
  }
  if(packages.length>1)throw new Error('Amazon tiene varios paquetes para este pedido y no se puede determinar de forma segura cuál corresponde al tracking de Sendcloud.');
  const fallback=positivePackageReference(parcelId);
  if(!fallback)throw new Error('Sendcloud no devolvió un parcel_id válido para identificar el paquete en Amazon.');
  return {packageReferenceId:fallback,alreadySynced:false};
}

export async function syncAmazonTracking(admin:any,order:FulfillmentOrderRow):Promise<AmazonTrackingSyncResult>{
  const trackingNumber=clean(order.tracking_number);if(order.source_channel!=='amazon')throw new Error('El pedido no procede de Amazon.');if(!trackingNumber)throw new Error('El pedido todavía no tiene número de seguimiento.');
  let context:AmazonOrderContext|undefined;
  try{
    context=await loadContext(admin,order);
    const packages=await currentPackages(context.amazonOrderId);
    const selectedPackage=packageReference(packages,trackingNumber,order.sendcloud_parcel_id);
    if(selectedPackage.alreadySynced){await markSuccess(admin,order);return {orderId:order.id,amazonOrderId:context.amazonOrderId,status:'already_synced',trackingNumber,packageReferenceId:selectedPackage.packageReferenceId};}
    const carrierData=carrier(order),shipDate=order.label_created_at||order.fulfilled_at||order.tracking_updated_at||order.order_updated_at||new Date().toISOString();
    const packageDetail:any={packageReferenceId:selectedPackage.packageReferenceId,carrierCode:carrierData.carrierCode,carrierName:carrierData.carrierName,trackingNumber,shipDate:new Date(shipDate).toISOString(),orderItems:context.orderItems};
    const shippingMethod=clean(order.shipping_service_name);if(shippingMethod)packageDetail.shippingMethod=shippingMethod;
    await spApiRequest(`/orders/v0/orders/${encodeURIComponent(context.amazonOrderId)}/shipmentConfirmation`,{method:'POST',body:{marketplaceId:context.marketplaceId,packageDetail}});
    await markSuccess(admin,order);
    return {orderId:order.id,amazonOrderId:context.amazonOrderId,status:'confirmed',trackingNumber,packageReferenceId:selectedPackage.packageReferenceId};
  }catch(error){
    try{await markFailure(admin,order,error)}catch{/* preserve original Amazon error */}
    throw error;
  }
}

export async function retryPendingAmazonTracking(admin:any,ownerId:string,limit=5,force=false){
  const safeLimit=Math.max(1,Math.min(25,Math.trunc(Number(limit)||5)));
  const {data,error}=await admin.from('fulfillment_orders').select('*').eq('owner_id',ownerId).eq('source_channel','amazon').not('tracking_number','is',null).is('amazon_tracking_synced_at',null).order('tracking_updated_at',{ascending:false,nullsFirst:false}).limit(Math.max(safeLimit*4,20));
  if(error)throw error;
  const results:any[]=[];
  for(const order of data||[]){
    if(results.length>=safeLimit)break;
    if(!force&&!attemptDue(order))continue;
    try{const result=await syncAmazonTracking(admin,order);results.push({...result,ok:true})}
    catch(syncError){results.push({orderId:order.id,ok:false,error:sanitizeAmazonError(syncError instanceof Error?syncError.message:syncError)})}
  }
  return {attempted:results.length,succeeded:results.filter(item=>item.ok).length,failed:results.filter(item=>!item.ok).length,results};
}
