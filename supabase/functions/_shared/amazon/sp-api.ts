import { readAmazonSpApiCredentials } from './config.ts';
import { retryAfterMs, sanitizeAmazonError, sleep } from './http.ts';

const LWA_URL='https://api.amazon.com/auth/o2/token';
export const SP_API_BASE='https://sellingpartnerapi-eu.amazon.com';
export const MAX_ATTEMPTS=4;
const USER_AGENT='ZENVIA-Gestion/1.0 (Language=TypeScript; Platform=Supabase-Edge)';

type TokenCache={token:string;expiresAt:number}|null;
let cachedToken:TokenCache=null;

function amazonDate(date=new Date()){
  return date.toISOString().replace(/[:-]|\.\d{3}/g,'');
}

export async function getLwaAccessToken(){
  const now=Date.now();
  if(cachedToken&&cachedToken.expiresAt>now+60_000)return cachedToken.token;
  const credentials=readAmazonSpApiCredentials();
  const body=new URLSearchParams();
  body.set('grant_type','refresh_token');
  body.set('refresh_token',credentials.refreshToken);
  body.set('client_id',credentials.clientId);
  body.set('client_secret',credentials.clientSecret);
  const response=await fetch(LWA_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
  const text=await response.text();
  let data:any=null;try{data=text?JSON.parse(text):null}catch{data=null}
  if(!response.ok||!data?.access_token){
    throw new Error(`Amazon LWA (${response.status}): ${sanitizeAmazonError(data?.error_description||data?.error||text)}`);
  }
  const expiresIn=Math.max(60,Number(data.expires_in)||3600);
  cachedToken={token:String(data.access_token),expiresAt:now+(expiresIn*1000)};
  return cachedToken.token;
}

export type SpApiRequestOptions={
  method?:'GET'|'POST'|'PUT'|'DELETE';
  query?:Record<string,string|number|boolean|Array<string|number>|null|undefined>;
  body?:unknown;
};

function buildUrl(path:string,query?:SpApiRequestOptions['query']){
  const url=new URL(path.startsWith('http')?path:`${SP_API_BASE}${path.startsWith('/')?'':'/'}${path}`);
  for(const [key,value] of Object.entries(query||{})){
    if(value==null)continue;
    if(Array.isArray(value))url.searchParams.set(key,value.map(String).join(','));
    else url.searchParams.set(key,String(value));
  }
  return url;
}

function transient(status:number){return [429,500,502,503,504].includes(status);}

export async function spApiRequest<T=any>(path:string,options:SpApiRequestOptions={}):Promise<T>{
  const url=buildUrl(path,options.query);
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt+=1){
    const accessToken=await getLwaAccessToken();
    const headers=new Headers({
      Accept:'application/json',
      'user-agent':USER_AGENT,
      'x-amz-access-token':accessToken,
      'x-amz-date':amazonDate(),
    });
    let body:BodyInit|undefined;
    if(options.body!==undefined){headers.set('Content-Type','application/json');body=JSON.stringify(options.body);}
    const response=await fetch(url,{method:options.method||'GET',headers,body});
    const text=await response.text();
    if(response.ok){
      if(!text)return undefined as T;
      try{return JSON.parse(text) as T}catch{throw new Error('Amazon SP-API devolvió una respuesta JSON no válida.');}
    }
    if(transient(response.status)&&attempt<MAX_ATTEMPTS-1){
      await sleep(retryAfterMs(response.headers,attempt));
      continue;
    }
    let parsed:any=null;try{parsed=text?JSON.parse(text):null}catch{/* keep raw */}
    const detail=parsed?.errors?.map?.((item:any)=>item?.message||item?.code).filter(Boolean).join(' · ')||parsed?.message||text;
    throw new Error(`Amazon SP-API (${response.status}): ${sanitizeAmazonError(detail)}`);
  }
  throw new Error('Amazon SP-API agotó los reintentos.');
}
