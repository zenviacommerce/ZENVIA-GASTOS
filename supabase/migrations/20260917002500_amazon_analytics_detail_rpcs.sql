-- Amazon Analytics detail RPCs and SKU mapping workflow.

create or replace function private.amazon_auto_map_order_item()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_product uuid;
  v_matches integer;
begin
  if nullif(trim(new.seller_sku),'') is null then return new; end if;
  select min(p.id::text)::uuid,count(*)::integer
    into v_product,v_matches
  from public.products p
  where p.owner_id=new.owner_id
    and p.sku=new.seller_sku
    and coalesce(p.active,true);
  if v_matches=1 then
    insert into public.amazon_product_mappings(
      owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at
    ) values(new.owner_id,new.amazon_account_id,new.seller_sku,v_product,1,'automatic',now(),now())
    on conflict(owner_id,amazon_account_id,seller_sku) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.amazon_auto_map_order_item() from public,anon,authenticated;
drop trigger if exists amazon_order_items_auto_map on public.amazon_order_items;
create trigger amazon_order_items_auto_map
after insert or update of seller_sku on public.amazon_order_items
for each row execute function private.amazon_auto_map_order_item();

with unique_products as (
  select p.owner_id,p.sku,min(p.id::text)::uuid as product_id
  from public.products p
  where nullif(trim(p.sku),'') is not null and coalesce(p.active,true)
  group by p.owner_id,p.sku
  having count(*)=1
), seen as (
  select distinct i.owner_id,i.amazon_account_id,i.seller_sku
  from public.amazon_order_items i
  where nullif(trim(i.seller_sku),'') is not null
)
insert into public.amazon_product_mappings(
  owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at
)
select s.owner_id,s.amazon_account_id,s.seller_sku,p.product_id,1,'automatic',now(),now()
from seen s
join unique_products p on p.owner_id=s.owner_id and p.sku=s.seller_sku
on conflict(owner_id,amazon_account_id,seller_sku) do nothing;

create or replace function public.amazon_analytics_products(
  from_date date,to_date date,marketplace_ids text[] default null,
  search text default null,page integer default 1,page_size integer default 25
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  with eligible_orders as (
    select o.*,private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) order_fx
    from public.amazon_orders o where o.owner_id=v_owner
      and o.purchase_date::date between from_date and to_date
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ), item_facts as (
    select i.seller_sku,i.asin,i.quantity_ordered,i.item_price,eo.order_fx,eo.purchase_date::date purchase_date,
           m.product_id,m.consumption_factor,p.name product_name,
           h.normalized_unit_price,h.currency historical_currency,h.price_date historical_price_date,
           case when h.price_date is not null then private.amazon_rate_to_eur(h.currency,h.price_date) end cost_fx
    from public.amazon_order_items i
    join eligible_orders eo on eo.owner_id=i.owner_id and eo.amazon_account_id=i.amazon_account_id and eo.marketplace_id=i.marketplace_id and eo.amazon_order_id=i.amazon_order_id
    left join public.amazon_product_mappings m on m.owner_id=i.owner_id and m.amazon_account_id=i.amazon_account_id and m.seller_sku=i.seller_sku
    left join public.products p on p.id=m.product_id and p.owner_id=i.owner_id
    left join lateral (
      select ph.normalized_unit_price,ph.currency,ph.price_date
      from public.product_price_history ph
      where ph.owner_id=i.owner_id and ph.product_id=m.product_id and ph.normalized_unit_price is not null and ph.price_date<=eo.purchase_date::date
      order by ph.price_date desc,ph.created_at desc,ph.id desc limit 1
    ) h on true
    where coalesce(search,'')='' or i.seller_sku ilike '%'||search||'%' or i.asin ilike '%'||search||'%' or p.name ilike '%'||search||'%'
  ), item_group as (
    select seller_sku,asin,product_id,max(product_name) product_name,
      sum(quantity_ordered)::bigint units,
      coalesce(sum(case when item_price is not null and order_fx is not null then item_price*order_fx else 0 end),0)::numeric net_sales,
      coalesce(sum(case when product_id is not null and normalized_unit_price is not null and cost_fx is not null then quantity_ordered*consumption_factor*normalized_unit_price*cost_fx else 0 end),0)::numeric product_cost,
      bool_and(product_id is not null and normalized_unit_price is not null and (upper(coalesce(historical_currency,'EUR'))='EUR' or cost_fx is not null) and (item_price is null or order_fx is not null)) item_complete
    from item_facts group by seller_sku,asin,product_id
  ), finance_group as (
    select c.seller_sku,c.asin,
      coalesce(sum(c.amount_original*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date)) filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee','adjustment')),0)::numeric fee_effect,
      coalesce(sum(c.amount_original*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date)) filter(where c.component_category='refund'),0)::numeric refund_effect,
      count(*) filter(where c.amount_original<>0 and private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) is null)::bigint missing_fx
    from public.amazon_finance_components c
    where c.owner_id=v_owner and c.posted_date::date between from_date and to_date
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
    group by c.seller_sku,c.asin
  ), combined as (
    select ig.*,coalesce(fg.fee_effect,0) fee_effect,coalesce(fg.refund_effect,0) refund_effect,coalesce(fg.missing_fx,0) missing_fx,
      count(*) over() total_rows
    from item_group ig left join finance_group fg on fg.seller_sku=ig.seller_sku and (fg.asin=ig.asin or fg.asin is null or ig.asin is null)
  ), paged as (
    select * from combined order by net_sales desc nulls last,seller_sku offset (page-1)*page_size limit page_size
  ), sync_bad as (
    select exists(select 1 from public.amazon_sync_jobs j where j.owner_id=v_owner and j.status in ('queued','running','failed')) value
  )
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
      'sellerSku',seller_sku,'asin',asin,'productId',product_id,'productName',product_name,'units',units,
      'netSales',round(net_sales,2),'amazonFees',round(-fee_effect,2),'refunds',round(-refund_effect,2),'productCost',round(product_cost,2),
      'profitBeforeAds',round(net_sales+fee_effect+refund_effect-product_cost,2),
      'marginPct',case when net_sales<>0 then round((net_sales+fee_effect+refund_effect-product_cost)/net_sales*100,2) end,
      'profitComplete',(item_complete and missing_fx=0 and not sb.value)
    ) order by net_sales desc),'[]'::jsonb),'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0))
  into v_result from paged cross join sync_bad sb;
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;$$;

create or replace function public.amazon_analytics_marketplaces(
  from_date date,to_date date,marketplace_ids text[] default null
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  with markets as (
    select m.marketplace_id,m.country_code,m.name,
      public.amazon_analytics_summary(from_date,to_date,array[m.marketplace_id]) summary
    from public.amazon_marketplaces m
    where m.owner_id=v_owner and m.active
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or m.marketplace_id=any(marketplace_ids))
  )
  select coalesce(jsonb_build_object('items',jsonb_agg(jsonb_build_object(
    'marketplaceId',marketplace_id,'countryCode',country_code,'name',name,
    'orders',summary->'orders','units',summary->'units','netSales',summary->'netSales','amazonFees',summary->'amazonFees',
    'refunds',summary->'refunds','productCost',summary->'productCost','profitBeforeAds',summary->'profitBeforeAds',
    'marginPct',summary->'marginPct','profitComplete',summary->'profitComplete'
  ) order by country_code)),jsonb_build_object('items','[]'::jsonb)) into v_result from markets;
  return v_result;
end;$$;

create or replace function public.amazon_analytics_orders(
  from_date date,to_date date,marketplace_ids text[] default null,
  search text default null,page integer default 1,page_size integer default 25
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  with orders as (
    select o.*,private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) order_fx
    from public.amazon_orders o where o.owner_id=v_owner and o.purchase_date::date between from_date and to_date
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
      and (coalesce(search,'')='' or o.amazon_order_id ilike '%'||search||'%')
  ), items as (
    select i.amazon_order_id,i.marketplace_id,sum(i.quantity_ordered)::bigint units,
      coalesce(sum(case when m.product_id is not null then i.quantity_ordered*m.consumption_factor*private.amazon_historical_unit_cost_eur(i.owner_id,m.product_id,o.purchase_date::date) else 0 end),0)::numeric product_cost,
      bool_and(m.product_id is not null and private.amazon_historical_unit_cost_eur(i.owner_id,m.product_id,o.purchase_date::date) is not null) item_complete
    from public.amazon_order_items i join orders o on o.owner_id=i.owner_id and o.amazon_account_id=i.amazon_account_id and o.marketplace_id=i.marketplace_id and o.amazon_order_id=i.amazon_order_id
    left join public.amazon_product_mappings m on m.owner_id=i.owner_id and m.amazon_account_id=i.amazon_account_id and m.seller_sku=i.seller_sku
    group by i.amazon_order_id,i.marketplace_id
  ), finance as (
    select c.amazon_order_id,c.marketplace_id,
      coalesce(sum(c.amount_original*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date)) filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee','adjustment')),0)::numeric fee_effect,
      coalesce(sum(c.amount_original*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date)) filter(where c.component_category='refund'),0)::numeric refund_effect,
      count(*) filter(where c.amount_original<>0 and private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) is null)::bigint missing_fx
    from public.amazon_finance_components c join orders o on o.amazon_order_id=c.amazon_order_id and o.marketplace_id=c.marketplace_id
    where c.owner_id=v_owner and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
    group by c.amazon_order_id,c.marketplace_id
  ), combined as (
    select o.amazon_order_id,o.purchase_date,o.marketplace_id,o.order_status,
      coalesce(i.units,0) units,
      case when o.order_total is not null and o.vat_amount is not null and o.order_fx is not null then (o.order_total-o.vat_amount)*o.order_fx else 0 end::numeric net_sales,
      coalesce(f.fee_effect,0) fee_effect,coalesce(f.refund_effect,0) refund_effect,coalesce(i.product_cost,0) product_cost,
      (o.order_total is not null and o.vat_amount is not null and o.order_fx is not null and coalesce(i.item_complete,false) and coalesce(f.missing_fx,0)=0) row_complete,
      count(*) over() total_rows
    from orders o left join items i on i.amazon_order_id=o.amazon_order_id and i.marketplace_id=o.marketplace_id
    left join finance f on f.amazon_order_id=o.amazon_order_id and f.marketplace_id=o.marketplace_id
  ), paged as (select * from combined order by purchase_date desc offset (page-1)*page_size limit page_size),
  sync_bad as (select exists(select 1 from public.amazon_sync_jobs j where j.owner_id=v_owner and j.status in ('queued','running','failed')) value)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'amazonOrderId',amazon_order_id,'purchaseDate',purchase_date,'marketplaceId',marketplace_id,'status',order_status,'units',units,
    'netSales',round(net_sales,2),'amazonFees',round(-fee_effect,2),'refunds',round(-refund_effect,2),'productCost',round(product_cost,2),
    'profitBeforeAds',round(net_sales+fee_effect+refund_effect-product_cost,2),'profitComplete',(row_complete and not sb.value)
  ) order by purchase_date desc),'[]'::jsonb),'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)) into v_result from paged cross join sync_bad sb;
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;$$;

create or replace function public.amazon_analytics_inventory(
  marketplace_ids text[] default null,search text default null,page integer default 1,page_size integer default 25
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  with rows as (
    select i.*,count(*) over() total_rows from public.amazon_inventory_current i
    where i.owner_id=v_owner
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or i.marketplace_id=any(marketplace_ids))
      and (coalesce(search,'')='' or i.seller_sku ilike '%'||search||'%' or i.asin ilike '%'||search||'%')
    order by i.total_quantity desc,i.seller_sku offset (page-1)*page_size limit page_size
  ) select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
      'sellerSku',seller_sku,'asin',asin,'marketplaceId',marketplace_id,'fulfillable',fulfillable_quantity,'reserved',reserved_quantity,
      'inbound',inbound_working_quantity+inbound_shipped_quantity+inbound_receiving_quantity,'unfulfillable',unfulfillable_quantity,
      'researching',researching_quantity,'total',total_quantity,'lastSync',synced_at
    ) order by total_quantity desc),'[]'::jsonb),'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)) into v_result from rows;
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;$$;

create or replace function public.amazon_analytics_unmapped_skus(
  search text default null,page integer default 1,page_size integer default 25
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  with grouped as (
    select i.seller_sku,max(i.asin) asin,array_agg(distinct i.marketplace_id order by i.marketplace_id) marketplace_ids,
      count(distinct i.amazon_order_id)::bigint orders,sum(i.quantity_ordered)::bigint units,
      coalesce(sum(case when o.purchase_date::date>=current_date-29 and i.item_price is not null then i.item_price*private.amazon_rate_to_eur(i.currency_code,o.purchase_date::date) else 0 end),0)::numeric recent_net_sales
    from public.amazon_order_items i
    join public.amazon_orders o on o.owner_id=i.owner_id and o.amazon_account_id=i.amazon_account_id and o.marketplace_id=i.marketplace_id and o.amazon_order_id=i.amazon_order_id
    left join public.amazon_product_mappings m on m.owner_id=i.owner_id and m.amazon_account_id=i.amazon_account_id and m.seller_sku=i.seller_sku
    where i.owner_id=v_owner and m.id is null and nullif(trim(i.seller_sku),'') is not null
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (coalesce(search,'')='' or i.seller_sku ilike '%'||search||'%' or i.asin ilike '%'||search||'%')
    group by i.seller_sku
  ), rows as (select *,count(*) over() total_rows from grouped order by units desc,seller_sku offset (page-1)*page_size limit page_size)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'sellerSku',seller_sku,'asin',asin,'marketplaceIds',marketplace_ids,'orders',orders,'units',units,'recentNetSales',round(recent_net_sales,2)
  ) order by units desc),'[]'::jsonb),'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)) into v_result from rows;
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;$$;

create or replace function public.amazon_set_product_mapping(
  seller_sku text,product_id uuid,consumption_factor numeric default 1
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_owner uuid; v_product uuid; v_account uuid; v_mapping uuid;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if coalesce(trim(seller_sku),'')='' then raise exception 'seller_sku is required'; end if;
  if consumption_factor is null or consumption_factor <= 0 then raise exception 'consumption_factor must be greater than zero'; end if;
  select p.id into v_product from public.products p where p.id=product_id and p.owner_id=v_owner;
  if v_product is null then raise exception 'Product not found in workspace'; end if;
  select a.id into v_account from public.amazon_accounts a where a.owner_id=v_owner and a.status='connected' order by a.created_at limit 1;
  if v_account is null then raise exception 'Amazon account not connected'; end if;
  insert into public.amazon_product_mappings(owner_id,amazon_account_id,seller_sku,product_id,consumption_factor,mapping_source,created_at,updated_at)
  values(v_owner,v_account,trim(seller_sku),v_product,consumption_factor,'manual',now(),now())
  on conflict(owner_id,amazon_account_id,seller_sku) do update
    set product_id=excluded.product_id,consumption_factor=excluded.consumption_factor,mapping_source='manual',updated_at=now()
  returning id into v_mapping;
  return jsonb_build_object('ok',true,'id',v_mapping,'sellerSku',trim(seller_sku),'productId',v_product,'consumptionFactor',consumption_factor);
end;$$;

create or replace function public.amazon_delete_product_mapping(seller_sku text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_owner uuid; v_count integer;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if coalesce(trim(seller_sku),'')='' then raise exception 'seller_sku is required'; end if;
  delete from public.amazon_product_mappings m using public.amazon_accounts a
  where m.amazon_account_id=a.id and m.owner_id=v_owner and a.owner_id=v_owner and a.status='connected' and m.seller_sku=trim(seller_sku);
  get diagnostics v_count=row_count;
  return jsonb_build_object('ok',true,'deleted',v_count);
end;$$;

revoke all on function public.amazon_analytics_products(date,date,text[],text,integer,integer) from public,anon;
revoke all on function public.amazon_analytics_marketplaces(date,date,text[]) from public,anon;
revoke all on function public.amazon_analytics_orders(date,date,text[],text,integer,integer) from public,anon;
revoke all on function public.amazon_analytics_inventory(text[],text,integer,integer) from public,anon;
revoke all on function public.amazon_analytics_unmapped_skus(text,integer,integer) from public,anon;
revoke all on function public.amazon_set_product_mapping(text,uuid,numeric) from public,anon;
revoke all on function public.amazon_delete_product_mapping(text) from public,anon;
grant execute on function public.amazon_analytics_products(date,date,text[],text,integer,integer) to authenticated;
grant execute on function public.amazon_analytics_marketplaces(date,date,text[]) to authenticated;
grant execute on function public.amazon_analytics_orders(date,date,text[],text,integer,integer) to authenticated;
grant execute on function public.amazon_analytics_inventory(text[],text,integer,integer) to authenticated;
grant execute on function public.amazon_analytics_unmapped_skus(text,integer,integer) to authenticated;
grant execute on function public.amazon_set_product_mapping(text,uuid,numeric) to authenticated;
grant execute on function public.amazon_delete_product_mapping(text) to authenticated;
