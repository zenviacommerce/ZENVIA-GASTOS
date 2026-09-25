-- Normalize Amazon finance analytics without rewriting the raw SP-API data.
--
-- Amazon Finances v2024 exposes many fees as a parent with sibling Base + Tax
-- nodes. The stored amount_original is intentionally the Base amount (net of
-- VAT), while tax_amount_original stores the Tax sibling. Some standalone
-- ServiceFee rows expose only a gross amount. Analytics therefore read through
-- a normalized view that presents a consistent gross + tax pair.
--
-- Finance transactions also move through DEFERRED -> RELEASED lifecycle states.
-- RELEASED rows point to their predecessor via DEFERRED_TRANSACTION_ID. The
-- predecessor must remain stored for audit, but must not be counted twice.

alter table public.amazon_finance_transactions
  add column if not exists superseded boolean not null default false;

create index if not exists amazon_finance_transactions_external_id_idx
  on public.amazon_finance_transactions(owner_id,amazon_account_id,amazon_transaction_id)
  where amazon_transaction_id is not null;

create index if not exists amazon_finance_transactions_superseded_idx
  on public.amazon_finance_transactions(owner_id,superseded,posted_date desc);

-- Mark historical deferred rows already superseded by a released transaction.
with links as (
  select distinct
    released.owner_id,
    released.amazon_account_id,
    identifier->>'value' as deferred_transaction_id
  from public.amazon_finance_transactions released
  cross join lateral jsonb_array_elements(coalesce(released.related_identifiers,'[]'::jsonb)) identifier
  where identifier->>'name'='DEFERRED_TRANSACTION_ID'
    and nullif(identifier->>'value','') is not null
)
update public.amazon_finance_transactions old_tx
set superseded=true,
    updated_at=now()
from links
where old_tx.owner_id=links.owner_id
  and old_tx.amazon_account_id=links.amazon_account_id
  and old_tx.amazon_transaction_id=links.deferred_transaction_id
  and not old_tx.superseded;

create or replace function private.amazon_mark_deferred_transaction_superseded()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deferred_id text;
begin
  for v_deferred_id in
    select identifier->>'value'
    from jsonb_array_elements(coalesce(new.related_identifiers,'[]'::jsonb)) identifier
    where identifier->>'name'='DEFERRED_TRANSACTION_ID'
      and nullif(identifier->>'value','') is not null
  loop
    update public.amazon_finance_transactions old_tx
    set superseded=true,
        updated_at=now()
    where old_tx.owner_id=new.owner_id
      and old_tx.amazon_account_id=new.amazon_account_id
      and old_tx.amazon_transaction_id=v_deferred_id
      and not old_tx.superseded;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_amazon_mark_deferred_transaction_superseded on public.amazon_finance_transactions;
create trigger trg_amazon_mark_deferred_transaction_superseded
after insert or update of related_identifiers,transaction_status on public.amazon_finance_transactions
for each row execute function private.amazon_mark_deferred_transaction_superseded();

-- Remove the earlier experimental component triggers if this migration is
-- replayed in an environment where they were created during development.
drop trigger if exists trg_amazon_prepare_finance_component on public.amazon_finance_components;
drop trigger if exists trg_amazon_remove_superseded_finance_components on public.amazon_finance_transactions;
drop function if exists private.amazon_prepare_finance_component();
drop function if exists private.amazon_remove_superseded_finance_components();

create or replace view private.amazon_finance_components_analytics
with (security_invoker=false)
as
select
  c.id,
  c.owner_id,
  c.amazon_account_id,
  c.finance_transaction_id,
  c.marketplace_id,
  c.amazon_order_id,
  c.seller_sku,
  c.asin,
  c.posted_date,
  c.component_key,
  c.component_type,
  c.component_category,
  -- Analytics expects amount_original to be gross and subtracts tax. For normal
  -- Base+Tax nodes, reconstruct gross as Base + Tax. For standalone ServiceFee
  -- rows Amazon gives us a gross amount, so leave it unchanged.
  case
    when c.tax_amount_original is not null then c.amount_original+c.tax_amount_original
    else c.amount_original
  end as amount_original,
  c.currency_code,
  case
    when c.tax_amount_original is not null then c.tax_amount_original
    when t.transaction_type='ServiceFee'
      and upper(coalesce(b.country_code,''))='ES'
      and c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')
      and c.amount_original<>0
      then c.amount_original-(c.amount_original/1.21)
    else null
  end as tax_amount_original,
  c.amount_eur,
  c.tax_amount_eur,
  c.fx_rate,
  c.created_at,
  c.updated_at
from public.amazon_finance_components c
join public.amazon_finance_transactions t on t.id=c.finance_transaction_id
left join public.business_settings b on b.owner_id=c.owner_id
where not coalesce(t.superseded,false)
  and not (
    c.component_category='adjustment'
    and c.component_type='Adjustment (fallback)'
    and (
      t.metadata::text ilike '%ReserveDebit%'
      or t.metadata::text ilike '%ReserveCredit%'
    )
  );

-- Route all Amazon analytics RPCs through the normalized finance view. This
-- keeps summary, series, products, marketplaces, orders and detail consistent.
do $$
declare
  r record;
  definition text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname like 'amazon_analytics_%'
      and pg_get_functiondef(p.oid) like '%public.amazon_finance_components%'
  loop
    definition:=pg_get_functiondef(r.oid);
    definition:=replace(definition,'public.amazon_finance_components','private.amazon_finance_components_analytics');
    execute definition;
  end loop;
end;
$$;

grant select on private.amazon_finance_components_analytics to authenticated;
