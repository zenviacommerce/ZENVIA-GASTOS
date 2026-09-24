create index if not exists integration_accounts_parent_account_idx
  on public.integration_accounts(parent_account_id)
  where parent_account_id is not null;

create index if not exists fulfillment_orders_source_integration_fk_idx
  on public.fulfillment_orders(source_integration_account_id)
  where source_integration_account_id is not null;

create index if not exists fulfillment_orders_shipping_integration_fk_idx
  on public.fulfillment_orders(shipping_integration_account_id)
  where shipping_integration_account_id is not null;

create index if not exists gmail_imports_integration_account_fk_idx
  on public.gmail_imports(integration_account_id)
  where integration_account_id is not null;
