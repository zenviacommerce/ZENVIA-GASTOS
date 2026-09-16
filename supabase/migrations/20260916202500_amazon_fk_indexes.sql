-- Cover Amazon Analytics foreign keys before historical backfill.
-- These indexes improve cascades, joins and account-scoped maintenance.

create index if not exists amazon_finance_transactions_account_idx
  on public.amazon_finance_transactions(amazon_account_id);

create index if not exists amazon_inventory_current_account_idx
  on public.amazon_inventory_current(amazon_account_id);

create index if not exists amazon_inventory_daily_account_idx
  on public.amazon_inventory_daily(amazon_account_id);

create index if not exists amazon_marketplaces_account_idx
  on public.amazon_marketplaces(amazon_account_id);

create index if not exists amazon_order_items_account_idx
  on public.amazon_order_items(amazon_account_id);

create index if not exists amazon_orders_account_idx
  on public.amazon_orders(amazon_account_id);

create index if not exists amazon_sync_jobs_account_idx
  on public.amazon_sync_jobs(amazon_account_id);

create index if not exists amazon_sync_jobs_run_idx
  on public.amazon_sync_jobs(run_id);

create index if not exists amazon_sync_runs_account_idx
  on public.amazon_sync_runs(amazon_account_id);

create index if not exists amazon_sync_state_account_idx
  on public.amazon_sync_state(amazon_account_id);
