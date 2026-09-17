alter table public.transport_tariff_documents
  add column if not exists vat_rate_pct numeric(6,3);

comment on column public.transport_tariff_documents.vat_rate_pct is
  'VAT percentage used to derive gross shipping cost from tariff prices when the source tariff excludes VAT.';

update public.transport_tariff_documents
set vat_rate_pct = 21
where carrier_code = 'mrw'
  and vat_rate_pct is null
  and prices_include_vat = false
  and coalesce(source_file_name,'') ilike '%IMPULSO%CADIZ%';
