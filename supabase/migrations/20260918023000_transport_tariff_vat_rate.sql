alter table public.transport_tariff_documents
  add column if not exists vat_rate_pct numeric(6,3) default 21;
