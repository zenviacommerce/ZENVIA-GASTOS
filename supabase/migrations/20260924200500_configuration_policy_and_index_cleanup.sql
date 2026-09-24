-- Tighten Configuration Center policies and cover the new preferences FK.

drop policy if exists business_settings_admin_write on public.business_settings;

drop policy if exists business_settings_admin_insert on public.business_settings;
create policy business_settings_admin_insert
on public.business_settings
for insert
to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

drop policy if exists business_settings_admin_update on public.business_settings;
create policy business_settings_admin_update
on public.business_settings
for update
to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
)
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

drop policy if exists business_settings_admin_delete on public.business_settings;
create policy business_settings_admin_delete
on public.business_settings
for delete
to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

create index if not exists user_preferences_owner_id_idx
  on public.user_preferences(owner_id);

notify pgrst,'reload schema';
