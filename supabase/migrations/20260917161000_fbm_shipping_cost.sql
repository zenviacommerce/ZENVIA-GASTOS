-- Historical FBM shipping cost is frozen on the fulfillment order when the label/tariff is chosen.
-- Sendcloud quotes are stored exactly as shown at label creation. The tariff module can later
-- populate the same fields for MRW direct-contract shipments without coupling profitability to Sendcloud.

alter table public.fulfillment_orders
  add column if not exists shipping_cost_amount numeric,
  add column if not exists shipping_cost_currency text,
  add column if not exists shipping_cost_source text,
  add column if not exists shipping_cost_net_amount numeric,
  add column if not exists shipping_cost_tax_amount numeric,
  add column if not exists shipping_cost_recorded_at timestamptz;

create index if not exists fulfillment_orders_amazon_shipping_cost_idx
  on public.fulfillment_orders(owner_id,source_channel,order_number,order_id)
  where source_channel='amazon';

-- Preserve the VAT-aware profitability implementation from the previous migration as an internal base.
alter function public.amazon_analytics_summary(date,date,text[])
  rename to amazon_analytics_summary_without_fbm_20260917;
revoke all on function public.amazon_analytics_summary_without_fbm_20260917(date,date,text[]) from public,anon,authenticated;

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
  v_base jsonb;
  v_shipping numeric:=0;
  v_missing bigint:=0;
  v_net_profit numeric:=0;
  v_net_sales numeric:=0;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;

  v_base:=public.amazon_analytics_summary_without_fbm_20260917(from_date,to_date,marketplace_ids);

  with eligible_orders as (
    select eo.owner_id,eo.amazon_account_id,eo.marketplace_id,eo.amazon_order_id,eo.purchase_date
    from public.amazon_orders eo
    where eo.owner_id=v_owner
      and eo.purchase_date::date between from_date and to_date
      and lower(coalesce(eo.order_status,'')) not in ('canceled','cancelled')
      and eo.fulfillment_channel='MERCHANT'
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or eo.marketplace_id=any(marketplace_ids))
  ), matched as (
    select eo.*,
      fo.shipping_cost_net_amount,
      fo.shipping_cost_currency,
      fo.shipping_cost_recorded_at,
      private.amazon_rate_to_eur(
        coalesce(nullif(fo.shipping_cost_currency,''),'EUR'),
        coalesce(fo.shipping_cost_recorded_at::date,eo.purchase_date::date)
      ) as shipping_fx
    from eligible_orders eo
    left join lateral (
      select f.shipping_cost_net_amount,f.shipping_cost_currency,f.shipping_cost_recorded_at
      from public.fulfillment_orders f
      where f.owner_id=eo.owner_id
        and f.source_channel='amazon'
        and (f.order_number=eo.amazon_order_id or f.order_id=eo.amazon_order_id)
      order by f.shipping_cost_recorded_at desc nulls last,f.last_synced_at desc nulls last
      limit 1
    ) fo on true
  )
  select
    coalesce(sum(case when shipping_cost_net_amount is not null and shipping_fx is not null then shipping_cost_net_amount*shipping_fx else 0 end),0)::numeric,
    count(*) filter(where shipping_cost_net_amount is null or shipping_fx is null)::bigint
  into v_shipping,v_missing
  from matched;

  v_net_profit:=coalesce((v_base->>'netProfit')::numeric,0)-v_shipping;
  v_net_sales:=coalesce((v_base->>'netSales')::numeric,0);

  return v_base || jsonb_build_object(
    'fbmShippingCost',round(v_shipping,2),
    'netProfit',round(v_net_profit,2),
    'marginPct',case when v_net_sales<>0 then round(v_net_profit/v_net_sales*100,2) else null end,
    'missingFbmShippingCostCount',v_missing,
    'profitComplete',coalesce((v_base->>'profitComplete')::boolean,false) and v_missing=0
  );
end;
$$;

revoke all on function public.amazon_analytics_summary(date,date,text[]) from public,anon;
grant execute on function public.amazon_analytics_summary(date,date,text[]) to authenticated;

alter function public.amazon_analytics_series(date,date,text[],text)
  rename to amazon_analytics_series_without_fbm_20260917;
revoke all on function public.amazon_analytics_series_without_fbm_20260917(date,date,text[],text) from public,anon,authenticated;

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
  v_base jsonb;
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if grain not in ('day','month') then raise exception 'Invalid analytics grain'; end if;

  v_base:=public.amazon_analytics_series_without_fbm_20260917(from_date,to_date,marketplace_ids,grain);

  with eligible_orders as (
    select eo.owner_id,eo.marketplace_id,eo.amazon_order_id,eo.purchase_date,
      case when grain='month' then date_trunc('month',eo.purchase_date)::date else eo.purchase_date::date end as bucket_start
    from public.amazon_orders eo
    where eo.owner_id=v_owner
      and eo.purchase_date::date between from_date and to_date
      and lower(coalesce(eo.order_status,'')) not in ('canceled','cancelled')
      and eo.fulfillment_channel='MERCHANT'
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or eo.marketplace_id=any(marketplace_ids))
  ), matched as (
    select eo.*,
      fo.shipping_cost_net_amount,
      private.amazon_rate_to_eur(
        coalesce(nullif(fo.shipping_cost_currency,''),'EUR'),
        coalesce(fo.shipping_cost_recorded_at::date,eo.purchase_date::date)
      ) as shipping_fx
    from eligible_orders eo
    left join lateral (
      select f.shipping_cost_net_amount,f.shipping_cost_currency,f.shipping_cost_recorded_at
      from public.fulfillment_orders f
      where f.owner_id=eo.owner_id
        and f.source_channel='amazon'
        and (f.order_number=eo.amazon_order_id or f.order_id=eo.amazon_order_id)
      order by f.shipping_cost_recorded_at desc nulls last,f.last_synced_at desc nulls last
      limit 1
    ) fo on true
  ), shipping as (
    select bucket_start,
      coalesce(sum(case when shipping_cost_net_amount is not null and shipping_fx is not null then shipping_cost_net_amount*shipping_fx else 0 end),0)::numeric as shipping_cost,
      count(*) filter(where shipping_cost_net_amount is null or shipping_fx is null)::bigint as missing_cost
    from matched
    group by bucket_start
  ), elements as (
    select e.value as item,e.ordinality as ord,(e.value->>'period')::date as bucket_start
    from jsonb_array_elements(coalesce(v_base,'[]'::jsonb)) with ordinality e(value,ordinality)
  )
  select coalesce(jsonb_agg(
    e.item || jsonb_build_object(
      'fbmShippingCost',round(coalesce(s.shipping_cost,0),2),
      'netProfit',round(coalesce((e.item->>'netProfit')::numeric,0)-coalesce(s.shipping_cost,0),2),
      'profitComplete',coalesce((e.item->>'profitComplete')::boolean,false) and coalesce(s.missing_cost,0)=0
    ) order by e.ord
  ),'[]'::jsonb)
  into v_result
  from elements e
  left join shipping s on s.bucket_start=e.bucket_start;

  return v_result;
end;
$$;

revoke all on function public.amazon_analytics_series(date,date,text[],text) from public,anon;
grant execute on function public.amazon_analytics_series(date,date,text[],text) to authenticated;
