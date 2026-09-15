import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};
const SENDCLOUD_BASE='https://panel.sendcloud.sc/api/v3';

type Caller={user_id:string;data_owner_id:string;role:string;active:boolean;permissions:string[]|null};

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
  const text=await res.text();
  let data:any=null;
  try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok){
    const detail=Array.isArray(data?.errors)?data.errors.map((item:any)=>item?.detail||item?.title).filter(Boolean).join(' · '):data?.message||data?.error||text;
    throw new Error(`Sendcloud (${res.status}): ${String(detail||'Error desconocido').slice(0,500)}`);
  }
  return {data,headers:res.headers};
}

async function sendcloudBinary(path:string,accept='application/pdf'){
  const {publicKey,secretKey,configured}=sendcloudCredentials();
  if(!configured)throw new Error('Faltan las claves de la API de Sendcloud.');
  const res=await fetch(`${SENDCLOUD_BASE}${path}`,{headers:{Authorization:basicAuth(publicKey,secretKey),Accept:accept}});
  if(!res.ok){const text=await res.text();throw new Error(`Sendcloud (${res.status}): ${text.slice(0,400)}`)}
  const bytes=new Uint8Array(await res.arrayBuffer());
  let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return {base64:btoa(binary),mimeType:res.headers.get('content-type')||accept};
}

async function authenticate(req:Request,admin:any):Promise<Caller>{
  const authHeader=req.headers.get('Authorization')||'';
  const token=authHeader.replace(/^Bearer\s+/i,'').trim();
  if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);
  if(userError||!userData.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();
  if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');
  const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');
  return caller as Caller;
}

function channelFor(integration:any){
  const value=`${integration?.type||''} ${integration?.shop_name||''} ${integration?.shop_url||''}`.toLowerCase();
  if(value.includes('amazon'))return 'amazon';
  if(value.includes('shopify'))return 'shopify';
  return 'other';
}

function orderEmail(order:any){
  return order?.customer_details?.email||order?.shipping_address?.email||order?.billing_address?.email||null;
}
function orderPhone(order:any){
  return order?.customer_details?.phone_number||order?.customer_details?.telephone||order?.shipping_address?.phone_number||order?.shipping_address?.telephone||null;
}
function orderName(order:any){
  return order?.customer_details?.name||order?.shipping_address?.name||order?.billing_address?.name||null;
}

function normalizeShippingOption(option:any){
  const code=String(option?.code||option?.shipping_option_code||option?.shipping_option?.code||'');
  const carrierCode=String(option?.carrier?.code||option?.carrier_code||code.split(':')[0]||'');
  const carrierName=String(option?.carrier?.name||option?.carrier_name||carrierCode||'Transportista');
  const name=String(option?.name||option?.title||option?.shipping_product?.name||option?.shipping_product_name||option?.display_name||code||'Servicio');
  const contractValue=option?.contract_id??option?.contract?.id??option?.ship_with?.properties?.contract_id??null;
  const contractId=contractValue==null?null:Number(contractValue);
  const quote=Array.isArray(option?.quotes)?option.quotes[0]:option?.quotes?.price?option.quotes:null;
  const priceValue=quote?.price?.value??quote?.total_price?.value??quote?.value??null;
  const price=priceValue==null||Number.isNaN(Number(priceValue))?null:Number(priceValue);
  const currency=quote?.price?.currency||quote?.total_price?.currency||quote?.currency||null;
  return {code,name,carrierCode,carrierName,contractId,price,currency,raw:option};
}

async function integrations(){
  const {data}=await sendcloudJson('/integrations');
  return (data?.data||[]).map((item:any)=>({
    id:Number(item.id),shopName:String(item.shop_name||item.type||`Integración ${item.id}`),type:String(item.type||''),shopUrl:item.shop_url||null,channel:channelFor(item),
  }));
}

async function fetchUnshippedOrders(){
  const rows:any[]=[];
  let url=`${SENDCLOUD_BASE}/orders?status=unshipped&page_size=200&sort=-order_created_at`;
  for(let page=0;page<3&&url;page+=1){
    const result=await sendcloudJson(url);
    rows.push(...(result.data?.data||[]));
    const link=result.headers.get('link')||'';
    const next=link.split(',').map(part=>part.trim()).find(part=>/rel="next"/.test(part));
    const match=next?.match(/<([^>]+)>/);
    url=match?.[1]||'';
  }
  return rows;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=Deno.env.get('SUPABASE_URL')||'';
  const adminKey=getAdminKey();
  if(!url||!adminKey)return fail('Configuración del backend no disponible.',500);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin);
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||'status');
    const credentials=sendcloudCredentials();

    if(action==='status'){
      if(!credentials.configured)return response({configured:false,integrations:[],message:'Faltan SENDCLOUD_PUBLIC_KEY y SENDCLOUD_SECRET_KEY.'});
      try{return response({configured:true,integrations:await integrations()})}
      catch(error){return response({configured:true,integrations:[],message:error instanceof Error?error.message:String(error)})}
    }

    if(!credentials.configured)return fail('Sendcloud todavía no está conectado. Configura las claves Public y Secret de la integración Sendcloud API.',503);

    if(action==='sync'){
      const linked=await integrations();
      const integrationMap=new Map(linked.map((item:any)=>[Number(item.id),item]));
      const orders=await fetchUnshippedOrders();
      const now=new Date().toISOString();
      const rows=orders.map((order:any)=>{
        const integrationId=Number(order?.order_details?.integration?.id||0);
        const integration=integrationMap.get(integrationId) as any;
        const total=order?.payment_details?.total_price;
        return {
          owner_id:caller.data_owner_id,
          sendcloud_id:String(order.id),
          order_id:order.order_id==null?null:String(order.order_id),
          order_number:order.order_number==null?null:String(order.order_number),
          integration_id:integrationId,
          integration_name:integration?.shopName||null,
          integration_type:integration?.type||null,
          source_channel:integration?.channel||'other',
          source_status:order?.order_details?.status?.code||null,
          order_created_at:order?.order_details?.order_created_at||order?.created_at||null,
          order_updated_at:order?.order_details?.order_updated_at||order?.modified_at||null,
          customer_name:orderName(order),
          customer_email:orderEmail(order),
          customer_phone:orderPhone(order),
          shipping_address:order?.shipping_address||{},
          billing_address:order?.billing_address||{},
          items:Array.isArray(order?.order_details?.order_items)?order.order_details.order_items:[],
          total_amount:total?.value==null?null:Number(total.value),
          currency:total?.currency||null,
          raw_payload:order,
          last_synced_at:now,
        };
      }).filter((row:any)=>row.integration_id&&row.sendcloud_id);
      if(rows.length){
        const {error}=await admin.from('fulfillment_orders').upsert(rows,{onConflict:'owner_id,sendcloud_id'});
        if(error)throw error;
      }
      return response({ok:true,synced:rows.length,integrations:linked});
    }

    const orderId=String(body?.orderId||'');
    if(!orderId)return fail('Falta el pedido.');
    const {data:order,error:orderError}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();
    if(orderError)throw orderError;
    if(!order)return fail('Pedido no encontrado.',404);

    if(action==='shipping_options'){
      const address=order.shipping_address||{};
      const requestBody:any={calculate_quotes:false};
      if(address.country_code||address.postal_code||address.city){
        requestBody.to_address={
          country_code:address.country_code||undefined,
          postal_code:address.postal_code||undefined,
          city:address.city||undefined,
          address_line_1:address.address_line_1||undefined,
          house_number:address.house_number||undefined,
        };
      }
      const {data}=await sendcloudJson('/shipping-options',{method:'POST',body:JSON.stringify(requestBody)});
      const options=(data?.data||[]).map(normalizeShippingOption).filter((item:any)=>item.code);
      return response({options});
    }

    if(action==='create_label'){
      if(order.sendcloud_parcel_id)return fail('Este pedido ya tiene una etiqueta creada.',409);
      const selected=body?.shippingOption||null;
      const payload:any={
        integration_id:Number(order.integration_id),
        label_details:{mime_type:'application/pdf',dpi:72},
        order:{apply_shipping_rules:!selected},
      };
      if(order.order_id)payload.order.order_id=order.order_id;else if(order.order_number)payload.order.order_number=order.order_number;else return fail('El pedido no tiene identificador de origen.');
      if(selected?.code){
        payload.ship_with={type:'shipping_option_code',properties:{shipping_option_code:String(selected.code)}};
        if(selected.contractId!=null)payload.ship_with.properties.contract_id=Number(selected.contractId);
      }
      const {data}=await sendcloudJson('/orders/create-label-sync',{method:'POST',body:JSON.stringify(payload)});
      const created=Array.isArray(data?.data)?data.data[0]:null;
      if(!created?.parcel_id||!created?.label?.file)throw new Error('Sendcloud no devolvió la etiqueta creada.');
      const ship=created.ship_with?.properties||{};
      const now=new Date().toISOString();
      const {error:updateError}=await admin.from('fulfillment_orders').update({
        sendcloud_parcel_id:Number(created.parcel_id),
        sendcloud_shipment_id:created.shipment_id==null?null:String(created.shipment_id),
        tracking_number:created.tracking_number||null,
        tracking_url:created.tracking_url||null,
        shipping_option_code:ship.shipping_option_code||selected?.code||null,
        contract_id:ship.contract_id??selected?.contractId??null,
        label_created_at:now,
        fulfilled_at:now,
        source_status:'shipped',
      }).eq('id',order.id).eq('owner_id',caller.data_owner_id);
      if(updateError)throw updateError;
      return response({
        parcelId:Number(created.parcel_id),shipmentId:created.shipment_id==null?null:String(created.shipment_id),trackingNumber:created.tracking_number||null,trackingUrl:created.tracking_url||null,
        shippingOptionCode:ship.shipping_option_code||selected?.code||null,contractId:ship.contract_id??selected?.contractId??null,mimeType:created.label.mime_type||'application/pdf',base64:String(created.label.file),
      });
    }

    if(action==='fetch_label'){
      if(!order.sendcloud_parcel_id)return fail('Este pedido todavía no tiene etiqueta.',409);
      const file=await sendcloudBinary(`/parcels/${encodeURIComponent(String(order.sendcloud_parcel_id))}/documents/label?dpi=72`,'application/pdf');
      return response({
        parcelId:Number(order.sendcloud_parcel_id),shipmentId:order.sendcloud_shipment_id||null,trackingNumber:order.tracking_number||null,trackingUrl:order.tracking_url||null,
        shippingOptionCode:order.shipping_option_code||null,contractId:order.contract_id==null?null:Number(order.contract_id),mimeType:file.mimeType,base64:file.base64,
      });
    }

    return fail('Acción no válida.');
  }catch(error){
    const message=error instanceof Error?error.message:String(error||'Error interno.');
    const status=/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:500;
    return fail(message,status);
  }
});
