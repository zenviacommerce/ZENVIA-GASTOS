create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  icon text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  tax_id text,
  email text,
  phone text,
  supplier_type text not null default 'service' check (supplier_type in ('goods','service','both')),
  default_category_id uuid references public.expense_categories(id) on delete set null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  sku text,
  category text,
  base_unit text not null default 'ud',
  active boolean not null default true,
  last_cost numeric(14,6),
  previous_cost numeric(14,6),
  cost_unit text,
  last_supplier_id uuid references public.suppliers(id) on delete set null,
  last_purchase_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, sku)
);

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_sku text,
  supplier_description text not null,
  purchase_unit text,
  units_per_purchase numeric(14,4) not null default 1 check (units_per_purchase > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, supplier_id, supplier_description)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_number text,
  issue_date date,
  received_date date not null default current_date,
  fiscal_year integer,
  fiscal_quarter smallint check (fiscal_quarter between 1 and 4),
  currency text not null default 'EUR',
  net_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  withholding_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  expense_category_id uuid references public.expense_categories(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','reviewed','accounted')),
  source text not null default 'manual' check (source in ('manual','camera','gmail')),
  file_path text,
  file_name text,
  mime_type text,
  file_hash text,
  ocr_text text,
  extraction jsonb not null default '{}'::jsonb,
  extraction_confidence numeric(5,4),
  duplicate_of uuid references public.invoices(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index invoices_supplier_number_uidx on public.invoices(owner_id, supplier_id, invoice_number)
  where supplier_id is not null and invoice_number is not null and length(trim(invoice_number)) > 0;
create index invoices_owner_issue_date_idx on public.invoices(owner_id, issue_date desc);
create index invoices_owner_quarter_idx on public.invoices(owner_id, fiscal_year, fiscal_quarter);
create index invoices_file_hash_idx on public.invoices(owner_id, file_hash) where file_hash is not null;

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  description text not null,
  supplier_sku text,
  quantity numeric(14,4) not null default 1,
  unit text,
  units_per_purchase numeric(14,4) not null default 1 check (units_per_purchase > 0),
  unit_price numeric(14,6),
  normalized_unit_price numeric(14,6),
  discount_percent numeric(7,4),
  line_net numeric(14,2),
  tax_rate numeric(7,4),
  tax_amount numeric(14,2),
  line_total numeric(14,2),
  ai_confidence numeric(5,4),
  price_update_status text not null default 'pending' check (price_update_status in ('pending','confirmed','ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create index invoice_lines_product_idx on public.invoice_lines(owner_id, product_id);

create table public.product_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  invoice_line_id uuid unique references public.invoice_lines(id) on delete set null,
  price_date date not null,
  purchase_unit_price numeric(14,6),
  normalized_unit_price numeric(14,6) not null,
  base_unit text not null,
  currency text not null default 'EUR',
  created_at timestamptz not null default now()
);
create index product_price_history_product_date_idx on public.product_price_history(owner_id, product_id, price_date desc, created_at desc);

create table public.gmail_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text,
  sender text,
  subject text,
  received_at timestamptz,
  attachment_name text,
  status text not null default 'found' check (status in ('found','imported','ignored','error')),
  invoice_id uuid references public.invoices(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, gmail_message_id, attachment_name)
);

create table public.export_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fiscal_year integer not null,
  fiscal_quarter smallint not null check (fiscal_quarter between 1 and 4),
  invoice_count integer not null default 0,
  total_amount numeric(14,2) not null default 0,
  storage_path text,
  created_at timestamptz not null default now()
);

create or replace function public.set_invoice_period()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.issue_date is not null then
    new.fiscal_year := extract(year from new.issue_date)::integer;
    new.fiscal_quarter := extract(quarter from new.issue_date)::smallint;
  else
    new.fiscal_year := null; new.fiscal_quarter := null;
  end if;
  return new;
end; $$;
create trigger invoices_set_period before insert or update of issue_date on public.invoices for each row execute function public.set_invoice_period();

create or replace function public.capture_confirmed_product_price()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_supplier_id uuid; v_issue_date date; v_currency text; v_base_unit text;
begin
  if new.product_id is not null and new.price_update_status = 'confirmed' and new.normalized_unit_price is not null
     and (tg_op = 'INSERT' or old.price_update_status is distinct from 'confirmed' or old.normalized_unit_price is distinct from new.normalized_unit_price) then
    select i.supplier_id, coalesce(i.issue_date, i.received_date), i.currency into v_supplier_id, v_issue_date, v_currency from public.invoices i where i.id = new.invoice_id;
    select p.base_unit into v_base_unit from public.products p where p.id = new.product_id;
    insert into public.product_price_history(owner_id,product_id,supplier_id,invoice_id,invoice_line_id,price_date,purchase_unit_price,normalized_unit_price,base_unit,currency)
    values(new.owner_id,new.product_id,v_supplier_id,new.invoice_id,new.id,coalesce(v_issue_date,current_date),new.unit_price,new.normalized_unit_price,coalesce(v_base_unit,new.unit,'ud'),coalesce(v_currency,'EUR'))
    on conflict(invoice_line_id) do update set supplier_id=excluded.supplier_id,price_date=excluded.price_date,purchase_unit_price=excluded.purchase_unit_price,normalized_unit_price=excluded.normalized_unit_price,base_unit=excluded.base_unit,currency=excluded.currency;
    update public.products p set previous_cost=case when p.last_cost is distinct from new.normalized_unit_price then p.last_cost else p.previous_cost end,last_cost=new.normalized_unit_price,cost_unit=coalesce(v_base_unit,new.unit,'ud'),last_supplier_id=v_supplier_id,last_purchase_date=coalesce(v_issue_date,current_date),updated_at=now() where p.id=new.product_id and p.owner_id=new.owner_id;
  end if;
  return new;
end; $$;
create trigger invoice_lines_capture_price after insert or update of price_update_status, normalized_unit_price, unit_price, product_id on public.invoice_lines for each row execute function public.capture_confirmed_product_price();

create trigger expense_categories_updated_at before update on public.expense_categories for each row execute function public.set_updated_at();
create trigger suppliers_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger supplier_products_updated_at before update on public.supplier_products for each row execute function public.set_updated_at();
create trigger invoices_updated_at before update on public.invoices for each row execute function public.set_updated_at();
create trigger invoice_lines_updated_at before update on public.invoice_lines for each row execute function public.set_updated_at();
create trigger gmail_imports_updated_at before update on public.gmail_imports for each row execute function public.set_updated_at();

alter table public.expense_categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.supplier_products enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.product_price_history enable row level security;
alter table public.gmail_imports enable row level security;
alter table public.export_runs enable row level security;

create policy expense_categories_owner_all on public.expense_categories for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy suppliers_owner_all on public.suppliers for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy products_owner_all on public.products for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy supplier_products_owner_all on public.supplier_products for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy invoices_owner_all on public.invoices for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy invoice_lines_owner_all on public.invoice_lines for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy product_price_history_owner_all on public.product_price_history for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy gmail_imports_owner_all on public.gmail_imports for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy export_runs_owner_all on public.export_runs for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.expense_categories,public.suppliers,public.products,public.supplier_products,public.invoices,public.invoice_lines,public.product_price_history,public.gmail_imports,public.export_runs to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('invoices','invoices',false,26214400,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy invoices_storage_select on storage.objects for select to authenticated using (bucket_id='invoices' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy invoices_storage_insert on storage.objects for insert to authenticated with check (bucket_id='invoices' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy invoices_storage_update on storage.objects for update to authenticated using (bucket_id='invoices' and (storage.foldername(name))[1]=(select auth.uid())::text) with check (bucket_id='invoices' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy invoices_storage_delete on storage.objects for delete to authenticated using (bucket_id='invoices' and (storage.foldername(name))[1]=(select auth.uid())::text);

create or replace function public.bootstrap_expense_categories()
returns void language plpgsql security invoker set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  insert into public.expense_categories(owner_id,name,sort_order) values
    (v_uid,'Mercancía',10),(v_uid,'Transporte y logística',20),(v_uid,'Publicidad y marketing',30),(v_uid,'Software y suscripciones',40),(v_uid,'Embalaje y consumibles',50),(v_uid,'Servicios profesionales',60),(v_uid,'Suministros',70),(v_uid,'Viajes y dietas',80),(v_uid,'Comisiones marketplaces',90),(v_uid,'Otros',100)
  on conflict(owner_id,name) do nothing;
end; $$;
grant execute on function public.bootstrap_expense_categories() to authenticated;

create index export_runs_owner_idx on public.export_runs(owner_id);
create index gmail_imports_invoice_idx on public.gmail_imports(invoice_id);
create index invoice_lines_product_fk_idx on public.invoice_lines(product_id);
create index invoice_lines_supplier_product_idx on public.invoice_lines(supplier_product_id);
create index invoices_duplicate_of_idx on public.invoices(duplicate_of);
create index invoices_category_idx on public.invoices(expense_category_id);
create index invoices_supplier_idx on public.invoices(supplier_id);
create index price_history_invoice_idx on public.product_price_history(invoice_id);
create index price_history_product_idx on public.product_price_history(product_id);
create index price_history_supplier_idx on public.product_price_history(supplier_id);
create index products_last_supplier_idx on public.products(last_supplier_id);
create index supplier_products_product_idx on public.supplier_products(product_id);
create index supplier_products_supplier_idx on public.supplier_products(supplier_id);
create index suppliers_default_category_idx on public.suppliers(default_category_id);
