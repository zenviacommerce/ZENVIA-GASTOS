-- Amazon Configuration Center runtime behavior.
-- Keeps exact Amazon tax/factor data authoritative while making safe fallbacks configurable.

create or replace function private.amazon_setting_text(
  p_owner uuid,
  p_key text,
  p_fallback text
)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    nullif(trim((
      select s.config->'amazon'->>p_key
      from public.app_settings s
      where s.owner_id=p_owner
      limit 1
    )),''),
    p_fallback
  );
$$;

-- Despite the legacy name, all existing analytics callers now receive a factor
-- from the event currency into the configured consolidated currency.
create or replace function private.amazon_rate_to_consolidated(
  p_owner uuid,
  p_currency text,
  p_event_date date
)
returns numeric
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_source text:=upper(coalesce(nullif(trim(p_currency),''),'EUR'));
  v_target text:=upper(private.amazon_setting_text(p_owner,'consolidatedCurrency','EUR'));
  v_policy text:=lower(private.amazon_setting_text(p_owner,'fxMissingRatePolicy','last_known'));
  v_source_eur numeric;
  v_target_eur numeric;
begin
  if p_event_date is null then return null; end if;
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
$$;

create or replace function private.amazon_rate_to_eur(p_currency text,p_event_date date)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select private.amazon_rate_to_consolidated(
    private.app_workspace_owner_id(),
    p_currency,
    p_event_date
  );
$$;

create or replace function private.amazon_effective_vat_amount(
  p_owner uuid,
  p_gross numeric,
  p_explicit_vat numeric,
  p_is_business boolean
)
returns numeric
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_rate numeric;
begin
  if p_explicit_vat is not null then return p_explicit_vat; end if;
  if coalesce(p_is_business,false) then return 0::numeric; end if;
  if p_gross is null then return null; end if;

  begin
    v_rate:=private.amazon_setting_text(p_owner,'defaultVatRate','21')::numeric;
  exception when others then
    v_rate:=21;
  end;
  v_rate:=greatest(0,least(100,v_rate));
  if v_rate=0 then return 0::numeric; end if;
  return p_gross-(p_gross/(1+(v_rate/100)));
end;
$$;

revoke all on function private.amazon_setting_text(uuid,text,text) from public,anon,authenticated;
revoke all on function private.amazon_rate_to_consolidated(uuid,text,date) from public,anon,authenticated;
revoke all on function private.amazon_rate_to_eur(text,date) from public,anon,authenticated;
revoke all on function private.amazon_effective_vat_amount(uuid,numeric,numeric,boolean) from public,anon,authenticated;

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.amazon_analytics_summary(date,date,text[])'::regprocedure) into v_def;
  v_old := $old$coalesce(
        o.vat_amount,
        ta.tax_amount,
        it.item_tax_total,
        case when coalesce(o.is_business_order,false) then 0::numeric end
      ) effective_vat_amount$old$;
  v_new := $new$private.amazon_effective_vat_amount(
        v_owner,
        coalesce(o.order_total,it.item_total),
        coalesce(o.vat_amount,ta.tax_amount,it.item_tax_total),
        coalesce(o.is_business_order,false)
      ) effective_vat_amount$new$;
  if position(v_old in v_def)>0 then execute replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then raise exception 'Expected VAT fragment not found in amazon_analytics_summary'; end if;

  select pg_get_functiondef('public.amazon_analytics_series(date,date,text[],text)'::regprocedure) into v_def;
  if position(v_old in v_def)>0 then execute replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then raise exception 'Expected VAT fragment not found in amazon_analytics_series'; end if;

  select pg_get_functiondef('public.amazon_analytics_products(date,date,text[],text,integer,integer,text,text)'::regprocedure) into v_def;
  v_old := $old$coalesce(i.item_tax,case when coalesce(eo.is_business_order,false) then 0::numeric end) effective_item_tax$old$;
  v_new := $new$private.amazon_effective_vat_amount(
             v_owner,
             i.item_price,
             i.item_tax,
             coalesce(eo.is_business_order,false)
           ) effective_item_tax$new$;
  if position(v_old in v_def)>0 then execute replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then raise exception 'Expected VAT fragment not found in amazon_analytics_products'; end if;

  select pg_get_functiondef('public.amazon_analytics_orders(date,date,text[],text,integer,integer)'::regprocedure) into v_def;
  v_old := $old$case when o.order_total is not null and o.vat_amount is not null and o.order_fx is not null then (o.order_total-o.vat_amount)*o.order_fx else 0 end::numeric net_sales,$old$;
  v_new := $new$case when o.order_total is not null and o.order_fx is not null then
        (o.order_total-private.amazon_effective_vat_amount(v_owner,o.order_total,o.vat_amount,coalesce(o.is_business_order,false)))*o.order_fx
        else 0 end::numeric net_sales,$new$;
  if position(v_old in v_def)>0 then v_def:=replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then raise exception 'Expected net sales fragment not found in amazon_analytics_orders'; end if;

  v_old := $old$(o.order_total is not null and o.vat_amount is not null and o.order_fx is not null and coalesce(i.item_complete,false) and coalesce(f.missing_fx,0)=0) row_complete,$old$;
  v_new := $new$(o.order_total is not null
        and private.amazon_effective_vat_amount(v_owner,o.order_total,o.vat_amount,coalesce(o.is_business_order,false)) is not null
        and o.order_fx is not null
        and coalesce(i.item_complete,false)
        and coalesce(f.missing_fx,0)=0) row_complete,$new$;
  if position(v_old in v_def)>0 then execute replace(v_def,v_old,v_new);
  elsif position(v_new in v_def)=0 then raise exception 'Expected completeness fragment not found in amazon_analytics_orders';
  else execute v_def; end if;
end
$migration$;

notify pgrst,'reload schema';
