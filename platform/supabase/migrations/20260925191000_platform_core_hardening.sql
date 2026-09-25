create index if not exists platform_role_permissions_permission_idx
  on public.platform_role_permissions(permission_key);
create index if not exists platform_user_permissions_permission_idx
  on public.platform_user_permissions(permission_key);
create index if not exists platform_users_role_idx
  on public.platform_users(role_key);

drop policy if exists platform_users_read on public.platform_users;
create policy platform_users_read on public.platform_users
for select to authenticated using (
  user_id=(select auth.uid()) or private.platform_has_permission('users.view')
);

drop policy if exists platform_user_permissions_read on public.platform_user_permissions;
create policy platform_user_permissions_read on public.platform_user_permissions
for select to authenticated using (
  user_id=(select auth.uid()) or private.platform_has_permission('users.view')
);

drop policy if exists platform_secrets_no_client_access on public.platform_secrets;
create policy platform_secrets_no_client_access on public.platform_secrets
for all to anon,authenticated
using (false)
with check (false);
