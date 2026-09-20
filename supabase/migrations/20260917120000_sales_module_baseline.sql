-- Reconstruct the sales/business schema that existed in production before
-- 20260917125000_sales_invoice_number_edit.sql. This closes a historical
-- migration gap so a fresh Supabase project can replay the repository.

create table if not exists public.business_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  legal_name text not null default 'ZENVIA COMMERCE SL',
  trade_name text,
  tax_id text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  province text,
  country_code text not null default 'ES',
  email text,
  phone text,
  iban text,
  invoice_footer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  name text not null,
  tax_id text,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  province text,
  country_code text not null default 'ES',
  payment_terms_days integer not null default 0 check (payment_terms_days between 0 and 365),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,name)
);

create table if not exists public.sales_invoice_series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  code text not null,
  name text not null,
  kind text not null default 'standard' check (kind in ('standard','rectifying')),
  year integer not null,
  prefix text not null,
  next_number integer not null default 1 check (next_number > 0),
  padding smallint not null default 4 check (padding between 1 and 10),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,code,year)
);

create table if not exists public.business_tax_registrations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  label text not null,
  country_code text not null default 'ES' check (char_length(country_code)=2),
  vat_number text not null,
  fiscal_name text,
  address_text text,
  is_default boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,vat_number)
);

create unique index if not exists business_tax_registrations_one_default_idx
  on public.business_tax_registrations(owner_id) where is_default;
create index if not exists business_tax_registrations_owner_idx
  on public.business_tax_registrations(owner_id);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  client_id uuid not null references public.clients(id) on delete restrict,
  series_id uuid not null references public.sales_invoice_series(id) on delete restrict,
  invoice_type text not null default 'standard' check (invoice_type in ('standard','rectifying')),
  rectifies_invoice_id uuid references public.sales_invoices(id) on delete restrict,
  invoice_number text,
  status text not null default 'draft' check (status in ('draft','issued','sent','partially_paid','paid','rectified','cancelled')),
  issue_date date not null default current_date,
  operation_date date,
  due_date date,
  currency text not null default 'EUR',
  subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  payment_method text,
  notes text,
  client_name text,
  client_tax_id text,
  client_email text,
  client_address text,
  issuer_name text,
  issuer_tax_id text,
  issuer_email text,
  issuer_address text,
  issued_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reserved_number integer check (reserved_number is null or reserved_number > 0),
  tax_registration_id uuid references public.business_tax_registrations(id) on delete set null,
  client_phone text,
  issuer_phone text,
  issuer_tax_country_code text,
  issuer_tax_registration_label text,
  unique(owner_id,invoice_number)
);

create index if not exists sales_invoices_client_idx on public.sales_invoices(client_id);
create index if not exists sales_invoices_owner_date_idx on public.sales_invoices(owner_id,issue_date desc);
create index if not exists sales_invoices_tax_registration_idx on public.sales_invoices(tax_registration_id);

create table if not exists public.sales_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  position integer not null default 1,
  description text not null,
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit text not null default 'ud',
  unit_price numeric(14,4) not null default 0,
  discount_percent numeric(7,4) not null default 0 check (discount_percent between 0 and 100),
  tax_rate numeric(7,4) not null default 21 check (tax_rate between 0 and 100),
  line_net numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_invoice_lines_invoice_idx
  on public.sales_invoice_lines(invoice_id,position);

create table if not exists public.sales_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  method text,
  reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists sales_payments_invoice_idx
  on public.sales_payments(invoice_id,payment_date);

create table if not exists public.sales_invoice_released_numbers (
  owner_id uuid not null default private.app_workspace_owner_id(),
  series_id uuid not null references public.sales_invoice_series(id) on delete cascade,
  number integer not null check (number > 0),
  created_at timestamptz not null default now(),
  primary key(owner_id,series_id,number)
);

create table if not exists public.company_branding (
  owner_id uuid primary key references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_secrets (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider='sendcloud'),
  secret_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,provider)
);

create or replace function private.sales_invoice_line_calculate()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_gross numeric;
  v_net numeric;
  v_type text;
begin
  select invoice_type into v_type from public.sales_invoices where id=new.invoice_id;
  if v_type is null then raise exception 'Factura no encontrada.'; end if;
  if v_type='standard' and new.unit_price < 0 then
    raise exception 'Una factura ordinaria no puede tener precios negativos.';
  end if;
  v_gross := new.quantity * new.unit_price;
  v_net := v_gross * (1 - new.discount_percent / 100);
  new.line_net := round(v_net,2);
  new.tax_amount := round(new.line_net * new.tax_rate / 100,2);
  new.line_total := new.line_net + new.tax_amount;
  return new;
end;
$$;

create or replace function private.recalculate_sales_invoice_totals()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_invoice_id uuid;
begin
  v_invoice_id := case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  update public.sales_invoices i
  set subtotal=coalesce(x.net,0),
      discount_amount=coalesce(x.discount,0),
      tax_amount=coalesce(x.tax,0),
      total_amount=coalesce(x.total,0)
  from (
    select invoice_id,
           round(sum(quantity*unit_price),2)-round(sum(line_net),2) as discount,
           round(sum(line_net),2) as net,
           round(sum(tax_amount),2) as tax,
           round(sum(line_total),2) as total
    from public.sales_invoice_lines
    where invoice_id=v_invoice_id
    group by invoice_id
  ) x
  where i.id=v_invoice_id and i.id=x.invoice_id;

  if not found then
    update public.sales_invoices
       set subtotal=0,discount_amount=0,tax_amount=0,total_amount=0
     where id=v_invoice_id;
  end if;
  return coalesce(new,old);
end;
$$;

create or replace function private.guard_sales_invoice_line_edit()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_invoice_id uuid;
  v_status text;
begin
  v_invoice_id := case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select status into v_status from public.sales_invoices where id=v_invoice_id;
  if tg_op='DELETE' and v_status is null then return old; end if;
  if v_status is distinct from 'draft' then
    raise exception 'Las líneas de una factura emitida no se pueden modificar.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.guard_sales_invoice_immutable()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    if old.status='draft' then return old; end if;
    if old.status='issued'
       and old.sent_at is null
       and old.paid_at is null
       and not exists(select 1 from public.sales_payments p where p.invoice_id=old.id)
    then
      return old;
    end if;
    raise exception 'Solo se puede eliminar una factura en borrador o una factura emitida que todavía no se haya enviado ni cobrado.';
  end if;

  if old.status='issued' and new.status='draft' then
    if old.sent_at is not null
       or old.paid_at is not null
       or exists(select 1 from public.sales_payments p where p.invoice_id=old.id)
    then
      raise exception 'La factura ya tiene envío o cobros y no se puede reabrir.';
    end if;
    return new;
  end if;

  if old.status <> 'draft' then
    if new.client_id is distinct from old.client_id
      or new.series_id is distinct from old.series_id
      or new.invoice_type is distinct from old.invoice_type
      or new.rectifies_invoice_id is distinct from old.rectifies_invoice_id
      or new.invoice_number is distinct from old.invoice_number
      or new.issue_date is distinct from old.issue_date
      or new.operation_date is distinct from old.operation_date
      or new.due_date is distinct from old.due_date
      or new.currency is distinct from old.currency
      or new.subtotal is distinct from old.subtotal
      or new.discount_amount is distinct from old.discount_amount
      or new.tax_amount is distinct from old.tax_amount
      or new.total_amount is distinct from old.total_amount
      or new.payment_method is distinct from old.payment_method
      or new.notes is distinct from old.notes
      or new.client_name is distinct from old.client_name
      or new.client_tax_id is distinct from old.client_tax_id
      or new.client_email is distinct from old.client_email
      or new.client_address is distinct from old.client_address
      or new.issuer_name is distinct from old.issuer_name
      or new.issuer_tax_id is distinct from old.issuer_tax_id
      or new.issuer_email is distinct from old.issuer_email
      or new.issuer_address is distinct from old.issuer_address
    then
      raise exception 'Los datos fiscales de una factura cerrada no se pueden modificar directamente.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.sync_sales_payment_status()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_invoice_id uuid;
  v_paid numeric;
  v_total numeric;
  v_status text;
begin
  v_invoice_id := case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
  select total_amount,status into v_total,v_status
  from public.sales_invoices where id=v_invoice_id;
  if v_status='draft' then
    raise exception 'No se pueden registrar cobros sobre una factura en borrador.';
  end if;
  select coalesce(sum(amount),0) into v_paid
  from public.sales_payments where invoice_id=v_invoice_id;
  update public.sales_invoices
     set status=case
          when v_paid>=v_total and v_total>0 then 'paid'
          when v_paid>0 then 'partially_paid'
          when v_status in ('paid','partially_paid') then 'issued'
          else v_status
        end,
        paid_at=case when v_paid>=v_total and v_total>0 then coalesce(paid_at,now()) else null end
   where id=v_invoice_id;
  return coalesce(new,old);
end;
$$;

create or replace function public.create_rectifying_invoice(p_original_id uuid)
returns uuid
language plpgsql
set search_path=''
as $$
declare
  v_original public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_new_id uuid;
  v_year integer := extract(year from current_date)::integer;
begin
  select * into v_original from public.sales_invoices where id=p_original_id;
  if v_original.id is null then raise exception 'Factura original no encontrada.'; end if;
  if v_original.status='draft' then raise exception 'No se puede rectificar un borrador.'; end if;
  if v_original.invoice_type='rectifying' then raise exception 'No se puede rectificar una rectificativa desde esta acción.'; end if;
  if v_original.status='rectified' then raise exception 'La factura ya está rectificada.'; end if;

  select * into v_series from public.sales_invoice_series
   where owner_id=v_original.owner_id and kind='rectifying' and year=v_year and active=true
   order by created_at limit 1;
  if v_series.id is null then raise exception 'No existe una serie rectificativa activa para el año actual.'; end if;

  insert into public.sales_invoices(
    owner_id,client_id,series_id,tax_registration_id,invoice_type,rectifies_invoice_id,
    issue_date,operation_date,due_date,currency,payment_method,notes
  ) values (
    v_original.owner_id,v_original.client_id,v_series.id,v_original.tax_registration_id,'rectifying',v_original.id,
    current_date,current_date,current_date,v_original.currency,v_original.payment_method,
    concat('Rectifica la factura ',coalesce(v_original.invoice_number,v_original.id::text),'.')
  ) returning id into v_new_id;

  insert into public.sales_invoice_lines(owner_id,invoice_id,product_id,position,description,quantity,unit,unit_price,discount_percent,tax_rate)
  select owner_id,v_new_id,product_id,position,description,quantity,unit,-abs(unit_price),discount_percent,tax_rate
  from public.sales_invoice_lines where invoice_id=v_original.id order by position;
  return v_new_id;
end;
$$;

create or replace function public.reopen_sales_invoice(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
set search_path=''
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_number integer;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;
  if v_invoice.status <> 'issued' then raise exception 'Solo se puede reabrir una factura que esté únicamente emitida.'; end if;
  if v_invoice.sent_at is not null or v_invoice.paid_at is not null or exists(select 1 from public.sales_payments p where p.invoice_id=v_invoice.id) then
    raise exception 'La factura ya se ha enviado o tiene cobros y no se puede reabrir.';
  end if;

  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null then raise exception 'Serie no encontrada.'; end if;
  if v_invoice.invoice_number is null or left(v_invoice.invoice_number,char_length(v_series.prefix))<>v_series.prefix then
    raise exception 'No se pudo recuperar el número de factura.';
  end if;

  v_number := substring(v_invoice.invoice_number from char_length(v_series.prefix)+1)::integer;
  insert into public.sales_invoice_released_numbers(owner_id,series_id,number)
  values(v_invoice.owner_id,v_invoice.series_id,v_number)
  on conflict do nothing;

  update public.sales_invoices
     set status='draft',invoice_number=null,reserved_number=v_number,issued_at=null,
         client_name=null,client_tax_id=null,client_email=null,client_address=null,
         issuer_name=null,issuer_tax_id=null,issuer_email=null,issuer_address=null
   where id=v_invoice.id
   returning * into v_invoice;
  return v_invoice;
end;
$$;

create or replace function public.delete_reversible_sales_invoice(p_invoice_id uuid)
returns void
language plpgsql
set search_path=''
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_number integer;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;

  if v_invoice.status='draft' then
    delete from public.sales_invoices where id=v_invoice.id;
    return;
  end if;

  if v_invoice.status <> 'issued' then
    raise exception 'Solo se puede eliminar completamente una factura en borrador o una factura que esté únicamente emitida.';
  end if;
  if v_invoice.sent_at is not null or v_invoice.paid_at is not null or exists(select 1 from public.sales_payments p where p.invoice_id=v_invoice.id) then
    raise exception 'La factura ya se ha enviado o tiene cobros y no se puede eliminar completamente.';
  end if;

  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null then raise exception 'Serie no encontrada.'; end if;
  if v_invoice.invoice_number is null or left(v_invoice.invoice_number,char_length(v_series.prefix))<>v_series.prefix then
    raise exception 'No se pudo recuperar el número de factura.';
  end if;

  v_number := substring(v_invoice.invoice_number from char_length(v_series.prefix)+1)::integer;
  insert into public.sales_invoice_released_numbers(owner_id,series_id,number)
  values(v_invoice.owner_id,v_invoice.series_id,v_number)
  on conflict do nothing;

  delete from public.sales_invoices where id=v_invoice.id;
end;
$$;

create or replace function public.set_integration_secrets_updated_at()
returns trigger
language plpgsql
set search_path='public'
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

revoke all on function private.sales_invoice_line_calculate() from public,anon,authenticated;
revoke all on function private.recalculate_sales_invoice_totals() from public,anon,authenticated;
revoke all on function private.guard_sales_invoice_line_edit() from public,anon,authenticated;
revoke all on function private.guard_sales_invoice_immutable() from public,anon,authenticated;
revoke all on function private.sync_sales_payment_status() from public,anon,authenticated;
revoke all on function public.create_rectifying_invoice(uuid) from public,anon;
revoke all on function public.reopen_sales_invoice(uuid) from public,anon;
revoke all on function public.delete_reversible_sales_invoice(uuid) from public,anon;
grant execute on function public.create_rectifying_invoice(uuid) to authenticated;
grant execute on function public.reopen_sales_invoice(uuid) to authenticated;
grant execute on function public.delete_reversible_sales_invoice(uuid) to authenticated;

drop trigger if exists business_settings_updated_at on public.business_settings;
create trigger business_settings_updated_at before update on public.business_settings
for each row execute function public.set_updated_at();

drop trigger if exists clients_updated_at on public.clients;
create trigger clients_updated_at before update on public.clients
for each row execute function public.set_updated_at();

drop trigger if exists sales_invoice_series_updated_at on public.sales_invoice_series;
create trigger sales_invoice_series_updated_at before update on public.sales_invoice_series
for each row execute function public.set_updated_at();

drop trigger if exists sales_invoices_updated_at on public.sales_invoices;
create trigger sales_invoices_updated_at before update on public.sales_invoices
for each row execute function public.set_updated_at();

drop trigger if exists sales_invoices_immutable on public.sales_invoices;
create trigger sales_invoices_immutable before update or delete on public.sales_invoices
for each row execute function private.guard_sales_invoice_immutable();

drop trigger if exists sales_invoice_lines_updated_at on public.sales_invoice_lines;
create trigger sales_invoice_lines_updated_at before update on public.sales_invoice_lines
for each row execute function public.set_updated_at();

drop trigger if exists sales_invoice_lines_calculate on public.sales_invoice_lines;
create trigger sales_invoice_lines_calculate before insert or update on public.sales_invoice_lines
for each row execute function private.sales_invoice_line_calculate();

drop trigger if exists sales_invoice_lines_guard on public.sales_invoice_lines;
create trigger sales_invoice_lines_guard before insert or update or delete on public.sales_invoice_lines
for each row execute function private.guard_sales_invoice_line_edit();

drop trigger if exists sales_invoice_lines_recalc on public.sales_invoice_lines;
create trigger sales_invoice_lines_recalc after insert or update or delete on public.sales_invoice_lines
for each row execute function private.recalculate_sales_invoice_totals();

drop trigger if exists sales_payments_status on public.sales_payments;
create trigger sales_payments_status after insert or update or delete on public.sales_payments
for each row execute function private.sync_sales_payment_status();

drop trigger if exists integration_secrets_set_updated_at on public.integration_secrets;
create trigger integration_secrets_set_updated_at before update on public.integration_secrets
for each row execute function public.set_integration_secrets_updated_at();

alter table public.business_settings enable row level security;
alter table public.clients enable row level security;
alter table public.sales_invoice_series enable row level security;
alter table public.business_tax_registrations enable row level security;
alter table public.sales_invoices enable row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.sales_payments enable row level security;
alter table public.sales_invoice_released_numbers enable row level security;
alter table public.company_branding enable row level security;
alter table public.integration_secrets enable row level security;

revoke all on public.business_settings,public.clients,public.sales_invoice_series,public.business_tax_registrations,
  public.sales_invoices,public.sales_invoice_lines,public.sales_payments,public.sales_invoice_released_numbers,
  public.company_branding,public.integration_secrets from anon;
grant select,insert,update,delete on public.business_settings,public.clients,public.sales_invoice_series,
  public.business_tax_registrations,public.sales_invoices,public.sales_invoice_lines,public.sales_payments,
  public.sales_invoice_released_numbers,public.company_branding to authenticated;
grant select,insert,update,delete on public.integration_secrets to authenticated;

drop policy if exists business_settings_workspace_select on public.business_settings;
create policy business_settings_workspace_select on public.business_settings for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('sales')) or (select private.app_has_permission('clients')))
);
drop policy if exists business_settings_workspace_write on public.business_settings;
create policy business_settings_workspace_write on public.business_settings for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists clients_workspace_select on public.clients;
create policy clients_workspace_select on public.clients for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('clients')) or (select private.app_has_permission('sales')) or (select private.app_has_permission('dashboard')))
);
drop policy if exists clients_workspace_insert on public.clients;
create policy clients_workspace_insert on public.clients for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('clients')) or (select private.app_has_permission('sales')))
);
drop policy if exists clients_workspace_update on public.clients;
create policy clients_workspace_update on public.clients for update to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('clients')) or (select private.app_has_permission('sales')))
)
with check (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('clients')) or (select private.app_has_permission('sales')))
);
drop policy if exists clients_workspace_delete on public.clients;
create policy clients_workspace_delete on public.clients for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('clients')));

drop policy if exists sales_series_workspace_all on public.sales_invoice_series;
create policy sales_series_workspace_all on public.sales_invoice_series for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists business_tax_registrations_select on public.business_tax_registrations;
create policy business_tax_registrations_select on public.business_tax_registrations for select to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));
drop policy if exists business_tax_registrations_insert on public.business_tax_registrations;
create policy business_tax_registrations_insert on public.business_tax_registrations for insert to authenticated
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));
drop policy if exists business_tax_registrations_update on public.business_tax_registrations;
create policy business_tax_registrations_update on public.business_tax_registrations for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));
drop policy if exists business_tax_registrations_delete on public.business_tax_registrations;
create policy business_tax_registrations_delete on public.business_tax_registrations for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists sales_invoices_workspace_select on public.sales_invoices;
create policy sales_invoices_workspace_select on public.sales_invoices for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('sales')) or (select private.app_has_permission('dashboard')))
);
drop policy if exists sales_invoices_workspace_all on public.sales_invoices;
create policy sales_invoices_workspace_all on public.sales_invoices for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists sales_lines_workspace_select on public.sales_invoice_lines;
create policy sales_lines_workspace_select on public.sales_invoice_lines for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('sales')) or (select private.app_has_permission('dashboard')))
);
drop policy if exists sales_lines_workspace_all on public.sales_invoice_lines;
create policy sales_lines_workspace_all on public.sales_invoice_lines for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists sales_payments_workspace_select on public.sales_payments;
create policy sales_payments_workspace_select on public.sales_payments for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('sales')) or (select private.app_has_permission('dashboard')))
);
drop policy if exists sales_payments_workspace_all on public.sales_payments;
create policy sales_payments_workspace_all on public.sales_payments for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists sales_invoice_released_numbers_workspace_all on public.sales_invoice_released_numbers;
create policy sales_invoice_released_numbers_workspace_all on public.sales_invoice_released_numbers for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

drop policy if exists company_branding_workspace_select on public.company_branding;
create policy company_branding_workspace_select on public.company_branding for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and ((select private.app_has_permission('sales')) or (select private.app_has_permission('clients')) or (select private.app_has_permission('dashboard')))
);
drop policy if exists company_branding_workspace_insert on public.company_branding;
create policy company_branding_workspace_insert on public.company_branding for insert to authenticated
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));
drop policy if exists company_branding_workspace_update on public.company_branding;
create policy company_branding_workspace_update on public.company_branding for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));
drop policy if exists company_branding_workspace_delete on public.company_branding;
create policy company_branding_workspace_delete on public.company_branding for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('sales')));

notify pgrst,'reload schema';
