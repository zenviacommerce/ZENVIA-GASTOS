import { loadAmazonStatus, requestAmazonSync } from './amazon';
import { getCachedGmailConnection, gmailOAuthConfigured, syncGmailInvoiceCandidates, testGmailConnection } from './gmail';
import { getSendcloudStatus, syncSendcloudOrders, type SendcloudStatus } from './orders';
import { supabase } from './supabase';
import type { IntegrationsSettings } from './settingsSchema';

export type IntegrationId='gmail'|'amazon'|'sendcloud'|'shopify';

export type IntegrationHealth={
  id:IntegrationId;
  enabled:boolean;
  connected:boolean;
  lastSuccessAt:string|null;
  lastAttemptAt:string|null;
  lastError:string|null;
};

export type IntegrationActionResult={
  ok:boolean;
  checkedAt:string;
  message:string;
};

function enabledFor(id:IntegrationId,settings:IntegrationsSettings){
  if(id==='gmail')return settings.gmailEnabled;
  if(id==='amazon')return settings.amazonEnabled;
  if(id==='sendcloud')return settings.sendcloudEnabled;
  return settings.shopifyEnabled;
}

function errorMessage(error:unknown,fallback:string){
  return error instanceof Error&&error.message?error.message:fallback;
}

async function latestTimestamp(
  table:'gmail_imports'|'fulfillment_orders',
  column:'updated_at'|'last_synced_at',
  sourceChannel?:'shopify',
):Promise<string|null>{
  let query=supabase.from(table).select(column).not(column,'is',null);
  if(sourceChannel)query=query.eq('source_channel',sourceChannel);
  const {data,error}=await query.order(column,{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  const value=(data as Record<string,unknown>|null)?.[column];
  return typeof value==='string'?value:null;
}

async function gmailHealth(settings:IntegrationsSettings):Promise<IntegrationHealth>{
  const connected=Boolean(getCachedGmailConnection());
  let lastSuccessAt:string|null=null;
  try{lastSuccessAt=await latestTimestamp('gmail_imports','updated_at');}catch{/* Health remains available even if history cannot be read. */}
  return {
    id:'gmail',
    enabled:enabledFor('gmail',settings),
    connected,
    lastSuccessAt,
    lastAttemptAt:lastSuccessAt,
    lastError:gmailOAuthConfigured()?null:'OAuth de Gmail no está configurado.',
  };
}

async function amazonHealth(settings:IntegrationsSettings):Promise<IntegrationHealth>{
  try{
    const status=await loadAmazonStatus();
    const latest=status.sync?.latestRun||null;
    return {
      id:'amazon',
      enabled:enabledFor('amazon',settings),
      connected:Boolean(status.connected),
      lastSuccessAt:status.account?.lastSuccessfulSyncAt||null,
      lastAttemptAt:latest?.started_at||status.account?.lastSuccessfulSyncAt||null,
      lastError:latest?.status==='failed'?(latest.error_message||status.error||'La última sincronización falló.'):status.error||null,
    };
  }catch(error){
    return {
      id:'amazon',enabled:enabledFor('amazon',settings),connected:false,
      lastSuccessAt:null,lastAttemptAt:null,lastError:errorMessage(error,'No se pudo comprobar Amazon.'),
    };
  }
}

async function sendcloudHealth(
  settings:IntegrationsSettings,
  statusPromise:Promise<SendcloudStatus>,
  id:'sendcloud'|'shopify',
):Promise<IntegrationHealth>{
  let lastSuccessAt:string|null=null;
  try{lastSuccessAt=await latestTimestamp('fulfillment_orders','last_synced_at',id==='shopify'?'shopify':undefined);}catch{/* Status is still useful without history. */}
  try{
    const status=await statusPromise;
    const connected=id==='sendcloud'
      ?Boolean(status.configured)
      :Boolean(status.configured&&status.integrations.some(item=>item.channel==='shopify'));
    return {
      id,
      enabled:enabledFor(id,settings),
      connected,
      lastSuccessAt,
      lastAttemptAt:lastSuccessAt,
      lastError:connected?null:(id==='shopify'
        ?'No hay una integración Shopify activa en Sendcloud.'
        :(status.message||'Sendcloud no está configurado.')),
    };
  }catch(error){
    return {
      id,enabled:enabledFor(id,settings),connected:false,
      lastSuccessAt,lastAttemptAt:lastSuccessAt,lastError:errorMessage(error,`No se pudo comprobar ${id==='shopify'?'Shopify':'Sendcloud'}.`),
    };
  }
}

export async function loadIntegrationHealth(settings:IntegrationsSettings):Promise<IntegrationHealth[]>{
  const sendcloudStatus=getSendcloudStatus();
  const [gmail,amazon,sendcloud,shopify]=await Promise.all([
    gmailHealth(settings),
    amazonHealth(settings),
    sendcloudHealth(settings,sendcloudStatus,'sendcloud'),
    sendcloudHealth(settings,sendcloudStatus,'shopify'),
  ]);
  return [gmail,amazon,sendcloud,shopify];
}

export async function testIntegrationConnection(id:IntegrationId):Promise<IntegrationActionResult>{
  const checkedAt=new Date().toISOString();
  if(id==='gmail'){
    const result=await testGmailConnection();
    return {ok:true,checkedAt,message:`Gmail conectado: ${result.email}.`};
  }
  if(id==='amazon'){
    const status=await loadAmazonStatus();
    if(!status.connected)throw new Error(status.error||'Amazon no está conectado.');
    return {ok:true,checkedAt,message:`Amazon conectado${status.account?.displayName?`: ${status.account.displayName}`:''}.`};
  }
  const status=await getSendcloudStatus();
  if(!status.configured)throw new Error(status.message||'Sendcloud no está configurado.');
  if(id==='shopify'){
    const linked=status.integrations.filter(item=>item.channel==='shopify');
    if(!linked.length)throw new Error('No hay una integración Shopify activa en Sendcloud.');
    return {ok:true,checkedAt,message:`Shopify conectado mediante Sendcloud (${linked.length} integración${linked.length===1?'':'es'}).`};
  }
  return {ok:true,checkedAt,message:`Sendcloud conectado (${status.integrations.length} integración${status.integrations.length===1?'':'es'}).`};
}

export async function syncIntegration(id:IntegrationId):Promise<IntegrationActionResult>{
  const checkedAt=new Date().toISOString();
  if(id==='gmail'){
    const result=await syncGmailInvoiceCandidates();
    return {ok:true,checkedAt,message:`Gmail sincronizado: ${result.found} adjunto${result.found===1?'':'s'} detectado${result.found===1?'':'s'}.`};
  }
  if(id==='amazon'){
    const result=await requestAmazonSync();
    return {ok:true,checkedAt,message:result.jobs?`Amazon: ${result.jobs} trabajos puestos en cola.`:'Amazon ya estaba al día.'};
  }
  const result=await syncSendcloudOrders(false,id==='sendcloud');
  if(id==='shopify'){
    const shopify=result.integrations.filter(item=>item.channel==='shopify');
    if(!shopify.length)throw new Error('No hay una integración Shopify activa en Sendcloud.');
    return {ok:true,checkedAt,message:`Shopify actualizado mediante Sendcloud. ${result.synced} pedidos procesados en la sincronización.`};
  }
  return {ok:true,checkedAt,message:`Sendcloud sincronizado: ${result.synced} pedidos actualizados.`};
}
