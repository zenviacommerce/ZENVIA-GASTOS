-- Sales receipts / simplified sales documents.
-- Receipts share the existing sales document, line and payment engine so
-- totals, collection status, RLS and workspace isolation stay centralized.

alter table public.sales_invoice_series drop constraint if exists sales_invoice_series_kind_check;
alter table public.sales_invoice_series
  add constraint sales_invoice_series_kind_check check (kind in ('standard','rectifying','receipt'));

alter table public.sales_invoices
  add column if not exists document_kind text not null default 'invoice',
  add column if not exists fiscal_treatment text not null default 'taxable',
  add column if not exists fiscal_reason text;

alter table public.sales_invoices drop constraint if exists sales_invoices_document_kind_check;
alter table public.sales_invoices
  add constraint sales_invoices_document_kind_check check (document_kind in ('invoice','receipt'));

alter table public.sales_invoices drop constraint if exists sales_invoices_fiscal_treatment_check;
alter table public.sales_invoices
  add constraint sales_invoices_fiscal_treatment_check check (fiscal_treatment in ('taxable','exempt','non_taxable','out_of_scope'));

create index if not exists sales_invoices_owner_document_date_idx
  on public.sales_invoices(owner_id,document_kind,issue_date desc);

create or replace function private.sales_invoice_line_calculate()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_gross numeric;
  v_net numeric;
  v_type text;
  v_document_kind text;
  v_fiscal_treatment text;
begin
  select invoice_type,document_kind,fiscal_treatment
    into v_type,v_document_kind,v_fiscal_treatment
  from public.sales_invoices where id=new.invoice_id;

  if v_type is null then raise exception 'Documento de venta no encontrado.'; end if;
  if v_type='standard' and new.unit_price < 0 then
    raise exception 'Un documento de venta ordinario no puede tener precios negativos.';
  end if;
  if v_document_kind='receipt'
     and v_fiscal_treatment in ('exempt','non_taxable','out_of_scope')
     and coalesce(new.tax_rate,0)<>0
  then
    raise exception 'Los recibos exentos o no sujetos deben tener IVA 0 %.';
  end if;

  v_gross := new.quantity * new.unit_price;
  v_net := v_gross * (1 - new.discount_percent / 100);
  new.line_net := round(v_net,2);
  new.tax_amount := round(new.line_net * new.tax_rate / 100,2);
  new.line_total := new.line_net + new.tax_amount;
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
    raise exception 'Solo se puede eliminar un documento en borrador o emitido que todavía no se haya enviado ni cobrado.';
  end if;

  if old.status='issued' and new.status='draft' then
    if not private.sales_setting_boolean(old.owner_id,'allowEditIssuedInvoices',true) then
      raise exception 'La edición de documentos emitidos está desactivada en Configuración.';
    end if;
    if old.sent_at is not null
       or old.paid_at is not null
       or exists(select 1 from public.sales_payments p where p.invoice_id=old.id)
    then
      raise exception 'El documento ya tiene envío o cobros y no se puede reabrir.';
    end if;
    return new;
  end if;

  if old.status <> 'draft' then
    if new.client_id is distinct from old.client_id
      or new.series_id is distinct from old.series_id
      or new.invoice_type is distinct from old.invoice_type
      or new.document_kind is distinct from old.document_kind
      or new.fiscal_treatment is distinct from old.fiscal_treatment
      or new.fiscal_reason is distinct from old.fiscal_reason
      or new.rectifies_invoice_id is distinct from old.rectifies_invoice_id
      or new.invoice_number is distinct from old.invoice_number
      or new.issue_date is distinct from old.issue_date
      or new.operation_date is distinct from old.operation_date
      or (
        new.due_date is distinct from old.due_date
        and not (
          old.due_date is null
          and new.due_date = old.issue_date + private.sales_default_due_days(old.owner_id)
        )
      )
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
      raise exception 'Los datos fiscales de un documento cerrado no se pueden modificar directamente.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.issue_sales_receipt(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_client public.clients%rowtype;
  v_business public.business_settings%rowtype;
  v_tax public.business_tax_registrations%rowtype;
  v_number text;
  v_number_value integer;
  v_released_number integer;
  v_line_count integer;
  v_client_address text;
  v_issuer_address text;
  v_issuer_name text;
  v_issuer_tax_id text;
  v_issuer_tax_country text;
  v_issuer_tax_label text;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Recibo no encontrado.'; end if;
  if v_invoice.document_kind<>'receipt' then raise exception 'El documento no es un recibo.'; end if;
  if v_invoice.status<>'draft' then raise exception 'Solo se puede emitir un recibo en borrador.'; end if;
  if v_invoice.total_amount<=0 then raise exception 'El recibo debe tener un importe total positivo.'; end if;
  if v_invoice.fiscal_treatment<>'taxable' and coalesce(trim(v_invoice.fiscal_reason),'')='' then
    raise exception 'Indica el motivo fiscal de la exención o no sujeción.';
  end if;

  select count(*) into v_line_count from public.sales_invoice_lines where invoice_id=p_invoice_id;
  if v_line_count=0 then raise exception 'El recibo no tiene líneas.'; end if;
  if v_invoice.fiscal_treatment<>'taxable'
     and exists(select 1 from public.sales_invoice_lines where invoice_id=p_invoice_id and coalesce(tax_rate,0)<>0)
  then
    raise exception 'Los recibos exentos o no sujetos deben tener IVA 0 %.';
  end if;

  select * into v_client from public.clients where id=v_invoice.client_id;
  if v_client.id is null then raise exception 'Cliente no encontrado.'; end if;

  select * into v_business from public.business_settings where owner_id=v_invoice.owner_id;
  if v_business.owner_id is null or coalesce(trim(v_business.legal_name),'')='' then
    raise exception 'Completa los datos de empresa antes de emitir el primer recibo.';
  end if;

  if v_invoice.tax_registration_id is not null then
    select * into v_tax from public.business_tax_registrations
    where id=v_invoice.tax_registration_id and owner_id=v_invoice.owner_id;
  else
    select * into v_tax from public.business_tax_registrations
    where owner_id=v_invoice.owner_id and active and is_default limit 1;
  end if;

  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null or not v_series.active or v_series.kind<>'receipt' then
    raise exception 'La serie de recibos no está disponible.';
  end if;
  if v_series.year<>extract(year from v_invoice.issue_date)::integer then
    raise exception 'La serie no corresponde al año del recibo.';
  end if;

  select r.number into v_released_number
  from public.sales_invoice_released_numbers r
  where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id
  order by r.number limit 1 for update;

  if v_released_number is not null then
    v_number_value:=v_released_number;
    delete from public.sales_invoice_released_numbers
    where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_released_number;
  else
    v_number_value:=v_series.next_number;
    update public.sales_invoice_series set next_number=next_number+1,updated_at=now() where id=v_series.id;
  end if;
  v_number:=v_series.prefix||lpad(v_number_value::text,v_series.padding,'0');

  v_client_address:=concat_ws(', ',nullif(v_client.address_line1,''),nullif(v_client.address_line2,''),nullif(concat_ws(' ',nullif(v_client.postal_code,''),nullif(v_client.city,'')),''),nullif(v_client.province,''),nullif(v_client.country_code,''));
  v_issuer_address:=coalesce(nullif(v_tax.address_text,''),concat_ws(', ',nullif(v_business.address_line1,''),nullif(v_business.address_line2,''),nullif(concat_ws(' ',nullif(v_business.postal_code,''),nullif(v_business.city,'')),''),nullif(v_business.province,''),nullif(v_business.country_code,'')));
  v_issuer_name:=coalesce(nullif(v_tax.fiscal_name,''),v_business.legal_name);
  v_issuer_tax_id:=coalesce(nullif(v_tax.vat_number,''),v_business.tax_id);
  v_issuer_tax_country:=coalesce(v_tax.country_code,v_business.country_code);
  v_issuer_tax_label:=v_tax.label;

  update public.sales_invoices
  set invoice_number=v_number,reserved_number=null,status='issued',issued_at=now(),
      tax_registration_id=coalesce(v_tax.id,tax_registration_id),
      client_name=v_client.name,client_tax_id=v_client.tax_id,client_email=v_client.email,client_phone=v_client.phone,client_address=v_client_address,
      issuer_name=v_issuer_name,issuer_tax_id=v_issuer_tax_id,issuer_email=v_business.email,issuer_phone=v_business.phone,issuer_address=v_issuer_address,
      issuer_tax_country_code=v_issuer_tax_country,issuer_tax_registration_label=v_issuer_tax_label
  where id=p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.issue_sales_receipt(uuid) from public,anon;
grant execute on function public.issue_sales_receipt(uuid) to authenticated;

notify pgrst,'reload schema';
