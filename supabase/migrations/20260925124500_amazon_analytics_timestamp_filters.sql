-- Make period filters sargable in the heavy Amazon base analytics functions.
-- Casting posted_date to date forced PostgreSQL to scan the full finance table
-- for global/account costs even for a single month.
do $$
declare
  r record;
  definition text;
  before_text constant text := 'c.posted_date::date between from_date and to_date';
  after_text constant text := 'c.posted_date >= from_date::timestamptz and c.posted_date < (to_date+1)::timestamptz';
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
    if position(before_text in definition)=0 then
      raise exception 'Expected Amazon date filter was not found in %',r.proname;
    end if;
    definition:=replace(definition,before_text,after_text);
    execute definition;
  end loop;
end;
$$;

-- Keep a little headroom above the authenticated role timeout for these
-- security-definer analytics functions while retaining a finite upper bound.
alter function public.amazon_analytics_series_without_fbm_20260917(date,date,text[],text)
  set statement_timeout='15s';

analyze public.amazon_finance_components;
