import { normalizeFinanceComponents } from '../_shared/amazon/finance-components.ts';
import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';

const DEFAULT_LIMIT=100;
const MAX_LIMIT=500;

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function boundedLimit(value:unknown){const parsed=Number(value);if(!Number.isFinite(parsed))return DEFAULT_LIMIT;return Math.max(1,Math.min(MAX_LIMIT,Math.trunc(parsed)));}

function sourceTransaction(row:any){
  const metadata=row?.metadata&&typeof row.metadata==='object'?row.metadata:{};
  return {
    transactionType:String(row?.transaction_type||'UNKNOWN'),
    totalAmount:{currencyAmount:Number(row?.amount_original)||0,currencyCode:String(row?.currency_code||'EUR')},
    breakdowns:Array.isArray(metadata?.breakdowns)?metadata.breakdowns:[],
  };
}

async function replaceComponents(admin:any,row:any){
  const components=await normalizeFinanceComponents(sourceTransaction(row),row,{owner_id:row.owner_id,amazon_account_id:row.amazon_account_id,marketplace_id:row.marketplace_id});
  const {error:deleteError}=await admin
    .from('amazon_finance_components')
    .delete()
    .eq('owner_id',row.owner_id)
    .eq('amazon_account_id',row.amazon_account_id)
    .eq('finance_transaction_id',row.id);
  if(deleteError)throw deleteError;
  if(components.length){
    const {error:upsertError}=await admin
      .from('amazon_finance_components')
      .upsert(components,{onConflict:'owner_id,amazon_account_id,finance_transaction_id,component_key'});
    if(upsertError)throw upsertError;
  }
  return components.length;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const body=await req.json().catch(()=>({}));
    const limit=boundedLimit(body?.limit);
    const cursor=typeof body?.cursor==='string'&&body.cursor.trim()?body.cursor.trim():null;

    let query=admin
      .from('amazon_finance_transactions')
      .select('id,owner_id,amazon_account_id,marketplace_id,amazon_order_id,seller_sku,asin,posted_date,transaction_key,transaction_type,amount_original,currency_code,metadata')
      .order('id',{ascending:true})
      .limit(limit+1);
    if(cursor)query=query.gt('id',cursor);
    const {data,error}=await query;
    if(error)throw error;

    const all=data||[];
    const rows=all.slice(0,limit);
    let componentCount=0;
    for(const row of rows)componentCount+=await replaceComponents(admin,row);
    const nextCursor=rows.length?String(rows[rows.length-1].id):cursor;
    return response({
      ok:true,
      processed:rows.length,
      components:componentCount,
      cursor:nextCursor,
      hasMore:all.length>limit,
      limit,
    });
  }catch(error){
    return response({error:error instanceof Error?error.message:'Error interno del backfill financiero.'},401);
  }
});
