create table if not exists public.amazon_product_images (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null,
  asin text not null,
  marketplace_id text,
  image_url text,
  image_width integer,
  image_height integer,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,amazon_account_id,asin,marketplace_id)
);
create index if not exists amazon_product_images_lookup_idx
  on public.amazon_product_images(owner_id,asin,fetched_at desc);
alter table public.amazon_product_images enable row level security;
drop policy if exists amazon_product_images_select on public.amazon_product_images;
create policy amazon_product_images_select on public.amazon_product_images
for select to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('amazon')));
grant select on public.amazon_product_images to authenticated;
