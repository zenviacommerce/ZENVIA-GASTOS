alter table public.clients
  add column if not exists default_vat_rate numeric(7,4),
  add column if not exists default_payment_method text;

alter table public.clients
  drop constraint if exists clients_default_vat_rate_check;

alter table public.clients
  add constraint clients_default_vat_rate_check
  check (default_vat_rate is null or (default_vat_rate >= 0 and default_vat_rate <= 100));

notify pgrst,'reload schema';
