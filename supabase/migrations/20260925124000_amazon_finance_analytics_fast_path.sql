-- Fast path for Amazon analytics.
-- amazon_finance_components is a normalized derived table. The original SP-API
-- transaction payload remains in amazon_finance_transactions.metadata, so the
-- derived components can safely keep gross + tax semantics for analytics.

-- Superseded DEFERRED transactions remain in the transaction ledger for audit,
-- but their derived components must not participate in analytics.
delete from public.amazon_finance_components c
using public.amazon_finance_transactions t
where c.finance_transaction_id=t.id
  and coalesce(t.superseded,false);

-- Reserve debit/credit is a cash movement, not an operating adjustment.
delete from public.amazon_finance_components c
using public.amazon_finance_transactions t
where c.finance_transaction_id=t.id
  and c.component_category='adjustment'
  and c.component_type='Adjustment (fallback)'
  and (
    t.metadata::text ilike '%ReserveDebit%'
    or t.metadata::text ilike '%ReserveCredit%'
  );

-- EUR is by far the dominant currency. Return immediately for EUR instead of
-- reading app_settings for every row. For non-EUR currencies preserve the
-- configured missing-rate policy.
create or replace function private.amazon_rate_to_eur(
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
  v_policy text:='last_known';
  v_rate numeric;
  v_owner uuid;
begin
  if p_event_date is null then return null; end if;
  if v_source='EUR' then return 1; end if;

  v_owner:=private.app_workspace_owner_id();
  if v_owner is not null then
    select lower(coalesce(nullif(trim(s.config->'amazon'->>'fxMissingRatePolicy'),''),'last_known'))
      into v_policy
    from public.app_settings s
    where s.owner_id=v_owner
    limit 1;
  end if;
  v_policy:=coalesce(v_policy,'last_known');

  select r.rate_to_eur
    into v_rate
  from public.amazon_fx_rates r
  where r.currency_code=v_source
    and (
      (v_policy='exclude' and r.rate_date=p_event_date)
      or
      (v_policy<>'exclude' and r.rate_date<=p_event_date)
    )
  order by r.rate_date desc
  limit 1;

  return v_rate;
end;
$$;

revoke all on function private.amazon_rate_to_eur(text,date) from public,anon;
grant execute on function private.amazon_rate_to_eur(text,date) to authenticated,service_role;

-- Prevent reintroduction of rows that are already superseded and infer Spanish
-- VAT for standalone ServiceFee rows that Amazon supplies as gross-only.
create or replace function private.amazon_prepare_finance_component_fast()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transaction_type text;
  v_superseded boolean;
  v_metadata jsonb;
  v_owner uuid;
  v_country text;
begin
  select t.transaction_type,coalesce(t.superseded,false),t.metadata,t.owner_id
    into v_transaction_type,v_superseded,v_metadata,v_owner
  from public.amazon_finance_transactions t
  where t.id=new.finance_transaction_id;

  if coalesce(v_superseded,false) then return null; end if;

  if new.component_category='adjustment'
     and new.component_type='Adjustment (fallback)'
     and (
       coalesce(v_metadata,'{}'::jsonb)::text ilike '%ReserveDebit%'
       or coalesce(v_metadata,'{}'::jsonb)::text ilike '%ReserveCredit%'
     ) then
    return null;
  end if;

  if new.tax_amount_original is null
     and v_transaction_type='ServiceFee'
     and new.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')
     and new.amount_original<>0 then
    select upper(coalesce(b.country_code,'')) into v_country
    from public.business_settings b
    where b.owner_id=v_owner
    limit 1;
    if v_country='ES' then
      new.tax_amount_original:=new.amount_original-(new.amount_original/1.21);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_amazon_prepare_finance_component on public.amazon_finance_components;
drop trigger if exists trg_amazon_prepare_finance_component_fast on public.amazon_finance_components;
create trigger trg_amazon_prepare_finance_component_fast
before insert or update on public.amazon_finance_components
for each row execute function private.amazon_prepare_finance_component_fast();

-- Keep the transaction ledger, mark superseded predecessors and remove only
-- their derived analytics components.
create or replace function private.amazon_mark_deferred_transaction_superseded()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deferred_id text;
  v_old_transaction uuid;
begin
  for v_deferred_id in
    select identifier->>'value'
    from jsonb_array_elements(coalesce(new.related_identifiers,'[]'::jsonb)) identifier
    where identifier->>'name'='DEFERRED_TRANSACTION_ID'
      and nullif(identifier->>'value','') is not null
  loop
    for v_old_transaction in
      update public.amazon_finance_transactions old_tx
      set superseded=true,updated_at=now()
      where old_tx.owner_id=new.owner_id
        and old_tx.amazon_account_id=new.amazon_account_id
        and old_tx.amazon_transaction_id=v_deferred_id
        and not old_tx.superseded
      returning old_tx.id
    loop
      delete from public.amazon_finance_components c
      where c.finance_transaction_id=v_old_transaction;
    end loop;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_amazon_mark_deferred_transaction_superseded on public.amazon_finance_transactions;
create trigger trg_amazon_mark_deferred_transaction_superseded
after insert or update of related_identifiers,transaction_status on public.amazon_finance_transactions
for each row execute function private.amazon_mark_deferred_transaction_superseded();

-- The previous analytics view joined every component to the transaction ledger
-- and business settings. With ~100k components that made a simple monthly
-- summary take tens of seconds. All normalization now happens at ingestion, so
-- analytics can read the derived table directly.
create or replace view private.amazon_finance_components_analytics
with (security_invoker=false)
as
select
  c.id,c.owner_id,c.amazon_account_id,c.finance_transaction_id,c.marketplace_id,
  c.amazon_order_id,c.seller_sku,c.asin,c.posted_date,c.component_key,
  c.component_type,c.component_category,c.amount_original::numeric as amount_original,c.currency_code,
  c.tax_amount_original::numeric as tax_amount_original,c.amount_eur,c.tax_amount_eur,c.fx_rate,c.created_at,c.updated_at
from public.amazon_finance_components c;

grant select on private.amazon_finance_components_analytics to authenticated;

create index if not exists amazon_finance_components_order_analytics_idx
  on public.amazon_finance_components(owner_id,amazon_account_id,amazon_order_id,marketplace_id,component_category)
  include(amount_original,tax_amount_original,currency_code,posted_date,component_type)
  where amazon_order_id is not null;

create index if not exists amazon_finance_components_global_analytics_idx
  on public.amazon_finance_components(owner_id,posted_date,marketplace_id,component_category)
  include(amount_original,tax_amount_original,currency_code,component_type)
  where amazon_order_id is null;

analyze public.amazon_finance_components;
analyze public.amazon_finance_transactions;
