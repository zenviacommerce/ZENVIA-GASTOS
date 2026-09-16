alter table public.app_users drop constraint if exists app_users_permissions_check;
alter table public.app_users add constraint app_users_permissions_check
  check (permissions <@ array[
    'dashboard','sales','orders','invoices','clients','products','suppliers','amazon'
  ]::text[]);
