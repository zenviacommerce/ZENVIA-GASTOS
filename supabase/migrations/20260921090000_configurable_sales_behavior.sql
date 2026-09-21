create or replace function private.sales_setting_boolean(
  p_owner uuid,
  p_key text,
  p_default boolean
)
returns boolean
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_raw text;
begin
  select lower(s.config->'sales'->>p_key)
    into v_raw
  from public.app_settings s
  where s.owner_id=p_owner;

  if v_raw='true' then return true; end if;
  if v_raw='false' then return false; end if;
  return p_default;
end;
$$;

revoke all on function private.sales_setting_boolean(uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.sales_setting_boolean(uuid,text,boolean) to authenticated;

create or replace function private.sync_sales_payment_status()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_invoice_id uuid;
  v_owner uuid;
  v_paid numeric;
  v_total numeric;
  v_status text;
  v_allow_partial boolean;
  v_auto_paid boolean;
begin
  v_invoice_id := case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;

  select owner_id,total_amount,status
    into v_owner,v_total,v_status
  from public.sales_invoices
  where id=v_invoice_id;

  if v_status='draft' then
    raise exception 'No se pueden registrar cobros sobre una factura en borrador.';
  end if;

  select coalesce(sum(amount),0)
    into v_paid
  from public.sales_payments
  where invoice_id=v_invoice_id;

  v_allow_partial := private.sales_setting_boolean(v_owner,'allowPartialPayments',true);
  v_auto_paid := private.sales_setting_boolean(v_owner,'autoMarkPaid',true);

  if not v_allow_partial
     and v_paid > 0.005
     and v_total > 0
     and v_paid < v_total - 0.005
  then
    raise exception 'Los cobros parciales están desactivados para este espacio de trabajo.';
  end if;

  update public.sales_invoices
  set status=case
      when v_paid>=v_total-0.005 and v_total>0 and v_auto_paid then 'paid'
      when v_paid>0.005 then 'partially_paid'
      when v_status in ('paid','partially_paid') then 'issued'
      else v_status
    end,
    paid_at=case
      when v_paid>=v_total-0.005 and v_total>0 and v_auto_paid then coalesce(paid_at,now())
      else null
    end
  where id=v_invoice_id;

  return coalesce(new,old);
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
    if not private.sales_setting_boolean(old.owner_id,'allowEditIssuedInvoices',true) then
      raise exception 'La edición de facturas emitidas está desactivada en Configuración.';
    end if;
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

create or replace function public.mark_sales_invoice_paid(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_paid numeric;
begin
  select * into v_invoice
  from public.sales_invoices
  where id=p_invoice_id
  for update;

  if v_invoice.id is null then
    raise exception 'Factura no encontrada.';
  end if;
  if v_invoice.status in ('draft','rectified') then
    raise exception 'Esta factura no se puede marcar como cobrada.';
  end if;

  select coalesce(sum(amount),0)
    into v_paid
  from public.sales_payments
  where invoice_id=p_invoice_id;

  if v_invoice.total_amount<=0 or v_paid < v_invoice.total_amount-0.005 then
    raise exception 'Los cobros registrados no cubren el total de la factura.';
  end if;

  update public.sales_invoices
  set status='paid',paid_at=coalesce(paid_at,now())
  where id=p_invoice_id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

revoke all on function public.mark_sales_invoice_paid(uuid) from public,anon;
grant execute on function public.mark_sales_invoice_paid(uuid) to authenticated;

notify pgrst,'reload schema';
