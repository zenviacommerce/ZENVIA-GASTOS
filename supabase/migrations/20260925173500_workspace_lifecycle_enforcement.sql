create or replace function private.app_membership_workspace_id()
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

create or replace function private.app_workspace_id()
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select au.workspace_id
  from public.app_users au
  join public.workspaces w on w.id=au.workspace_id
  where au.user_id=(select auth.uid())
    and au.active
    and w.status in ('active','trialing')
  limit 1
$$;

revoke all on function private.app_membership_workspace_id() from public,anon;
revoke all on function private.app_workspace_id() from public,anon;
grant execute on function private.app_membership_workspace_id(),private.app_workspace_id() to authenticated;

drop policy if exists workspaces_member_select on public.workspaces;
create policy workspaces_member_select
on public.workspaces for select to authenticated
using (id=(select private.app_membership_workspace_id()));

drop policy if exists workspace_subscriptions_member_select on public.workspace_subscriptions;
create policy workspace_subscriptions_member_select
on public.workspace_subscriptions for select to authenticated
using (workspace_id=(select private.app_membership_workspace_id()));

notify pgrst,'reload schema';
