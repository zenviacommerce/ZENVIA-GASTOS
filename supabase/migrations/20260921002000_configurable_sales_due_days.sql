create or replace function private.sales_default_due_days(p_owner uuid)
returns integer
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_raw text;
  v_days integer := 30;
begin
  select s.config #>> '{sales,defaultDueDays}'
    into v_raw
  from public.app_settings s
  where s.owner_id=p_owner;

  if v_raw is not null and v_raw ~ '^[0-9]{1,3}$' then
    v_days := v_raw::integer;
    if v_days < 0 or v_days > 365 then
      v_days := 30;
    end if;
  end if;

  return v_days;
end;
$$;

revoke all on function private.sales_default_due_days(uuid) from public,anon,authenticated;

create or replace function private.set_default_sales_invoice_due_date()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.issue_date is not null and new.due_date is null then
    new.due_date := new.issue_date + private.sales_default_due_days(new.owner_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sales_invoices_default_due_date on public.sales_invoices;
create trigger sales_invoices_default_due_date
before insert or update of issue_date,due_date
on public.sales_invoices
for each row
execute function private.set_default_sales_invoice_due_date();

create or replace function private.guard_sales_invoice_immutable()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then
      return old;
    end if;
    if old.status = 'issued'
       and old.sent_at is null
       and old.paid_at is null
       and not exists (select 1 from public.sales_payments p where p.invoice_id = old.id)
    then
      return old;
    end if;
    raise exception 'Solo se puede eliminar una factura en borrador o una factura emitida que todavía no se haya enviado ni cobrado.';
  end if;

  if old.status = 'issued' and new.status = 'draft' then
    if old.sent_at is not null
       or old.paid_at is not null
       or exists (select 1 from public.sales_payments p where p.invoice_id = old.id)
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
      raise exception 'Los datos fiscales de una factura cerrada no se pueden modificar directamente.';
    end if;
  end if;
  return new;
end;
$$;

notify pgrst,'reload schema';
