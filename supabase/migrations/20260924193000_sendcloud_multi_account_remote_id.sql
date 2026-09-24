alter table public.fulfillment_orders
  add column if not exists sendcloud_remote_id text;

update public.fulfillment_orders
set sendcloud_remote_id=sendcloud_id
where sendcloud_remote_id is null
  and sendcloud_id is not null
  and position(':' in sendcloud_id)=0;

create unique index if not exists fulfillment_orders_shipping_remote_uidx
  on public.fulfillment_orders(owner_id,shipping_integration_account_id,sendcloud_remote_id)
  where shipping_integration_account_id is not null and sendcloud_remote_id is not null;

create index if not exists fulfillment_orders_sendcloud_remote_idx
  on public.fulfillment_orders(owner_id,sendcloud_remote_id)
  where sendcloud_remote_id is not null;
