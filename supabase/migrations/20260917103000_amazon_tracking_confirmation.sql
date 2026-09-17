alter table public.fulfillment_orders
  add column if not exists amazon_tracking_synced_at timestamptz,
  add column if not exists amazon_tracking_last_attempt_at timestamptz,
  add column if not exists amazon_tracking_sync_error text,
  add column if not exists amazon_tracking_sync_attempts integer not null default 0;

create index if not exists fulfillment_orders_amazon_tracking_pending_idx
  on public.fulfillment_orders(owner_id, label_created_at desc)
  where source_channel = 'amazon'
    and tracking_number is not null
    and amazon_tracking_synced_at is null;
