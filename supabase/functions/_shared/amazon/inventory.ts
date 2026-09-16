import { spApiRequest } from './sp-api.ts';

function quantity(value:unknown){const parsed=Number(value);return Number.isFinite(parsed)?Math.max(0,Math.trunc(parsed)):0;}

export function normalizeInventorySummary(summary:any,job:any){
  const details=summary?.inventoryDetails||{};
  return {
    owner_id:job.owner_id,
    amazon_account_id:job.amazon_account_id,
    marketplace_id:String(job.marketplace_id||''),
    seller_sku:String(summary?.sellerSku||''),
    asin:summary?.asin?String(summary.asin):null,
    fulfillable_quantity:quantity(details?.fulfillableQuantity),
    inbound_working_quantity:quantity(details?.inboundWorkingQuantity),
    inbound_shipped_quantity:quantity(details?.inboundShippedQuantity),
    inbound_receiving_quantity:quantity(details?.inboundReceivingQuantity),
    reserved_quantity:quantity(details?.reservedQuantity?.totalReservedQuantity),
    unfulfillable_quantity:quantity(details?.unfulfillableQuantity?.totalUnfulfillableQuantity),
    researching_quantity:quantity(details?.researchingQuantity?.totalResearchingQuantity),
    total_quantity:quantity(summary?.totalQuantity),
    synced_at:new Date().toISOString(),
    updated_at:new Date().toISOString(),
  };
}

function dailySnapshot(row:any,date:string){
  return {
    owner_id:row.owner_id,
    amazon_account_id:row.amazon_account_id,
    marketplace_id:row.marketplace_id,
    seller_sku:row.seller_sku,
    asin:row.asin,
    snapshot_date:date,
    fulfillable_quantity:row.fulfillable_quantity,
    inbound_quantity:row.inbound_working_quantity+row.inbound_shipped_quantity+row.inbound_receiving_quantity,
    reserved_quantity:row.reserved_quantity,
    unfulfillable_quantity:row.unfulfillable_quantity,
    researching_quantity:row.researching_quantity,
    total_quantity:row.total_quantity,
    synced_at:row.synced_at,
    updated_at:row.updated_at,
  };
}

async function persistInventoryPage(admin:any,summaries:any[],job:any){
  const currentRows=summaries
    .filter(summary=>String(summary?.sellerSku||'').trim())
    .map(summary=>normalizeInventorySummary(summary,job));
  if(!currentRows.length)return 0;
  const {error:currentError}=await admin.from('amazon_inventory_current').upsert(currentRows,{onConflict:'owner_id,amazon_account_id,marketplace_id,seller_sku'});
  if(currentError)throw currentError;
  const snapshotDate=new Date().toISOString().slice(0,10);
  const dailyRows=currentRows.map(row=>dailySnapshot(row,snapshotDate));
  const {error:dailyError}=await admin.from('amazon_inventory_daily').upsert(dailyRows,{onConflict:'owner_id,amazon_account_id,marketplace_id,seller_sku,snapshot_date'});
  if(dailyError)throw dailyError;
  return currentRows.length;
}

export async function syncInventoryJob(admin:any,job:any){
  if(!job?.marketplace_id)throw new Error('Job de inventario incompleto.');
  let nextToken:string|undefined;
  let processed=0;
  do{
    const query:any={
      details:true,
      granularityType:'Marketplace',
      granularityId:job.marketplace_id,
      marketplaceIds:[job.marketplace_id],
      ...(nextToken?{nextToken}:{}),
    };
    const data:any=await spApiRequest('/fba/inventory/v1/summaries',{query});
    const summaries=Array.isArray(data?.payload?.inventorySummaries)?data.payload.inventorySummaries:[];
    processed+=await persistInventoryPage(admin,summaries,job);
    nextToken=data?.pagination?.nextToken||undefined;
  }while(nextToken);
  return processed;
}
