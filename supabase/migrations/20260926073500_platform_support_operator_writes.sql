-- Allow the authenticated ZENVIA Platform bridge to write support replies and attachments
-- with an explicit internal operator identity while customer writes keep using auth.uid().

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
begin
  if auth.uid() is null then
    if coalesce(auth.role(),'')<>'service_role' then raise exception 'Sesión no válida.'; end if;

    select t.owner_id into ticket_owner
    from public.support_tickets t
    where t.id=new.ticket_id;
    if ticket_owner is null then raise exception 'Ticket no accesible.'; end if;
    if new.author_user_id is null or coalesce(trim(new.author_email),'')='' or new.author_role<>'admin' then
      raise exception 'Identidad de operador de Platform no válida.';
    end if;

    new.owner_id:=ticket_owner;
    return new;
  end if;

  if not private.app_support_ticket_access(new.ticket_id,false) then raise exception 'Ticket no accesible.'; end if;

  select t.owner_id into ticket_owner
  from public.support_tickets t
  where t.id=new.ticket_id;

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

create or replace function private.support_prepare_attachment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  ticket_owner uuid;
begin
  if auth.uid() is null then
    if coalesce(auth.role(),'')<>'service_role' then raise exception 'Sesión no válida.'; end if;
    select t.owner_id into ticket_owner from public.support_tickets t where t.id=new.ticket_id;
    if ticket_owner is null then raise exception 'Ticket no accesible.'; end if;
    if new.uploaded_by is null then raise exception 'Identidad de operador de Platform no válida.'; end if;
  else
    if not private.app_support_ticket_access(new.ticket_id,false) then raise exception 'Ticket no accesible.'; end if;
    select t.owner_id into ticket_owner from public.support_tickets t where t.id=new.ticket_id;
    new.uploaded_by:=auth.uid();
  end if;

  if new.message_id is not null and not exists(
    select 1 from public.support_messages m where m.id=new.message_id and m.ticket_id=new.ticket_id
  ) then raise exception 'El mensaje no pertenece al ticket.'; end if;
  if split_part(new.storage_path,'/',1)<>new.ticket_id::text then raise exception 'Ruta de adjunto no válida.'; end if;

  new.owner_id:=ticket_owner;
  return new;
end;
$$;

notify pgrst,'reload schema';
