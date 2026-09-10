create or replace function private.app_storage_folder_in_workspace(folder_user_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select folder_user_id = (select private.app_workspace_owner_id())::text
     or exists (
       select 1 from public.app_users au
       where au.user_id::text = folder_user_id
         and au.data_owner_id = (select private.app_workspace_owner_id())
     )
$$;
revoke all on function private.app_storage_folder_in_workspace(text) from public, anon;
grant execute on function private.app_storage_folder_in_workspace(text) to authenticated;

drop policy if exists invoices_storage_select on storage.objects;
drop policy if exists invoices_storage_insert on storage.objects;
drop policy if exists invoices_storage_update on storage.objects;
drop policy if exists invoices_storage_delete on storage.objects;

create policy invoices_storage_select on storage.objects for select to authenticated
using (
  bucket_id='invoices'
  and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
);
create policy invoices_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id='invoices'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
);
create policy invoices_storage_update on storage.objects for update to authenticated
using (
  bucket_id='invoices'
  and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
)
with check (
  bucket_id='invoices'
  and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
  and ((select private.app_has_permission('invoices')) or (select private.app_has_permission('gmail')))
);
create policy invoices_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id='invoices'
  and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1]))
  and (select private.app_has_permission('invoices'))
);
