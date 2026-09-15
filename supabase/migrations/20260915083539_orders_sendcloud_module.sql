alter table public.app_users drop constraint if exists app_users_permissions_check;
alter table public.app_users add constraint app_users_permissions_check
  check (permissions <@ array['dashboard','sales','orders','invoices','clients','products','suppliers']::text[]);

create table if not exists public.fulfillment_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  sendcloud_id text not null,
  order_id text,
  order_number text,
  integration_id bigint not null,
  integration_name text,
  integration_type text,
  source_channel text not null default 'other' check (source_channel in ('amazon','shopify','other')),
  source_status text,
  order_created_at timestamptz,
  order_updated_at timestamptz,
  customer_name text,
  customer_email text,
  customer_phone text,
  shipping_address jsonb not null default '{}'::jsonb,
  billing_address jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  total_amount numeric(12,2),
  currency text,
  raw_payload jsonb not null default '{}'::jsonb,
  sendcloud_parcel_id bigint,
  sendcloud_shipment_id text,
  tracking_number text,
  tracking_url text,
  shipping_option_code text,
  contract_id bigint,
  label_created_at timestamptz,
  fulfilled_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, sendcloud_id)
);

create index if not exists fulfillment_orders_owner_created_idx
  on public.fulfillment_orders(owner_id, order_created_at desc);
create index if not exists fulfillment_orders_owner_status_idx
  on public.fulfillment_orders(owner_id, source_status, label_created_at);
create index if not exists fulfillment_orders_owner_channel_idx
  on public.fulfillment_orders(owner_id, source_channel, order_created_at desc);

alter table public.fulfillment_orders enable row level security;

drop policy if exists fulfillment_orders_workspace_select on public.fulfillment_orders;
create policy fulfillment_orders_workspace_select
on public.fulfillment_orders
for select
to authenticated
using (
  owner_id = (select private.app_workspace_owner_id())
  and (select private.app_has_permission('orders'))
);

revoke all on table public.fulfillment_orders from anon;
grant select on table public.fulfillment_orders to authenticated;

create trigger fulfillment_orders_set_updated_at
before update on public.fulfillment_orders
for each row execute function public.set_updated_at();
