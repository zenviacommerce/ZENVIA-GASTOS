alter table public.workspaces
  add column if not exists allow_environment_credentials boolean not null default false;

update public.workspaces w
set allow_environment_credentials=true,
    updated_at=now()
where exists (
  select 1
  from public.integration_accounts ia
  where ia.owner_id=w.id
    and ia.credential_source='environment'
);

do $$
declare r record;
begin
  for r in
    select
      ns.nspname as schema_name,
      cls.relname as table_name,
      con.conname as constraint_name
    from pg_constraint con
    join pg_class cls on cls.oid=con.conrelid
    join pg_namespace ns on ns.oid=cls.relnamespace
    join pg_class ref on ref.oid=con.confrelid
    join pg_namespace refns on refns.oid=ref.relnamespace
    where con.contype='f'
      and ns.nspname='public'
      and refns.nspname='auth'
      and ref.relname='users'
      and exists (
        select 1
        from unnest(con.conkey) as key(attnum)
        join pg_attribute a on a.attrelid=cls.oid and a.attnum=key.attnum
        where a.attname in ('owner_id','workspace_owner_id')
      )
  loop
    execute format('alter table %I.%I drop constraint %I',r.schema_name,r.table_name,r.constraint_name);
  end loop;
end $$;

do $$
declare r record;
declare constraint_name text;
begin
  for r in
    select
      c.table_name,
      c.column_name,
      a.attnum
    from information_schema.columns c
    join pg_class cls on cls.relname=c.table_name
    join pg_namespace ns on ns.oid=cls.relnamespace and ns.nspname=c.table_schema
    join pg_attribute a on a.attrelid=cls.oid and a.attname=c.column_name
    where c.table_schema='public'
      and c.column_name in ('owner_id','workspace_owner_id')
      and c.table_name<>'workspaces'
  loop
    if not exists (
      select 1
      from pg_constraint con
      where con.conrelid=format('public.%I',r.table_name)::regclass
        and con.contype='f'
        and con.confrelid='public.workspaces'::regclass
        and array_length(con.conkey,1)=1
        and con.conkey[1]=r.attnum
    ) then
      constraint_name :=
        case when r.column_name='owner_id'
          then left(r.table_name||'_owner_workspace_fkey',63)
          else left(r.table_name||'_workspace_owner_workspace_fkey',63)
        end;
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.workspaces(id) on delete cascade not valid',
        r.table_name,constraint_name,r.column_name
      );
      execute format('alter table public.%I validate constraint %I',r.table_name,constraint_name);
    end if;
  end loop;
end $$;

create index if not exists sales_invoice_lines_owner_workspace_idx
  on public.sales_invoice_lines(owner_id);
create index if not exists sales_payments_owner_workspace_idx
  on public.sales_payments(owner_id);
create index if not exists support_messages_owner_workspace_idx
  on public.support_messages(owner_id);
create index if not exists support_attachments_owner_workspace_idx
  on public.support_attachments(owner_id);

create or replace function private.enforce_environment_integration_scope()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.credential_source='environment'
     and not exists (
       select 1
       from public.workspaces w
       where w.id=new.owner_id
         and w.allow_environment_credentials=true
     ) then
    raise exception 'Las credenciales globales del entorno no están habilitadas para este workspace.';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_environment_integration_scope() from public,anon,authenticated;

drop trigger if exists integration_accounts_environment_scope on public.integration_accounts;
create trigger integration_accounts_environment_scope
before insert or update of owner_id,credential_source
on public.integration_accounts
for each row execute function private.enforce_environment_integration_scope();

notify pgrst,'reload schema';
