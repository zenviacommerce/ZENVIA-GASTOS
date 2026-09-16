-- Preserve the current consumption factor when editing an existing Amazon SKU mapping.
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
    select seller_sku,asin,product_id,max(product_name) product_name,max(consumption_factor) consumption_factor,
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
    select ig.*,coalesce(fg.fee_effect,0) fee_effect,coalesce(fg.refund_effect,0) refund_effect,coalesce(fg.missing_fx,0) missing_fx,count(*) over() total_rows
    from item_group ig left join finance_group fg on fg.seller_sku=ig.seller_sku and (fg.asin=ig.asin or fg.asin is null or ig.asin is null)
  ), paged as (select * from combined order by net_sales desc nulls last,seller_sku offset (page-1)*page_size limit page_size),
  sync_bad as (select exists(select 1 from public.amazon_sync_jobs j where j.owner_id=v_owner and j.status in ('queued','running','failed')) value)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
      'sellerSku',seller_sku,'asin',asin,'productId',product_id,'productName',product_name,'consumptionFactor',coalesce(consumption_factor,1),'units',units,
      'netSales',round(net_sales,2),'amazonFees',round(-fee_effect,2),'refunds',round(-refund_effect,2),'productCost',round(product_cost,2),
      'profitBeforeAds',round(net_sales+fee_effect+refund_effect-product_cost,2),
      'marginPct',case when net_sales<>0 then round((net_sales+fee_effect+refund_effect-product_cost)/net_sales*100,2) end,
      'profitComplete',(item_complete and missing_fx=0 and not sb.value)
    ) order by net_sales desc),'[]'::jsonb),'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0))
  into v_result from paged cross join sync_bad sb;
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;$$;

revoke all on function public.amazon_analytics_products(date,date,text[],text,integer,integer) from public,anon;
grant execute on function public.amazon_analytics_products(date,date,text[],text,integer,integer) to authenticated;
