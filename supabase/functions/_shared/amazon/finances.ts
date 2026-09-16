import { spApiRequest } from './sp-api.ts';

const SAFE_LAG_MS=2*60*1000;

type Currency={currencyAmount?:string|number|null;currencyCode?:string|null}|null|undefined;
function money(value:Currency){const parsed=Number(value?.currencyAmount);return Number.isFinite(parsed)?parsed:0;}
function currency(value:Currency){return value?.currencyCode?String(value.currencyCode):'EUR';}
function safePostedBefore(value:string|undefined|null){
  const limit=new Date(Date.now()-SAFE_LAG_MS);
  if(!value)return limit.toISOString();
  const requested=new Date(value);
  return (requested<limit?requested:limit).toISOString();
}

function identifierName(item:any){return String(item?.relatedIdentifierName||item?.name||item?.type||'').trim();}
function identifierValue(item:any){return String(item?.relatedIdentifierValue||item?.value||item?.id||'').trim();}
function safeIdentifiers(transaction:any){
  return (Array.isArray(transaction?.relatedIdentifiers)?transaction.relatedIdentifiers:[])
    .map((item:any)=>({name:identifierName(item),value:identifierValue(item)}))
    .filter((item:any)=>item.name&&item.value)
    .slice(0,50);
}
function identifier(transaction:any,pattern:RegExp){
  const found=safeIdentifiers(transaction).find((item:any)=>pattern.test(item.name));
  return found?.value||null;
}

function collectBreakdownTypes(value:any,out:string[]=[]){
  if(!value||typeof value!=='object')return out;
  if(typeof value.breakdownType==='string')out.push(value.breakdownType);
  const nested=Array.isArray(value.breakdowns)?value.breakdowns:[];
  for(const child of nested)collectBreakdownTypes(child,out);
  return out;
}

function sanitizeBreakdowns(value:any):any[]{
  const source=Array.isArray(value)?value:[];
  return source.slice(0,100).map((entry:any)=>({
    breakdownType:String(entry?.breakdownType||''),
    breakdownAmount:entry?.breakdownAmount?{
      currencyAmount:money(entry.breakdownAmount),
      currencyCode:currency(entry.breakdownAmount),
    }:null,
    breakdowns:sanitizeBreakdowns(entry?.breakdowns),
  }));
}

export function safeTransactionMetadata(transaction:any){
  return {
    marketplaceId:transaction?.marketplaceDetails?.marketplaceId?String(transaction.marketplaceDetails.marketplaceId):null,
    breakdowns:sanitizeBreakdowns(transaction?.breakdowns),
  };
}

function firstProductContext(transaction:any){
  const candidates:any[]=[];
  if(Array.isArray(transaction?.contexts))candidates.push(...transaction.contexts);
  for(const item of Array.isArray(transaction?.items)?transaction.items:[]){
    if(Array.isArray(item?.contexts))candidates.push(...item.contexts);
  }
  return candidates.find(context=>context&&(context.sku||context.asin))||null;
}

export function categorizeTransaction(transaction:any){
  const breakdownText=collectBreakdownTypes(transaction).join(' ');
  const text=`${transaction?.transactionType||''} ${transaction?.description||''} ${breakdownText}`.toLowerCase();
  if(/refund|chargeback|return/.test(text))return 'refund';
  if(/referral/.test(text))return 'referral_fee';
  if(/storage/.test(text))return 'storage_fee';
  if(/fba|fulfil+l?ment|fulfillment/.test(text)&&/fee|expense|charge/.test(text))return 'fba_fee';
  if(/\btax\b|\bvat\b|impuesto/.test(text))return 'tax';
  if(/adjust|reimburse|reimbursement|correction/.test(text))return 'adjustment';
  if(/fee|expense|charge|commission/.test(text))return 'other_fee';
  if(/sale|shipment|order payment|product charges|proceeds/.test(text))return 'sale';
  return 'other';
}

function stableTransactionSeed(transaction:any,job:any){
  return JSON.stringify({
    marketplaceId:transaction?.marketplaceDetails?.marketplaceId||job?.marketplace_id||null,
    transactionType:transaction?.transactionType||null,
    transactionStatus:transaction?.transactionStatus||null,
    postedDate:transaction?.postedDate||null,
    amount:money(transaction?.totalAmount),
    currency:currency(transaction?.totalAmount),
    related:safeIdentifiers(transaction).sort((a:any,b:any)=>`${a.name}:${a.value}`.localeCompare(`${b.name}:${b.value}`)),
  });
}

export async function deriveTransactionKey(transaction:any,job:any){
  const explicit=String(transaction?.transactionId||'').trim();
  if(explicit)return `id:${explicit}`;
  const bytes=new TextEncoder().encode(stableTransactionSeed(transaction,job));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return `sha256:${Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('')}`;
}

async function normalizeTransaction(transaction:any,job:any){
  const product=firstProductContext(transaction);
  const total=transaction?.totalAmount||null;
  return {
    owner_id:job.owner_id,
    amazon_account_id:job.amazon_account_id,
    transaction_key:await deriveTransactionKey(transaction,job),
    amazon_transaction_id:transaction?.transactionId?String(transaction.transactionId):null,
    marketplace_id:transaction?.marketplaceDetails?.marketplaceId?String(transaction.marketplaceDetails.marketplaceId):job.marketplace_id||null,
    amazon_order_id:identifier(transaction,/order/i),
    seller_sku:product?.sku?String(product.sku):null,
    asin:product?.asin?String(product.asin):null,
    posted_date:transaction?.postedDate||null,
    transaction_status:transaction?.transactionStatus?String(transaction.transactionStatus):null,
    transaction_type:String(transaction?.transactionType||'UNKNOWN'),
    category:categorizeTransaction(transaction),
    amount_original:money(total),
    currency_code:currency(total),
    amount_eur:null,
    fx_rate:null,
    related_identifiers:safeIdentifiers(transaction),
    metadata:safeTransactionMetadata(transaction),
    synced_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
  };
}

async function upsertTransactions(admin:any,transactions:any[],job:any){
  const rows=[];
  for(const transaction of transactions)rows.push(await normalizeTransaction(transaction,job));
  if(!rows.length)return 0;
  const {error}=await admin.from('amazon_finance_transactions').upsert(rows,{onConflict:'owner_id,amazon_account_id,transaction_key'});
  if(error)throw error;
  return rows.length;
}

export async function syncFinancesJob(admin:any,job:any){
  if(!job?.window_from)throw new Error('Job de finanzas incompleto.');
  const postedBefore=safePostedBefore(job.window_to);
  if(new Date(job.window_from)>=new Date(postedBefore))return 0;
  let nextToken:string|undefined;
  let processed=0;
  do{
    const query:any={
      postedAfter:job.window_from,
      postedBefore,
      ...(job.marketplace_id?{marketplaceId:job.marketplace_id}:{}),
      ...(nextToken?{nextToken}:{}),
    };
    const data:any=await spApiRequest('/finances/2024-06-19/transactions',{query});
    const payload=data?.payload||data||{};
    const transactions=Array.isArray(payload?.transactions)?payload.transactions:[];
    processed+=await upsertTransactions(admin,transactions,job);
    nextToken=payload?.nextToken||undefined;
  }while(nextToken);
  return processed;
}
