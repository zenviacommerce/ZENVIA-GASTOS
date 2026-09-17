import { createAdminClient, requireInternalSecret } from '../_shared/amazon/supabase.ts';
import { spApiRequest } from '../_shared/amazon/sp-api.ts';
import { readAmazonSpApiCredentials } from '../_shared/amazon/config.ts';

function response(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function fromCatalog(data:any){
  const groups=Array.isArray(data?.images)?data.images:[];
  for(const group of groups){const images=Array.isArray(group?.images)?group.images:[];const main=images.find((img:any)=>String(img?.variant||'').toUpperCase()==='MAIN')||images[0];if(main?.link)return {url:String(main.link),width:Number(main.width)||null,height:Number(main.height)||null};}
  return null;
}
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
    const limit=Math.min(100,Math.max(1,Number(body?.limit)||50));
    const {data:account,error:accountError}=await admin.from('amazon_accounts').select('id,owner_id').limit(1).maybeSingle();
    if(accountError)throw accountError;if(!account)throw new Error('No hay cuenta Amazon configurada.');
    let marketplaceId=String(body?.marketplaceId||'');
    if(!marketplaceId){
      const {data:market,error:marketError}=await admin.from('amazon_marketplaces').select('marketplace_id,country_code').eq('amazon_account_id',account.id).eq('owner_id',account.owner_id).eq('active',true).order('country_code').limit(20);
      if(marketError)throw marketError;marketplaceId=String((market||[]).find((m:any)=>m.country_code==='ES')?.marketplace_id||(market||[])[0]?.marketplace_id||'');
    }
    if(!marketplaceId)throw new Error('No hay marketplace Amazon activo.');

    let products=Array.isArray(body?.products)?body.products.map((p:any)=>({asin:String(p?.asin||'').trim(),sellerSku:String(p?.sellerSku||'').trim()})).filter((p:any)=>p.asin&&p.sellerSku):[];
    if(!products.length){
      const {data:items,error:itemError}=await admin.from('amazon_order_items').select('asin,seller_sku').eq('owner_id',account.owner_id).not('asin','is',null).not('seller_sku','is',null).limit(5000);
      if(itemError)throw itemError;
      const seen=new Set<string>();products=[];
      for(const item of items||[]){const asin=String(item.asin||''),sellerSku=String(item.seller_sku||'');const key=asin+'|'+sellerSku;if(asin&&sellerSku&&!seen.has(key)){seen.add(key);products.push({asin,sellerSku});}}
    }
    products=products.slice(0,limit);

    const now=new Date().toISOString();const rows:any[]=[];const failed:any[]=[];
    for(const product of products){
      let image:any=null;let source='catalog';
      try{
        const data:any=await spApiRequest(`/catalog/2022-04-01/items/${encodeURIComponent(product.asin)}`,{query:{marketplaceIds:[marketplaceId],includedData:['images']}});
        image=fromCatalog(data);
      }catch{/* fallback below */}
      if(!image){
        source='listings';
        try{
          const data:any=await spApiRequest(`/listings/2021-08-01/items/${encodeURIComponent(credentials.sellerId)}/${encodeURIComponent(product.sellerSku)}`,{query:{marketplaceIds:[marketplaceId],includedData:['attributes','summaries']}});
          image=fromListing(data);
        }catch(error){failed.push({asin:product.asin,sellerSku:product.sellerSku,error:error instanceof Error?error.message:'Error'});continue;}
      }
      rows.push({owner_id:account.owner_id,amazon_account_id:account.id,asin:product.asin,marketplace_id:marketplaceId,image_url:image?.url||null,image_width:image?.width||null,image_height:image?.height||null,fetched_at:now,updated_at:now});
      if(!image)failed.push({asin:product.asin,sellerSku:product.sellerSku,error:`Sin imagen en ${source}`});
    }
    if(rows.length){const {error}=await admin.from('amazon_product_images').upsert(rows,{onConflict:'owner_id,amazon_account_id,asin,marketplace_id'});if(error)throw error;}
    return response({ok:true,processed:rows.length,withImage:rows.filter(r=>r.image_url).length,failed:failed.length,failures:failed.slice(0,10)});
  }catch(error){return response({error:error instanceof Error?error.message:'No se pudieron sincronizar las imágenes Amazon.'},500);}
});