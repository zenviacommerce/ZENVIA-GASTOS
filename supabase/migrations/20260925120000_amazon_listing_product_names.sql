-- Cache the Amazon listing title together with product imagery.
alter table public.amazon_product_images
  add column if not exists product_name text,
  add column if not exists seller_sku text;

create index if not exists amazon_product_images_sku_idx
  on public.amazon_product_images(owner_id,amazon_account_id,seller_sku)
  where seller_sku is not null;
