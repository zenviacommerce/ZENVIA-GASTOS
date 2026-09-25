-- Reduce Amazon Analytics timeouts by keeping order-date predicates sargable
-- and supporting the tax-audit join used by summary/series.
create index if not exists amazon_orders_owner_purchase_market_idx
  on public.amazon_orders(owner_id,purchase_date,marketplace_id,amazon_account_id,amazon_order_id)
  include(order_total,vat_amount,is_business_order,currency_code,order_status,fulfillment_channel);

create index if not exists amazon_finance_tax_audit_order_idx
  on public.amazon_finance_components(owner_id,amazon_account_id,marketplace_id,amazon_order_id)
  include(amount_original)
  where component_category='tax_audit' and amazon_order_id is not null;

do $$
declare
  r record;
  definition text;
  before_text constant text := 'o.purchase_date::date between from_date and to_date';
  after_text constant text := 'o.purchase_date >= from_date::timestamptz and o.purchase_date < (to_date+1)::timestamptz';
begin
  for r in
    select p.oid,p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'amazon_analytics_summary_without_fbm_20260917',
        'amazon_analytics_series_without_fbm_20260917'
      )
  loop
    definition:=pg_get_functiondef(r.oid);
    if position(before_text in definition)>0 then
      definition:=replace(definition,before_text,after_text);
      execute definition;
    end if;
  end loop;
end;
$$;

alter function public.amazon_analytics_summary_without_fbm_20260917(date,date,text[])
  set statement_timeout='20s';
alter function public.amazon_analytics_summary(date,date,text[])
  set statement_timeout='25s';
alter function public.amazon_analytics_series_without_fbm_20260917(date,date,text[],text)
  set statement_timeout='20s';
alter function public.amazon_analytics_series(date,date,text[],text)
  set statement_timeout='25s';
alter function public.amazon_analytics_marketplaces(date,date,text[])
  set statement_timeout='25s';

analyze public.amazon_orders;
analyze public.amazon_finance_components;
