-- Amazon Analytics Phase B core schema.
-- Additive only. No credentials or buyer PII are stored in these tables.

create table if not exists public.amazon_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  seller_id text not null,
  display_name text not null default 'Amazon Europe',
  region text not null default 'EU' check (region in ('EU')),
  status text not null default 'pending' check (status in ('pending','connected','error','disabled')),
  initial_sync_from timestamptz not null default '2026-01-01T00:00:00Z'::timestamptz,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, seller_id)
);

create table if not exists public.amazon_marketplaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  marketplace_id text not null,
  country_code text not null,
  name text not null,
  currency_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, marketplace_id)
);

create table if not exists public.amazon_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  amazon_order_id text not null,
  marketplace_id text not null,
  purchase_date timestamptz,
  last_update_date timestamptz,
  order_status text,
  fulfillment_channel text,
  sales_channel text,
  currency_code text,
  gross_sales numeric(18,6),
  vat_amount numeric(18,6),
  shipping_amount numeric(18,6),
  promotion_discount numeric(18,6),
  order_total numeric(18,6),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, marketplace_id, amazon_order_id)
);

create table if not exists public.amazon_order_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  amazon_order_id text not null,
  marketplace_id text not null,
  order_item_id text not null,
  asin text,
  seller_sku text,
  quantity_ordered integer not null default 0 check (quantity_ordered >= 0),
  quantity_shipped integer not null default 0 check (quantity_shipped >= 0),
  item_price numeric(18,6),
  item_tax numeric(18,6),
  shipping_price numeric(18,6),
  shipping_tax numeric(18,6),
  promotion_discount numeric(18,6),
  currency_code text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, marketplace_id, amazon_order_id, order_item_id)
);

create table if not exists public.amazon_finance_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  transaction_key text not null,
  amazon_transaction_id text,
  marketplace_id text,
  amazon_order_id text,
  seller_sku text,
  asin text,
  posted_date timestamptz,
  transaction_status text,
  transaction_type text not null,
  category text not null check (category in ('sale','refund','referral_fee','fba_fee','storage_fee','other_fee','tax','adjustment','other')),
  amount_original numeric(18,6) not null default 0,
  currency_code text not null,
  amount_eur numeric(18,6),
  fx_rate numeric(20,10),
  related_identifiers jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, transaction_key)
);

create table if not exists public.amazon_inventory_current (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  marketplace_id text not null,
  seller_sku text not null,
  asin text,
  fulfillable_quantity integer not null default 0,
  inbound_working_quantity integer not null default 0,
  inbound_shipped_quantity integer not null default 0,
  inbound_receiving_quantity integer not null default 0,
  reserved_quantity integer not null default 0,
  unfulfillable_quantity integer not null default 0,
  researching_quantity integer not null default 0,
  total_quantity integer not null default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, marketplace_id, seller_sku)
);

create table if not exists public.amazon_inventory_daily (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  marketplace_id text not null,
  seller_sku text not null,
  asin text,
  snapshot_date date not null,
  fulfillable_quantity integer not null default 0,
  inbound_quantity integer not null default 0,
  reserved_quantity integer not null default 0,
  unfulfillable_quantity integer not null default 0,
  researching_quantity integer not null default 0,
  total_quantity integer not null default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, marketplace_id, seller_sku, snapshot_date)
);

create table if not exists public.amazon_sync_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid references public.amazon_accounts(id) on delete cascade,
  source text not null check (source in ('orders','finances','inventory','orchestrator')),
  mode text not null check (mode in ('initial','hourly','manual','reconcile')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  window_from timestamptz,
  window_to timestamptz,
  rows_processed integer not null default 0,
  error_message text,
  checkpoint jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.amazon_sync_state (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  source text not null check (source in ('orders','finances','inventory')),
  scope_key text not null default 'global',
  marketplace_id text,
  high_water_mark timestamptz,
  checkpoint jsonb not null default '{}'::jsonb,
  last_successful_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, source, scope_key)
);

create table if not exists public.amazon_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  run_id uuid references public.amazon_sync_runs(id) on delete set null,
  job_key text not null,
  source text not null check (source in ('orders','finances','inventory')),
  marketplace_id text,
  scope_key text not null default 'global',
  window_from timestamptz,
  window_to timestamptz,
  status text not null default 'queued' check (status in ('queued','running','success','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  finished_at timestamptz,
  rows_processed integer not null default 0,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, job_key)
);

create index if not exists amazon_marketplaces_owner_active_idx on public.amazon_marketplaces(owner_id, active, marketplace_id);
create index if not exists amazon_orders_purchase_idx on public.amazon_orders(owner_id, marketplace_id, purchase_date desc);
create index if not exists amazon_orders_update_idx on public.amazon_orders(owner_id, marketplace_id, last_update_date desc);
create index if not exists amazon_order_items_sku_idx on public.amazon_order_items(owner_id, marketplace_id, seller_sku);
create index if not exists amazon_order_items_asin_idx on public.amazon_order_items(owner_id, marketplace_id, asin);
create index if not exists amazon_finance_posted_idx on public.amazon_finance_transactions(owner_id, marketplace_id, posted_date desc);
create index if not exists amazon_finance_order_idx on public.amazon_finance_transactions(owner_id, amazon_order_id);
create index if not exists amazon_inventory_current_lookup_idx on public.amazon_inventory_current(owner_id, marketplace_id, seller_sku);
create index if not exists amazon_inventory_daily_date_idx on public.amazon_inventory_daily(owner_id, marketplace_id, snapshot_date desc);
create index if not exists amazon_sync_jobs_claim_idx on public.amazon_sync_jobs(status, available_at, created_at) where status='queued';
create index if not exists amazon_sync_runs_started_idx on public.amazon_sync_runs(owner_id, started_at desc);

alter table public.amazon_accounts enable row level security;
alter table public.amazon_marketplaces enable row level security;
alter table public.amazon_orders enable row level security;
alter table public.amazon_order_items enable row level security;
alter table public.amazon_finance_transactions enable row level security;
alter table public.amazon_inventory_current enable row level security;
alter table public.amazon_inventory_daily enable row level security;
alter table public.amazon_sync_runs enable row level security;
alter table public.amazon_sync_state enable row level security;
alter table public.amazon_sync_jobs enable row level security;

create policy amazon_accounts_select on public.amazon_accounts for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_marketplaces_select on public.amazon_marketplaces for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_orders_select on public.amazon_orders for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_order_items_select on public.amazon_order_items for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_finance_transactions_select on public.amazon_finance_transactions for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_inventory_current_select on public.amazon_inventory_current for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_inventory_daily_select on public.amazon_inventory_daily for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_sync_runs_select on public.amazon_sync_runs for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_sync_state_select on public.amazon_sync_state for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_sync_jobs_select on public.amazon_sync_jobs for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));

revoke all on table public.amazon_accounts, public.amazon_marketplaces, public.amazon_orders, public.amazon_order_items,
  public.amazon_finance_transactions, public.amazon_inventory_current, public.amazon_inventory_daily,
  public.amazon_sync_runs, public.amazon_sync_state, public.amazon_sync_jobs from anon;
revoke insert, update, delete on table public.amazon_accounts, public.amazon_marketplaces, public.amazon_orders, public.amazon_order_items,
  public.amazon_finance_transactions, public.amazon_inventory_current, public.amazon_inventory_daily,
  public.amazon_sync_runs, public.amazon_sync_state, public.amazon_sync_jobs from anon, authenticated;
grant select on table public.amazon_accounts, public.amazon_marketplaces, public.amazon_orders, public.amazon_order_items,
  public.amazon_finance_transactions, public.amazon_inventory_current, public.amazon_inventory_daily,
  public.amazon_sync_runs, public.amazon_sync_state, public.amazon_sync_jobs to authenticated;

create or replace function private.amazon_claim_sync_jobs(limit_count integer default 3)
returns setof public.amazon_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if limit_count < 1 or limit_count > 20 then
    raise exception 'Invalid job claim size';
  end if;

  return query
  with candidates as (
    select j.id
    from public.amazon_sync_jobs j
    where j.status='queued'
      and j.available_at <= now()
      and j.attempts < j.max_attempts
    order by j.available_at, j.created_at
    for update skip locked
    limit limit_count
  )
  update public.amazon_sync_jobs j
  set status='running',
      attempts=j.attempts + 1,
      locked_at=now(),
      updated_at=now()
  from candidates c
  where j.id=c.id
  returning j.*;
end;
$$;

revoke all on function private.amazon_claim_sync_jobs(integer) from public;
revoke all on function private.amazon_claim_sync_jobs(integer) from anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.amazon_claim_sync_jobs(integer) to service_role;
