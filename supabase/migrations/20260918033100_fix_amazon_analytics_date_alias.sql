-- Repair the safe timestamp-range rewrite for functions using the eo alias.
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
      and p.proname in ('amazon_analytics_summary','amazon_analytics_series')
  loop
    v_def:=pg_get_functiondef(r.oid);
    v_new:=replace(
      v_def,
      'eo.purchase_date >= from_date::timestamptz and o.purchase_date < (to_date+1)::timestamptz',
      'eo.purchase_date >= from_date::timestamptz and eo.purchase_date < (to_date+1)::timestamptz'
    );
    if v_new<>v_def then execute v_new; end if;
  end loop;
end $$;
