alter table public.suppliers
  add column if not exists address text,
  add column if not exists website text;
