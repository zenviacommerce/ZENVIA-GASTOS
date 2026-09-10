create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user' check (role in ('admin','user')),
  active boolean not null default true,
  data_owner_id uuid not null references auth.users(id),
  permissions text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_permissions_check check (permissions <@ array['dashboard','invoices','products','suppliers','gmail']::text[])
);
create index if not exists app_users_data_owner_idx on public.app_users(data_owner_id);
alter table public.app_users enable row level security;

insert into public.app_users(user_id,email,full_name,role,active,data_owner_id,permissions)
select u.id, coalesce(u.email,''), coalesce(nullif(u.raw_user_meta_data->>'full_name',''),'Administrador'), 'admin', true, u.id,
       array['dashboard','invoices','products','suppliers','gmail']::text[]
from auth.users u
where u.id = (select id from auth.users order by created_at asc limit 1)
on conflict (user_id) do update set
  email=excluded.email,
  role='admin',
  active=true,
  data_owner_id=excluded.data_owner_id,
  permissions=excluded.permissions,
  updated_at=now();

create or replace function private.app_workspace_owner_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select au.data_owner_id from public.app_users au
  where au.user_id = (select auth.uid()) and au.active limit 1
$$;
create or replace function private.app_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_users au where au.user_id=(select auth.uid()) and au.active)
$$;
create or replace function private.app_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_users au where au.user_id=(select auth.uid()) and au.active and au.role='admin')
$$;
create or replace function private.app_has_permission(requested text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.app_users au where au.user_id=(select auth.uid()) and au.active and (au.role='admin' or requested=any(au.permissions)))
$$;
revoke all on function private.app_workspace_owner_id() from public, anon;
revoke all on function private.app_is_active() from public, anon;
revoke all on function private.app_is_admin() from public, anon;
revoke all on function private.app_has_permission(text) from public, anon;
grant execute on function private.app_workspace_owner_id(),private.app_is_active(),private.app_is_admin(),private.app_has_permission(text) to authenticated;

revoke all on public.app_users from anon, public;
revoke insert,update,delete on public.app_users from authenticated;
grant select on public.app_users to authenticated;
drop policy if exists app_users_self_select on public.app_users;
create policy app_users_self_select on public.app_users for select to authenticated using (user_id=(select auth.uid()));

alter table public.expense_categories alter column owner_id set default private.app_workspace_owner_id();
alter table public.suppliers alter column owner_id set default private.app_workspace_owner_id();
alter table public.products alter column owner_id set default private.app_workspace_owner_id();
alter table public.supplier_products alter column owner_id set default private.app_workspace_owner_id();
alter table public.invoices alter column owner_id set default private.app_workspace_owner_id();
alter table public.invoice_lines alter column owner_id set default private.app_workspace_owner_id();
alter table public.product_price_history alter column owner_id set default private.app_workspace_owner_id();
alter table public.gmail_imports alter column owner_id set default private.app_workspace_owner_id();
alter table public.export_runs alter column owner_id set default private.app_workspace_owner_id();

drop policy if exists expense_categories_owner_all on public.expense_categories;
drop policy if exists suppliers_owner_all on public.suppliers;
drop policy if exists products_owner_all on public.products;
drop policy if exists supplier_products_owner_all on public.supplier_products;
drop policy if exists invoices_owner_all on public.invoices;
drop policy if exists invoice_lines_owner_all on public.invoice_lines;
drop policy if exists product_price_history_owner_all on public.product_price_history;
drop policy if exists gmail_imports_owner_all on public.gmail_imports;
drop policy if exists export_runs_owner_all on public.export_runs;

create policy expense_categories_workspace_select on public.expense_categories for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_active()));
create policy expense_categories_workspace_insert on public.expense_categories for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
create policy expense_categories_workspace_update on public.expense_categories for update to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin())) with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
create policy expense_categories_workspace_delete on public.expense_categories for delete to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));

create policy suppliers_workspace_select on public.suppliers for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('dashboard')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('products')) or (select private.app_has_permission('suppliers')) or (select private.app_has_permission('gmail'))));
create policy suppliers_workspace_insert on public.suppliers for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('suppliers')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy suppliers_workspace_update on public.suppliers for update to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('suppliers')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))) with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('suppliers')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy suppliers_workspace_delete on public.suppliers for delete to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('suppliers')));

create policy products_workspace_select on public.products for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('dashboard')) or (select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy products_workspace_insert on public.products for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy products_workspace_update on public.products for update to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))) with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy products_workspace_delete on public.products for delete to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('products')));

create policy supplier_products_workspace_select on public.supplier_products for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy supplier_products_workspace_insert on public.supplier_products for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy supplier_products_workspace_update on public.supplier_products for update to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))) with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy supplier_products_workspace_delete on public.supplier_products for delete to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices'))));

create policy invoices_workspace_select on public.invoices for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('dashboard')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy invoices_workspace_insert on public.invoices for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy invoices_workspace_update on public.invoices for update to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))) with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy invoices_workspace_delete on public.invoices for delete to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('invoices')));

create policy invoice_lines_workspace_select on public.invoice_lines for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('dashboard')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('products')) or (select private.app_has_permission('gmail'))));
create policy invoice_lines_workspace_insert on public.invoice_lines for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy invoice_lines_workspace_update on public.invoice_lines for update to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('products')) or (select private.app_has_permission('gmail')))) with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('products')) or (select private.app_has_permission('gmail'))));
create policy invoice_lines_workspace_delete on public.invoice_lines for delete to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('invoices')));

create policy product_price_history_workspace_select on public.product_price_history for select to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('dashboard')) or (select private.app_has_permission('products')) or (select private.app_has_permission('invoices'))));
create policy product_price_history_workspace_insert on public.product_price_history for insert to authenticated with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy product_price_history_workspace_update on public.product_price_history for update to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))) with check (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail'))));
create policy product_price_history_workspace_delete on public.product_price_history for delete to authenticated using (owner_id=(select private.app_workspace_owner_id()) and ((select private.app_has_permission('products')) or (select private.app_has_permission('invoices'))));

create policy gmail_imports_workspace_all on public.gmail_imports for all to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('gmail'))) with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('gmail')));
create policy export_runs_workspace_all on public.export_runs for all to authenticated using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('invoices'))) with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('invoices')));

create or replace function public.bootstrap_expense_categories()
returns void language plpgsql security invoker set search_path = '' as $$
declare v_owner uuid := private.app_workspace_owner_id();
begin
  if v_owner is null then raise exception 'Access not configured'; end if;
  if exists(select 1 from public.expense_categories where owner_id=v_owner) then return; end if;
  if not private.app_is_admin() then return; end if;
  insert into public.expense_categories(owner_id,name,sort_order) values
    (v_owner,'Mercancía',10),(v_owner,'Transporte y logística',20),(v_owner,'Publicidad y marketing',30),(v_owner,'Software y suscripciones',40),(v_owner,'Embalaje y consumibles',50),(v_owner,'Servicios profesionales',60),(v_owner,'Suministros',70),(v_owner,'Viajes y dietas',80),(v_owner,'Comisiones marketplaces',90),(v_owner,'Otros',100)
  on conflict(owner_id,name) do nothing;
end; $$;

notify pgrst, 'reload schema';
