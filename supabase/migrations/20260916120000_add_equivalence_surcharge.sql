alter table public.invoices
  add column if not exists equivalence_surcharge_amount numeric(14,2) not null default 0;
