create table if not exists public.platform_bridge_secrets(
  secret_id text primary key,
  token_sha256 text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_bridge_secrets enable row level security;
revoke all on public.platform_bridge_secrets from anon,authenticated;

create or replace function private.support_prepare_message()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  profile record;
  ticket_owner uuid;
  platform_operator boolean := private.app_is_platform_admin();
  jwt_role text := coalesce((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'),'');
begin
  select t.owner_id into ticket_owner
  from public.support_tickets t
  where t.id=new.ticket_id;

  if ticket_owner is null then raise exception 'Ticket no accesible.'; end if;

  if auth.uid() is null then
    if jwt_role<>'service_role' then raise exception 'Sesión no válida.'; end if;
    if new.author_role<>'admin' then raise exception 'Rol de autor no válido.'; end if;
    if new.author_user_id is null then raise exception 'Falta el autor de Platform.'; end if;
    if coalesce(trim(new.author_email),'')='' then raise exception 'Falta el email del autor de Platform.'; end if;
    new.owner_id:=ticket_owner;
    return new;
  end if;

  if not private.app_support_ticket_access(new.ticket_id,false) then raise exception 'Ticket no accesible.'; end if;

  if platform_operator then
    select
      coalesce(u.email,'') as email,
      coalesce(nullif(u.raw_user_meta_data->>'full_name',''),u.email,'Soporte') as full_name
    into profile
    from auth.users u
    where u.id=auth.uid();

    new.owner_id:=ticket_owner;
    new.author_user_id:=auth.uid();
    new.author_email:=coalesce(profile.email,'');
    new.author_name:=profile.full_name;
    new.author_role:='admin';
    return new;
  end if;

  select au.email,au.full_name,au.role
  into profile
  from public.app_users au
  where au.user_id=auth.uid() and au.active=true;

  new.owner_id:=ticket_owner;
  new.author_user_id:=auth.uid();
  new.author_email:=coalesce(profile.email,'');
  new.author_name:=profile.full_name;
  new.author_role:=case when profile.role='admin' then 'admin' else 'user' end;
  return new;
end;
$$;

notify pgrst,'reload schema';
