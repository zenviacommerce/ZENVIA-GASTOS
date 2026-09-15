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
function credentials(){
  const publicKey=Deno.env.get('SENDCLOUD_PUBLIC_KEY')||Deno.env.get('SENDCLOUD_API_KEY')||'';
  const secretKey=Deno.env.get('SENDCLOUD_SECRET_KEY')||Deno.env.get('SENDCLOUD_API_SECRET')||'';
  return {publicKey,secretKey,configured:Boolean(publicKey&&secretKey)};
}
function basicAuth(publicKey:string,secretKey:string){return `Basic ${btoa(`${publicKey}:${secretKey}`)}`;}
async function sendcloudJson(path:string,init:RequestInit={}){
  const {publicKey,secretKey,configured}=credentials();
  if(!configured)throw new Error('Faltan las claves de la API de Sendcloud.');
  const url=path.startsWith('http')?path:`${SENDCLOUD_BASE}${path.startsWith('/')?'':'/'}${path}`;
  const headers=new Headers(init.headers||{});headers.set('Authorization',basicAuth(publicKey,secretKey));headers.set('Accept','application/json');
  if(init.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  const res=await fetch(url,{...init,headers});const body=await res.text();let data:any=null;try{data=body?JSON.parse(body):null}catch{data=body}
  if(!res.ok){const detail=Array.isArray(data?.errors)?data.errors.map((x:any)=>x?.detail||x?.title).filter(Boolean).join(' · '):data?.message||data?.error||body;throw new Error(`Sendcloud (${res.status}): ${String(detail||'Error desconocido').slice(0,900)}`)}
  return {data,headers:res.headers};
}
async function authenticate(req:Request,admin:any):Promise<Caller>{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();if(!token)throw new Error('Sesión no válida.');
  const {data:userData,error:userError}=await admin.auth.getUser(token);if(userError||!userData.user)throw new Error('Sesión no válida.');
  const {data:caller,error}=await admin.from('app_users').select('user_id,data_owner_id,role,active,permissions').eq('user_id',userData.user.id).maybeSingle();if(error)throw error;
  if(!caller?.active)throw new Error('Tu acceso está desactivado.');const permissions=Array.isArray(caller.permissions)?caller.permissions:[];
  if(caller.role!=='admin'&&!permissions.includes('orders'))throw new Error('No tienes permiso para gestionar pedidos.');return caller as Caller;
}
function clean(v:unknown){return String(v??'').trim();}
function statusCode(v:unknown){return clean(v).toLowerCase();}
function canEdit(v:unknown){const s=statusCode(v);return !s.includes('cancel')&&!['fulfilled','shipped','delivered'].includes(s);}
function toKg(value:unknown,unit:unknown){const n=Number(value);if(!Number.isFinite(n)||n<=0)return null;const u=clean(unit).toLowerCase();if(u==='g')return n/1000;if(u==='lbs'||u==='lb')return n*0.45359237;return n;}
function orderWeightKg(order:any){const w=order?.raw_payload?.shipping_details?.measurement?.weight;return toKg(w?.value,w?.unit)||1;}
function friendlyCarrier(code:unknown){const v=clean(code),l=v.toLowerCase();if(l.includes('correos'))return 'Correos';if(l.includes('mrw'))return 'MRW';return v||'Transportista';}
function normalizeOption(option:any){
  const code=clean(option?.code||option?.shipping_option_code||option?.shipping_option?.code);
  const carrierCode=clean(option?.carrier?.code||option?.carrier_code||code.split(':')[0]);
  const name=clean(option?.name||option?.title||option?.product?.name||option?.shipping_product?.name||option?.display_name||code)||'Servicio';
  const contractValue=option?.contract_id??option?.contract?.id??null;
  const quote=Array.isArray(option?.quotes)?option.quotes[0]:option?.quotes||null;
  const priceValue=quote?.price?.total?.value??quote?.price?.value??quote?.total_price?.value??quote?.value??null;
  const currency=quote?.price?.total?.currency??quote?.price?.currency??quote?.total_price?.currency??quote?.currency??null;
  const billed=option?.billed_weight;
  return {code,name,carrierCode,carrierName:clean(option?.carrier?.name||option?.carrier_name)||friendlyCarrier(carrierCode),contractId:contractValue==null?null:Number(contractValue),price:priceValue==null?null:Number(priceValue),currency:currency||null,billedWeightKg:toKg(billed?.value,billed?.unit),raw:option};
}
async function senderAddress(){
  try{const {data}=await sendcloudJson('/addresses/sender-addresses');return Array.isArray(data?.data)?data.data[0]||null:null}catch{return null}
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return fail('Método no permitido.',405);
  const url=Deno.env.get('SUPABASE_URL')||'',adminKey=getAdminKey();if(!url||!adminKey)return fail('Configuración del backend no disponible.',500);
  const admin=createClient(url,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const caller=await authenticate(req,admin),body=await req.json().catch(()=>({})),action=clean(body?.action);
    if(!credentials().configured)return fail('Sendcloud todavía no está conectado.',503);
    const orderId=clean(body?.orderId);if(!orderId)return fail('Falta el pedido.');
    const {data:order,error}=await admin.from('fulfillment_orders').select('*').eq('id',orderId).eq('owner_id',caller.data_owner_id).maybeSingle();if(error)throw error;if(!order)return fail('Pedido no encontrado.',404);

    if(action==='shipping_options'){
      if(!canEdit(order.source_status)||order.sendcloud_parcel_id)return fail('Este pedido ya no admite una nueva etiqueta.',409);
      const address=order.shipping_address||{},sender=await senderAddress(),weightKg=orderWeightKg(order);
      const requestBody:any={calculate_quotes:true,weight:{value:Number(weightKg.toFixed(3)),unit:'kg'},to_address:{country_code:address.country_code||undefined,postal_code:address.postal_code||undefined,city:address.city||undefined,address_line_1:address.address_line_1||undefined,house_number:address.house_number||undefined,state_province_code:address.state_province_code||undefined}};
      if(sender)requestBody.from_address={country_code:sender.country_code||undefined,postal_code:sender.postal_code||undefined,city:sender.city||undefined,address_line_1:sender.address_line_1||undefined,house_number:sender.house_number||undefined,state_province_code:sender.state_province_code||undefined};
      const {data}=await sendcloudJson('/shipping-options',{method:'POST',body:JSON.stringify(requestBody)});
      return response({weightKg,options:(data?.data||[]).map(normalizeOption).filter((x:any)=>x.code)});
    }

    if(action==='update_order'){
      if(!canEdit(order.source_status)||order.sendcloud_parcel_id)return fail('Solo puedes editar pedidos pendientes antes de crear la etiqueta.',409);
      const input=body?.order||{},current=order.shipping_address||{};
      const name=clean(input.customerName||current.name||order.customer_name),email=clean(input.email??current.email??order.customer_email),phone=clean(input.phone??current.phone_number??order.customer_phone);
      const address1=clean(input.address??current.address_line_1),houseNumber=clean(input.houseNumber??current.house_number),address2=clean(input.address2??current.address_line_2),postalCode=clean(input.postalCode??current.postal_code),city=clean(input.city??current.city),stateProvince=clean(input.stateProvince??current.state_province_code),countryCode=clean(input.countryCode??current.country_code).toUpperCase();
      const weightKg=Number(input.weightKg);if(!name||!address1||!postalCode||!city||countryCode.length!==2)return fail('Completa nombre, dirección, código postal, ciudad y país.');if(!Number.isFinite(weightKg)||weightKg<=0)return fail('El peso debe ser mayor que 0.');
      const shippingAddress={...current,name,address_line_1:address1,house_number:houseNumber||null,address_line_2:address2||null,postal_code:postalCode,city,state_province_code:stateProvince||null,country_code:countryCode,email:email||null,phone_number:phone||null};
      const raw=order.raw_payload||{},shippingDetails={...(raw.shipping_details||{}),measurement:{...(raw.shipping_details?.measurement||{}),weight:{value:Number(weightKg.toFixed(3)),unit:'kg'}}};
      const customerDetails={...(raw.customer_details||{}),name,email:email||null,phone_number:phone||null};
      const patch={shipping_address:shippingAddress,shipping_details:shippingDetails,customer_details:customerDetails};
      const {data}=await sendcloudJson(`/orders/${encodeURIComponent(String(order.sendcloud_id))}`,{method:'PATCH',body:JSON.stringify(patch)});
      const remote=data?.data||{},now=new Date().toISOString(),newRaw={...raw,...remote,shipping_address:remote.shipping_address||shippingAddress,shipping_details:remote.shipping_details||shippingDetails,customer_details:remote.customer_details||customerDetails};
      const {error:updateError}=await admin.from('fulfillment_orders').update({customer_name:name,customer_email:email||null,customer_phone:phone||null,shipping_address:remote.shipping_address||shippingAddress,raw_payload:newRaw,order_updated_at:remote?.order_details?.order_updated_at||remote?.modified_at||now,last_synced_at:now}).eq('id',order.id).eq('owner_id',caller.data_owner_id);if(updateError)throw updateError;
      return response({ok:true,weightKg});
    }
    return fail('Acción no válida.');
  }catch(error){const message=error instanceof Error?error.message:String(error||'Error interno.');const status=/Sesión no válida/.test(message)?401:/permiso/.test(message)?403:/Solo puedes|no admite/.test(message)?409:500;return fail(message,status)}
});
