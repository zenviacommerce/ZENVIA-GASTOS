import { supabase } from './supabase';

export type OrderChannel = 'amazon' | 'shopify' | 'other';

export interface FulfillmentOrder {
  id: string;
  sendcloudId: string;
  orderId: string | null;
  orderNumber: string | null;
  integrationId: number;
  integrationName: string | null;
  integrationType: string | null;
  sourceChannel: OrderChannel;
  sourceStatus: string | null;
  orderCreatedAt: string | null;
  orderUpdatedAt: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  shippingAddress: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
  totalAmount: number | null;
  currency: string | null;
  sendcloudParcelId: number | null;
  sendcloudShipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippingOptionCode: string | null;
  contractId: number | null;
  labelCreatedAt: string | null;
  fulfilledAt: string | null;
  lastSyncedAt: string;
}

export interface SendcloudIntegration {
  id: number;
  shopName: string;
  type: string;
  shopUrl?: string | null;
  channel: OrderChannel;
}

export interface SendcloudStatus {
  configured: boolean;
  integrations: SendcloudIntegration[];
  message?: string;
}

export interface ShippingOption {
  code: string;
  name: string;
  carrierCode: string;
  carrierName: string;
  contractId: number | null;
  price: number | null;
  currency: string | null;
  raw: Record<string, unknown>;
}

export interface LabelResult {
  parcelId: number;
  shipmentId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippingOptionCode: string | null;
  contractId: number | null;
  mimeType: string;
  base64: string;
}

export interface LocalPrinter {
  id: string;
  name: string;
  default?: boolean;
}

const PRINTER_KEY='zenvia-label-printer';

function mapRow(row:any): FulfillmentOrder {
  return {
    id: row.id,
    sendcloudId: String(row.sendcloud_id),
    orderId: row.order_id || null,
    orderNumber: row.order_number || null,
    integrationId: Number(row.integration_id),
    integrationName: row.integration_name || null,
    integrationType: row.integration_type || null,
    sourceChannel: (row.source_channel || 'other') as OrderChannel,
    sourceStatus: row.source_status || null,
    orderCreatedAt: row.order_created_at || null,
    orderUpdatedAt: row.order_updated_at || null,
    customerName: row.customer_name || null,
    customerEmail: row.customer_email || null,
    customerPhone: row.customer_phone || null,
    shippingAddress: row.shipping_address || {},
    billingAddress: row.billing_address || {},
    items: Array.isArray(row.items) ? row.items : [],
    totalAmount: row.total_amount == null ? null : Number(row.total_amount),
    currency: row.currency || null,
    sendcloudParcelId: row.sendcloud_parcel_id == null ? null : Number(row.sendcloud_parcel_id),
    sendcloudShipmentId: row.sendcloud_shipment_id || null,
    trackingNumber: row.tracking_number || null,
    trackingUrl: row.tracking_url || null,
    shippingOptionCode: row.shipping_option_code || null,
    contractId: row.contract_id == null ? null : Number(row.contract_id),
    labelCreatedAt: row.label_created_at || null,
    fulfilledAt: row.fulfilled_at || null,
    lastSyncedAt: row.last_synced_at,
  };
}

async function invokeSendcloud<T>(body:Record<string,unknown>):Promise<T>{
  const { data, error }=await supabase.functions.invoke('sendcloud-orders',{body});
  if(error) throw new Error(error.message||'No se pudo conectar con Sendcloud.');
  if(data?.error) throw new Error(String(data.error));
  return data as T;
}

export async function listFulfillmentOrders():Promise<FulfillmentOrder[]>{
  const {data,error}=await supabase
    .from('fulfillment_orders')
    .select('*')
    .order('order_created_at',{ascending:false,nullsFirst:false})
    .limit(500);
  if(error) throw error;
  return (data||[]).map(mapRow);
}

export function getSendcloudStatus(){
  return invokeSendcloud<SendcloudStatus>({action:'status'});
}

export async function syncSendcloudOrders(){
  return invokeSendcloud<{ok:true;synced:number;integrations:SendcloudIntegration[]}>({action:'sync'});
}

export async function getShippingOptions(orderId:string){
  const result=await invokeSendcloud<{options:ShippingOption[]} >({action:'shipping_options',orderId});
  return result.options||[];
}

export function createOrderLabel(orderId:string,option?:ShippingOption|null){
  return invokeSendcloud<LabelResult>({
    action:'create_label',
    orderId,
    shippingOption: option ? {code:option.code,contractId:option.contractId} : null,
  });
}

export function fetchOrderLabel(orderId:string){
  return invokeSendcloud<LabelResult>({action:'fetch_label',orderId});
}

export function labelBlob(result:Pick<LabelResult,'base64'|'mimeType'>){
  const binary=atob(result.base64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:result.mimeType||'application/pdf'});
}

export function downloadLabel(blob:Blob,orderNumber?:string|null){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`etiqueta-${(orderNumber||'pedido').replace(/[^a-z0-9._-]+/gi,'-')}.pdf`;
  document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export function openLabelForPrint(blob:Blob){
  const url=URL.createObjectURL(blob);
  const win=window.open(url,'_blank','noopener,noreferrer');
  if(!win){URL.revokeObjectURL(url);throw new Error('El navegador ha bloqueado la ventana de impresión. Permite las ventanas emergentes e inténtalo de nuevo.');}
  win.addEventListener('load',()=>window.setTimeout(()=>{try{win.focus();win.print();}catch{/* el visor mantiene el botón de imprimir */}},500),{once:true});
  window.setTimeout(()=>URL.revokeObjectURL(url),60000);
}

export async function listLocalPrinters():Promise<LocalPrinter[]>{
  const response=await fetch('http://127.0.0.1:1903/printers',{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('El Print Client de Sendcloud no responde.');
  return response.json() as Promise<LocalPrinter[]>;
}

export async function printLabelWithClient(blob:Blob,printerId:string){
  const form=new FormData();
  form.append('file',new File([blob],'label.pdf',{type:blob.type||'application/pdf'}));
  const response=await fetch(`http://127.0.0.1:1903/printers/${encodeURIComponent(printerId)}/print`,{
    method:'POST',headers:{Accept:'application/json'},body:form,
  });
  if(!response.ok)throw new Error('El Print Client no pudo imprimir la etiqueta.');
}

export function getSavedPrinter(){return window.localStorage.getItem(PRINTER_KEY)||'';}
export function savePrinter(printerId:string){if(printerId)window.localStorage.setItem(PRINTER_KEY,printerId);else window.localStorage.removeItem(PRINTER_KEY);}
