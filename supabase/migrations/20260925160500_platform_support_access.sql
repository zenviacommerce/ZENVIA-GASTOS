-- Platform support operations for support.zenviacommerce.com.
-- Platform admins are trusted internal operators, distinct from tenant/workspace admins.

create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  workspace_id uuid references public.workspaces(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_logs_created_idx
  on public.platform_audit_logs(created_at desc);
create index if not exists platform_audit_logs_workspace_idx
  on public.platform_audit_logs(workspace_id,created_at desc);
create index if not exists platform_audit_logs_actor_idx
  on public.platform_audit_logs(actor_user_id,created_at desc);

alter table public.platform_audit_logs enable row level security;
revoke all on public.platform_audit_logs from anon,public;
grant select on public.platform_audit_logs to authenticated;

drop policy if exists platform_audit_logs_platform_select on public.platform_audit_logs;
create policy platform_audit_logs_platform_select
on public.platform_audit_logs for select to authenticated
using ((select private.app_is_platform_admin()));

create or replace function private.app_support_ticket_access(p_ticket_id uuid,p_admin_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    (select private.app_is_platform_admin())
    or exists(
      select 1
      from public.support_tickets t
      where t.id=p_ticket_id
        and t.owner_id=(select private.app_workspace_owner_id())
        and (
          (select private.app_is_admin())
          or (
            not p_admin_only
            and (select private.app_has_permission('support'))
            and t.created_by=(select auth.uid())
          )
        )
    )
$$;

revoke all on function private.app_support_ticket_access(uuid,boolean) from public,anon;
grant execute on function private.app_support_ticket_access(uuid,boolean) to authenticated;

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
  if auth.uid() is null then raise exception 'Sesión no válida.'; end if;
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

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
using (
  (select private.app_is_platform_admin())
  or (
    owner_id=(select private.app_workspace_owner_id())
    and (
      (select private.app_is_admin())
      or ((select private.app_has_permission('support')) and created_by=(select auth.uid()))
    )
  )
);

drop policy if exists support_tickets_admin_update on public.support_tickets;
create policy support_tickets_admin_update on public.support_tickets for update to authenticated
using (
  (select private.app_is_platform_admin())
  or (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
)
with check (
  (select private.app_is_platform_admin())
  or (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
);

drop policy if exists support_tickets_admin_delete on public.support_tickets;
create policy support_tickets_admin_delete on public.support_tickets for delete to authenticated
using (
  (select private.app_is_platform_admin())
  or (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
);

drop policy if exists support_email_events_admin_select on public.support_email_events;
create policy support_email_events_admin_select on public.support_email_events for select to authenticated
using (
  (select private.app_is_platform_admin())
  or (
    exists(
      select 1
      from public.support_tickets t
      where t.id=ticket_id
        and t.owner_id=(select private.app_workspace_owner_id())
    )
    and (select private.app_is_admin())
  )
);

create or replace function private.audit_support_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid := auth.uid();
  actor_mail text;
  row_data jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  workspace_id uuid;
  ticket_no text;
  ticket_subject text;
  action_name text;
  message text;
  detail jsonb;
begin
  workspace_id:=nullif(row_data->>'owner_id','')::uuid;
  if workspace_id is null then workspace_id:=private.app_workspace_owner_id(); end if;
  if workspace_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if actor_id is not null then
    select coalesce(au.email,u.email)
    into actor_mail
    from auth.users u
    left join public.app_users au on au.user_id=u.id
    where u.id=actor_id
    limit 1;
  end if;

  if tg_table_name='support_tickets' then
    ticket_no:=coalesce(row_data->>'ticket_number','Ticket');
    ticket_subject:=coalesce(row_data->>'subject','');
    detail:=jsonb_strip_nulls(jsonb_build_object(
      'ticket_number',ticket_no,
      'type',row_data->>'type',
      'subject',ticket_subject,
      'status',row_data->>'status',
      'priority',row_data->>'priority',
      'created_by_email',row_data->>'created_by_email'
    ));

    if tg_op='INSERT' then
      action_name:='create';
      message:='Creó el ticket '||ticket_no||' · '||ticket_subject;
    elsif tg_op='DELETE' then
      action_name:='delete';
      message:='Eliminó el ticket '||ticket_no||' · '||ticket_subject;
    else
      action_name:='update';
      message:='Modificó el ticket '||ticket_no||' · '||ticket_subject;
      detail:=detail||jsonb_strip_nulls(jsonb_build_object(
        'previous_type',old.type,
        'new_type',new.type,
        'previous_subject',old.subject,
        'new_subject',new.subject,
        'previous_status',old.status,
        'new_status',new.status,
        'previous_priority',old.priority,
        'new_priority',new.priority
      ));
    end if;

    insert into public.audit_logs(
      workspace_owner_id,actor_user_id,actor_email,module,action,
      entity_type,entity_id,entity_label,summary,details
    ) values (
      workspace_id,actor_id,actor_mail,'support',action_name,
      'support_ticket',row_data->>'id',ticket_no,message,detail
    );

  elsif tg_table_name='support_messages' and tg_op='INSERT' then
    select t.ticket_number,t.subject
      into ticket_no,ticket_subject
    from public.support_tickets t
    where t.id=new.ticket_id;

    insert into public.audit_logs(
      workspace_owner_id,actor_user_id,actor_email,module,action,
      entity_type,entity_id,entity_label,summary,details
    ) values (
      workspace_id,actor_id,actor_mail,'support','reply',
      'support_message',new.id::text,coalesce(ticket_no,'Ticket'),
      'Respondió al ticket '||coalesce(ticket_no,'')||' · '||coalesce(ticket_subject,''),
      jsonb_strip_nulls(jsonb_build_object(
        'ticket_id',new.ticket_id,
        'ticket_number',ticket_no,
        'author_role',new.author_role
      ))
    );
  end if;

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

notify pgrst,'reload schema';
