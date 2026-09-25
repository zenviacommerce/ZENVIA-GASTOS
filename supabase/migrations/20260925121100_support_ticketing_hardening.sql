-- Keep support inserts server-authored even if a client sends forged lifecycle fields.
create or replace function private.support_prepare_ticket()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  profile record;
begin
  if auth.uid() is null then raise exception 'Sesión no válida.'; end if;
  select au.data_owner_id,au.email,au.full_name
  into profile
  from public.app_users au
  where au.user_id=auth.uid() and au.active=true;
  if profile.data_owner_id is null then raise exception 'Usuario no autorizado.'; end if;

  new.owner_id:=profile.data_owner_id;
  new.created_by:=auth.uid();
  new.created_by_email:=coalesce(profile.email,'');
  new.created_by_name:=profile.full_name;
  new.ticket_number:='ZG-'||to_char(now(),'YYYY')||'-'||lpad(nextval('public.support_ticket_number_seq')::text,6,'0');
  new.status:='open';
  new.priority:='normal';
  new.assigned_to:=null;
  new.resolved_at:=null;
  new.closed_at:=null;
  new.updated_at:=now();
  new.last_activity_at:=now();
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
  if auth.uid() is null then raise exception 'Sesión no válida.'; end if;
  if not private.app_support_ticket_access(new.ticket_id,false) then raise exception 'Ticket no accesible.'; end if;
  select t.owner_id into ticket_owner from public.support_tickets t where t.id=new.ticket_id;
  if new.message_id is not null and not exists(
    select 1 from public.support_messages m where m.id=new.message_id and m.ticket_id=new.ticket_id
  ) then raise exception 'El mensaje no pertenece al ticket.'; end if;
  if split_part(new.storage_path,'/',1)<>new.ticket_id::text then raise exception 'Ruta de adjunto no válida.'; end if;
  new.owner_id:=ticket_owner;
  new.uploaded_by:=auth.uid();
  return new;
end;
$$;
