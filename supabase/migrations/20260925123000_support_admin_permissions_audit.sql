-- Support permissions, admin delete/edit access and audit trail.

alter table public.app_users drop constraint if exists app_users_permissions_check;
alter table public.app_users add constraint app_users_permissions_check
  check (permissions <@ array['dashboard','sales','orders','invoices','clients','products','suppliers','amazon','support']::text[]);

-- Existing users already had access to Support before it became permission-aware.
update public.app_users
set permissions=array_append(permissions,'support'),
    updated_at=now()
where role='user' and not ('support'=any(permissions));

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

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (
    (select private.app_is_admin())
    or ((select private.app_has_permission('support')) and created_by=(select auth.uid()))
  )
);

drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and created_by=(select auth.uid())
  and (select private.app_has_permission('support'))
);

drop policy if exists support_tickets_admin_update on public.support_tickets;
create policy support_tickets_admin_update on public.support_tickets for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));

drop policy if exists support_tickets_admin_delete on public.support_tickets;
create policy support_tickets_admin_delete on public.support_tickets for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));

grant delete on public.support_tickets to authenticated;

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
    select au.email into actor_mail from public.app_users au where au.user_id=actor_id limit 1;
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

revoke all on function private.audit_support_change() from public,anon,authenticated;

drop trigger if exists audit_support_tickets on public.support_tickets;
create trigger audit_support_tickets
after insert or update or delete on public.support_tickets
for each row execute function private.audit_support_change();

drop trigger if exists audit_support_messages on public.support_messages;
create trigger audit_support_messages
after insert on public.support_messages
for each row execute function private.audit_support_change();

notify pgrst,'reload schema';
