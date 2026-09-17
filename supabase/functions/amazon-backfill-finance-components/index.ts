import { normalizeFinanceComponents } from '../_shared/amazon/finance-components.ts';
import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';

const DEFAULT_LIMIT=500;
const MAX_LIMIT=999;
const DEFAULT_PAGES=1;
const MAX_PAGES=5;
const BULK_WRITE_SIZE=250;

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function bounded(value:unknown,fallback:number,max:number){const parsed=Number(value);if(!Number.isFinite(parsed))return fallback;return Math.max(1,Math.min(max,Math.trunc(parsed)));}
function sourceTransaction(row:any){const metadata=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};return {transactionType:String(row?.transaction_type||'UNKNOWN'),totalAmount:{currencyAmount:Number(row?.amount_original)||0,currencyCode:String(row?.currency_code||'EUR')},breakdowns:Array.isArray(metadata?.breakdowns)?metadata.breakdowns:[]};}
async function normalizeRow(row:any){return normalizeFinanceComponents(sourceTransaction(row),row,{owner_id:row.owner_id,amazon_account_id:row.amazon_account_id,marketplace_id:row.marketplace_id});}
async function replacePage(admin:any,rows:any[]){if(!rows.length)return 0;const normalized=await Promise.all(rows.map(normalizeRow));const transactionIds=rows.map(row=>String(row.id));const components=normalized.flat();for(let offset=0;offset<transactionIds.length;offset+=BULK_WRITE_SIZE){const ids=transactionIds.slice(offset,offset+BULK_WRITE_SIZE);const {error}=await admin.from('amazon_finance_components').delete().in('finance_transaction_id',ids);if(error)throw error;}for(let offset=0;offset<components.length;offset+=BULK_WRITE_SIZE){const batch=components.slice(offset,offset+BULK_WRITE_SIZE);const {error}=await admin.from('amazon_finance_components').upsert(batch,{onConflict:'owner_id,amazon_account_id,finance_transaction_id,component_key'});if(error)throw error;}return components.length;}
async function loadPage(admin:any,cursor:string|null,limit:number){let query=admin.from('amazon_finance_transactions').select('id,owner_id,amazon_account_id,marketplace_id,amazon_order_id,seller_sku,asin,posted_date,transaction_key,transaction_type,amount_original,currency_code,metadata').order('id',{ascending:true}).limit(limit+1);if(cursor)query=query.gt('id',cursor);const {data,error}=await query;if(error)throw error;const all=data||[];return {rows:all.slice(0,limit),hasMore:all.length>limit};}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const body=await req.json().catch(()=>({}));
    const limit=bounded(body?.limit,DEFAULT_LIMIT,MAX_LIMIT);
    const pages=bounded(body?.pages,DEFAULT_PAGES,MAX_PAGES);
    let cursor=typeof body?.cursor==='string'&&body.cursor.trim()?body.cursor.trim():null;
    let processed=0;
    let componentCount=0;
    let hasMore=false;
    let pagesProcessed=0;

    for(let page=0;page<pages;page+=1){
      const loaded=await loadPage(admin,cursor,limit);
      if(!loaded.rows.length){hasMore=false;break;}
      componentCount+=await replacePage(admin,loaded.rows);
      processed+=loaded.rows.length;
      pagesProcessed+=1;
      cursor=String(loaded.rows[loaded.rows.length-1].id);
      hasMore=loaded.hasMore;
      if(!hasMore)break;
    }

    return response({ok:true,processed,components:componentCount,cursor,hasMore,limit,pagesProcessed});
  }catch(error){
    return response({error:error instanceof Error?error.message:'Error interno del backfill financiero.'},401);
  }
});
