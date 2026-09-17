create or replace function public.update_sales_invoice_number(p_invoice_id uuid,p_invoice_number text)
returns public.sales_invoices
language plpgsql
set search_path=''
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_series public.sales_invoice_series%rowtype;
  v_new text:=trim(coalesce(p_invoice_number,''));
  v_old text;
  v_suffix text;
  v_old_suffix text;
  v_value integer;
  v_old_value integer;
begin
  if auth.uid() is null then raise exception 'Sesión no válida.'; end if;
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if v_invoice.id is null then raise exception 'Factura no encontrada.'; end if;
  if v_invoice.owner_id <> private.app_workspace_owner_id() or not private.app_has_permission('sales') then raise exception 'Sin permiso para modificar la factura.'; end if;
  if v_new='' then raise exception 'Indica un número de factura.'; end if;
  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update;
  if v_series.id is null then raise exception 'Serie no encontrada.'; end if;
  if left(v_new,length(v_series.prefix))<>v_series.prefix then raise exception 'El número debe comenzar por el prefijo de la serie: %',v_series.prefix; end if;
  v_suffix:=substring(v_new from length(v_series.prefix)+1);
  if v_suffix !~ '^[0-9]+$' then raise exception 'El número debe terminar en una parte numérica.'; end if;
  v_value:=v_suffix::integer;
  if v_value<1 then raise exception 'El número debe ser mayor que cero.'; end if;
  if exists(select 1 from public.sales_invoices where owner_id=v_invoice.owner_id and invoice_number=v_new and id<>v_invoice.id) then raise exception 'Ya existe una factura con el número %.',v_new; end if;
  v_old:=v_invoice.invoice_number;
  if v_old is not distinct from v_new then return v_invoice; end if;
  update public.sales_invoices set invoice_number=v_new,updated_at=now() where id=v_invoice.id returning * into v_invoice;
  delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_value;
  if v_value>=v_series.next_number then update public.sales_invoice_series set next_number=v_value+1,updated_at=now() where id=v_series.id; end if;
  if v_old is not null and left(v_old,length(v_series.prefix))=v_series.prefix then
    v_old_suffix:=substring(v_old from length(v_series.prefix)+1);
    if v_old_suffix ~ '^[0-9]+$' then
      v_old_value:=v_old_suffix::integer;
      if not exists(select 1 from public.sales_invoices where owner_id=v_invoice.owner_id and invoice_number=v_old) then
        insert into public.sales_invoice_released_numbers(owner_id,series_id,number) values(v_invoice.owner_id,v_series.id,v_old_value) on conflict do nothing;
      end if;
    end if;
  end if;
  return v_invoice;
end;
$$;
revoke all on function public.update_sales_invoice_number(uuid,text) from public,anon;
grant execute on function public.update_sales_invoice_number(uuid,text) to authenticated;

create or replace function private.audit_sales_invoice_number_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_mail text;
begin
  if old.invoice_number is not distinct from new.invoice_number then return new; end if;
  select email into v_mail from public.app_users where user_id=auth.uid() limit 1;
  insert into public.audit_logs(workspace_owner_id,actor_user_id,actor_email,module,action,entity_type,entity_id,entity_label,summary,details)
  values(new.owner_id,auth.uid(),v_mail,'sales','invoice_number_change','sales_invoices',new.id::text,new.invoice_number,'Cambió el número de factura de '||coalesce(old.invoice_number,'Sin número')||' a '||coalesce(new.invoice_number,'Sin número'),jsonb_build_object('previous_invoice_number',old.invoice_number,'new_invoice_number',new.invoice_number,'status',new.status));
  return new;
end;
$$;
revoke all on function private.audit_sales_invoice_number_change() from public,anon,authenticated;
drop trigger if exists audit_sales_invoice_number_change on public.sales_invoices;
create trigger audit_sales_invoice_number_change after update of invoice_number on public.sales_invoices for each row execute function private.audit_sales_invoice_number_change();

create or replace function public.issue_sales_invoice(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
set search_path=''
as $$
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
  select count(*) into v_line_count from public.sales_invoice_lines where invoice_id=p_invoice_id; if v_line_count=0 then raise exception 'La factura no tiene líneas.'; end if;
  select * into v_client from public.clients where id=v_invoice.client_id; if v_client.id is null then raise exception 'Cliente no encontrado.'; end if; if coalesce(trim(v_client.tax_id),'')='' then raise exception 'Completa el NIF/CIF del cliente antes de emitir.'; end if;
  select * into v_business from public.business_settings where owner_id=v_invoice.owner_id; if v_business.owner_id is null or coalesce(trim(v_business.legal_name),'')='' or coalesce(trim(v_business.address_line1),'')='' or coalesce(trim(v_business.postal_code),'')='' or coalesce(trim(v_business.city),'')='' then raise exception 'Completa los datos fiscales de ZENVIA antes de emitir la primera factura.'; end if;
  if v_invoice.tax_registration_id is not null then select * into v_tax from public.business_tax_registrations where id=v_invoice.tax_registration_id and owner_id=v_invoice.owner_id; if v_tax.id is null or not v_tax.active then raise exception 'El registro IVA seleccionado no está disponible.'; end if; else select * into v_tax from public.business_tax_registrations where owner_id=v_invoice.owner_id and active and is_default limit 1; end if;
  if v_tax.id is null and coalesce(trim(v_business.tax_id),'')='' then raise exception 'Añade al menos un registro IVA antes de emitir.'; end if;
  select * into v_series from public.sales_invoice_series where id=v_invoice.series_id for update; if v_series.id is null or not v_series.active then raise exception 'La serie de facturación no está disponible.'; end if;
  if v_series.year<>extract(year from v_invoice.issue_date)::integer then raise exception 'La serie no corresponde al año de la factura.'; end if;
  if (v_invoice.invoice_type='standard' and v_series.kind<>'standard') or (v_invoice.invoice_type='rectifying' and v_series.kind<>'rectifying') then raise exception 'La serie no corresponde al tipo de factura.'; end if;
  if coalesce(trim(v_invoice.invoice_number),'')<>'' then
    v_number:=trim(v_invoice.invoice_number); if left(v_number,length(v_series.prefix))<>v_series.prefix then raise exception 'El número manual no corresponde a la serie.'; end if;
    v_suffix:=substring(v_number from length(v_series.prefix)+1); if v_suffix !~ '^[0-9]+$' then raise exception 'El número manual no es válido.'; end if; v_number_value:=v_suffix::integer;
    delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_number_value;
    if v_number_value>=v_series.next_number then update public.sales_invoice_series set next_number=v_number_value+1,updated_at=now() where id=v_series.id; end if;
  elsif v_invoice.reserved_number is not null and exists(select 1 from public.sales_invoice_released_numbers r where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id and r.number=v_invoice.reserved_number) then
    v_number_value:=v_invoice.reserved_number; delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_number_value; v_number:=v_series.prefix||lpad(v_number_value::text,v_series.padding,'0');
  else
    select r.number into v_released_number from public.sales_invoice_released_numbers r where r.owner_id=v_invoice.owner_id and r.series_id=v_series.id order by r.number limit 1 for update;
    if v_released_number is not null then v_number_value:=v_released_number; delete from public.sales_invoice_released_numbers where owner_id=v_invoice.owner_id and series_id=v_series.id and number=v_released_number; else v_number_value:=v_series.next_number; update public.sales_invoice_series set next_number=next_number+1,updated_at=now() where id=v_series.id; end if;
    v_number:=v_series.prefix||lpad(v_number_value::text,v_series.padding,'0');
  end if;
  v_client_address:=concat_ws(', ',nullif(v_client.address_line1,''),nullif(v_client.address_line2,''),nullif(concat_ws(' ',nullif(v_client.postal_code,''),nullif(v_client.city,'')),''),nullif(v_client.province,''),nullif(v_client.country_code,''));
  v_issuer_address:=coalesce(nullif(v_tax.address_text,''),concat_ws(', ',nullif(v_business.address_line1,''),nullif(v_business.address_line2,''),nullif(concat_ws(' ',nullif(v_business.postal_code,''),nullif(v_business.city,'')),''),nullif(v_business.province,''),nullif(v_business.country_code,'')));
  v_issuer_name:=coalesce(nullif(v_tax.fiscal_name,''),v_business.legal_name); v_issuer_tax_id:=coalesce(nullif(v_tax.vat_number,''),v_business.tax_id); v_issuer_tax_country:=coalesce(v_tax.country_code,v_business.country_code); v_issuer_tax_label:=v_tax.label;
  update public.sales_invoices set invoice_number=v_number,reserved_number=null,status='issued',issued_at=now(),tax_registration_id=coalesce(v_tax.id,tax_registration_id),client_name=v_client.name,client_tax_id=v_client.tax_id,client_email=v_client.email,client_phone=v_client.phone,client_address=v_client_address,issuer_name=v_issuer_name,issuer_tax_id=v_issuer_tax_id,issuer_email=v_business.email,issuer_phone=v_business.phone,issuer_address=v_issuer_address,issuer_tax_country_code=v_issuer_tax_country,issuer_tax_registration_label=v_issuer_tax_label where id=p_invoice_id returning * into v_invoice;
  if v_invoice.invoice_type='rectifying' then update public.sales_invoices set status='rectified' where id=v_invoice.rectifies_invoice_id and status<>'draft'; end if;
  return v_invoice;
end;
$$;
