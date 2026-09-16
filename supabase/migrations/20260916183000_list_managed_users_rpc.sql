create or replace function public.list_managed_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  active boolean,
  permissions text[],
  created_at timestamptz,
  updated_at timestamptz,
  last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    au.user_id,
    au.email,
    coalesce(au.full_name, '') as full_name,
    au.role,
    au.active,
    au.permissions,
    au.created_at,
    au.updated_at,
    u.last_sign_in_at
  from public.app_users au
  join auth.users u on u.id = au.user_id
  where private.app_is_admin()
    and au.data_owner_id = private.app_workspace_owner_id()
  order by au.created_at asc;
$$;

revoke all on function public.list_managed_users() from public, anon;
grant execute on function public.list_managed_users() to authenticated;

notify pgrst, 'reload schema';
