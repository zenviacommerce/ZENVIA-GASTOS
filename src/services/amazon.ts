import { supabase } from './supabase';

export type AmazonMarketplaceStatus={
  id:string;
  countryCode:string;
  name:string;
  currencyCode:string;
  active:boolean;
};

export type AmazonStatus={
  configured:boolean;
  connected:boolean;
  status:'not_configured'|'pending'|'connected'|'error'|'disabled'|string;
  account:{displayName:string;initialSyncFrom:string;lastSuccessfulSyncAt:string|null}|null;
  marketplaces:AmazonMarketplaceStatus[];
  sync:{
    latestRun:{source:string;mode:string;status:string;started_at:string;finished_at:string|null;rows_processed:number;error_message:string|null}|null;
    jobCounts:{queued:number;running:number;success:number;failed:number};
  };
  error:string|null;
};

function message(data:any,error:any,fallback:string){
  const detail=String(data?.error||error?.message||'').trim();
  return detail||fallback;
}

export async function loadAmazonStatus():Promise<AmazonStatus>{
  const {data,error}=await supabase.functions.invoke('amazon-status',{body:{}});
  if(error||!data||data.error)throw new Error(message(data,error,'No se pudo consultar el estado de Amazon.'));
  return data as AmazonStatus;
}

export async function requestAmazonSync(){
  const {data,error}=await supabase.functions.invoke('amazon-sync-manual',{body:{}});
  if(error||!data||data.error)throw new Error(message(data,error,'No se pudo iniciar la sincronización de Amazon.'));
  return data as {ok:true;accounts:number;jobs:number};
}
