-- Transactional, admin-only maintenance merges for Configuration Center.
-- Product and invoice duplicates remain diagnostic-only.

create or replace function public.configuration_merge_supplier(
  p_source_id uuid,
  p_destination_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_source public.suppliers%rowtype;
  v_destination public.suppliers%rowtype;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_invoice_count integer := 0;
  v_history_count integer := 0;
  v_product_count integer := 0;
  v_relation_count integer := 0;
  v_alias_count integer := 0;
  v_relation record;
  v_destination_relation uuid;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede fusionar proveedores.';
  end if;
  if p_source_id is null or p_destination_id is null or p_source_id=p_destination_id then
    raise exception 'El proveedor origen y destino deben ser distintos.';
  end if;

  select * into v_source
  from public.suppliers
  where id=p_source_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Proveedor origen no encontrado en este workspace.'; end if;

  select * into v_destination
  from public.suppliers
  where id=p_destination_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Proveedor destino no encontrado en este workspace.'; end if;

  if nullif(regexp_replace(upper(coalesce(v_source.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null
     and nullif(regexp_replace(upper(coalesce(v_destination.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null
     and regexp_replace(upper(v_source.tax_id),'[^A-Z0-9]','','g')
       <> regexp_replace(upper(v_destination.tax_id),'[^A-Z0-9]','','g') then
    raise exception 'Los proveedores tienen identificaciones fiscales diferentes. Revisa la fusión manualmente.';
  end if;

  if exists(
    select 1
    from public.invoices s
    join public.invoices d
      on d.owner_id=v_owner
     and d.supplier_id=p_destination_id
     and d.invoice_number=s.invoice_number
    where s.owner_id=v_owner
      and s.supplier_id=p_source_id
      and s.invoice_number is not null
      and length(trim(s.invoice_number))>0
  ) then
    raise exception 'La fusión produciría facturas duplicadas con el mismo número. No se ha modificado ningún dato.';
  end if;

  select count(*) into v_invoice_count from public.invoices where owner_id=v_owner and supplier_id=p_source_id;
  select count(*) into v_history_count from public.product_price_history where owner_id=v_owner and supplier_id=p_source_id;
  select count(*) into v_product_count from public.products where owner_id=v_owner and last_supplier_id=p_source_id;
  select count(*) into v_relation_count from public.supplier_products where owner_id=v_owner and supplier_id=p_source_id;
  select count(*) into v_alias_count from public.entity_alias_rules where owner_id=v_owner and entity_type='supplier' and target_entity_id=p_source_id;

  -- Preserve useful source fields only when destination fields are empty.
  update public.suppliers
  set
    tax_id=coalesce(nullif(trim(v_destination.tax_id),''),v_source.tax_id),
    email=coalesce(nullif(trim(v_destination.email),''),v_source.email),
    phone=coalesce(nullif(trim(v_destination.phone),''),v_source.phone),
    address=coalesce(nullif(trim(v_destination.address),''),v_source.address),
    website=coalesce(nullif(trim(v_destination.website),''),v_source.website),
    default_category_id=coalesce(v_destination.default_category_id,v_source.default_category_id),
    notes=case
      when nullif(trim(coalesce(v_destination.notes,'')),'') is null then v_source.notes
      when nullif(trim(coalesce(v_source.notes,'')),'') is null then v_destination.notes
      when position(v_source.notes in v_destination.notes)>0 then v_destination.notes
      else v_destination.notes || E'\n' || v_source.notes
    end
  where id=p_destination_id and owner_id=v_owner;

  -- Resolve supplier-product collisions before changing supplier_id.
  for v_relation in
    select id,supplier_description
    from public.supplier_products
    where owner_id=v_owner and supplier_id=p_source_id
    order by id
  loop
    select id into v_destination_relation
    from public.supplier_products
    where owner_id=v_owner
      and supplier_id=p_destination_id
      and supplier_description=v_relation.supplier_description
    limit 1;

    if v_destination_relation is not null then
      update public.invoice_lines
      set supplier_product_id=v_destination_relation
      where supplier_product_id=v_relation.id;
      delete from public.supplier_products where id=v_relation.id and owner_id=v_owner;
    end if;
    v_destination_relation := null;
  end loop;

  update public.supplier_products
  set supplier_id=p_destination_id
  where owner_id=v_owner and supplier_id=p_source_id;

  update public.invoices
  set supplier_id=p_destination_id
  where owner_id=v_owner and supplier_id=p_source_id;

  update public.product_price_history
  set supplier_id=p_destination_id
  where owner_id=v_owner and supplier_id=p_source_id;

  update public.products
  set last_supplier_id=p_destination_id
  where owner_id=v_owner and last_supplier_id=p_source_id;

  update public.entity_alias_rules
  set target_entity_id=p_destination_id
  where owner_id=v_owner and entity_type='supplier' and target_entity_id=p_source_id;

  delete from public.suppliers where id=p_source_id and owner_id=v_owner;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','merge','suppliers',
    p_destination_id::text,v_destination.name,
    'Fusionó proveedor '||v_source.name||' en '||v_destination.name,
    jsonb_build_object(
      'source_id',p_source_id,'destination_id',p_destination_id,
      'source_name',v_source.name,'destination_name',v_destination.name,
      'affected',jsonb_build_object(
        'invoices',v_invoice_count,'price_history',v_history_count,
        'products',v_product_count,'supplier_products',v_relation_count,
        'aliases',v_alias_count
      )
    )
  );

  return jsonb_build_object(
    'ok',true,'sourceId',p_source_id,'destinationId',p_destination_id,
    'affected',jsonb_build_object(
      'invoices',v_invoice_count,'priceHistory',v_history_count,
      'products',v_product_count,'supplierProducts',v_relation_count,
      'aliases',v_alias_count
    )
  );
end;
$$;

create or replace function public.configuration_merge_client(
  p_source_id uuid,
  p_destination_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_source public.clients%rowtype;
  v_destination public.clients%rowtype;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_invoice_count integer := 0;
  v_alias_count integer := 0;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede fusionar clientes.';
  end if;
  if p_source_id is null or p_destination_id is null or p_source_id=p_destination_id then
    raise exception 'El cliente origen y destino deben ser distintos.';
  end if;

  select * into v_source
  from public.clients
  where id=p_source_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Cliente origen no encontrado en este workspace.'; end if;

  select * into v_destination
  from public.clients
  where id=p_destination_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Cliente destino no encontrado en este workspace.'; end if;

  if nullif(regexp_replace(upper(coalesce(v_source.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null
     and nullif(regexp_replace(upper(coalesce(v_destination.tax_id,'')),'[^A-Z0-9]','','g'),'') is not null
     and regexp_replace(upper(v_source.tax_id),'[^A-Z0-9]','','g')
       <> regexp_replace(upper(v_destination.tax_id),'[^A-Z0-9]','','g') then
    raise exception 'Los clientes tienen identificaciones fiscales diferentes. Revisa la fusión manualmente.';
  end if;

  select count(*) into v_invoice_count from public.sales_invoices where owner_id=v_owner and client_id=p_source_id;
  select count(*) into v_alias_count from public.entity_alias_rules where owner_id=v_owner and entity_type='client' and target_entity_id=p_source_id;

  update public.clients
  set
    tax_id=coalesce(nullif(trim(v_destination.tax_id),''),v_source.tax_id),
    email=coalesce(nullif(trim(v_destination.email),''),v_source.email),
    phone=coalesce(nullif(trim(v_destination.phone),''),v_source.phone),
    address_line1=coalesce(nullif(trim(v_destination.address_line1),''),v_source.address_line1),
    address_line2=coalesce(nullif(trim(v_destination.address_line2),''),v_source.address_line2),
    postal_code=coalesce(nullif(trim(v_destination.postal_code),''),v_source.postal_code),
    city=coalesce(nullif(trim(v_destination.city),''),v_source.city),
    province=coalesce(nullif(trim(v_destination.province),''),v_source.province),
    notes=case
      when nullif(trim(coalesce(v_destination.notes,'')),'') is null then v_source.notes
      when nullif(trim(coalesce(v_source.notes,'')),'') is null then v_destination.notes
      when position(v_source.notes in v_destination.notes)>0 then v_destination.notes
      else v_destination.notes || E'\n' || v_source.notes
    end
  where id=p_destination_id and owner_id=v_owner;

  update public.sales_invoices
  set client_id=p_destination_id
  where owner_id=v_owner and client_id=p_source_id;

  update public.entity_alias_rules
  set target_entity_id=p_destination_id
  where owner_id=v_owner and entity_type='client' and target_entity_id=p_source_id;

  delete from public.clients where id=p_source_id and owner_id=v_owner;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','merge','clients',
    p_destination_id::text,v_destination.name,
    'Fusionó cliente '||v_source.name||' en '||v_destination.name,
    jsonb_build_object(
      'source_id',p_source_id,'destination_id',p_destination_id,
      'source_name',v_source.name,'destination_name',v_destination.name,
      'affected',jsonb_build_object('sales_invoices',v_invoice_count,'aliases',v_alias_count)
    )
  );

  return jsonb_build_object(
    'ok',true,'sourceId',p_source_id,'destinationId',p_destination_id,
    'affected',jsonb_build_object('salesInvoices',v_invoice_count,'aliases',v_alias_count)
  );
end;
$$;

revoke all on function public.configuration_merge_supplier(uuid,uuid) from public,anon;
revoke all on function public.configuration_merge_client(uuid,uuid) from public,anon;
grant execute on function public.configuration_merge_supplier(uuid,uuid) to authenticated;
grant execute on function public.configuration_merge_client(uuid,uuid) to authenticated;

notify pgrst,'reload schema';
