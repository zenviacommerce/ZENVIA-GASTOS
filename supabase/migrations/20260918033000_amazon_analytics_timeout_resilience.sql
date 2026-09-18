-- Reduce Amazon Analytics statement-timeout risk.
-- Keep timestamp predicates sargable so btree indexes can be used.

create index if not exists amazon_finance_components_owner_posted_idx
  on public.amazon_finance_components(owner_id,posted_date desc,marketplace_id,component_category);

create index if not exists amazon_finance_components_tax_audit_order_idx
  on public.amazon_finance_components(owner_id,amazon_account_id,marketplace_id,amazon_order_id)
  include (amount_original,currency_code)
  where component_category='tax_audit' and amazon_order_id is not null;

do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select p.oid,p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'amazon_analytics_summary',
        'amazon_analytics_series',
        'amazon_analytics_products',
        'amazon_analytics_marketplaces',
        'amazon_analytics_orders'
      )
  loop
    v_def:=pg_get_functiondef(r.oid);
    -- Replace the longer alias first so "o.purchase_date" can never match inside "eo.purchase_date".
    v_new:=replace(
      v_def,
      'eo.purchase_date::date between from_date and to_date',
      'eo.purchase_date >= from_date::timestamptz and eo.purchase_date < (to_date+1)::timestamptz'
    );
    v_new:=replace(
      v_new,
      'o.purchase_date::date between from_date and to_date',
      'o.purchase_date >= from_date::timestamptz and o.purchase_date < (to_date+1)::timestamptz'
    );
    v_new:=replace(
      v_new,
      'c.posted_date::date between from_date and to_date',
      'c.posted_date >= from_date::timestamptz and c.posted_date < (to_date+1)::timestamptz'
    );
    v_new:=replace(
      v_new,
      'f.order_created_at::date between from_date and to_date',
      'f.order_created_at >= from_date::timestamptz and f.order_created_at < (to_date+1)::timestamptz'
    );
    if v_new<>v_def then execute v_new; end if;
  end loop;
end $$;

analyze public.amazon_orders;
analyze public.amazon_order_items;
analyze public.amazon_finance_components;
analyze public.amazon_product_mappings;
analyze public.product_price_history;
