-- SaaS foundation: explicit workspaces, subscriptions/entitlements and platform administration.
-- Existing owner_id values are preserved by creating each initial workspace with the
-- same UUID that is currently used as data_owner_id.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  legal_name text,
  status text not null default 'active'
    check (status in ('active','trialing','suspended','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.workspaces(id,slug,name,legal_name,status,created_by)
select
  owners.data_owner_id,
  'workspace-' || owners.data_owner_id::text,
  coalesce(nullif(trim(bs.trade_name),''),nullif(trim(bs.legal_name),''),'Empresa'),
  nullif(trim(bs.legal_name),''),
  'active',
  (
    select au2.user_id
    from public.app_users au2
    where au2.data_owner_id=owners.data_owner_id
      and au2.role='admin'
      and au2.active=true
    order by (au2.user_id=owners.data_owner_id) desc, au2.created_at asc
    limit 1
  )
from (select distinct data_owner_id from public.app_users) owners
left join public.business_settings bs on bs.owner_id=owners.data_owner_id
on conflict(id) do nothing;

alter table public.app_users add column if not exists workspace_id uuid;
update public.app_users
set workspace_id=data_owner_id
where workspace_id is null;

alter table public.app_users
  drop constraint if exists app_users_data_owner_id_fkey;

alter table public.app_users
  drop constraint if exists app_users_workspace_id_fkey;
alter table public.app_users
  add constraint app_users_workspace_id_fkey
  foreign key(workspace_id) references public.workspaces(id) on delete restrict;

create or replace function private.app_users_sync_workspace()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  -- workspace_id is canonical. data_owner_id remains as a compatibility alias
  -- while the existing application migrates away from the old naming.
  if new.workspace_id is null then
    new.workspace_id:=new.data_owner_id;
  end if;
  if new.workspace_id is null then
    raise exception 'Workspace no configurado.';
  end if;
  new.data_owner_id:=new.workspace_id;
  return new;
end;
$$;

drop trigger if exists trg_app_users_sync_workspace on public.app_users;
create trigger trg_app_users_sync_workspace
before insert or update of workspace_id,data_owner_id on public.app_users
for each row execute function private.app_users_sync_workspace();

alter table public.app_users alter column workspace_id set not null;
alter table public.app_users drop constraint if exists app_users_workspace_alias_check;
alter table public.app_users add constraint app_users_workspace_alias_check
  check (data_owner_id=workspace_id);

create index if not exists app_users_workspace_idx on public.app_users(workspace_id);

comment on column public.app_users.data_owner_id is
  'Compatibility alias for workspace_id. New authorization code should use workspace_id.';
comment on column public.app_users.workspace_id is
  'Tenant/workspace that owns the user membership and all business data.';

create or replace function private.app_workspace_id()
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select au.workspace_id
  from public.app_users au
  where au.user_id=(select auth.uid())
    and au.active
  limit 1
$$;

-- Keep the old helper name during the migration. All existing RLS policies and RPCs
-- immediately start resolving the explicit workspace without requiring a flag day.
create or replace function private.app_workspace_owner_id()
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select private.app_workspace_id()
$$;

revoke all on function private.app_workspace_id() from public,anon;
revoke all on function private.app_workspace_owner_id() from public,anon;
grant execute on function private.app_workspace_id(),private.app_workspace_owner_id() to authenticated;

create table if not exists public.billing_plans (
  plan_key text primary key,
  name text not null,
  description text,
  is_public boolean not null default false,
  active boolean not null default true,
  monthly_price_cents integer check (monthly_price_cents is null or monthly_price_cents>=0),
  yearly_price_cents integer check (yearly_price_cents is null or yearly_price_cents>=0),
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_plans(plan_key,name,description,is_public,active,sort_order)
values
  ('internal','Interno','Plan interno para ZENVIA y cuentas de plataforma.',false,true,0),
  ('starter','Starter','Plan base para vendedores que empiezan a centralizar su gestión.',false,true,10),
  ('pro','Pro','Plan para vendedores con más volumen e integraciones avanzadas.',false,true,20),
  ('business','Business','Plan para operaciones con varios usuarios y mayor volumen.',false,true,30)
on conflict(plan_key) do nothing;

create table if not exists public.plan_entitlements (
  plan_key text not null references public.billing_plans(plan_key) on delete cascade,
  entitlement_key text not null,
  enabled boolean not null default true,
  limit_value bigint,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(plan_key,entitlement_key)
);

insert into public.plan_entitlements(plan_key,entitlement_key,enabled,limit_value)
select 'internal',key,true,null
from unnest(array[
  'module.dashboard',
  'module.sales',
  'module.orders',
  'module.invoices',
  'module.clients',
  'module.products',
  'module.suppliers',
  'module.amazon',
  'module.support',
  'module.settings',
  'module.admin',
  'integration.amazon',
  'integration.sendcloud',
  'integration.gmail',
  'automation',
  'analytics',
  'users',
  'amazon_accounts',
  'monthly_orders'
]::text[]) as key
on conflict(plan_key,entitlement_key) do nothing;

create table if not exists public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  plan_key text not null references public.billing_plans(plan_key),
  status text not null default 'active'
    check (status in ('trialing','active','past_due','cancelled','unpaid')),
  billing_provider text not null default 'manual'
    check (billing_provider in ('manual','stripe')),
  provider_customer_id text,
  provider_subscription_id text unique,
  trial_ends_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.workspace_subscriptions(workspace_id,plan_key,status,billing_provider)
select w.id,'internal','active','manual'
from public.workspaces w
on conflict(workspace_id) do nothing;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'super_admin'
    check (role in ('super_admin','support_admin','billing_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only the original workspace owner is promoted during this one-time migration.
-- Future customer workspace owners are tenant admins, not platform admins.
insert into public.platform_admins(user_id,role,active)
select distinct au.user_id,'super_admin',true
from public.app_users au
where au.role='admin'
  and au.active=true
  and au.user_id=au.workspace_id
on conflict(user_id) do nothing;

create or replace function private.app_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.platform_admins pa
    where pa.user_id=(select auth.uid())
      and pa.active
  )
$$;

revoke all on function private.app_is_platform_admin() from public,anon;
grant execute on function private.app_is_platform_admin() to authenticated;

alter table public.workspaces enable row level security;
alter table public.billing_plans enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.workspace_subscriptions enable row level security;
alter table public.platform_admins enable row level security;

revoke all on public.workspaces from anon,public;
revoke all on public.billing_plans from anon,public;
revoke all on public.plan_entitlements from anon,public;
revoke all on public.workspace_subscriptions from anon,public;
revoke all on public.platform_admins from anon,public;

revoke insert,update,delete on public.workspaces from authenticated;
revoke insert,update,delete on public.billing_plans from authenticated;
revoke insert,update,delete on public.plan_entitlements from authenticated;
revoke insert,update,delete on public.workspace_subscriptions from authenticated;
revoke insert,update,delete on public.platform_admins from authenticated;

grant select on public.workspaces to authenticated;
grant select on public.billing_plans to authenticated;
grant select on public.plan_entitlements to authenticated;
grant select on public.workspace_subscriptions to authenticated;
grant select on public.platform_admins to authenticated;

drop policy if exists workspaces_member_select on public.workspaces;
create policy workspaces_member_select
on public.workspaces for select to authenticated
using (id=(select private.app_workspace_id()));

drop policy if exists billing_plans_authenticated_select on public.billing_plans;
create policy billing_plans_authenticated_select
on public.billing_plans for select to authenticated
using (active=true);

drop policy if exists plan_entitlements_authenticated_select on public.plan_entitlements;
create policy plan_entitlements_authenticated_select
on public.plan_entitlements for select to authenticated
using (
  exists(
    select 1
    from public.billing_plans bp
    where bp.plan_key=plan_entitlements.plan_key
      and bp.active=true
  )
);

drop policy if exists workspace_subscriptions_member_select on public.workspace_subscriptions;
create policy workspace_subscriptions_member_select
on public.workspace_subscriptions for select to authenticated
using (workspace_id=(select private.app_workspace_id()));

drop policy if exists platform_admins_self_select on public.platform_admins;
create policy platform_admins_self_select
on public.platform_admins for select to authenticated
using (user_id=(select auth.uid()));

create or replace function public.get_workspace_context()
returns table(
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  workspace_status text,
  plan_key text,
  plan_name text,
  subscription_status text,
  is_platform_admin boolean,
  entitlements jsonb
)
language sql
stable
security invoker
set search_path=''
as $$
  select
    w.id,
    w.name,
    w.slug,
    w.status,
    coalesce(ws.plan_key,'internal'),
    coalesce(bp.name,'Interno'),
    coalesce(ws.status,'active'),
    (select private.app_is_platform_admin()),
    coalesce(
      jsonb_object_agg(
        pe.entitlement_key,
        jsonb_build_object(
          'enabled',pe.enabled,
          'limit',pe.limit_value,
          'config',pe.config
        )
      ) filter (where pe.entitlement_key is not null),
      '{}'::jsonb
    )
  from public.app_users au
  join public.workspaces w on w.id=au.workspace_id
  left join public.workspace_subscriptions ws on ws.workspace_id=w.id
  left join public.billing_plans bp on bp.plan_key=coalesce(ws.plan_key,'internal')
  left join public.plan_entitlements pe on pe.plan_key=coalesce(ws.plan_key,'internal')
  where au.user_id=(select auth.uid())
    and au.active=true
  group by w.id,w.name,w.slug,w.status,ws.plan_key,ws.status,bp.name
$$;

revoke all on function public.get_workspace_context() from public,anon;
grant execute on function public.get_workspace_context() to authenticated;

notify pgrst,'reload schema';
