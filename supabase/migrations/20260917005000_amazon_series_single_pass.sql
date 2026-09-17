-- Avoid statement timeouts in Amazon Analytics trend queries.
-- The previous implementation called the full summary RPC once per bucket.
-- This version scans each source once for the requested range and groups by bucket.

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
    select bucket_start::date
    from generate_series(
      case when grain='month'
        then date_trunc('month',from_date::timestamp)::date
        else from_date
      end,
      to_date,
      case when grain='month' then interval '1 month' else interval '1 day' end
    ) bucket_start
  ),
  eligible_orders as (
    select o.owner_id,
           o.amazon_account_id,
           o.marketplace_id,
           o.amazon_order_id,
           o.purchase_date,
           o.order_total,
           o.vat_amount,
           private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) as order_fx,
           case when grain='month'
             then date_trunc('month',o.purchase_date)::date
             else o.purchase_date::date
           end as bucket_start
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date::date between from_date and to_date
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (
        marketplace_ids is null
        or cardinality(marketplace_ids)=0
        or o.marketplace_id=any(marketplace_ids)
      )
  ),
  order_metrics_by_bucket as (
    select eo.bucket_start,
           count(distinct eo.amazon_order_id)::bigint as orders,
           coalesce(sum(
             case
               when eo.order_total is not null
                and eo.vat_amount is not null
                and eo.order_fx is not null
               then (eo.order_total-eo.vat_amount)*eo.order_fx
               else 0
             end
           ),0)::numeric as net_sales,
           count(*) filter (where eo.vat_amount is null)::bigint as missing_vat_orders,
           count(*) filter (
             where eo.order_total is not null
               and eo.vat_amount is not null
               and eo.order_fx is null
           )::bigint as missing_order_fx
    from eligible_orders eo
    group by eo.bucket_start
  ),
  item_rows as (
    select eo.bucket_start,
           i.seller_sku,
           i.quantity_ordered,
           m.product_id,
           m.consumption_factor,
           hist.normalized_unit_price as historical_unit_cost,
           hist.currency as historical_currency,
           hist.price_date as historical_price_date,
           case
             when hist.price_date is not null
             then private.amazon_rate_to_eur(hist.currency,hist.price_date)
             else null
           end as historical_cost_fx
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
  item_metrics_by_bucket as (
    select ir.bucket_start,
           coalesce(sum(ir.quantity_ordered),0)::bigint as units,
           coalesce(sum(
             case
               when ir.product_id is not null
                and ir.historical_unit_cost is not null
                and ir.historical_cost_fx is not null
               then ir.quantity_ordered
                    * ir.consumption_factor
                    * ir.historical_unit_cost
                    * ir.historical_cost_fx
               else 0
             end
           ),0)::numeric as product_cost,
           count(distinct ir.seller_sku) filter (
             where ir.seller_sku is not null and ir.product_id is null
           )::bigint as unmapped_skus,
           count(distinct ir.seller_sku) filter (
             where ir.product_id is not null and ir.historical_unit_cost is null
           )::bigint as missing_historical_cost,
           count(*) filter (
             where ir.product_id is not null
               and ir.historical_unit_cost is not null
               and ir.historical_cost_fx is null
           )::bigint as missing_cost_fx
    from item_rows ir
    group by ir.bucket_start
  ),
  finance_rows as (
    select case when grain='month'
             then date_trunc('month',c.posted_date)::date
             else c.posted_date::date
           end as bucket_start,
           c.component_category,
           c.amount_original,
           private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) as finance_fx
    from public.amazon_finance_components c
    where c.owner_id=v_owner
      and c.posted_date::date between from_date and to_date
      and (
        marketplace_ids is null
        or cardinality(marketplace_ids)=0
        or c.marketplace_id=any(marketplace_ids)
      )
      and c.component_category not in ('sale_audit','tax_audit','ads_payment_excluded')
  ),
  finance_metrics_by_bucket as (
    select fr.bucket_start,
           coalesce(sum(fr.amount_original*fr.finance_fx) filter (
             where fr.component_category in (
               'commission_fee','fba_fee','digital_services_fee',
               'storage_fee','other_amazon_fee','adjustment'
             )
               and fr.finance_fx is not null
           ),0)::numeric as amazon_fee_effect,
           coalesce(sum(fr.amount_original*fr.finance_fx) filter (
             where fr.component_category='refund'
               and fr.finance_fx is not null
           ),0)::numeric as refund_effect,
           count(*) filter (
             where fr.amount_original<>0 and fr.finance_fx is null
           )::bigint as missing_finance_fx
    from finance_rows fr
    group by fr.bucket_start
  ),
  sync_metrics as (
    select count(*) filter (where j.status='queued')::bigint as sync_queued,
           count(*) filter (where j.status='running')::bigint as sync_running,
           count(*) filter (where j.status='failed')::bigint as sync_failed
    from public.amazon_sync_jobs j
    where j.owner_id=v_owner
  ),
  combined as (
    select b.bucket_start,
           coalesce(om.orders,0)::bigint as orders,
           coalesce(im.units,0)::bigint as units,
           coalesce(om.net_sales,0)::numeric as net_sales,
           coalesce(fm.amazon_fee_effect,0)::numeric as amazon_fee_effect,
           coalesce(fm.refund_effect,0)::numeric as refund_effect,
           coalesce(im.product_cost,0)::numeric as product_cost,
           coalesce(im.unmapped_skus,0)::bigint as unmapped_skus,
           coalesce(im.missing_historical_cost,0)::bigint as missing_historical_cost,
           (
             coalesce(om.missing_order_fx,0)
             + coalesce(fm.missing_finance_fx,0)
             + coalesce(im.missing_cost_fx,0)
           )::bigint as missing_fx_events,
           coalesce(om.missing_vat_orders,0)::bigint as missing_vat_orders,
           sm.sync_queued,
           sm.sync_running,
           sm.sync_failed
    from buckets b
    left join order_metrics_by_bucket om on om.bucket_start=b.bucket_start
    left join item_metrics_by_bucket im on im.bucket_start=b.bucket_start
    left join finance_metrics_by_bucket fm on fm.bucket_start=b.bucket_start
    cross join sync_metrics sm
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period',c.bucket_start::text,
    'netSales',round(c.net_sales,2),
    'profitBeforeAds',round(
      c.net_sales+c.amazon_fee_effect+c.refund_effect-c.product_cost,
      2
    ),
    'orders',c.orders,
    'units',c.units,
    'profitComplete',(
      c.unmapped_skus=0
      and c.missing_historical_cost=0
      and c.missing_fx_events=0
      and c.missing_vat_orders=0
      and c.sync_queued=0
      and c.sync_running=0
      and c.sync_failed=0
    )
  ) order by c.bucket_start),'[]'::jsonb)
  into v_result
  from combined c;

  return v_result;
end;
$$;

revoke all on function public.amazon_analytics_series(date,date,text[],text) from public, anon;
grant execute on function public.amazon_analytics_series(date,date,text[],text) to authenticated;
