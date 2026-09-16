import { sanitizeAmazonError } from './http.ts';

export const INITIAL_SYNC_FROM='2026-01-01T00:00:00Z';
export const BACKFILL_WINDOW_DAYS=7;
export const OVERLAP_HOURS=6;

type Mode='initial'|'hourly'|'manual'|'reconcile';
type Source='orders'|'finances'|'inventory';
type Account={id:string;owner_id:string;initial_sync_from?:string|null};
type Marketplace={marketplace_id:string;active?:boolean};

function iso(value:Date|string){return new Date(value).toISOString();}
function plusDays(value:Date,days:number){const next=new Date(value);next.setUTCDate(next.getUTCDate()+days);return next;}
function minusHours(value:Date,hours:number){const next=new Date(value);next.setUTCHours(next.getUTCHours()-hours);return next;}
function hourKey(value:Date){const d=new Date(value);d.setUTCMinutes(0,0,0);return d.toISOString();}

function jobKey(source:Source,marketplaceId:string|null,from:string|null,to:string|null,mode:Mode){
  return [mode,source,marketplaceId||'global',from||'current',to||'current'].join(':');
}

async function insertJobs(admin:any,rows:any[]){
  for(let offset=0;offset<rows.length;offset+=200){
    const batch=rows.slice(offset,offset+200);
    const {error}=await admin.from('amazon_sync_jobs').upsert(batch,{onConflict:'owner_id,amazon_account_id,job_key',ignoreDuplicates:true});
    if(error)throw error;
  }
  return rows.length;
}

export async function enqueueInitialBackfill(admin:any,account:Account,marketplaces:Marketplace[],until=new Date()){
  const start=new Date(account.initial_sync_from||INITIAL_SYNC_FROM);
  const end=new Date(until);
  const rows:any[]=[];
  for(const marketplace of marketplaces.filter(item=>item.active!==false)){
    let cursor=new Date(start);
    while(cursor<end){
      const windowEnd=plusDays(cursor,BACKFILL_WINDOW_DAYS);
      const clipped=windowEnd>end?end:windowEnd;
      for(const source of ['orders','finances'] as const){
        const from=iso(cursor),to=iso(clipped);
        rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey(source,marketplace.marketplace_id,from,to,'initial'),source,marketplace_id:marketplace.marketplace_id,scope_key:marketplace.marketplace_id,window_from:from,window_to:to,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode:'initial'}});
      }
      cursor=clipped;
    }
    rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey('inventory',marketplace.marketplace_id,null,hourKey(end),'initial'),source:'inventory',marketplace_id:marketplace.marketplace_id,scope_key:marketplace.marketplace_id,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode:'initial',snapshot:'current'}});
  }
  await insertJobs(admin,rows);
  return rows;
}

export async function enqueueHourlySync(admin:any,account:Account,marketplaces:Marketplace[],mode:Extract<Mode,'hourly'|'manual'|'reconcile'>='hourly',now=new Date()){
  const ids=marketplaces.filter(item=>item.active!==false).map(item=>item.marketplace_id);
  const {data:states,error}=await admin.from('amazon_sync_state')
    .select('source,scope_key,marketplace_id,high_water_mark')
    .eq('owner_id',account.owner_id)
    .eq('amazon_account_id',account.id);
  if(error)throw error;
  const stateMap=new Map((states||[]).map((state:any)=>[`${state.source}:${state.scope_key}`,state]));
  const rows:any[]=[];
  for(const marketplaceId of ids){
    for(const source of ['orders','finances'] as const){
      const state:any=stateMap.get(`${source}:${marketplaceId}`);
      const baseline=state?.high_water_mark?new Date(state.high_water_mark):minusHours(now,OVERLAP_HOURS);
      const from=iso(minusHours(baseline,OVERLAP_HOURS)),to=iso(now);
      rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey(source,marketplaceId,from,to,mode),source,marketplace_id:marketplaceId,scope_key:marketplaceId,window_from:from,window_to:to,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode,high_water_mark:state?.high_water_mark||null}});
    }
    rows.push({owner_id:account.owner_id,amazon_account_id:account.id,job_key:jobKey('inventory',marketplaceId,null,hourKey(now),mode),source:'inventory',marketplace_id:marketplaceId,scope_key:marketplaceId,status:'queued',attempts:0,max_attempts:5,available_at:new Date().toISOString(),payload:{mode,snapshot:'current'}});
  }
  await insertJobs(admin,rows);
  return rows;
}

export async function markJobSuccess(admin:any,job:any,rowsProcessed:number){
  const finished=new Date().toISOString();
  const {error}=await admin.from('amazon_sync_jobs').update({status:'success',rows_processed:rowsProcessed,finished_at:finished,locked_at:null,last_error:null,updated_at:finished}).eq('id',job.id);
  if(error)throw error;
  const highWater=job.window_to||finished;
  const {error:stateError}=await admin.from('amazon_sync_state').upsert({owner_id:job.owner_id,amazon_account_id:job.amazon_account_id,source:job.source,scope_key:job.scope_key||job.marketplace_id||'global',marketplace_id:job.marketplace_id||null,high_water_mark:highWater,last_successful_at:finished,checkpoint:{last_job_id:job.id,rows_processed:rowsProcessed},updated_at:finished},{onConflict:'owner_id,amazon_account_id,source,scope_key'});
  if(stateError)throw stateError;
}

export async function markJobFailed(admin:any,job:any,errorValue:unknown){
  const attempts=Number(job.attempts)||1,maxAttempts=Number(job.max_attempts)||5;
  const terminal=attempts>=maxAttempts;
  const delaySeconds=Math.min(3600,Math.max(60,60*(2**Math.max(0,attempts-1))));
  const availableAt=new Date(Date.now()+delaySeconds*1000).toISOString();
  const errorMessage=sanitizeAmazonError(errorValue instanceof Error?errorValue.message:errorValue);
  const {error}=await admin.from('amazon_sync_jobs').update({status:terminal?'failed':'queued',available_at:availableAt,locked_at:null,finished_at:terminal?new Date().toISOString():null,last_error:errorMessage,updated_at:new Date().toISOString(),attempts}).eq('id',job.id);
  if(error)throw error;
}
