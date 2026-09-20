alter table public.business_settings
  add column if not exists website text;

drop policy if exists business_settings_workspace_write on public.business_settings;
create policy business_settings_admin_write
on public.business_settings
for all
to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
)
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

drop policy if exists company_branding_workspace_insert on public.company_branding;
drop policy if exists company_branding_workspace_update on public.company_branding;
drop policy if exists company_branding_workspace_delete on public.company_branding;

create policy company_branding_admin_insert
on public.company_branding for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

create policy company_branding_admin_update
on public.company_branding for update to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
)
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

create policy company_branding_admin_delete
on public.company_branding for delete to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

notify pgrst,'reload schema';
