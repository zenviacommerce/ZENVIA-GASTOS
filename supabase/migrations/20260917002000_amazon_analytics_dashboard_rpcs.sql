-- Amazon Analytics query-time profitability layer.
-- Source ownership: Orders => sales/units/status; Finance components => fees/refunds/adjustments.

create or replace function private.amazon_rate_to_eur(p_currency text, p_event_date date)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select case
    when upper(coalesce(nullif(trim(p_currency),''),'EUR'))='EUR' then 1::numeric
    when p_event_date is null then null::numeric
    else (
      select r.rate_to_eur
      from public.amazon_fx_rates r
      where r.currency_code=upper(p_currency)
        and r.rate_date between (p_event_date - interval '7 days')::date and p_event_date
      order by r.rate_date desc
      limit 1
    )
  end;
$$;

create or replace function private.amazon_historical_unit_cost_eur(
  p_owner uuid,
  p_product uuid,
  p_event_date date
)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  with historical as (
    select h.normalized_unit_price,
           upper(coalesce(nullif(trim(h.currency),''),'EUR')) as currency_code,
           h.price_date
    from public.product_price_history h
    where h.owner_id=p_owner
      and h.product_id=p_product
      and h.normalized_unit_price is not null
      and h.price_date <= p_event_date
    order by h.price_date desc, h.created_at desc, h.id desc
    limit 1
  )
  select historical.normalized_unit_price
         * private.amazon_rate_to_eur(historical.currency_code,historical.price_date)
  from historical;
$$;

revoke all on function private.amazon_rate_to_eur(text,date) from public, anon, authenticated;
revoke all on function private.amazon_historical_unit_cost_eur(uuid,uuid,date) from public, anon, authenticated;

grant usage on schema private to authenticated;

create or replace function public.amazon_analytics_summary(
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
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;
  if from_date is null or to_date is null or to_date < from_date then
    raise exception 'Invalid analytics date range';
  end if;

  with eligible_orders as (
    select o.*,
           private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) as order_fx
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date::date between from_date and to_date
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  order_metrics as (
    select count(distinct amazon_order_id)::bigint as orders,
           coalesce(sum(
             case when order_total is not null and vat_amount is not null and order_fx is not null
               then (order_total-vat_amount)*order_fx else 0 end
           ),0)::numeric as net_sales,
           count(*) filter (where vat_amount is null)::bigint as missing_vat_orders,
           count(*) filter (
             where order_total is not null and vat_amount is not null and order_fx is null
           )::bigint as missing_order_fx
    from eligible_orders
  ),
  item_rows as (
    select i.amazon_order_id,
           i.marketplace_id,
           i.seller_sku,
           i.asin,
           i.quantity_ordered,
           eo.purchase_date::date as purchase_date,
           m.product_id,
           m.consumption_factor,
           hist.normalized_unit_price as historical_unit_cost,
           hist.currency as historical_currency,
           hist.price_date as historical_price_date,
           case when hist.price_date is not null
             then private.amazon_rate_to_eur(hist.currency,hist.price_date)
             else null end as historical_cost_fx
    from public.amazon_order_items i
    join eligible_orders eo
      on eo.owner_id=i.owner_id
     and eo.amazon_account_id=i.amazon_account_id
     and eo.marketplace_id=i.marketplace_id
     and eo.amazon_order_id=i.amazon_order_id
    left join public.amazon_product_mappings m
      on m.owner_id=i.owner_id
     and m.amazon_account_id=i.amazon_account_id
     and m.seller_sku=i.seller_sku
    left join lateral (
      select h.normalized_unit_price,h.currency,h.price_date
      from public.product_price_history h
      where h.owner_id=i.owner_id
        and h.product_id=m.product_id
        and h.normalized_unit_price is not null
        and h.price_date <= eo.purchase_date::date
      order by h.price_date desc,h.created_at desc,h.id desc
      limit 1
    ) hist on true
  ),
  item_metrics as (
    select coalesce(sum(quantity_ordered),0)::bigint as units,
           coalesce(sum(
             case when product_id is not null
                       and historical_unit_cost is not null
                       and historical_cost_fx is not null
               then quantity_ordered * consumption_factor * historical_unit_cost * historical_cost_fx
               else 0 end
           ),0)::numeric as product_cost,
           count(distinct seller_sku) filter (where seller_sku is not null and product_id is null)::bigint as unmapped_skus,
           coalesce(sum(quantity_ordered) filter (where product_id is null),0)::bigint as unmapped_units,
           count(distinct seller_sku) filter (
             where product_id is not null and historical_unit_cost is null
           )::bigint as missing_historical_cost,
           coalesce(sum(quantity_ordered) filter (
             where product_id is not null and historical_unit_cost is null
           ),0)::bigint as missing_historical_cost_units,
           count(*) filter (
             where product_id is not null
               and historical_unit_cost is not null
               and historical_cost_fx is null
           )::bigint as missing_cost_fx
    from item_rows
  ),
  finance_rows as (
    select c.component_category,
           c.amount_original,
           private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) as finance_fx
    from public.amazon_finance_components c
    where c.owner_id=v_owner
      and c.posted_date::date between from_date and to_date
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
  ),
  finance_metrics as (
    select coalesce(sum(
             amount_original*finance_fx
           ) filter (
             where component_category in (
               'commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee','adjustment'
             ) and finance_fx is not null
           ),0)::numeric as amazon_fee_effect,
           coalesce(sum(
             amount_original*finance_fx
           ) filter (where component_category='refund' and finance_fx is not null),0)::numeric as refund_effect,
           count(*) filter (where amount_original<>0 and finance_fx is null)::bigint as missing_finance_fx
    from finance_rows
  ),
  sync_metrics as (
    select count(*) filter (where j.status='queued')::bigint as sync_queued,
           count(*) filter (where j.status='running')::bigint as sync_running,
           count(*) filter (where j.status='failed')::bigint as sync_failed
    from public.amazon_sync_jobs j
    where j.owner_id=v_owner
  ),
  combined as (
    select om.orders,im.units,om.net_sales,
           -fm.amazon_fee_effect as amazon_fees,
           -fm.refund_effect as refunds,
           im.product_cost,
           (om.net_sales + fm.amazon_fee_effect + fm.refund_effect - im.product_cost) as profit_before_ads,
           im.unmapped_skus,im.unmapped_units,
           im.missing_historical_cost,im.missing_historical_cost_units,
           (om.missing_order_fx+fm.missing_finance_fx+im.missing_cost_fx)::bigint as missing_fx_events,
           om.missing_vat_orders,
           sm.sync_queued,sm.sync_running,sm.sync_failed
    from order_metrics om
    cross join item_metrics im
    cross join finance_metrics fm
    cross join sync_metrics sm
  )
  select jsonb_build_object(
    'netSales',round(net_sales,2),
    'orders',orders,
    'units',units,
    'amazonFees',round(amazon_fees,2),
    'refunds',round(refunds,2),
    'productCost',round(product_cost,2),
    'profitBeforeAds',round(profit_before_ads,2),
    'marginPct',case when net_sales<>0 then round(profit_before_ads/net_sales*100,2) else null end,
    'unmappedSkuCount',unmapped_skus,
    'unmappedUnits',unmapped_units,
    'missingHistoricalCostCount',missing_historical_cost,
    'missingHistoricalCostUnits',missing_historical_cost_units,
    'missingFxEventCount',missing_fx_events,
    'missingVatOrderCount',missing_vat_orders,
    'syncQueued',sync_queued,
    'syncRunning',sync_running,
    'syncFailed',sync_failed,
    'adsExcluded',true,
    'profitComplete',(
      unmapped_skus=0
      and missing_historical_cost=0
      and missing_fx_events=0
      and missing_vat_orders=0
      and sync_queued=0
      and sync_running=0
      and sync_failed=0
    )
  ) into v_result
  from combined;

  return coalesce(v_result,jsonb_build_object(
    'netSales',0,'orders',0,'units',0,'amazonFees',0,'refunds',0,'productCost',0,
    'profitBeforeAds',0,'marginPct',null,'unmappedSkuCount',0,'unmappedUnits',0,
    'missingHistoricalCostCount',0,'missingHistoricalCostUnits',0,'missingFxEventCount',0,
    'missingVatOrderCount',0,'syncQueued',0,'syncRunning',0,'syncFailed',0,
    'adsExcluded',true,'profitComplete',true
  ));
end;
$$;

create or replace function public.amazon_analytics_series(
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
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;
  if from_date is null or to_date is null or to_date < from_date then
    raise exception 'Invalid analytics date range';
  end if;
  if grain not in ('day','month') then
    raise exception 'Invalid analytics grain';
  end if;

  with buckets as (
    select bucket_start::date,
           case when grain='month'
             then least(to_date,(bucket_start + interval '1 month - 1 day')::date)
             else bucket_start::date end as bucket_end
    from generate_series(
      case when grain='month' then date_trunc('month',from_date::timestamp)::date else from_date end,
      to_date,
      case when grain='month' then interval '1 month' else interval '1 day' end
    ) bucket_start
  ),
  rows as (
    select b.bucket_start,b.bucket_end,
           public.amazon_analytics_summary(
             greatest(from_date,b.bucket_start),b.bucket_end,marketplace_ids
           ) as summary
    from buckets b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period',bucket_start::text,
    'netSales',summary->'netSales',
    'profitBeforeAds',summary->'profitBeforeAds',
    'orders',summary->'orders',
    'units',summary->'units',
    'profitComplete',summary->'profitComplete'
  ) order by bucket_start),'[]'::jsonb)
  into v_result
  from rows;

  return v_result;
end;
$$;

revoke all on function public.amazon_analytics_summary(date,date,text[]) from public, anon;
revoke all on function public.amazon_analytics_series(date,date,text[],text) from public, anon;
grant execute on function public.amazon_analytics_summary(date,date,text[]) to authenticated;
grant execute on function public.amazon_analytics_series(date,date,text[],text) to authenticated;
