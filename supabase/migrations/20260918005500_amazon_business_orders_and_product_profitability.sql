-- Distinguish Amazon Business orders from orders whose VAT is genuinely missing,
-- and keep product profitability on the same net-of-VAT basis as the dashboard.

alter table public.amazon_orders
  add column if not exists programs text[] not null default '{}'::text[],
  add column if not exists is_business_order boolean not null default false;

create index if not exists amazon_orders_business_period_idx
  on public.amazon_orders(owner_id, purchase_date, is_business_order);

create or replace function public.amazon_analytics_summary_without_fbm_20260917(
  from_date date,
  to_date date,
  marketplace_ids text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date < from_date then raise exception 'Invalid analytics date range'; end if;

  with tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,
           sum(c.amount_original) as tax_amount
    from public.amazon_finance_components c
    where c.owner_id=v_owner
      and c.component_category='tax_audit'
      and c.amazon_order_id is not null
    group by c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id
  ),
  eligible_orders as (
    select o.*,
           coalesce(
             o.vat_amount,
             ta.tax_amount,
             case when coalesce(o.is_business_order,false) then 0::numeric end
           ) as effective_vat_amount,
           private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) as order_fx
    from public.amazon_orders o
    left join tax_audit_by_order ta
      on ta.owner_id=o.owner_id
     and ta.amazon_account_id=o.amazon_account_id
     and ta.marketplace_id=o.marketplace_id
     and ta.amazon_order_id=o.amazon_order_id
    where o.owner_id=v_owner
      and o.purchase_date::date between from_date and to_date
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  order_metrics as (
    select
      count(distinct amazon_order_id)::bigint as orders,
      count(distinct amazon_order_id) filter(where coalesce(is_business_order,false))::bigint as business_orders,
      coalesce(sum(case when order_total is not null and order_fx is not null then order_total*order_fx else 0 end),0)::numeric as gross_sales,
      coalesce(sum(case when effective_vat_amount is not null and order_fx is not null then effective_vat_amount*order_fx else 0 end),0)::numeric as sales_vat,
      coalesce(sum(case when order_total is not null and order_fx is not null then (order_total-coalesce(effective_vat_amount,0))*order_fx else 0 end),0)::numeric as net_sales,
      count(*) filter(where order_total is not null and effective_vat_amount is null)::bigint as missing_vat_orders,
      count(*) filter(where order_total is not null and order_fx is null)::bigint as missing_order_fx
    from eligible_orders
  ),
  item_rows as (
    select i.amazon_order_id,i.marketplace_id,i.seller_sku,i.asin,i.quantity_ordered,eo.purchase_date::date as purchase_date,
      m.product_id,m.consumption_factor,hist.normalized_unit_price as historical_unit_cost,hist.currency as historical_currency,hist.price_date as historical_price_date,
      case when hist.price_date is not null then private.amazon_rate_to_eur(hist.currency,hist.price_date) else null end as historical_cost_fx
    from public.amazon_order_items i
    join eligible_orders eo on eo.owner_id=i.owner_id and eo.amazon_account_id=i.amazon_account_id and eo.marketplace_id=i.marketplace_id and eo.amazon_order_id=i.amazon_order_id
    left join public.amazon_product_mappings m on m.owner_id=i.owner_id and m.amazon_account_id=i.amazon_account_id and m.seller_sku=i.seller_sku
    left join lateral (
      select h.normalized_unit_price,h.currency,h.price_date
      from public.product_price_history h
      where h.owner_id=i.owner_id and h.product_id=m.product_id and h.normalized_unit_price is not null and h.price_date <= eo.purchase_date::date
      order by h.price_date desc,h.created_at desc,h.id desc limit 1
    ) hist on true
  ),
  item_metrics as (
    select coalesce(sum(quantity_ordered),0)::bigint as units,
      coalesce(sum(case when product_id is not null and historical_unit_cost is not null and historical_cost_fx is not null then quantity_ordered*consumption_factor*historical_unit_cost*historical_cost_fx else 0 end),0)::numeric as product_cost,
      count(distinct seller_sku) filter(where seller_sku is not null and product_id is null)::bigint as unmapped_skus,
      coalesce(sum(quantity_ordered) filter(where product_id is null),0)::bigint as unmapped_units,
      count(distinct seller_sku) filter(where product_id is not null and historical_unit_cost is null)::bigint as missing_historical_cost,
      coalesce(sum(quantity_ordered) filter(where product_id is not null and historical_unit_cost is null),0)::bigint as missing_historical_cost_units,
      count(*) filter(where product_id is not null and historical_unit_cost is not null and historical_cost_fx is null)::bigint as missing_cost_fx
    from item_rows
  ),
  finance_rows as (
    select c.component_category,c.amount_original,c.tax_amount_original,
           private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) as finance_fx
    from public.amazon_finance_components c
    where c.owner_id=v_owner
      and c.posted_date::date between from_date and to_date
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit')
  ),
  finance_metrics as (
    select
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee') and finance_fx is not null),0)::numeric as amazon_fee_effect,
      coalesce(sum(coalesce(tax_amount_original,0)*finance_fx) filter(where component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee') and finance_fx is not null),0)::numeric as amazon_fee_vat_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='ads_payment_excluded' and finance_fx is not null),0)::numeric as ads_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='adjustment' and finance_fx is not null),0)::numeric as adjustment_effect,
      count(*) filter(where amount_original<>0 and finance_fx is null)::bigint as missing_finance_fx
    from finance_rows
  ),
  sync_metrics as (
    select count(*) filter(where j.status='queued')::bigint as sync_queued,
      count(*) filter(where j.status='running')::bigint as sync_running,
      count(*) filter(where j.status='failed')::bigint as sync_failed
    from public.amazon_sync_jobs j where j.owner_id=v_owner
  ),
  combined as (
    select om.orders,om.business_orders,im.units,om.gross_sales,om.sales_vat,om.net_sales,
      -fm.amazon_fee_effect as amazon_fees,
      -fm.amazon_fee_vat_effect as amazon_fee_vat,
      -fm.refund_effect as refunds,
      -fm.ads_effect as ads_cost,
      fm.adjustment_effect as amazon_adjustments,
      im.product_cost,
      0::numeric as fbm_shipping_cost,
      (om.net_sales+fm.amazon_fee_effect+fm.refund_effect+fm.ads_effect+fm.adjustment_effect-im.product_cost) as net_profit,
      im.unmapped_skus,im.unmapped_units,im.missing_historical_cost,im.missing_historical_cost_units,
      (om.missing_order_fx+fm.missing_finance_fx+im.missing_cost_fx)::bigint as missing_fx_events,om.missing_vat_orders,
      sm.sync_queued,sm.sync_running,sm.sync_failed
    from order_metrics om cross join item_metrics im cross join finance_metrics fm cross join sync_metrics sm
  )
  select jsonb_build_object(
    'grossSales',round(gross_sales,2),'salesVat',round(sales_vat,2),'netSales',round(net_sales,2),
    'orders',orders,'businessOrders',business_orders,'units',units,'amazonFees',round(amazon_fees,2),'amazonFeeVat',round(amazon_fee_vat,2),
    'refunds',round(refunds,2),'adsCost',round(ads_cost,2),'amazonAdjustments',round(amazon_adjustments,2),
    'productCost',round(product_cost,2),'fbmShippingCost',round(fbm_shipping_cost,2),'netProfit',round(net_profit,2),
    'marginPct',case when net_sales<>0 then round(net_profit/net_sales*100,2) else null end,
    'unmappedSkuCount',unmapped_skus,'unmappedUnits',unmapped_units,'missingHistoricalCostCount',missing_historical_cost,'missingHistoricalCostUnits',missing_historical_cost_units,
    'missingFxEventCount',missing_fx_events,'missingVatOrderCount',missing_vat_orders,'syncQueued',sync_queued,'syncRunning',sync_running,'syncFailed',sync_failed,
    'adsExcluded',false,
    'profitComplete',(unmapped_skus=0 and missing_historical_cost=0 and missing_fx_events=0 and missing_vat_orders=0 and sync_queued=0 and sync_running=0 and sync_failed=0)
  ) into v_result from combined;

  return coalesce(v_result,jsonb_build_object(
    'grossSales',0,'salesVat',0,'netSales',0,'orders',0,'businessOrders',0,'units',0,'amazonFees',0,'amazonFeeVat',0,'refunds',0,'adsCost',0,'amazonAdjustments',0,
    'productCost',0,'fbmShippingCost',0,'netProfit',0,'marginPct',null,'unmappedSkuCount',0,'unmappedUnits',0,'missingHistoricalCostCount',0,
    'missingHistoricalCostUnits',0,'missingFxEventCount',0,'missingVatOrderCount',0,'syncQueued',0,'syncRunning',0,'syncFailed',0,'adsExcluded',false,'profitComplete',true
  ));
end;
$$;

create or replace function public.amazon_analytics_series_without_fbm_20260917(
  from_date date,
  to_date date,
  marketplace_ids text[] default null,
  grain text default 'day'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date < from_date then raise exception 'Invalid analytics date range'; end if;
  if grain not in ('day','month') then raise exception 'Invalid analytics grain'; end if;

  with buckets as (
    select bucket_start::date from generate_series(
      case when grain='month' then date_trunc('month',from_date::timestamp)::date else from_date end,
      to_date,
      case when grain='month' then interval '1 month' else interval '1 day' end
    ) bucket_start
  ),
  tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,sum(c.amount_original) as tax_amount
    from public.amazon_finance_components c
    where c.owner_id=v_owner and c.component_category='tax_audit' and c.amazon_order_id is not null
    group by c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id
  ),
  eligible_orders as (
    select o.owner_id,o.amazon_account_id,o.marketplace_id,o.amazon_order_id,o.purchase_date,o.order_total,o.is_business_order,
      coalesce(o.vat_amount,ta.tax_amount,case when coalesce(o.is_business_order,false) then 0::numeric end) as effective_vat_amount,
      private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) as order_fx,
      case when grain='month' then date_trunc('month',o.purchase_date)::date else o.purchase_date::date end as bucket_start
    from public.amazon_orders o
    left join tax_audit_by_order ta on ta.owner_id=o.owner_id and ta.amazon_account_id=o.amazon_account_id and ta.marketplace_id=o.marketplace_id and ta.amazon_order_id=o.amazon_order_id
    where o.owner_id=v_owner and o.purchase_date::date between from_date and to_date
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  order_metrics as (
    select bucket_start,count(distinct amazon_order_id)::bigint as orders,
      coalesce(sum(case when order_total is not null and order_fx is not null then order_total*order_fx else 0 end),0)::numeric as gross_sales,
      coalesce(sum(case when effective_vat_amount is not null and order_fx is not null then effective_vat_amount*order_fx else 0 end),0)::numeric as sales_vat,
      coalesce(sum(case when order_total is not null and order_fx is not null then (order_total-coalesce(effective_vat_amount,0))*order_fx else 0 end),0)::numeric as net_sales,
      count(*) filter(where order_total is not null and effective_vat_amount is null)::bigint as missing_vat_orders,
      count(*) filter(where order_total is not null and order_fx is null)::bigint as missing_order_fx
    from eligible_orders group by bucket_start
  ),
  item_rows as (
    select eo.bucket_start,i.seller_sku,i.quantity_ordered,m.product_id,m.consumption_factor,
      hist.normalized_unit_price as historical_unit_cost,hist.price_date,
      case when hist.price_date is not null then private.amazon_rate_to_eur(hist.currency,hist.price_date) else null end as historical_cost_fx
    from public.amazon_order_items i
    join eligible_orders eo on eo.owner_id=i.owner_id and eo.amazon_account_id=i.amazon_account_id and eo.marketplace_id=i.marketplace_id and eo.amazon_order_id=i.amazon_order_id
    left join public.amazon_product_mappings m on m.owner_id=i.owner_id and m.amazon_account_id=i.amazon_account_id and m.seller_sku=i.seller_sku
    left join lateral (
      select h.normalized_unit_price,h.currency,h.price_date from public.product_price_history h
      where h.owner_id=i.owner_id and h.product_id=m.product_id and h.normalized_unit_price is not null and h.price_date<=eo.purchase_date::date
      order by h.price_date desc,h.created_at desc,h.id desc limit 1
    ) hist on true
  ),
  item_metrics as (
    select bucket_start,coalesce(sum(quantity_ordered),0)::bigint as units,
      coalesce(sum(case when product_id is not null and historical_unit_cost is not null and historical_cost_fx is not null then quantity_ordered*consumption_factor*historical_unit_cost*historical_cost_fx else 0 end),0)::numeric as product_cost,
      count(distinct seller_sku) filter(where seller_sku is not null and product_id is null)::bigint as unmapped_skus,
      count(distinct seller_sku) filter(where product_id is not null and historical_unit_cost is null)::bigint as missing_historical_cost,
      count(*) filter(where product_id is not null and historical_unit_cost is not null and historical_cost_fx is null)::bigint as missing_cost_fx
    from item_rows group by bucket_start
  ),
  finance_rows as (
    select case when grain='month' then date_trunc('month',c.posted_date)::date else c.posted_date::date end as bucket_start,
      c.component_category,c.amount_original,c.tax_amount_original,private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) as finance_fx
    from public.amazon_finance_components c
    where c.owner_id=v_owner and c.posted_date::date between from_date and to_date
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit')
  ),
  finance_metrics as (
    select bucket_start,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee') and finance_fx is not null),0)::numeric as amazon_fee_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='ads_payment_excluded' and finance_fx is not null),0)::numeric as ads_effect,
      coalesce(sum((amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='adjustment' and finance_fx is not null),0)::numeric as adjustment_effect,
      count(*) filter(where amount_original<>0 and finance_fx is null)::bigint as missing_finance_fx
    from finance_rows group by bucket_start
  ),
  sync_metrics as (
    select count(*) filter(where j.status='queued')::bigint as sync_queued,count(*) filter(where j.status='running')::bigint as sync_running,count(*) filter(where j.status='failed')::bigint as sync_failed
    from public.amazon_sync_jobs j where j.owner_id=v_owner
  ),
  combined as (
    select b.bucket_start,coalesce(om.orders,0)::bigint as orders,coalesce(im.units,0)::bigint as units,
      coalesce(om.gross_sales,0)::numeric as gross_sales,coalesce(om.sales_vat,0)::numeric as sales_vat,coalesce(om.net_sales,0)::numeric as net_sales,
      coalesce(fm.amazon_fee_effect,0)::numeric as amazon_fee_effect,coalesce(fm.refund_effect,0)::numeric as refund_effect,
      coalesce(fm.ads_effect,0)::numeric as ads_effect,coalesce(fm.adjustment_effect,0)::numeric as adjustment_effect,
      coalesce(im.product_cost,0)::numeric as product_cost,
      coalesce(im.unmapped_skus,0)::bigint as unmapped_skus,coalesce(im.missing_historical_cost,0)::bigint as missing_historical_cost,
      (coalesce(om.missing_order_fx,0)+coalesce(fm.missing_finance_fx,0)+coalesce(im.missing_cost_fx,0))::bigint as missing_fx_events,
      coalesce(om.missing_vat_orders,0)::bigint as missing_vat_orders,sm.sync_queued,sm.sync_running,sm.sync_failed
    from buckets b left join order_metrics om on om.bucket_start=b.bucket_start left join item_metrics im on im.bucket_start=b.bucket_start left join finance_metrics fm on fm.bucket_start=b.bucket_start cross join sync_metrics sm
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period',c.bucket_start::text,'grossSales',round(c.gross_sales,2),'salesVat',round(c.sales_vat,2),'netSales',round(c.net_sales,2),
    'amazonFees',round(-c.amazon_fee_effect,2),'refunds',round(-c.refund_effect,2),'adsCost',round(-c.ads_effect,2),'productCost',round(c.product_cost,2),'fbmShippingCost',0,
    'netProfit',round(c.net_sales+c.amazon_fee_effect+c.refund_effect+c.ads_effect+c.adjustment_effect-c.product_cost,2),
    'orders',c.orders,'units',c.units,'profitComplete',(c.unmapped_skus=0 and c.missing_historical_cost=0 and c.missing_fx_events=0 and c.missing_vat_orders=0 and c.sync_queued=0 and c.sync_running=0 and c.sync_failed=0)
  ) order by c.bucket_start),'[]'::jsonb) into v_result from combined c;
  return v_result;
end;
$$;

drop function if exists public.amazon_analytics_products(date,date,text[],text,integer,integer);

create or replace function public.amazon_analytics_products(
  from_date date,to_date date,marketplace_ids text[] default null,
  search text default null,page integer default 1,page_size integer default 50,
  sort_by text default 'profit_before_ads',sort_dir text default 'desc'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_owner uuid; v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date<from_date then raise exception 'Invalid analytics date range'; end if;
  if page<1 or page_size<1 or page_size>100 then raise exception 'Invalid pagination'; end if;
  if sort_by not in ('product_name','orders','units','gross_sales','net_sales','product_cost','amazon_fees','refunds','profit_before_ads','margin_pct') then raise exception 'Invalid sort'; end if;
  if sort_dir not in ('asc','desc') then raise exception 'Invalid sort direction'; end if;

  with eligible_orders as (
    select o.*,private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) order_fx
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date::date between from_date and to_date
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  item_facts as (
    select i.amazon_order_id,i.seller_sku,i.asin,i.quantity_ordered,i.item_price,i.item_tax,
           eo.order_fx,eo.purchase_date::date purchase_date,coalesce(eo.is_business_order,false) is_business_order,
           m.product_id,m.consumption_factor,p.name product_name,
           h.normalized_unit_price,h.currency historical_currency,h.price_date historical_price_date,
           case when h.price_date is not null then private.amazon_rate_to_eur(h.currency,h.price_date) end cost_fx,
           coalesce(i.item_tax,case when coalesce(eo.is_business_order,false) then 0::numeric end) effective_item_tax
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
  ),
  item_group as (
    select seller_sku,asin,product_id,max(product_name) product_name,max(consumption_factor) consumption_factor,
      count(distinct amazon_order_id)::bigint orders,
      count(distinct amazon_order_id) filter(where is_business_order)::bigint business_orders,
      sum(quantity_ordered)::bigint units,
      coalesce(sum(case when item_price is not null and order_fx is not null then item_price*order_fx else 0 end),0)::numeric gross_sales,
      coalesce(sum(case when effective_item_tax is not null and order_fx is not null then effective_item_tax*order_fx else 0 end),0)::numeric sales_vat,
      coalesce(sum(case when item_price is not null and order_fx is not null then (item_price-coalesce(effective_item_tax,0))*order_fx else 0 end),0)::numeric net_sales,
      count(distinct amazon_order_id) filter(where item_price is not null and effective_item_tax is null)::bigint missing_vat_orders,
      coalesce(sum(case when product_id is not null and normalized_unit_price is not null and cost_fx is not null then quantity_ordered*consumption_factor*normalized_unit_price*cost_fx else 0 end),0)::numeric product_cost,
      bool_and(product_id is not null and normalized_unit_price is not null and (upper(coalesce(historical_currency,'EUR'))='EUR' or cost_fx is not null) and (item_price is null or order_fx is not null)) item_complete
    from item_facts
    group by seller_sku,asin,product_id
  ),
  finance_group as (
    select c.seller_sku,c.asin,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date))
        filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')),0)::numeric fee_effect,
      coalesce(sum(coalesce(c.tax_amount_original,0)*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date))
        filter(where c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')),0)::numeric fee_vat_effect,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date))
        filter(where c.component_category='refund'),0)::numeric refund_effect,
      coalesce(sum((c.amount_original-coalesce(c.tax_amount_original,0))*private.amazon_rate_to_eur(c.currency_code,c.posted_date::date))
        filter(where c.component_category='adjustment'),0)::numeric adjustment_effect,
      count(*) filter(where c.amount_original<>0 and private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) is null)::bigint missing_fx
    from public.amazon_finance_components c
    where c.owner_id=v_owner and c.posted_date::date between from_date and to_date
      and c.seller_sku is not null
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
    group by c.seller_sku,c.asin
  ),
  combined as (
    select ig.*,coalesce(fg.fee_effect,0) fee_effect,coalesce(fg.fee_vat_effect,0) fee_vat_effect,
      coalesce(fg.refund_effect,0) refund_effect,coalesce(fg.adjustment_effect,0) adjustment_effect,coalesce(fg.missing_fx,0) missing_fx,
      (ig.net_sales+coalesce(fg.fee_effect,0)+coalesce(fg.refund_effect,0)+coalesce(fg.adjustment_effect,0)-ig.product_cost)::numeric profit_before_ads,
      case when ig.net_sales<>0 then (ig.net_sales+coalesce(fg.fee_effect,0)+coalesce(fg.refund_effect,0)+coalesce(fg.adjustment_effect,0)-ig.product_cost)/ig.net_sales*100 end::numeric margin_pct
    from item_group ig
    left join finance_group fg on fg.seller_sku=ig.seller_sku and coalesce(fg.asin,'')=coalesce(ig.asin,'')
  ),
  ranked as (
    select c.*,count(*) over() total_rows,
      row_number() over(order by
        case when sort_dir='asc' and sort_by='product_name' then lower(coalesce(product_name,seller_sku)) end asc nulls last,
        case when sort_dir='desc' and sort_by='product_name' then lower(coalesce(product_name,seller_sku)) end desc nulls last,
        case when sort_dir='asc' and sort_by='orders' then orders end asc nulls last,
        case when sort_dir='desc' and sort_by='orders' then orders end desc nulls last,
        case when sort_dir='asc' and sort_by='units' then units end asc nulls last,
        case when sort_dir='desc' and sort_by='units' then units end desc nulls last,
        case when sort_dir='asc' and sort_by='gross_sales' then gross_sales end asc nulls last,
        case when sort_dir='desc' and sort_by='gross_sales' then gross_sales end desc nulls last,
        case when sort_dir='asc' and sort_by='net_sales' then net_sales end asc nulls last,
        case when sort_dir='desc' and sort_by='net_sales' then net_sales end desc nulls last,
        case when sort_dir='asc' and sort_by='product_cost' then product_cost end asc nulls last,
        case when sort_dir='desc' and sort_by='product_cost' then product_cost end desc nulls last,
        case when sort_dir='asc' and sort_by='amazon_fees' then -fee_effect end asc nulls last,
        case when sort_dir='desc' and sort_by='amazon_fees' then -fee_effect end desc nulls last,
        case when sort_dir='asc' and sort_by='refunds' then -refund_effect end asc nulls last,
        case when sort_dir='desc' and sort_by='refunds' then -refund_effect end desc nulls last,
        case when sort_dir='asc' and sort_by='profit_before_ads' then profit_before_ads end asc nulls last,
        case when sort_dir='desc' and sort_by='profit_before_ads' then profit_before_ads end desc nulls last,
        case when sort_dir='asc' and sort_by='margin_pct' then margin_pct end asc nulls last,
        case when sort_dir='desc' and sort_by='margin_pct' then margin_pct end desc nulls last,
        seller_sku asc,coalesce(asin,'') asc
      ) ord
    from combined c
  ),
  paged as (
    select * from ranked
    where ord>((page-1)*page_size) and ord<=(page*page_size)
  ),
  sync_bad as (
    select exists(select 1 from public.amazon_sync_jobs j where j.owner_id=v_owner and j.status in ('queued','running','failed')) value
  )
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'sellerSku',seller_sku,'asin',asin,'productId',product_id,'productName',product_name,'consumptionFactor',coalesce(consumption_factor,1),
      'orders',orders,'businessOrders',business_orders,'units',units,
      'grossSales',round(gross_sales,2),'salesVat',round(sales_vat,2),'netSales',round(net_sales,2),
      'amazonFees',round(-fee_effect,2),'amazonFeeVat',round(-fee_vat_effect,2),'refunds',round(-refund_effect,2),
      'amazonAdjustments',round(adjustment_effect,2),'productCost',round(product_cost,2),
      'profitBeforeAds',round(profit_before_ads,2),'marginPct',case when margin_pct is null then null else round(margin_pct,2) end,
      'missingVatOrders',missing_vat_orders,
      'profitComplete',(item_complete and missing_vat_orders=0 and missing_fx=0 and not sb.value)
    ) order by ord),'[]'::jsonb),
    'page',page,'pageSize',page_size,'total',coalesce(max(total_rows),0)
  )
  into v_result from paged cross join sync_bad sb;

  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'page',page,'pageSize',page_size,'total',0));
end;
$$;

revoke all on function public.amazon_analytics_products(date,date,text[],text,integer,integer,text,text) from public,anon;
grant execute on function public.amazon_analytics_products(date,date,text[],text,integer,integer,text,text) to authenticated;
