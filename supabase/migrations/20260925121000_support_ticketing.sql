-- In-app support desk: incidents, feature requests, replies and private attachments.

create sequence if not exists public.support_ticket_number_seq;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  ticket_number text not null unique,
  created_by uuid not null,
  created_by_email text not null,
  created_by_name text,
  type text not null check(type in ('incident','request')),
  subject text not null check(char_length(trim(subject)) between 3 and 180),
  description text not null check(char_length(trim(description)) between 3 and 10000),
  status text not null default 'open' check(status in ('open','in_progress','waiting_user','resolved','closed')),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  assigned_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  owner_id uuid not null,
  author_user_id uuid not null,
  author_email text not null,
  author_name text,
  author_role text not null check(author_role in ('user','admin')),
  body text not null check(char_length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);

create table if not exists public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid references public.support_messages(id) on delete cascade,
  owner_id uuid not null,
  uploaded_by uuid not null,
  file_name text not null,
  mime_type text,
  file_size bigint not null default 0,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.support_email_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  message_id uuid references public.support_messages(id) on delete set null,
  event_type text not null,
  recipient text not null,
  status text not null check(status in ('sent','skipped','failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_owner_activity_idx on public.support_tickets(owner_id,last_activity_at desc);
create index if not exists support_tickets_creator_activity_idx on public.support_tickets(created_by,last_activity_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets(owner_id,status,last_activity_at desc);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id,created_at);
create index if not exists support_attachments_ticket_idx on public.support_attachments(ticket_id,created_at);

create or replace function private.app_support_ticket_access(p_ticket_id uuid,p_admin_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.support_tickets t
    where t.id=p_ticket_id
      and t.owner_id=(select private.app_workspace_owner_id())
      and (
        (select private.app_is_admin())
        or (not p_admin_only and t.created_by=(select auth.uid()))
      )
  )
$$;

revoke all on function private.app_support_ticket_access(uuid,boolean) from public,anon;
grant execute on function private.app_support_ticket_access(uuid,boolean) to authenticated;

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
  if coalesce(new.ticket_number,'')='' then
    new.ticket_number:='ZG-'||to_char(now(),'YYYY')||'-'||lpad(nextval('public.support_ticket_number_seq')::text,6,'0');
  end if;
  new.updated_at:=now();
  new.last_activity_at:=coalesce(new.last_activity_at,now());
  return new;
end;
$$;

drop trigger if exists trg_support_prepare_ticket on public.support_tickets;
create trigger trg_support_prepare_ticket
before insert on public.support_tickets
for each row execute function private.support_prepare_ticket();

create or replace function private.support_prepare_message()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  profile record;
  ticket_owner uuid;
begin
  if auth.uid() is null then raise exception 'Sesión no válida.'; end if;
  if not private.app_support_ticket_access(new.ticket_id,false) then raise exception 'Ticket no accesible.'; end if;
  select t.owner_id into ticket_owner from public.support_tickets t where t.id=new.ticket_id;
  select au.email,au.full_name,au.role into profile from public.app_users au where au.user_id=auth.uid() and au.active=true;

  new.owner_id:=ticket_owner;
  new.author_user_id:=auth.uid();
  new.author_email:=coalesce(profile.email,'');
  new.author_name:=profile.full_name;
  new.author_role:=case when profile.role='admin' then 'admin' else 'user' end;
  return new;
end;
$$;

drop trigger if exists trg_support_prepare_message on public.support_messages;
create trigger trg_support_prepare_message
before insert on public.support_messages
for each row execute function private.support_prepare_message();

create or replace function private.support_touch_ticket()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.support_tickets
  set last_activity_at=now(),updated_at=now(),
      status=case when new.author_role='user' and status='waiting_user' then 'open' else status end
  where id=new.ticket_id;
  return new;
end;
$$;

drop trigger if exists trg_support_touch_ticket on public.support_messages;
create trigger trg_support_touch_ticket
after insert on public.support_messages
for each row execute function private.support_touch_ticket();

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
  new.owner_id:=ticket_owner;
  new.uploaded_by:=auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_support_prepare_attachment on public.support_attachments;
create trigger trg_support_prepare_attachment
before insert on public.support_attachments
for each row execute function private.support_prepare_attachment();

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_attachments enable row level security;
alter table public.support_email_events enable row level security;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_is_admin()) or created_by=(select auth.uid()))
);

drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and created_by=(select auth.uid())
  and (select private.app_is_active())
);

drop policy if exists support_tickets_admin_update on public.support_tickets;
create policy support_tickets_admin_update on public.support_tickets for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));

drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages for select to authenticated
using ((select private.app_support_ticket_access(ticket_id,false)));

drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages for insert to authenticated
with check (
  (select private.app_support_ticket_access(ticket_id,false))
  and author_user_id=(select auth.uid())
);

drop policy if exists support_attachments_select on public.support_attachments;
create policy support_attachments_select on public.support_attachments for select to authenticated
using ((select private.app_support_ticket_access(ticket_id,false)));

drop policy if exists support_attachments_insert on public.support_attachments;
create policy support_attachments_insert on public.support_attachments for insert to authenticated
with check (
  (select private.app_support_ticket_access(ticket_id,false))
  and uploaded_by=(select auth.uid())
);

drop policy if exists support_email_events_admin_select on public.support_email_events;
create policy support_email_events_admin_select on public.support_email_events for select to authenticated
using (
  exists(select 1 from public.support_tickets t where t.id=ticket_id and t.owner_id=(select private.app_workspace_owner_id()))
  and (select private.app_is_admin())
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('support-attachments','support-attachments',false,10485760,null)
on conflict(id) do update set public=false,file_size_limit=10485760;

drop policy if exists support_storage_select on storage.objects;
drop policy if exists support_storage_insert on storage.objects;
drop policy if exists support_storage_delete on storage.objects;

create policy support_storage_select on storage.objects for select to authenticated
using (
  bucket_id='support-attachments'
  and (select private.app_support_ticket_access(((storage.foldername(name))[1])::uuid,false))
);

create policy support_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id='support-attachments'
  and (select private.app_support_ticket_access(((storage.foldername(name))[1])::uuid,false))
);

create policy support_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id='support-attachments'
  and (
    owner_id=(select auth.uid())::text
    or (select private.app_is_admin())
  )
);

grant select,insert on public.support_tickets to authenticated;
grant select,insert on public.support_messages to authenticated;
grant select,insert on public.support_attachments to authenticated;
grant update on public.support_tickets to authenticated;
grant select on public.support_email_events to authenticated;
