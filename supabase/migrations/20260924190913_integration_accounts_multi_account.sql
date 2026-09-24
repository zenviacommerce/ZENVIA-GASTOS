create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('amazon','sendcloud','shopify','gmail')),
  display_name text not null,
  external_account_id text,
  status text not null default 'pending' check (status in ('pending','connected','error','disabled')),
  enabled boolean not null default true,
  is_default boolean not null default false,
  credential_source text not null default 'vault' check (credential_source in ('vault','environment','session','derived')),
  secret_id uuid,
  parent_account_id uuid references public.integration_accounts(id) on delete set null,
  linked_resource_id uuid,
  config jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists integration_accounts_owner_provider_external_uidx
  on public.integration_accounts(owner_id,provider,external_account_id)
  where external_account_id is not null;

create unique index if not exists integration_accounts_default_uidx
  on public.integration_accounts(owner_id,provider)
  where is_default;

create index if not exists integration_accounts_owner_provider_idx
  on public.integration_accounts(owner_id,provider,status,updated_at desc);

alter table public.integration_accounts enable row level security;
revoke all on table public.integration_accounts from anon, authenticated;
grant select, insert, update, delete on table public.integration_accounts to service_role;

create or replace function public.integration_store_secret(
  p_secret text,
  p_name text,
  p_description text default null,
  p_existing_secret_id uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  if coalesce(btrim(p_secret),'')='' then
    raise exception 'El secreto no puede estar vacío.';
  end if;
  if p_existing_secret_id is null then
    select vault.create_secret(p_secret,p_name,p_description,null) into v_secret_id;
  else
    perform vault.update_secret(p_existing_secret_id,p_secret,p_name,p_description,null);
    v_secret_id:=p_existing_secret_id;
  end if;
  return v_secret_id;
end;
$$;

create or replace function public.integration_read_secret(p_secret_id uuid)
returns text
language sql
security invoker
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where id=p_secret_id
$$;

revoke all on function public.integration_store_secret(text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.integration_read_secret(uuid) from public, anon, authenticated;
grant execute on function public.integration_store_secret(text,text,text,uuid) to service_role;
grant execute on function public.integration_read_secret(uuid) to service_role;

alter table public.amazon_accounts
  add column if not exists integration_account_id uuid references public.integration_accounts(id) on delete set null;

create unique index if not exists amazon_accounts_integration_account_uidx
  on public.amazon_accounts(integration_account_id)
  where integration_account_id is not null;

alter table public.fulfillment_orders
  add column if not exists source_integration_account_id uuid references public.integration_accounts(id) on delete set null,
  add column if not exists shipping_integration_account_id uuid references public.integration_accounts(id) on delete set null;

alter table public.gmail_imports
  add column if not exists integration_account_id uuid references public.integration_accounts(id) on delete set null;

create index if not exists fulfillment_orders_source_integration_idx
  on public.fulfillment_orders(owner_id,source_integration_account_id,order_created_at desc);

create index if not exists fulfillment_orders_shipping_integration_idx
  on public.fulfillment_orders(owner_id,shipping_integration_account_id,last_synced_at desc);

create index if not exists gmail_imports_integration_account_idx
  on public.gmail_imports(owner_id,integration_account_id,received_at desc);
