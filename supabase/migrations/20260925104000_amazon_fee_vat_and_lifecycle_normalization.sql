-- Normalize Amazon finance component semantics and prevent lifecycle double counting.
-- Amazon Finances v2024 often exposes fee nodes as:
--   Fee -> Base + Tax
-- where Base is already NET of VAT. The app previously persisted Base in
-- amount_original and then subtracted Tax again in analytics. We migrate those
-- rows to gross=Base+Tax so the existing "gross - tax = net" formula is correct.
--
-- RELEASED transactions also reference their previous DEFERRED transaction via
-- related_identifiers.DEFERRED_TRANSACTION_ID. Keeping both component sets
-- double-counted the same economic event. Superseded components are removed and
-- prevented from being reinserted.
--
-- Spain-established sellers are invoiced locally by Amazon EU and local VAT is
-- charged on Amazon service fees. Some ServiceFee transactions expose only a
-- gross amount without a Tax child, so for ES owners we infer 21% VAT there.

-- 1) Convert already-persisted Base+Tax components from net-in-amount to
--    gross-in-amount. This migration is one-shot and intentionally not repeated.
update public.amazon_finance_components
set amount_original=amount_original+tax_amount_original,
    updated_at=now()
where tax_amount_original is not null;

-- 2) Infer VAT for gross ServiceFee rows where Amazon omitted a Tax breakdown.
update public.amazon_finance_components c
set tax_amount_original=c.amount_original-(c.amount_original/1.21),
    updated_at=now()
from public.amazon_finance_transactions t
join public.business_settings b on b.owner_id=t.owner_id
where c.finance_transaction_id=t.id
  and upper(coalesce(b.country_code,''))='ES'
  and t.transaction_type='ServiceFee'
  and c.tax_amount_original is null
  and c.component_category in ('commission_fee','fba_fee','digital_services_fee','storage_fee','other_amazon_fee')
  and c.amount_original<>0;

-- 3) Drop historical components from DEFERRED transactions that have already
--    been released.
delete from public.amazon_finance_components c
using public.amazon_finance_transactions old_tx
where c.finance_transaction_id=old_tx.id
  and old_tx.amazon_transaction_id is not null
  and exists(
    select 1
    from public.amazon_finance_transactions released_tx
    cross join lateral jsonb_array_elements(coalesce(released_tx.related_identifiers,'[]'::jsonb)) identifier
    where released_tx.owner_id=old_tx.owner_id
      and released_tx.amazon_account_id=old_tx.amazon_account_id
      and identifier->>'name'='DEFERRED_TRANSACTION_ID'
      and identifier->>'value'=old_tx.amazon_transaction_id
  );

-- 4) Remove old reserve-movement fallback rows. Reserve debit/credit is a cash
--    movement, not an Amazon operating expense.
delete from public.amazon_finance_components c
using public.amazon_finance_transactions t
where c.finance_transaction_id=t.id
  and c.component_category='adjustment'
  and c.component_type='Adjustment (fallback)'
  and (
    t.metadata::text ilike '%ReserveDebit%'
    or t.metadata::text ilike '%ReserveCredit%'
  );

create or replace function private.amazon_prepare_finance_component()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transaction_type text;
  v_transaction_id text;
  v_owner uuid;
  v_account uuid;
  v_country text;
begin
  select t.transaction_type,t.amazon_transaction_id,t.owner_id,t.amazon_account_id
  into v_transaction_type,v_transaction_id,v_owner,v_account
  from public.amazon_finance_transactions t
  where t.id=new.finance_transaction_id;

  -- If a RELEASED transaction already points back to this transaction, its
  -- components are superseded and must not be reinserted by an overlapping sync.
  if v_transaction_id is not null and exists(
    select 1
    from public.amazon_finance_transactions released_tx
    cross join lateral jsonb_array_elements(coalesce(released_tx.related_identifiers,'[]'::jsonb)) identifier
    where released_tx.owner_id=v_owner
      and released_tx.amazon_account_id=v_account
      and identifier->>'name'='DEFERRED_TRANSACTION_ID'
      and identifier->>'value'=v_transaction_id
  ) then
    return null;
  end if;

  -- ServiceFee totals can arrive gross without a nested Tax node. Infer Spanish
  -- VAT only for fee categories and only when no explicit tax was provided.
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
create trigger trg_amazon_prepare_finance_component
before insert or update on public.amazon_finance_components
for each row execute function private.amazon_prepare_finance_component();

create or replace function private.amazon_remove_superseded_finance_components()
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
    delete from public.amazon_finance_components c
    using public.amazon_finance_transactions old_tx
    where c.finance_transaction_id=old_tx.id
      and old_tx.owner_id=new.owner_id
      and old_tx.amazon_account_id=new.amazon_account_id
      and old_tx.amazon_transaction_id=v_deferred_id;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_amazon_remove_superseded_finance_components on public.amazon_finance_transactions;
create trigger trg_amazon_remove_superseded_finance_components
after insert or update of related_identifiers,transaction_status on public.amazon_finance_transactions
for each row execute function private.amazon_remove_superseded_finance_components();
