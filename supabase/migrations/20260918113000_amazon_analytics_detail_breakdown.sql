create or replace function public.amazon_analytics_detail(
  from_date date,
  to_date date,
  marketplace_ids text[] default null::text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_owner uuid;
  v_result jsonb;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('amazon') then
    raise exception 'Forbidden';
  end if;
  if from_date is null or to_date is null or to_date<from_date then
    raise exception 'Invalid analytics date range';
  end if;

  with eligible_orders as (
    select o.*,
           private.amazon_rate_to_eur(o.currency_code,o.purchase_date::date) as order_fx
    from public.amazon_orders o
    where o.owner_id=v_owner
      and o.purchase_date >= from_date::timestamptz
      and o.purchase_date < (to_date+1)::timestamptz
      and lower(coalesce(o.order_status,'')) not in ('canceled','cancelled')
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or o.marketplace_id=any(marketplace_ids))
  ),
  item_metrics as (
    select
      count(*)::bigint as order_lines,
      coalesce(sum(case when eo.order_fx is not null then coalesce(i.promotion_discount,0)*eo.order_fx else 0 end),0)::numeric as promotion_discounts,
      coalesce(sum(case when eo.order_fx is not null then coalesce(i.shipping_price,0)*eo.order_fx else 0 end),0)::numeric as shipping_charged,
      coalesce(sum(case when eo.order_fx is not null then coalesce(i.shipping_tax,0)*eo.order_fx else 0 end),0)::numeric as shipping_tax
    from public.amazon_order_items i
    join eligible_orders eo
      on eo.owner_id=i.owner_id
     and eo.amazon_account_id=i.amazon_account_id
     and eo.marketplace_id=i.marketplace_id
     and eo.amazon_order_id=i.amazon_order_id
  ),
  finance_rows as (
    select c.finance_transaction_id,c.amazon_order_id,c.component_category,
           c.amount_original,c.tax_amount_original,c.currency_code,c.posted_date,
           private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) as finance_fx
    from public.amazon_finance_components c
    join eligible_orders eo
      on eo.owner_id=c.owner_id
     and eo.amazon_account_id=c.amazon_account_id
     and eo.amazon_order_id=c.amazon_order_id
     and (c.marketplace_id is null or c.marketplace_id=eo.marketplace_id)
    where c.owner_id=v_owner
      and nullif(c.amazon_order_id,'') is not null
      and c.component_category not in ('sale_audit','tax_audit')
    union all
    select c.finance_transaction_id,c.amazon_order_id,c.component_category,
           c.amount_original,c.tax_amount_original,c.currency_code,c.posted_date,
           private.amazon_rate_to_eur(c.currency_code,c.posted_date::date) as finance_fx
    from public.amazon_finance_components c
    where c.owner_id=v_owner
      and nullif(c.amazon_order_id,'') is null
      and c.posted_date >= from_date::timestamptz
      and c.posted_date < (to_date+1)::timestamptz
      and (marketplace_ids is null or cardinality(marketplace_ids)=0 or c.marketplace_id=any(marketplace_ids))
      and c.component_category not in ('sale_audit','tax_audit')
  ),
  finance_metrics as (
    select
      count(distinct finance_transaction_id) filter(where component_category='refund')::bigint as refund_transactions,
      count(distinct amazon_order_id) filter(where component_category='refund' and amazon_order_id is not null)::bigint as refund_orders,
      coalesce(sum(-amount_original*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_gross_impact,
      coalesce(sum(-coalesce(tax_amount_original,0)*finance_fx) filter(where component_category='refund' and finance_fx is not null),0)::numeric as refund_tax_impact,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='commission_fee' and finance_fx is not null),0)::numeric as commission_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='fba_fee' and finance_fx is not null),0)::numeric as fba_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='digital_services_fee' and finance_fx is not null),0)::numeric as digital_services_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='storage_fee' and finance_fx is not null),0)::numeric as storage_fees,
      coalesce(sum(-(amount_original-coalesce(tax_amount_original,0))*finance_fx) filter(where component_category='other_amazon_fee' and finance_fx is not null),0)::numeric as other_amazon_fees
    from finance_rows
  )
  select jsonb_build_object(
    'orderLines',im.order_lines,
    'promotionDiscounts',round(im.promotion_discounts,2),
    'shippingCharged',round(im.shipping_charged,2),
    'shippingTax',round(im.shipping_tax,2),
    'refundTransactions',fm.refund_transactions,
    'refundOrders',fm.refund_orders,
    'refundGrossImpact',round(fm.refund_gross_impact,2),
    'refundTaxImpact',round(fm.refund_tax_impact,2),
    'commissionFees',round(fm.commission_fees,2),
    'fbaFees',round(fm.fba_fees,2),
    'digitalServicesFees',round(fm.digital_services_fees,2),
    'storageFees',round(fm.storage_fees,2),
    'otherAmazonFees',round(fm.other_amazon_fees,2)
  )
  into v_result
  from item_metrics im cross join finance_metrics fm;

  return coalesce(v_result,jsonb_build_object(
    'orderLines',0,'promotionDiscounts',0,'shippingCharged',0,'shippingTax',0,
    'refundTransactions',0,'refundOrders',0,'refundGrossImpact',0,'refundTaxImpact',0,
    'commissionFees',0,'fbaFees',0,'digitalServicesFees',0,'storageFees',0,'otherAmazonFees',0
  ));
end;
$function$;

grant execute on function public.amazon_analytics_detail(date,date,text[]) to authenticated;
