-- Cover new Amazon Analytics foreign keys and remove a duplicate historical-cost index.

create index if not exists amazon_finance_components_account_fk_idx
  on public.amazon_finance_components(amazon_account_id);

create index if not exists amazon_finance_components_transaction_fk_idx
  on public.amazon_finance_components(finance_transaction_id);

create index if not exists amazon_product_mappings_account_fk_idx
  on public.amazon_product_mappings(amazon_account_id);

create index if not exists amazon_product_mappings_product_fk_idx
  on public.amazon_product_mappings(product_id);

-- product_price_history_product_date_idx already covers the same columns.
drop index if exists public.amazon_price_history_analytics_idx;
