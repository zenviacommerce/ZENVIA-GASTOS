-- Amazon profitability: keep gross sales, real sales VAT and net sales separate.
-- Finance components are converted to net cost by removing recoverable tax.
-- Ads payments are included in net profit. Unknown order VAT is never estimated.

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
  if v_owner is null or not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
  if from_date is null or to_date is null or to_date < from_date then raise exception 'Invalid analytics date range'; end if;

  with tax_audit_by_order as (
    select c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id,
           sum(c.amount_original) as tax_amount,
           min(c.currency_code) as currency_code
    from public.amazon_finance_components c
    where c.owner_id=v_owner
      and c.component_category='tax_audit'
      and c.amazon_order_id is not null
    group by c.owner_id,c.amazon_account_id,c.marketplace_id,c.amazon_order_id
  ),
  eligible_orders as (
    select o.*,
           coalesce(o.vat_amount,ta.tax_amount) as effective_vat_amount,
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
    select count(distinct amazon_order_id)::bigint as orders,
      coalesce(sum(case when order_total is not null and order_fx is not null then order_total*order_fx else 0 end),0)::numeric as gross_sales,
      coalesce(sum(case when effective_vat_amount is not null and order_fx is not null then effective_vat_amount*order_fx else 0 end),0)::numeric as sales_vat,
      coalesce(sum(case when order_total is not null and effective_vat_amount is not null and order_fx is not null then (order_total-effective_vat_amount)*order_fx else 0 end),0)::numeric as net_sales,
      count(*) filter(where effective_vat_amount is null)::bigint as missing_vat_orders,
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
    select om.orders,im.units,om.gross_sales,om.sales_vat,om.net_sales,
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
    'orders',orders,'units',units,'amazonFees',round(amazon_fees,2),'amazonFeeVat',round(amazon_fee_vat,2),
    'refunds',round(refunds,2),'adsCost',round(ads_cost,2),'amazonAdjustments',round(amazon_adjustments,2),
    'productCost',round(product_cost,2),'fbmShippingCost',round(fbm_shipping_cost,2),'netProfit',round(net_profit,2),
    'marginPct',case when net_sales<>0 then round(net_profit/net_sales*100,2) else null end,
    'unmappedSkuCount',unmapped_skus,'unmappedUnits',unmapped_units,'missingHistoricalCostCount',missing_historical_cost,'missingHistoricalCostUnits',missing_historical_cost_units,
    'missingFxEventCount',missing_fx_events,'missingVatOrderCount',missing_vat_orders,'syncQueued',sync_queued,'syncRunning',sync_running,'syncFailed',sync_failed,
    'adsExcluded',false,
    'profitComplete',(unmapped_skus=0 and missing_historical_cost=0 and missing_fx_events=0 and missing_vat_orders=0 and sync_queued=0 and sync_running=0 and sync_failed=0)
  ) into v_result from combined;

  return coalesce(v_result,jsonb_build_object(
    'grossSales',0,'salesVat',0,'netSales',0,'orders',0,'units',0,'amazonFees',0,'amazonFeeVat',0,'refunds',0,'adsCost',0,'amazonAdjustments',0,
    'productCost',0,'fbmShippingCost',0,'netProfit',0,'marginPct',null,'unmappedSkuCount',0,'unmappedUnits',0,'missingHistoricalCostCount',0,
    'missingHistoricalCostUnits',0,'missingFxEventCount',0,'missingVatOrderCount',0,'syncQueued',0,'syncRunning',0,'syncFailed',0,'adsExcluded',false,'profitComplete',true
  ));
end;
$$;

revoke all on function public.amazon_analytics_summary(date,date,text[]) from public,anon;
grant execute on function public.amazon_analytics_summary(date,date,text[]) to authenticated;

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
    select o.owner_id,o.amazon_account_id,o.marketplace_id,o.amazon_order_id,o.purchase_date,o.order_total,
      coalesce(o.vat_amount,ta.tax_amount) as effective_vat_amount,
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
      coalesce(sum(case when order_total is not null and effective_vat_amount is not null and order_fx is not null then (order_total-effective_vat_amount)*order_fx else 0 end),0)::numeric as net_sales,
      count(*) filter(where effective_vat_amount is null)::bigint as missing_vat_orders,
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

revoke all on function public.amazon_analytics_series(date,date,text[],text) from public,anon;
grant execute on function public.amazon_analytics_series(date,date,text[],text) to authenticated;
