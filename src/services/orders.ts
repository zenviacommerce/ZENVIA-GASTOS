import { supabase } from './supabase';

export type OrderChannel = 'amazon' | 'shopify' | 'other';

export interface FulfillmentOrder {
  id:string; sendcloudId:string; orderId:string|null; orderNumber:string|null;
  integrationId:number; integrationName:string|null; integrationType:string|null; sourceChannel:OrderChannel;
  sourceStatus:string|null; orderCreatedAt:string|null; orderUpdatedAt:string|null;
  customerName:string|null; customerEmail:string|null; customerPhone:string|null;
  shippingAddress:Record<string,unknown>; billingAddress:Record<string,unknown>; items:Array<Record<string,unknown>>;
  totalAmount:number|null; currency:string|null; weightKg:number|null;
  sendcloudParcelId:number|null; sendcloudShipmentId:string|null;
  trackingNumber:string|null; trackingUrl:string|null; trackingStatusCode:string|null; trackingStatusMessage:string|null; trackingUpdatedAt:string|null;
  shippingOptionCode:string|null; contractId:number|null;
  carrierCode:string|null; carrierName:string|null; shippingServiceName:string|null;
  labelCreatedAt:string|null; fulfilledAt:string|null; lastSyncedAt:string;
}

export interface SendcloudIntegration {
  id:number; shopName:string; type:string; shopUrl?:string|null; channel:OrderChannel; isApi?:boolean;
}
export interface SendcloudStatus { configured:boolean; integrations:SendcloudIntegration[]; message?:string; }
export interface ShippingOption {
  code:string; name:string; carrierCode:string; carrierName:string; contractId:number|null;
  price:number|null; currency:string|null; billedWeightKg?:number|null; raw:Record<string,unknown>;
}
export interface LabelResult {
  parcelId:number; shipmentId:string|null; trackingNumber:string|null; trackingUrl:string|null;
  shippingOptionCode:string|null; contractId:number|null; carrierCode?:string|null; carrierName?:string|null;
  shippingServiceName?:string|null; mimeType:string; base64:string;
}
export interface LocalPrinter { id:string; name:string; default?:boolean; }
export interface ManualOrderItem { name:string; sku?:string; quantity:number; unitPrice:number; }
export interface ManualOrderInput {
  integrationId:number; orderNumber:string; customerName:string; email?:string; phone?:string;
  address:string; houseNumber?:string; address2?:string; postalCode:string; city:string; countryCode:string;
  weightKg:number; items:ManualOrderItem[];
}
export interface OrderUpdateInput {
  customerName:string; email?:string; phone?:string; address:string; houseNumber?:string;
  address2?:string; postalCode:string; city:string; stateProvince?:string; countryCode:string; weightKg:number;
}

const PRINTER_KEY='zenvia-label-printer';
const HISTORY_SYNC_KEY='zenvia-orders-history-sync';

function toKg(value:unknown,unit:unknown){
  const n=Number(value);if(!Number.isFinite(n)||n<=0)return null;
  const u=String(unit||'kg').toLowerCase();if(u==='g')return n/1000;if(u==='lbs'||u==='lb')return n*0.45359237;return n;
}
function isBalearicAddress(address:Record<string,unknown>){
  const country=String(address?.country_code||'').trim().toUpperCase();
  const postal=String(address?.postal_code||'').replace(/\s+/g,'').trim();
  return country==='ES'&&/^07\d{3}$/.test(postal);
}
function mapRow(row:any):FulfillmentOrder{
  const weight=row?.raw_payload?.shipping_details?.measurement?.weight;
  const shippingAddress=row.shipping_address||{};
  const balearicPending=isBalearicAddress(shippingAddress)&&row.sendcloud_parcel_id==null;
  return {
    id:row.id, sendcloudId:String(row.sendcloud_id), orderId:row.order_id||null, orderNumber:row.order_number||null,
    integrationId:Number(row.integration_id), integrationName:row.integration_name||null, integrationType:row.integration_type||null,
    sourceChannel:(row.source_channel||'other') as OrderChannel, sourceStatus:row.source_status||null,
    orderCreatedAt:row.order_created_at||null, orderUpdatedAt:row.order_updated_at||null,
    customerName:row.customer_name||null, customerEmail:row.customer_email||null, customerPhone:row.customer_phone||null,
    shippingAddress, billingAddress:row.billing_address||{}, items:Array.isArray(row.items)?row.items:[],
    totalAmount:row.total_amount==null?null:Number(row.total_amount), currency:row.currency||null, weightKg:toKg(weight?.value,weight?.unit),
    sendcloudParcelId:row.sendcloud_parcel_id==null?null:Number(row.sendcloud_parcel_id),
    sendcloudShipmentId:row.sendcloud_shipment_id||null, trackingNumber:row.tracking_number||null, trackingUrl:row.tracking_url||null,
    trackingStatusCode:row.tracking_status_code||null, trackingStatusMessage:row.tracking_status_message||null, trackingUpdatedAt:row.tracking_updated_at||null,
    shippingOptionCode:row.shipping_option_code||null, contractId:row.contract_id==null?null:Number(row.contract_id),
    carrierCode:row.carrier_code||null, carrierName:row.carrier_name||(balearicPending?'🏝 Baleares · usar Correos':null), shippingServiceName:row.shipping_service_name||null,
    labelCreatedAt:row.label_created_at||null, fulfilledAt:row.fulfilled_at||null, lastSyncedAt:row.last_synced_at,
  };
}

async function invokeFunction<T>(functionName:string,body:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.functions.invoke(functionName,{body});
  if(error){
    let detail='';
    const context=(error as any)?.context;
    if(context instanceof Response){
      try{
        const payload=await context.clone().json();
        detail=String(payload?.error||payload?.message||'').trim();
      }catch{/* respuesta no JSON */}
    }
    throw new Error(detail||error.message||'No se pudo conectar con Sendcloud.');
  }
  if(data?.error)throw new Error(String(data.error));
  return data as T;
}
function invokeSendcloud<T>(body:Record<string,unknown>){return invokeFunction<T>('sendcloud-orders',body);}
function invokeOrderTools<T>(body:Record<string,unknown>){return invokeFunction<T>('sendcloud-order-tools',body);}

export async function listFulfillmentOrders():Promise<FulfillmentOrder[]>{
  const {data,error}=await supabase.from('fulfillment_orders').select('*').order('order_created_at',{ascending:false,nullsFirst:false}).limit(10000);
  if(error)throw error;
  return (data||[]).map(mapRow);
}
export function getSendcloudStatus(){return invokeSendcloud<SendcloudStatus>({action:'status'});}
export function syncSendcloudOrders(history=false){return invokeSendcloud<{ok:true;synced:number;enriched?:number;history?:boolean;integrations:SendcloudIntegration[]}>({action:'sync',history});}
export function createManualOrder(order:ManualOrderInput){return invokeSendcloud<{ok:true;id:string;sendcloudId:string;orderNumber:string}>({action:'create_manual_order',order});}
export async function getShippingOptions(orderId:string){
  const result=await invokeOrderTools<{weightKg:number;options:ShippingOption[];message?:string|null}>({action:'shipping_options',orderId});
  return {weightKg:result.weightKg,options:result.options||[],message:result.message||null};
}
export function updateFulfillmentOrder(orderId:string,order:OrderUpdateInput){return invokeOrderTools<{ok:true;weightKg:number}>({action:'update_order',orderId,order});}
export function createOrderLabel(orderId:string,option?:ShippingOption|null){return invokeSendcloud<LabelResult>({action:'create_label',orderId,shippingOption:option?{code:option.code,contractId:option.contractId,carrierName:option.carrierName,name:option.name}:null});}
export function fetchOrderLabel(orderId:string){return invokeSendcloud<LabelResult>({action:'fetch_label',orderId});}

export function shouldRunHistorySync(){
  const today=new Date().toISOString().slice(0,10);
  return window.localStorage.getItem(HISTORY_SYNC_KEY)!==today;
}
export function markHistorySyncDone(){window.localStorage.setItem(HISTORY_SYNC_KEY,new Date().toISOString().slice(0,10));}

export function labelBlob(result:Pick<LabelResult,'base64'|'mimeType'>){
  const binary=atob(result.base64); const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:result.mimeType||'application/pdf'});
}
export function downloadLabel(blob:Blob,orderNumber?:string|null){
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;
  a.download=`etiqueta-${(orderNumber||'pedido').replace(/[^a-z0-9._-]+/gi,'-')}.pdf`; document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function openLabelForPrint(blob:Blob){
  const url=URL.createObjectURL(blob); const win=window.open(url,'_blank','noopener,noreferrer');
  if(!win){URL.revokeObjectURL(url);throw new Error('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.');}
  win.addEventListener('load',()=>window.setTimeout(()=>{try{win.focus();win.print();}catch{/* visor PDF */}},500),{once:true});
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export async function listLocalPrinters():Promise<LocalPrinter[]>{
  const response=await fetch('http://127.0.0.1:1903/printers',{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('El Print Client de Sendcloud no responde.');
  return response.json() as Promise<LocalPrinter[]>;
}
export async function printLabelWithClient(blob:Blob,printerId:string){
  const form=new FormData();form.append('file',new File([blob],'label.pdf',{type:blob.type||'application/pdf'}));
  const response=await fetch(`http://127.0.0.1:1903/printers/${encodeURIComponent(printerId)}/print`,{method:'POST',headers:{Accept:'application/json'},body:form});
  if(!response.ok)throw new Error('El Print Client no pudo imprimir la etiqueta.');
}
export function getSavedPrinter(){return window.localStorage.getItem(PRINTER_KEY)||'';}
export function savePrinter(printerId:string){if(printerId)window.localStorage.setItem(PRINTER_KEY,printerId);else window.localStorage.removeItem(PRINTER_KEY);}