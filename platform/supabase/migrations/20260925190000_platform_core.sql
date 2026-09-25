create schema if not exists private;

create table if not exists public.platform_roles(
  role_key text primary key,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_permissions(
  permission_key text primary key,
  module text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_role_permissions(
  role_key text not null references public.platform_roles(role_key) on delete cascade,
  permission_key text not null references public.platform_permissions(permission_key) on delete cascade,
  primary key(role_key,permission_key)
);

create table if not exists public.platform_users(
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role_key text not null references public.platform_roles(role_key),
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists platform_users_email_lower_idx on public.platform_users(lower(email));

create table if not exists public.platform_user_permissions(
  user_id uuid not null references public.platform_users(user_id) on delete cascade,
  permission_key text not null references public.platform_permissions(permission_key) on delete cascade,
  allowed boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,permission_key)
);

create table if not exists public.platform_audit_logs(
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_logs_created_idx on public.platform_audit_logs(created_at desc);
create index if not exists platform_audit_logs_actor_idx on public.platform_audit_logs(actor_user_id,created_at desc);

create table if not exists public.platform_secrets(
  secret_key text primary key,
  secret_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.platform_roles(role_key,name,description) values
 ('super_admin','Superadministrador','Acceso completo a ZENVIA Platform'),
 ('support_admin','Soporte','Gestión de clientes y tickets'),
 ('billing_admin','Facturación','Planes, suscripciones y facturación'),
 ('operations_admin','Operaciones','Operación de clientes e integraciones')
on conflict(role_key) do update set name=excluded.name,description=excluded.description,active=true,updated_at=now();

insert into public.platform_permissions(permission_key,module,name,description) values
 ('dashboard.view','dashboard','Ver resumen','Acceso al resumen de plataforma'),
 ('clients.view','clients','Ver clientes','Consultar clientes y workspaces'),
 ('clients.create','clients','Crear clientes','Dar de alta nuevos clientes'),
 ('clients.update','clients','Editar clientes','Editar estado y datos operativos de clientes'),
 ('plans.view','plans','Ver planes','Consultar planes y suscripciones'),
 ('plans.manage','plans','Gestionar planes','Editar precios, límites y asignaciones'),
 ('tickets.view','tickets','Ver tickets','Consultar tickets de todos los clientes'),
 ('tickets.reply','tickets','Responder tickets','Responder a clientes'),
 ('tickets.manage','tickets','Gestionar tickets','Cambiar estado, prioridad y asignación'),
 ('users.view','users','Ver usuarios internos','Consultar usuarios de Platform'),
 ('users.manage','users','Gestionar usuarios internos','Invitar, activar y asignar roles/permisos'),
 ('audit.view','audit','Ver auditoría','Consultar auditoría de Platform'),
 ('billing.manage','billing','Gestionar facturación','Gestionar suscripciones y facturación'),
 ('integrations.view','integrations','Ver integraciones','Consultar estado de integraciones de clientes'),
 ('integrations.manage','integrations','Gestionar integraciones','Operar integraciones de clientes')
on conflict(permission_key) do update set module=excluded.module,name=excluded.name,description=excluded.description;

insert into public.platform_role_permissions(role_key,permission_key)
select 'super_admin',permission_key from public.platform_permissions on conflict do nothing;

insert into public.platform_role_permissions(role_key,permission_key) values
 ('support_admin','dashboard.view'),
 ('support_admin','clients.view'),
 ('support_admin','tickets.view'),
 ('support_admin','tickets.reply'),
 ('support_admin','tickets.manage'),
 ('support_admin','audit.view'),
 ('billing_admin','dashboard.view'),
 ('billing_admin','clients.view'),
 ('billing_admin','plans.view'),
 ('billing_admin','plans.manage'),
 ('billing_admin','billing.manage'),
 ('billing_admin','audit.view'),
 ('operations_admin','dashboard.view'),
 ('operations_admin','clients.view'),
 ('operations_admin','clients.update'),
 ('operations_admin','tickets.view'),
 ('operations_admin','tickets.manage'),
 ('operations_admin','integrations.view'),
 ('operations_admin','integrations.manage'),
 ('operations_admin','audit.view')
on conflict do nothing;

create or replace function private.platform_is_active()
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.platform_users u where u.user_id=auth.uid() and u.active=true); $$;

create or replace function private.platform_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.platform_users u
    where u.user_id=auth.uid() and u.active=true and (
      exists(select 1 from public.platform_user_permissions up where up.user_id=u.user_id and up.permission_key=p_permission and up.allowed=true)
      or (
        not exists(select 1 from public.platform_user_permissions up where up.user_id=u.user_id and up.permission_key=p_permission and up.allowed=false)
        and exists(select 1 from public.platform_role_permissions rp where rp.role_key=u.role_key and rp.permission_key=p_permission)
      )
    )
  );
$$;

revoke all on function private.platform_is_active() from public,anon;
revoke all on function private.platform_has_permission(text) from public,anon;
grant execute on function private.platform_is_active() to authenticated;
grant execute on function private.platform_has_permission(text) to authenticated;

create or replace function private.platform_bootstrap_user()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if lower(coalesce(new.email,''))='soporte@zenviacommerce.com'
     and not exists(select 1 from public.platform_users)
  then
    insert into public.platform_users(user_id,email,full_name,role_key,active)
    values(new.id,lower(new.email),coalesce(new.raw_user_meta_data->>'full_name','Soporte ZENVIA'),'super_admin',true)
    on conflict(user_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists platform_bootstrap_auth_user on auth.users;
create trigger platform_bootstrap_auth_user after insert on auth.users
for each row execute function private.platform_bootstrap_user();

alter table public.platform_roles enable row level security;
alter table public.platform_permissions enable row level security;
alter table public.platform_role_permissions enable row level security;
alter table public.platform_users enable row level security;
alter table public.platform_user_permissions enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.platform_secrets enable row level security;

revoke all on public.platform_roles from anon,authenticated;
revoke all on public.platform_permissions from anon,authenticated;
revoke all on public.platform_role_permissions from anon,authenticated;
revoke all on public.platform_users from anon,authenticated;
revoke all on public.platform_user_permissions from anon,authenticated;
revoke all on public.platform_audit_logs from anon,authenticated;
revoke all on public.platform_secrets from anon,authenticated;

grant select on public.platform_roles to authenticated;
grant select on public.platform_permissions to authenticated;
grant select on public.platform_role_permissions to authenticated;
grant select on public.platform_users to authenticated;
grant select on public.platform_user_permissions to authenticated;
grant select on public.platform_audit_logs to authenticated;

create policy platform_roles_read on public.platform_roles for select to authenticated using (private.platform_is_active());
create policy platform_permissions_read on public.platform_permissions for select to authenticated using (private.platform_is_active());
create policy platform_role_permissions_read on public.platform_role_permissions for select to authenticated using (private.platform_is_active());
create policy platform_users_read on public.platform_users for select to authenticated using (user_id=auth.uid() or private.platform_has_permission('users.view'));
create policy platform_user_permissions_read on public.platform_user_permissions for select to authenticated using (user_id=auth.uid() or private.platform_has_permission('users.view'));
create policy platform_audit_read on public.platform_audit_logs for select to authenticated using (private.platform_has_permission('audit.view'));
