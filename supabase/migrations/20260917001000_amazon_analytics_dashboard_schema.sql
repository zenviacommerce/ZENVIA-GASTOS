-- Amazon Analytics dashboard storage schema.
-- Additive only. No buyer PII or SP-API credentials are stored here.

create table if not exists public.amazon_product_mappings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  consumption_factor numeric(18,6) not null default 1 check (consumption_factor > 0),
  mapping_source text not null default 'manual' check (mapping_source in ('automatic','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, seller_sku)
);

create table if not exists public.amazon_finance_components (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  finance_transaction_id uuid not null references public.amazon_finance_transactions(id) on delete cascade,
  marketplace_id text,
  amazon_order_id text,
  seller_sku text,
  asin text,
  posted_date timestamptz,
  component_key text not null,
  component_type text not null,
  component_category text not null check (component_category in (
    'refund','commission_fee','fba_fee','digital_services_fee','storage_fee',
    'other_amazon_fee','adjustment','ads_payment_excluded','sale_audit','tax_audit'
  )),
  amount_original numeric(18,6) not null,
  currency_code text not null,
  tax_amount_original numeric(18,6),
  amount_eur numeric(18,6),
  tax_amount_eur numeric(18,6),
  fx_rate numeric(20,10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, finance_transaction_id, component_key)
);

create table if not exists public.amazon_fx_rates (
  rate_date date not null,
  currency_code text not null,
  rate_to_eur numeric(20,10) not null check (rate_to_eur > 0),
  source text not null default 'ECB',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rate_date, currency_code)
);

create index if not exists amazon_product_mappings_sku_idx
  on public.amazon_product_mappings(owner_id, amazon_account_id, seller_sku);
create index if not exists amazon_product_mappings_product_idx
  on public.amazon_product_mappings(owner_id, product_id);
create index if not exists amazon_finance_components_period_idx
  on public.amazon_finance_components(owner_id, marketplace_id, posted_date desc, component_category);
create index if not exists amazon_finance_components_order_idx
  on public.amazon_finance_components(owner_id, amazon_order_id);
create index if not exists amazon_finance_components_sku_idx
  on public.amazon_finance_components(owner_id, seller_sku, posted_date desc);
create index if not exists amazon_fx_rates_lookup_idx
  on public.amazon_fx_rates(currency_code, rate_date desc);
create index if not exists amazon_price_history_analytics_idx
  on public.product_price_history(owner_id, product_id, price_date desc, created_at desc);

alter table public.amazon_product_mappings enable row level security;
alter table public.amazon_finance_components enable row level security;
alter table public.amazon_fx_rates enable row level security;

create policy amazon_product_mappings_select on public.amazon_product_mappings for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_finance_components_select on public.amazon_finance_components for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));

-- FX contains no workspace/private information. Analytics RPCs consume it server-side.
revoke all on table public.amazon_fx_rates from anon, authenticated;

revoke all on table public.amazon_product_mappings, public.amazon_finance_components from anon;
revoke insert, update, delete on table public.amazon_product_mappings, public.amazon_finance_components from anon, authenticated;
grant select on table public.amazon_product_mappings, public.amazon_finance_components to authenticated;
