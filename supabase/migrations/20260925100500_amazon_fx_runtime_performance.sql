-- Reduce per-row overhead for Amazon analytics currency conversion.
-- Previous implementation performed two app_settings lookups for every amount.
create or replace function private.amazon_rate_to_consolidated(
  p_owner uuid,
  p_currency text,
  p_event_date date
)
returns numeric
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_source text:=upper(coalesce(nullif(trim(p_currency),''),'EUR'));
  v_target text:='EUR';
  v_policy text:='last_known';
  v_source_eur numeric;
  v_target_eur numeric;
begin
  if p_event_date is null then return null; end if;

  select
    upper(coalesce(nullif(trim(s.config->'amazon'->>'consolidatedCurrency'),''),'EUR')),
    lower(coalesce(nullif(trim(s.config->'amazon'->>'fxMissingRatePolicy'),''),'last_known'))
  into v_target,v_policy
  from public.app_settings s
  where s.owner_id=p_owner
  limit 1;

  v_target:=coalesce(v_target,'EUR');
  v_policy:=coalesce(v_policy,'last_known');

  if v_source=v_target then return 1; end if;

  if v_source='EUR' then
    v_source_eur:=1;
  else
    select r.rate_to_eur into v_source_eur
    from public.amazon_fx_rates r
    where r.currency_code=v_source
      and (
        (v_policy='exclude' and r.rate_date=p_event_date)
        or
        (v_policy<>'exclude' and r.rate_date<=p_event_date)
      )
    order by r.rate_date desc
    limit 1;
  end if;

  if v_target='EUR' then
    v_target_eur:=1;
  else
    select r.rate_to_eur into v_target_eur
    from public.amazon_fx_rates r
    where r.currency_code=v_target
      and (
        (v_policy='exclude' and r.rate_date=p_event_date)
        or
        (v_policy<>'exclude' and r.rate_date<=p_event_date)
      )
    order by r.rate_date desc
    limit 1;
  end if;

  if v_source_eur is null or v_target_eur is null or v_target_eur=0 then return null; end if;
  return v_source_eur/v_target_eur;
end;
$function$;
