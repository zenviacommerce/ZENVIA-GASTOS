import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};
const SENDCLOUD_BASE='https://panel.sendcloud.sc/api/v3';

type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};
type Integration={id:number;shopName:string;type:string;shopUrl:string|null;channel:'amazon'|'shopify'|'other';isApi:boolean};

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:jsonHeaders});}
function fail(message:string,status=400){return response({error:message},status);}
function getAdminKey(){
  const secretKeys=Deno.env.get('SUPABASE_SECRET_KEYS');
  if(secretKeys){try{const parsed=JSON.parse(secretKeys);if(parsed?.default)return parsed.default as string}catch{/* fallback */}}
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
function sendcloudCredentials(){
  const publicKey=Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY')||'';
  const secretKey=Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET')||'';
  return {publicKey,secretKey,configured:Boolean(publicKey&&secretKey)};
}
function basicAuth(publicKey:string,secretKey:string){return `Basic ${btoa(`${publicKey}:${secretKey}`)}`;}

async function sendcloudJson(path:string,init:RequestInit={}){
  const {publicKey,secretKey,configured}=sendcloudCredentials();
  if(!configured)throw new Error('Faltan las claves de la API de Sendcloud.');
  const url=path.startsWith('http')?path:`${SENDCLOUD_BASE}${path.startsWith('/')?'':'/'}${path}`;
  const headers=new Headers(init.headers||{});
  headers.set('Authorization',basicAuth(publicKey,secretKey));
  headers.set('Accept','application/json');
  if(init.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const res=await fetch(url,{...init,headers});
  const body=await res.text();
  let data:any=null;try{data=body?JSON.parse(body):null}catch{data=body}
  if(!res.ok){
    const detail=Array.isArray(data?.errors)?data.errors.map((item:any)=>item?.detail||item?.title).filter(Boolean).join(' · '):data?.message||data?.error||body;
    throw new Error(`Sendcloud (${res.status}): ${String(detail||'Error desconocido').slice(0,700)}`);
  }
  return {data,headers:res.headers};
}
async function sendcloudBinary(path:string,accept='application/pdf'){
  const {publicKey,secretKey,configured}=sendcloudCredentials();if(!configured)throw new Error('Faltan las claves de la API de Sendcloud.');
  const res=await fetch(`${SENDCLOUD_BASE}${path}`,{headers:{Authorization:basicAuth(publicKey,secretKey),Accept:accept}});
  if(!res.ok){const body=await res.text();throw new Error(`Sendcloud (${res.status}): ${body.slice(0,500)}`)}
  const bytes=new Uint8Array(await res.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return {base64:btoa(binary),mimeType:res.headers.get('content-type')||accept};
}
async function authenticate(req:Request,admin:any):Promise<Caller>{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);if(userError||!userData.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');
  return caller as Caller;
}

async function workspaceConfig(admin:any,ownerId:string){
  const {data,error}=await admin.from('app_settings').select('config').eq('owner_id',ownerId).maybeSingle();
  if(error)throw error;
  const config=(data?.config&&typeof data.config==='object')?data.config:{};
  return {
    orders:(config as any).orders||{},
    shipping:(config as any).shipping||{},
    integrations:(config as any).integrations||{},
  };
}
function enabledCarrier(option:any,enabled:unknown){
  const values=Array.isArray(enabled)?enabled.map(value=>clean(value).toLowerCase()).filter(Boolean):[];
  if(!values.length)return true;
  const haystack=`${option?.carrierCode||option?.carrierName||''} ${option?.code||''} ${option?.name||''}`.toLowerCase();
  return values.some(value=>haystack.includes(value));
}

function channelFor(i:any){const value=`${i?.type||''} ${i?.shop_name||''} ${i?.shop_url||''}`.toLowerCase();if(value.includes('amazon'))return 'amazon';if(value.includes('shopify'))return 'shopify';return 'other';}
function apiIntegration(i:any){const value=`${i?.type||''} ${i?.shop_name||''}`.toLowerCase();return value.includes('api')||value.includes('zenvia');}
function orderEmail(o:any){return o?.customer_details?.email||o?.shipping_address?.email||o?.billing_address?.email||null;}
function orderPhone(o:any){return o?.customer_details?.phone_number||o?.shipping_address?.phone_number||o?.billing_address?.phone_number||null;}
function orderName(o:any){return o?.customer_details?.name||o?.shipping_address?.name||o?.billing_address?.name||null;}
function statusCode(v:unknown){return String(v||'').trim().toLowerCase();}
function nonActionable(v:unknown){const s=statusCode(v);return s.includes('cancel')||['fulfilled','shipped','delivered','processed','completed'].includes(s);}
function friendlyCarrier(code:unknown){const v=String(code||'').trim(),l=v.toLowerCase();if(l.includes('correos'))return 'Correos';if(l.includes('mrw'))return 'MRW';if(l.includes('seur'))return 'SEUR';if(l.includes('gls'))return 'GLS';if(l.includes('ups'))return 'UPS';if(l.includes('dhl'))return 'DHL';return v?v.replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()):null;}
function carrierCode(option:unknown,tracking?:unknown){const o=String(option||'').trim();if(o)return o.split(':')[0].toLowerCase();try{return new URL(String(tracking||'')).searchParams.get('carrier')?.toLowerCase()||null}catch{return null}}
function clean(v:unknown){return String(v??'').trim();}
function positive(v:unknown,fallback=0){const n=Number(v);return Number.isFinite(n)&&n>=0?n:fallback;}

function normalizeShippingOption(option:any){
  const code=String(option?.code||option?.shipping_option_code||option?.shipping_option?.code||'');
  const carrier=String(option?.carrier?.code||option?.carrier_code||code.split(':')[0]||'');
  const name=String(option?.name||option?.title||option?.shipping_product?.name||option?.shipping_product_name||option?.display_name||code||'Servicio');
  const contractValue=option?.contract_id??option?.contract?.id??option?.ship_with?.properties?.contract_id??null;
  const quote=Array.isArray(option?.quotes)?option.quotes[0]:option?.quotes?.price?option.quotes:null;
  const priceValue=quote?.price?.value??quote?.total_price?.value??quote?.value??null;
  return {code,name,carrierCode:carrier,carrierName:String(option?.carrier?.name||option?.carrier_name||friendlyCarrier(carrier)||carrier||'Transportista'),contractId:contractValue==null?null:Number(contractValue),price:priceValue==null?null:Number(priceValue),currency:quote?.price?.currency||quote?.total_price?.currency||quote?.currency||null,raw:option};
}
async function integrations():Promise<Integration[]>{
  const {data}=await sendcloudJson('/integrations');
  return (data?.data||[]).map((item:any)=>({id:Number(item.id),shopName:String(item.shop_name||item.type||`Integración ${item.id}`),type:String(item.type||''),shopUrl:item.shop_url||null,channel:channelFor(item),isApi:apiIntegration(item)}));
}
function daysAgo(days:number){const d=new Date();d.setUTCDate(d.getUTCDate()-days);return d.toISOString().slice(0,10);}
function yearStart(){return `${new Date().getUTCFullYear()}-01-01`;}
async function fetchPaged(path:string,maxPages:number){
  const rows:any[]=[];let url=path.startsWith('http')?path:`${SENDCLOUD_BASE}${path}`;
  for(let page=0;page<maxPages&&url;page+=1){const result=await sendcloudJson(url);rows.push(...(result.data?.data||[]));const next=(result.headers.get('link')||'').split(',').map((p:string)=>p.trim()).find((p:string)=>/rel="next"/.test(p));url=next?.match(/<([^>]+)>/)?.[1]||'';}
  return rows;
}
async function fetchOrders(history:boolean){const min=history?yearStart():daysAgo(7);return fetchPaged(`/orders?page_size=100&sort=-order_created_at&order_created_at_min=${encodeURIComponent(min)}`,history?70:16);}
async function fetchShipments(history:boolean){const min=history?yearStart():daysAgo(30);return fetchPaged(`/shipments?page_size=100&updated_after=${encodeURIComponent(`${min}T00:00:00Z`)}`,history?70:24);}
function shipmentMeta(s:any){
  const parcel=Array.isArray(s?.parcels)?s.parcels[0]:null;const option=s?.ship_with?.properties?.shipping_option_code||null;const code=carrierCode(option,parcel?.tracking_url);const trackingStatus=parcel?.status||{};
  return {sendcloud_parcel_id:parcel?.id==null?null:Number(parcel.id),sendcloud_shipment_id:s?.id==null?null:String(s.id),tracking_number:parcel?.tracking_number||null,tracking_url:parcel?.tracking_url||null,shipping_option_code:option,contract_id:s?.ship_with?.properties?.contract_id==null?null:Number(s.ship_with.properties.contract_id),carrier_code:code,carrier_name:friendlyCarrier(code),shipping_service_name:option,fulfilled_at:parcel?.announced_at||s?.updated_at||null,tracking_status_code:clean(trackingStatus?.code)||null,tracking_status_message:clean(trackingStatus?.message)||null,tracking_updated_at:s?.updated_at||parcel?.updated_at||null};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=Deno.env.get('SUPABASE_URL')||'',adminKey=getAdminKey();if(!url||!adminKey)return fail('Configuración del backend no disponible.',500);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin),body=await req.json().catch(()=>({})),action=String(body?.action||'status'),credentials=sendcloudCredentials(),config=await workspaceConfig(admin,caller.data_owner_id),ordersConfig=config.orders,shippingConfig=config.shipping,integrationConfig=config.integrations;
    if(action==='status'){
      if(!credentials.configured)return response({configured:false,integrations:[],message:'Faltan SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.'});
      try{return response({configured:true,integrations:await integrations()})}catch(error){return response({configured:true,integrations:[],message:error instanceof Error?error.message:String(error)})}
    }
    if(!credentials.configured)return fail('Sendcloud todavía no está conectado. Configura las claves Public y Secret de la integración Sendcloud API.',503);

    if(action==='sync'){
      const history=Boolean(body?.history),automatic=Boolean(body?.automatic),linked=await integrations();
      if(automatic&&integrationConfig.sendcloudEnabled===false)return response({ok:true,synced:0,enriched:0,history,integrations:linked,disabled:true});
      const allowedChannels=new Set<string>(['other']);
      if(!automatic||integrationConfig.amazonEnabled!==false)allowedChannels.add('amazon');
      if(!automatic||integrationConfig.shopifyEnabled!==false)allowedChannels.add('shopify');
      const integrationMap=new Map(linked.map(i=>[i.id,i])),orders=await fetchOrders(history),now=new Date().toISOString();
      let shipments:any[]=[];try{shipments=await fetchShipments(history)}catch{/* sincronización base continúa */}
      const shipmentMap=new Map<string,any>();for(const s of shipments){const key=clean(s?.order_number);if(key&&!shipmentMap.has(key))shipmentMap.set(key,s)}
      const rows=orders.map((order:any)=>{const integrationId=Number(order?.order_details?.integration?.id||0),integration=integrationMap.get(integrationId),total=order?.payment_details?.total_price;return {owner_id:caller.data_owner_id,sendcloud_id:String(order.id),order_id:order.order_id==null?null:String(order.order_id),order_number:order.order_number==null?null:String(order.order_number),integration_id:integrationId,integration_name:integration?.shopName||null,integration_type:integration?.type||null,source_channel:integration?.channel||'other',source_status:order?.order_details?.status?.code||null,order_created_at:order?.order_details?.order_created_at||order?.created_at||null,order_updated_at:order?.order_details?.order_updated_at||order?.modified_at||null,customer_name:orderName(order),customer_email:orderEmail(order),customer_phone:orderPhone(order),shipping_address:order?.shipping_address||{},billing_address:order?.billing_address||{},items:Array.isArray(order?.order_details?.order_items)?order.order_details.order_items:[],total_amount:total?.value==null?null:Number(total.value),currency:total?.currency||null,raw_payload:order,last_synced_at:now};}).filter((r:any)=>r.integration_id&&r.sendcloud_id&&(!automatic||allowedChannels.has(r.source_channel)));
      if(rows.length){const {error}=await admin.from('fulfillment_orders').upsert(rows,{onConflict:'owner_id,sendcloud_id'});if(error)throw error;}
      const enriched=rows.map((r:any)=>{const s=shipmentMap.get(clean(r.order_number));return s?{...r,...shipmentMeta(s)}:null}).filter(Boolean);
      if(enriched.length){const {error}=await admin.from('fulfillment_orders').upsert(enriched,{onConflict:'owner_id,sendcloud_id'});if(error)throw error;}
      return response({ok:true,synced:rows.length,enriched:enriched.length,history,integrations:linked});
    }

    if(action==='create_manual_order'){
      const linked=await integrations(),manual=body?.order||{},integrationId=Number(manual.integrationId||0),integration=linked.find(i=>i.id===integrationId);
      if(!integration)return fail('Selecciona una integración API de Sendcloud válida.');if(integration.channel!=='other')return fail('Los pedidos manuales deben crearse en una integración API de Sendcloud, no en Amazon o Shopify.');
      const orderNumber=clean(manual.orderNumber)||`MAN-${Date.now()}`,customerName=clean(manual.customerName),address=clean(manual.address),postalCode=clean(manual.postalCode),city=clean(manual.city),countryCode=clean(manual.countryCode||ordersConfig.originCountryCode||'ES').toUpperCase();
      if(!customerName||!address||!postalCode||!city||countryCode.length!==2)return fail('Completa nombre, dirección, código postal, ciudad y país.');
      const items=(Array.isArray(manual.items)?manual.items:[]).map((item:any,index:number)=>{const name=clean(item?.name)||`Producto ${index+1}`,quantity=Math.max(1,Math.floor(positive(item?.quantity,1))),unitPrice=positive(item?.unitPrice,0),line:any={name,quantity,total_price:{value:Number((unitPrice*quantity).toFixed(2)),currency:'EUR'}};const sku=clean(item?.sku);if(sku)line.sku=sku;return line;});
      if(!items.length)return fail('Añade al menos un producto al pedido.');
      const total=Number(items.reduce((sum:number,item:any)=>sum+Number(item.total_price.value||0),0).toFixed(2)),weight=Math.max(0.01,positive(manual.weightKg,positive(shippingConfig.fallbackWeightKg,1)||1)),now=new Date().toISOString(),externalId=`manual-${crypto.randomUUID()}`,configuredStatus=clean(ordersConfig.defaultManualStatus||'pending')||'pending';
      const sendcloudOrder:any={order_id:externalId,order_number:orderNumber,order_details:{integration:{id:integrationId},status:{code:'unshipped',message:'Unshipped'},order_created_at:now,order_items:items},payment_details:{total_price:{value:total,currency:'EUR'},status:{code:'paid',message:'Paid'}},shipping_address:{name:customerName,address_line_1:address,house_number:clean(manual.houseNumber)||null,address_line_2:clean(manual.address2)||null,postal_code:postalCode,city,country_code:countryCode,email:clean(manual.email)||null,phone_number:clean(manual.phone)||null},shipping_details:{is_local_pickup:false,delivery_indicator:'Pedido manual ZENVIA Gestión',measurement:{weight:{value:weight,unit:'kg'}}}};
      const {data}=await sendcloudJson('/orders',{method:'POST',body:JSON.stringify([sendcloudOrder])}),created=Array.isArray(data?.data)?data.data[0]:null;if(created?.id==null)throw new Error('Sendcloud no devolvió el identificador del pedido.');
      const row={owner_id:caller.data_owner_id,sendcloud_id:String(created.id),order_id:externalId,order_number:orderNumber,integration_id:integrationId,integration_name:integration.shopName,integration_type:integration.type||'api',source_channel:'other',source_status:configuredStatus,order_created_at:now,order_updated_at:now,customer_name:customerName,customer_email:clean(manual.email)||null,customer_phone:clean(manual.phone)||null,shipping_address:sendcloudOrder.shipping_address,billing_address:{},items,total_amount:total,currency:'EUR',raw_payload:sendcloudOrder,last_synced_at:now};
      const {data:saved,error}=await admin.from('fulfillment_orders').upsert(row,{onConflict:'owner_id,sendcloud_id'}).select('id').single();if(error)throw error;
      return response({ok:true,id:saved.id,sendcloudId:String(created.id),orderNumber});
    }

    const orderId=String(body?.orderId||'');if(!orderId)return fail('Falta el pedido.');
    const {data:order,error:orderError}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();if(orderError)throw orderError;if(!order)return fail('Pedido no encontrado.',404);

    if(action==='shipping_options'){
      if(nonActionable(order.source_status))return fail('Este pedido ya no admite preparación de etiqueta por su estado actual.',409);
      const address=order.shipping_address||{},requestBody:any={calculate_quotes:false};if(address.country_code||address.postal_code||address.city)requestBody.to_address={country_code:address.country_code||undefined,postal_code:address.postal_code||undefined,city:address.city||undefined,address_line_1:address.address_line_1||undefined,house_number:address.house_number||undefined};
      const weight=order?.raw_payload?.shipping_details?.measurement?.weight;if(weight?.value)requestBody.weight={value:Number(weight.value),unit:weight.unit||'kg'};
      const {data}=await sendcloudJson('/shipping-options',{method:'POST',body:JSON.stringify(requestBody)});return response({options:(data?.data||[]).map(normalizeShippingOption).filter((i:any)=>i.code)});
    }

    if(action==='create_label'){
      if(order.sendcloud_parcel_id)return fail('Este pedido ya tiene una etiqueta creada.',409);if(nonActionable(order.source_status))return fail('No se puede crear una etiqueta para un pedido cancelado o ya procesado.',409);
      const selected=body?.shippingOption||null;
      if(selected&&!enabledCarrier(selected,shippingConfig.enabledCarriers))return fail('El transportista seleccionado está deshabilitado en Configuración.',409);
      if(!selected&&Array.isArray(shippingConfig.enabledCarriers)&&shippingConfig.enabledCarriers.length)return fail('Selecciona un servicio de uno de los transportistas habilitados.',409);
      const payload:any={integration_id:Number(order.integration_id),label_details:{mime_type:'application/pdf',dpi:72},order:{apply_shipping_rules:!selected}};
      if(order.order_id)payload.order.order_id=order.order_id;else if(order.order_number)payload.order.order_number=order.order_number;else return fail('El pedido no tiene identificador de origen.');
      if(selected?.code){payload.ship_with={type:'shipping_option_code',properties:{shipping_option_code:String(selected.code)}};if(selected.contractId!=null)payload.ship_with.properties.contract_id=Number(selected.contractId)}
      const {data}=await sendcloudJson('/orders/create-label-sync',{method:'POST',body:JSON.stringify(payload)}),created=Array.isArray(data?.data)?data.data[0]:null;if(!created?.parcel_id||!created?.label?.file)throw new Error('Sendcloud no devolvió la etiqueta creada.');
      const ship=created.ship_with?.properties||{},optionCode=ship.shipping_option_code||selected?.code||null,code=carrierCode(optionCode,created.tracking_url),now=new Date().toISOString();
      const selectedPrice=selected?.price==null?null:Number(selected.price),selectedCurrency=clean(selected?.currency).toUpperCase()||null;
      const persistShippingCost=shippingConfig.persistShippingCost!==false;
      const markSentAfterLabel=ordersConfig.markSentAfterLabel!==false;
      const confirmShipmentAfterLabel=shippingConfig.confirmShipmentAfterLabel!==false;
      const shouldMarkSent=markSentAfterLabel&&confirmShipmentAfterLabel;
      const costPatch=persistShippingCost&&Number.isFinite(selectedPrice)?{shipping_cost_amount:selectedPrice,shipping_cost_currency:selectedCurrency||'EUR',shipping_cost_source:'sendcloud_quote',shipping_cost_net_amount:selectedPrice,shipping_cost_tax_amount:0,shipping_cost_recorded_at:now}:{};
      const shipmentPatch:any={sendcloud_parcel_id:Number(created.parcel_id),sendcloud_shipment_id:created.shipment_id==null?null:String(created.shipment_id),tracking_number:created.tracking_number||null,tracking_url:created.tracking_url||null,shipping_option_code:optionCode,contract_id:ship.contract_id??selected?.contractId??null,carrier_code:code,carrier_name:selected?.carrierName||friendlyCarrier(code),shipping_service_name:selected?.name||optionCode,label_created_at:now,tracking_status_code:'READY_TO_SEND',tracking_status_message:'Ready to send',tracking_updated_at:now,...costPatch};
      if(shouldMarkSent){shipmentPatch.fulfilled_at=now;shipmentPatch.source_status='shipped';}
      const {error:updateError}=await admin.from('fulfillment_orders').update(shipmentPatch).eq('id',order.id).eq('owner_id',caller.data_owner_id);if(updateError)throw updateError;
      return response({parcelId:Number(created.parcel_id),shipmentId:created.shipment_id==null?null:String(created.shipment_id),trackingNumber:created.tracking_number||null,trackingUrl:created.tracking_url||null,shippingOptionCode:optionCode,contractId:ship.contract_id??selected?.contractId??null,carrierCode:code,carrierName:selected?.carrierName||friendlyCarrier(code),shippingServiceName:selected?.name||optionCode,mimeType:created.label.mime_type||'application/pdf',base64:String(created.label.file)});
    }

    if(action==='fetch_label'){
      if(!order.sendcloud_parcel_id)return fail('Este pedido todavía no tiene etiqueta.',409);const file=await sendcloudBinary(`/parcels/${encodeURIComponent(String(order.sendcloud_parcel_id))}/documents/label?dpi=72`,'application/pdf');
      return response({parcelId:Number(order.sendcloud_parcel_id),shipmentId:order.sendcloud_shipment_id||null,trackingNumber:order.tracking_number||null,trackingUrl:order.tracking_url||null,shippingOptionCode:order.shipping_option_code||null,contractId:order.contract_id==null?null:Number(order.contract_id),carrierCode:order.carrier_code||null,carrierName:order.carrier_name||null,shippingServiceName:order.shipping_service_name||null,mimeType:file.mimeType,base64:file.base64});
    }
    return fail('Acción no válida.');
  }catch(error){const message=error instanceof Error?error.message:String(error||'Error interno.');const status=/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:/no admite|No se puede|deshabilitado|transportistas habilitados/.test(message)?409:500;return fail(message,status);}
});