import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { spApiRequest } from '../_shared/amazon/sp-api.ts';
import { readAmazonSpApiCredentials } from '../_shared/amazon/config.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function fromListing(data:any){
  const attrs=data?.attributes||{};
  const preferred=['main_product_image_locator','main_image','image_url'];
  const keys=[...preferred,...Object.keys(attrs).filter(k=>/image/i.test(k)&&!preferred.includes(k))];
  for(const key of keys){
    const values=Array.isArray(attrs?.[key])?attrs[key]:attrs?.[key]?[attrs[key]]:[];
    for(const value of values){
      const url=value?.media_location||value?.url||value?.link||value?.value;
      if(typeof url==='string'&&/^https?:\/\//i.test(url))return {url,width:null,height:null};
    }
  }
  return null;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({error:'Método no permitido.'},405);
  try{
    requireInternalSecret(req);
    const admin=createAdminClient();
    const credentials=readAmazonSpApiCredentials();
    const body=await req.json().catch(()=>({}));
    const limit=Math.min(30,Math.max(1,Number(body?.limit)||10));
    const {data:account,error:accountError}=await admin.from('amazon_accounts').select('id,owner_id').limit(1).maybeSingle();
    if(accountError)throw accountError;if(!account)throw new Error('No hay cuenta Amazon configurada.');

    const {data:markets,error:marketError}=await admin.from('amazon_marketplaces').select('marketplace_id,country_code').eq('amazon_account_id',account.id).eq('owner_id',account.owner_id).eq('active',true).order('country_code');
    if(marketError)throw marketError;
    const activeMarketplaceIds=(markets||[]).map((m:any)=>String(m.marketplace_id||'')).filter(Boolean);
    const esMarketplaceId=String((markets||[]).find((m:any)=>m.country_code==='ES')?.marketplace_id||'');
    const {data:cached,error:cacheError}=await admin.from('amazon_product_images').select('asin').eq('owner_id',account.owner_id).eq('amazon_account_id',account.id);
    if(cacheError)throw cacheError;
    const cachedAsins=new Set((cached||[]).map((row:any)=>String(row.asin||'')));

    let products=Array.isArray(body?.products)?body.products.map((p:any)=>({
      asin:String(p?.asin||'').trim(),sellerSku:String(p?.sellerSku||'').trim(),marketplaceId:String(p?.marketplaceId||'').trim()
    })).filter((p:any)=>p.asin&&p.sellerSku&&p.marketplaceId):[];

    if(!products.length){
      const seen=new Set<string>();
      products=[];
      for(let offset=0;offset<20000&&products.length<limit;offset+=1000){
        const {data:items,error:itemError}=await admin.from('amazon_order_items')
          .select('asin,seller_sku,marketplace_id')
          .eq('owner_id',account.owner_id)
          .not('asin','is',null).not('seller_sku','is',null)
          .range(offset,offset+999);
        if(itemError)throw itemError;
        if(!(items||[]).length)break;
        for(const item of items||[]){
          const asin=String(item.asin||''),sellerSku=String(item.seller_sku||''),marketplaceId=String(item.marketplace_id||'');
          if(!asin||!sellerSku||!marketplaceId||cachedAsins.has(asin)||seen.has(asin))continue;
          seen.add(asin);products.push({asin,sellerSku,marketplaceId});
          if(products.length>=limit)break;
        }
        if((items||[]).length<1000)break;
      }
    }
    products=products.slice(0,limit);

    const now=new Date().toISOString();const rows:any[]=[];const failed:any[]=[];
    for(const product of products){
      const marketplaceCandidates=Array.from(new Set([product.marketplaceId,esMarketplaceId,...activeMarketplaceIds].filter(Boolean)));
      let image:any=null;let usedMarketplace='';let lastError='';
      for(const marketplaceId of marketplaceCandidates){
        try{
          const data:any=await spApiRequest(`/listings/2021-08-01/items/${encodeURIComponent(credentials.sellerId)}/${encodeURIComponent(product.sellerSku)}`,{
            query:{marketplaceIds:[marketplaceId],includedData:['attributes','summaries']}
          });
          image=fromListing(data);usedMarketplace=marketplaceId;
          if(image)break;
        }catch(error){lastError=error instanceof Error?error.message:'Error';}
      }
      if(image){
        rows.push({
          owner_id:account.owner_id,amazon_account_id:account.id,asin:product.asin,marketplace_id:usedMarketplace||product.marketplaceId,
          image_url:image.url,image_width:null,image_height:null,fetched_at:now,updated_at:now
        });
      }else{
        failed.push({asin:product.asin,sellerSku:product.sellerSku,error:lastError||'Listing sin imagen principal'});
      }
    }
    if(rows.length){const {error}=await admin.from('amazon_product_images').upsert(rows,{onConflict:'owner_id,amazon_account_id,asin,marketplace_id'});if(error)throw error;}
    return response({ok:true,processed:rows.length,withImage:rows.filter(r=>r.image_url).length,failed:failed.length,failures:failed.slice(0,10)});
  }catch(error){return response({error:error instanceof Error?error.message:'No se pudieron sincronizar las imágenes Amazon.'},500);}
});