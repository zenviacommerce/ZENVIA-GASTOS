-- Allow issuing imported/historical invoices when the recipient NIF/CIF is not available.
-- The UI surfaces this as a warning before issuing instead of blocking the operation.
create or replace function public.issue_sales_invoice(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
set search_path to ''
as $function$
declare
  v_invoice public.sales_invoices%rowtype; v_series public.sales_invoice_series%rowtype; v_client public.clients%rowtype; v_business public.business_settings%rowtype; v_tax public.business_tax_registrations%rowtype;
  v_number text; v_number_value integer; v_released_number integer; v_line_count integer; v_client_address text; v_issuer_address text; v_issuer_name text; v_issuer_tax_id text; v_issuer_tax_country text; v_issuer_tax_label text; v_suffix text;
begin
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;
  if v_invoice.status <> 'draft' then raise exception 'Solo se puede emitir una factura en borrador.'; end if;
  if v_invoice.invoice_type='standard' and v_invoice.total_amount <= 0 then raise exception 'La factura debe tener un importe total positivo.'; end if;
  if v_invoice.invoice_type='rectifying' and v_invoice.total_amount = 0 then raise exception 'La rectificativa debe tener un importe distinto de cero.'; end if;
  if v_invoice.invoice_type='rectifying' and v_invoice.rectifies_invoice_id is null then raise exception 'La rectificativa debe indicar la factura original.'; end if;
  select count(*) into v_line_count from public.sales_invoice_lines where invoice_id=p_invoice_id;
  if v_line_count=0 then raise exception 'La factura no tiene líneas.'; end if;
  select * into v_client from public.clients where id=v_invoice.client_id;
  if v_client.id is null then raise exception 'Cliente no encontrado.'; end if;

  select * into v_business from public.business_settings where owner_id=v_invoice.owner_id;
  if v_business.owner_id is null or coalesce(trim(v_business.legal_name),'')='' or coalesce(trim(v_business.address_line1),'')='' or coalesce(trim(v_business.postal_code),'')='' or coalesce(trim(v_business.city),'')='' then
    raise exception 'Completa los datos fiscales de ZENVIA antes de emitir la primera factura.';
  end if;

  if v_invoice.tax_registration_id is not null then
    select * into v_tax from public.business_tax_registrations where id=v_invoice.tax_registration_id and owner_id=v_invoice.owner_id;
    if v_tax.id is null or not v_tax.active then raise exception 'El registro IVA seleccionado no está disponible.'; end if;
  else
    select * into v_tax from public.business_tax_registrations where owner_id=v_invoice.owner_id and active and is_default limit 1;
  end if;
  if v_tax.id is null and coalesce(trim(v_business.tax_id),'')='' then raise exception 'Añade al menos un registro IVA antes de emitir.'; end if;

  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null or not v_series.active then raise exception 'La serie de facturación no está disponible.'; end if;
  if v_series.year<>extract(year from v_invoice.issue_date)::integer then raise exception 'La serie no corresponde al año de la factura.'; end if;
  if (v_invoice.invoice_type='standard' and v_series.kind<>'standard') or (v_invoice.invoice_type='rectifying' and v_series.kind<>'rectifying') then raise exception 'La serie no corresponde al tipo de factura.'; end if;

  if coalesce(trim(v_invoice.invoice_number),'')<>'' then
    v_number:=trim(v_invoice.invoice_number);
    if left(v_number,length(v_series.prefix))<>v_series.prefix then raise exception 'El número manual no corresponde a la serie.'; end if;
    v_suffix:=substring(v_number from length(v_series.prefix)+1);
    if v_suffix !~ '^[0-9]+$' then raise exception 'El número manual no es válido.'; end if;
    v_number_value:=v_suffix::integer;
    delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_number_value;
    if v_number_value>=v_series.next_number then update public.sales_invoice_series set next_number=v_number_value+1,updated_at=now() where id=v_series.id; end if;
  elsif v_invoice.reserved_number is not null and exists(select 1 from public.sales_invoice_released_numbers r where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id and r.number=v_invoice.reserved_number) then
    v_number_value:=v_invoice.reserved_number;
    delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_number_value;
    v_number:=v_series.prefix||lpad(v_number_value::text,v_series.padding,'0');
  else
    select r.number into v_released_number from public.sales_invoice_released_numbers r where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id order by r.number limit 1 for update;
    if v_released_number is not null then
      v_number_value:=v_released_number;
      delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_released_number;
    else
      v_number_value:=v_series.next_number;
      update public.sales_invoice_series set next_number=next_number+1,updated_at=now() where id=v_series.id;
    end if;
    v_number:=v_series.prefix||lpad(v_number_value::text,v_series.padding,'0');
  end if;

  v_client_address:=concat_ws(', ',nullif(v_client.address_line1,''),nullif(v_client.address_line2,''),nullif(concat_ws(' ',nullif(v_client.postal_code,''),nullif(v_client.city,'')),''),nullif(v_client.province,''),nullif(v_client.country_code,''));
  v_issuer_address:=coalesce(nullif(v_tax.address_text,''),concat_ws(', ',nullif(v_business.address_line1,''),nullif(v_business.address_line2,''),nullif(concat_ws(' ',nullif(v_business.postal_code,''),nullif(v_business.city,'')),''),nullif(v_business.province,''),nullif(v_business.country_code,'')));
  v_issuer_name:=coalesce(nullif(v_tax.fiscal_name,''),v_business.legal_name);
  v_issuer_tax_id:=coalesce(nullif(v_tax.vat_number,''),v_business.tax_id);
  v_issuer_tax_country:=coalesce(v_tax.country_code,v_business.country_code);
  v_issuer_tax_label:=v_tax.label;

  update public.sales_invoices
     set invoice_number=v_number,reserved_number=null,status='issued',issued_at=now(),tax_registration_id=coalesce(v_tax.id,tax_registration_id),
         client_name=v_client.name,client_tax_id=v_client.tax_id,client_email=v_client.email,client_phone=v_client.phone,client_address=v_client_address,
         issuer_name=v_issuer_name,issuer_tax_id=v_issuer_tax_id,issuer_email=v_business.email,issuer_phone=v_business.phone,issuer_address=v_issuer_address,
         issuer_tax_country_code=v_issuer_tax_country,issuer_tax_registration_label=v_issuer_tax_label
   where id=p_invoice_id
   returning * into v_invoice;

  if v_invoice.invoice_type='rectifying' then
    update public.sales_invoices set status='rectified' where id=v_invoice.rectifies_invoice_id and status<>'draft';
  end if;
  return v_invoice;
end;
$function$;
