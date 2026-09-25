-- Speed up Amazon "Todos" analytics and keep the summary within the RPC timeout.
-- The previous function aggregated all tax/order-item history before applying the
-- selected period. Restrict those aggregates to the requested order cohort.

create index if not exists fulfillment_orders_amazon_order_number_cost_idx
  on public.fulfillment_orders(owner_id,order_number,shipping_cost_recorded_at desc,last_synced_at desc)
  include (shipping_cost_net_amount,shipping_cost_currency)
  where source_channel='amazon' and order_number is not null;

create index if not exists fulfillment_orders_amazon_order_id_cost_idx
  on public.fulfillment_orders(owner_id,order_id,shipping_cost_recorded_at desc,last_synced_at desc)
  include (shipping_cost_net_amount,shipping_cost_currency)
  where source_channel='amazon' and order_id is not null;

create or replace function public.amazon_analytics_summary(
  from_date date,
  to_date date,
  marketplace_ids text[] default null::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
set statement_timeout to '30s'
as $function$
declare
  v_owner uuid;
  v_base jsonb;
  v_shipping numeric:=0;
  v_missing bigint:=0;
  v_gross_sales numeric:=0;
  v_sales_vat numeric:=0;
  v_net_sales numeric:=0;
  v_missing_vat bigint:=0;
  v_fallback_missing_fx bigint:=0;
  v_net_profit numeric:=0;
  v_missing_fx bigint:=0;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date < from_date then raise exception 'Invalid analytics date range'; end if;

  v_base:=public.amazon_analytics_summary_without_fbm_20260917(from_date,to_date,marketplace_ids);

  with eligible_base as (
    select
      o.owner_id,o.amazon_account_id,o.marketplace_id,o.amazon_order_id,o.purchase_date,
      o.order_total,o.vat_amount,o.is_business_order,o.currency_code,o.fulfillment_channel
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= from_date::timestamptz
      and o.purchase_date < (to_date+1)::timestamptz
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,sum(c.amount_original) tax_amount
    from public.amazon_finance_components c
    join eligible_base e
      on e.owner_id=c.owner_id
     and e.amazon_account_id=c.amazon_account_id
     and e.marketplace_id=c.marketplace_id
     and e.amazon_order_id=c.amazon_order_id
    where c.component_category='tax_audit'
      and c.amazon_order_id is not null
    group by c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id
  ),
  item_totals as (
    select i.owner_id,i.amazon_account_id,i.marketplace_id,i.amazon_order_id,
      case when count(*) filter(where i.item_price is not null)>0
        then sum(coalesce(i.item_price,0)) end item_total,
      case when count(*) filter(where i.item_price is not null)>0
             and count(*) filter(where i.item_price is not null and i.item_tax is null)=0
        then sum(coalesce(i.item_tax,0)) end item_tax_total
    from public.amazon_order_items i
    join eligible_base e
      on e.owner_id=i.owner_id
     and e.amazon_account_id=i.amazon_account_id
     and e.marketplace_id=i.marketplace_id
     and e.amazon_order_id=i.amazon_order_id
    group by i.owner_id,i.amazon_account_id,i.marketplace_id,i.amazon_order_id
  ),
  eligible_orders as (
    select e.owner_id,e.amazon_account_id,e.marketplace_id,e.amazon_order_id,e.purchase_date,
      e.order_total,
      coalesce(e.order_total,it.item_total) effective_order_total,
      private.amazon_effective_vat_amount(
        v_owner,
        coalesce(e.order_total,it.item_total),
        coalesce(e.vat_amount,ta.tax_amount,it.item_tax_total),
        coalesce(e.is_business_order,false)
      ) effective_vat_amount,
      private.amazon_rate_to_eur(e.currency_code,e.purchase_date::date) order_fx,
      e.fulfillment_channel
    from eligible_base e
    left join tax_audit_by_order ta
      on ta.owner_id=e.owner_id
     and ta.amazon_account_id=e.amazon_account_id
     and ta.marketplace_id=e.marketplace_id
     and ta.amazon_order_id=e.amazon_order_id
    left join item_totals it
      on it.owner_id=e.owner_id
     and it.amazon_account_id=e.amazon_account_id
     and it.marketplace_id=e.marketplace_id
     and it.amazon_order_id=e.amazon_order_id
  ),
  sales as (
    select
      coalesce(sum(case when effective_order_total is not null and order_fx is not null then effective_order_total*order_fx else 0 end),0)::numeric gross_sales,
      coalesce(sum(case when effective_vat_amount is not null and order_fx is not null then effective_vat_amount*order_fx else 0 end),0)::numeric sales_vat,
      coalesce(sum(case when effective_order_total is not null and order_fx is not null then (effective_order_total-coalesce(effective_vat_amount,0))*order_fx else 0 end),0)::numeric net_sales,
      count(*) filter(where effective_order_total is not null and effective_vat_amount is null)::bigint missing_vat_orders,
      count(*) filter(where order_total is null and effective_order_total is not null and order_fx is null)::bigint fallback_missing_fx
    from eligible_orders
  ),
  matched as (
    select eo.*,
      fo.shipping_cost_net_amount,
      fo.shipping_cost_currency,
      fo.shipping_cost_recorded_at,
      private.amazon_rate_to_eur(
        coalesce(nullif(fo.shipping_cost_currency,''),'EUR'),
        coalesce(fo.shipping_cost_recorded_at::date,eo.purchase_date::date)
      ) shipping_fx
    from eligible_orders eo
    left join lateral (
      select candidate.shipping_cost_net_amount,candidate.shipping_cost_currency,candidate.shipping_cost_recorded_at
      from (
        select f.shipping_cost_net_amount,f.shipping_cost_currency,f.shipping_cost_recorded_at,f.last_synced_at
        from public.fulfillment_orders f
        where f.owner_id=eo.owner_id
          and f.source_channel='amazon'
          and f.order_number=eo.amazon_order_id
        union all
        select f.shipping_cost_net_amount,f.shipping_cost_currency,f.shipping_cost_recorded_at,f.last_synced_at
        from public.fulfillment_orders f
        where f.owner_id=eo.owner_id
          and f.source_channel='amazon'
          and f.order_id=eo.amazon_order_id
          and f.order_number is distinct from eo.amazon_order_id
      ) candidate
      order by candidate.shipping_cost_recorded_at desc nulls last,candidate.last_synced_at desc nulls last
      limit 1
    ) fo on true
    where eo.fulfillment_channel='MERCHANT'
  )
  select
    s.gross_sales,s.sales_vat,s.net_sales,s.missing_vat_orders,s.fallback_missing_fx,
    coalesce(sum(case when m.shipping_cost_net_amount is not null and m.shipping_fx is not null then m.shipping_cost_net_amount*m.shipping_fx else 0 end),0)::numeric,
    count(m.*) filter(where m.shipping_cost_net_amount is null or m.shipping_fx is null)::bigint
  into v_gross_sales,v_sales_vat,v_net_sales,v_missing_vat,v_fallback_missing_fx,v_shipping,v_missing
  from sales s
  left join matched m on true
  group by s.gross_sales,s.sales_vat,s.net_sales,s.missing_vat_orders,s.fallback_missing_fx;

  v_net_profit:=coalesce((v_base->>'netProfit')::numeric,0)
    +(v_net_sales-coalesce((v_base->>'netSales')::numeric,0))
    -v_shipping;
  v_missing_fx:=coalesce((v_base->>'missingFxEventCount')::bigint,0)+v_fallback_missing_fx;

  return v_base || jsonb_build_object(
    'grossSales',round(v_gross_sales,2),
    'salesVat',round(v_sales_vat,2),
    'netSales',round(v_net_sales,2),
    'fbmShippingCost',round(v_shipping,2),
    'netProfit',round(v_net_profit,2),
    'marginPct',case when v_net_sales<>0 then round(v_net_profit/v_net_sales*100,2) else null end,
    'missingVatOrderCount',v_missing_vat,
    'missingFxEventCount',v_missing_fx,
    'missingFbmShippingCostCount',v_missing,
    'profitComplete',
      coalesce((v_base->>'profitComplete')::boolean,false)
      and v_missing=0
      and v_missing_vat=0
      and v_fallback_missing_fx=0
  );
end;
$function$;
