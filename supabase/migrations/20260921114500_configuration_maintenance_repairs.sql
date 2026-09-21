-- Remaining Configuration Center maintenance actions.
-- Every mutating action is admin-only, previewable, audited and workspace-scoped.

create or replace function public.configuration_recalculate_product_costs(
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_method text := 'last_purchase';
  v_decimals integer := 4;
  v_eligible integer := 0;
  v_changed integer := 0;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede recalcular costes.';
  end if;

  select
    coalesce(nullif(config->'products'->>'costMethod',''),'last_purchase'),
    greatest(0,least(8,coalesce((config->'products'->>'costDecimals')::integer,4)))
  into v_method,v_decimals
  from public.app_settings
  where owner_id=v_owner;

  v_method:=coalesce(v_method,'last_purchase');
  v_decimals:=coalesce(v_decimals,4);

  if v_method='manual' then
    return jsonb_build_object(
      'ok',true,'preview',not p_apply,'method',v_method,
      'eligible',0,'changed',0,
      'message','El método de coste configurado es manual; no hay costes automáticos que recalcular.'
    );
  end if;

  with latest as (
    select distinct on (h.product_id)
      h.product_id,h.normalized_unit_price,h.supplier_id,h.price_date,h.base_unit
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    order by h.product_id,h.price_date desc,h.created_at desc
  ),
  averages as (
    select h.product_id,avg(h.normalized_unit_price)::numeric as average_cost
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    group by h.product_id
  ),
  desired as (
    select
      p.id,
      round((case when v_method='average' then a.average_cost else l.normalized_unit_price end)::numeric,v_decimals) as next_cost,
      l.supplier_id,
      l.price_date,
      coalesce(l.base_unit,p.base_unit) as cost_unit
    from public.products p
    join latest l on l.product_id=p.id
    left join averages a on a.product_id=p.id
    where p.owner_id=v_owner and p.active=true
  )
  select
    count(*),
    count(*) filter (where p.last_cost is distinct from d.next_cost)
  into v_eligible,v_changed
  from desired d
  join public.products p on p.id=d.id;

  if not p_apply then
    return jsonb_build_object(
      'ok',true,'preview',true,'method',v_method,
      'eligible',v_eligible,'changed',v_changed,
      'historicalRowsDeleted',0
    );
  end if;

  with latest as (
    select distinct on (h.product_id)
      h.product_id,h.normalized_unit_price,h.supplier_id,h.price_date,h.base_unit
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    order by h.product_id,h.price_date desc,h.created_at desc
  ),
  averages as (
    select h.product_id,avg(h.normalized_unit_price)::numeric as average_cost
    from public.product_price_history h
    join public.products p on p.id=h.product_id and p.owner_id=v_owner and p.active=true
    where h.owner_id=v_owner
    group by h.product_id
  ),
  desired as (
    select
      p.id,
      round((case when v_method='average' then a.average_cost else l.normalized_unit_price end)::numeric,v_decimals) as next_cost,
      l.supplier_id,
      l.price_date,
      coalesce(l.base_unit,p.base_unit) as cost_unit
    from public.products p
    join latest l on l.product_id=p.id
    left join averages a on a.product_id=p.id
    where p.owner_id=v_owner and p.active=true
  )
  update public.products p
  set
    previous_cost=case when p.last_cost is distinct from d.next_cost then p.last_cost else p.previous_cost end,
    last_cost=d.next_cost,
    cost_unit=d.cost_unit,
    last_supplier_id=d.supplier_id,
    last_purchase_date=d.price_date,
    updated_at=now()
  from desired d
  where p.id=d.id
    and p.owner_id=v_owner
    and p.last_cost is distinct from d.next_cost;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','recalculate','products',
    null,null,
    'Recalculó los costes actuales de productos',
    jsonb_build_object(
      'method',v_method,'eligible',v_eligible,'changed',v_changed,
      'historical_rows_deleted',0
    )
  );

  return jsonb_build_object(
    'ok',true,'preview',false,'method',v_method,
    'eligible',v_eligible,'changed',v_changed,
    'historicalRowsDeleted',0
  );
end;
$$;

create or replace function public.configuration_rebuild_supplier_product_links(
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_missing_relations integer := 0;
  v_lines_to_link integer := 0;
  v_conflicts integer := 0;
  v_inserted integer := 0;
  v_linked integer := 0;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede reconstruir relaciones producto-proveedor.';
  end if;

  with source_rows as (
    select l.*,i.supplier_id
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    where l.owner_id=v_owner
      and l.product_id is not null
      and i.supplier_id is not null
      and length(trim(l.description))>0
  )
  select
    count(distinct (s.supplier_id::text||'|'||s.description)) filter (where sp.id is null),
    count(*) filter (where sp.id is not null and sp.product_id=s.product_id and s.supplier_product_id is distinct from sp.id),
    count(*) filter (where sp.id is not null and sp.product_id is distinct from s.product_id)
  into v_missing_relations,v_lines_to_link,v_conflicts
  from source_rows s
  left join public.supplier_products sp
    on sp.owner_id=v_owner
   and sp.supplier_id=s.supplier_id
   and sp.supplier_description=s.description;

  if not p_apply then
    return jsonb_build_object(
      'ok',true,'preview',true,
      'missingRelations',v_missing_relations,
      'linesToLink',v_lines_to_link,
      'conflicts',v_conflicts
    );
  end if;

  with candidates as (
    select distinct on (i.supplier_id,l.description)
      i.supplier_id,l.product_id,l.supplier_sku,l.description,l.unit,l.units_per_purchase,l.created_at
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    left join public.supplier_products sp
      on sp.owner_id=v_owner
     and sp.supplier_id=i.supplier_id
     and sp.supplier_description=l.description
    where l.owner_id=v_owner
      and l.product_id is not null
      and i.supplier_id is not null
      and length(trim(l.description))>0
      and sp.id is null
    order by i.supplier_id,l.description,l.created_at desc
  ),
  inserted as (
    insert into public.supplier_products(
      owner_id,supplier_id,product_id,supplier_sku,supplier_description,purchase_unit,units_per_purchase
    )
    select
      v_owner,supplier_id,product_id,nullif(trim(supplier_sku),''),
      description,nullif(trim(unit),''),coalesce(nullif(units_per_purchase,0),1)
    from candidates
    on conflict(owner_id,supplier_id,supplier_description) do nothing
    returning id
  )
  select count(*) into v_inserted from inserted;

  with matched as (
    select l.id,sp.id as supplier_product_id
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    join public.supplier_products sp
      on sp.owner_id=v_owner
     and sp.supplier_id=i.supplier_id
     and sp.supplier_description=l.description
     and sp.product_id=l.product_id
    where l.owner_id=v_owner
      and l.product_id is not null
      and l.supplier_product_id is distinct from sp.id
  ),
  updated as (
    update public.invoice_lines l
    set supplier_product_id=m.supplier_product_id,updated_at=now()
    from matched m
    where l.id=m.id
    returning l.id
  )
  select count(*) into v_linked from updated;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','rebuild','supplier_products',
    null,null,
    'Reconstruyó relaciones producto-proveedor desde líneas de factura',
    jsonb_build_object(
      'inserted_relations',v_inserted,'linked_lines',v_linked,'conflicts_skipped',v_conflicts
    )
  );

  return jsonb_build_object(
    'ok',true,'preview',false,
    'insertedRelations',v_inserted,'linkedLines',v_linked,'conflicts',v_conflicts
  );
end;
$$;

create or replace function public.configuration_rebuild_price_history_links(
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_missing integer := 0;
  v_mismatched integer := 0;
  v_written integer := 0;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede reconstruir el histórico de precios.';
  end if;

  with candidates as (
    select
      l.id as invoice_line_id,l.product_id,i.supplier_id,i.id as invoice_id,
      coalesce(i.issue_date,i.received_date) as price_date,
      l.unit_price,l.normalized_unit_price,
      coalesce(p.base_unit,l.unit,'ud') as base_unit,
      coalesce(i.currency,'EUR') as currency
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    join public.products p on p.id=l.product_id and p.owner_id=v_owner
    where l.owner_id=v_owner
      and l.product_id is not null
      and l.normalized_unit_price is not null
  )
  select
    count(*) filter (where h.id is null),
    count(*) filter (
      where h.id is not null and (
        h.product_id is distinct from c.product_id
        or h.supplier_id is distinct from c.supplier_id
        or h.invoice_id is distinct from c.invoice_id
        or h.price_date is distinct from c.price_date
        or h.normalized_unit_price is distinct from c.normalized_unit_price
        or h.base_unit is distinct from c.base_unit
        or h.currency is distinct from c.currency
      )
    )
  into v_missing,v_mismatched
  from candidates c
  left join public.product_price_history h
    on h.owner_id=v_owner and h.invoice_line_id=c.invoice_line_id;

  if not p_apply then
    return jsonb_build_object(
      'ok',true,'preview',true,
      'missing',v_missing,'mismatched',v_mismatched,
      'historicalRowsDeleted',0
    );
  end if;

  with candidates as (
    select
      l.id as invoice_line_id,l.product_id,i.supplier_id,i.id as invoice_id,
      coalesce(i.issue_date,i.received_date) as price_date,
      l.unit_price,l.normalized_unit_price,
      coalesce(p.base_unit,l.unit,'ud') as base_unit,
      coalesce(i.currency,'EUR') as currency
    from public.invoice_lines l
    join public.invoices i on i.id=l.invoice_id and i.owner_id=v_owner
    join public.products p on p.id=l.product_id and p.owner_id=v_owner
    where l.owner_id=v_owner
      and l.product_id is not null
      and l.normalized_unit_price is not null
  ),
  written as (
    insert into public.product_price_history(
      owner_id,product_id,supplier_id,invoice_id,invoice_line_id,price_date,
      purchase_unit_price,normalized_unit_price,base_unit,currency
    )
    select
      v_owner,product_id,supplier_id,invoice_id,invoice_line_id,price_date,
      unit_price,normalized_unit_price,base_unit,currency
    from candidates
    on conflict(invoice_line_id) do update set
      product_id=excluded.product_id,
      supplier_id=excluded.supplier_id,
      invoice_id=excluded.invoice_id,
      price_date=excluded.price_date,
      purchase_unit_price=excluded.purchase_unit_price,
      normalized_unit_price=excluded.normalized_unit_price,
      base_unit=excluded.base_unit,
      currency=excluded.currency
    returning id
  )
  select count(*) into v_written from written;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','rebuild','product_price_history',
    null,null,
    'Reconstruyó enlaces del histórico de precios desde líneas de factura',
    jsonb_build_object(
      'rows_written',v_written,'missing_before',v_missing,
      'mismatched_before',v_mismatched,'historical_rows_deleted',0
    )
  );

  return jsonb_build_object(
    'ok',true,'preview',false,
    'rowsWritten',v_written,'missingBefore',v_missing,'mismatchedBefore',v_mismatched,
    'historicalRowsDeleted',0
  );
end;
$$;

create or replace function public.configuration_apply_invoice_reprocess(
  p_invoice_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_invoice public.invoices%rowtype;
  v_category uuid;
  v_supplier uuid;
  v_issue_date date;
  v_supplier_tax text;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede reprocesar facturas.';
  end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then
    raise exception 'Payload de reprocesado no válido.';
  end if;

  select * into v_invoice
  from public.invoices
  where id=p_invoice_id and owner_id=v_owner
  for update;
  if not found then raise exception 'Factura no encontrada en este workspace.'; end if;
  if v_invoice.file_path is null then raise exception 'La factura no conserva archivo para reprocesar.'; end if;

  begin
    v_issue_date:=nullif(p_payload->>'invoiceDate','')::date;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'Fecha de factura no válida en el reprocesado.';
  end;

  if nullif(p_payload->>'categoryId','') is not null then
    begin
      v_category:=(p_payload->>'categoryId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Categoría no válida en el reprocesado.';
    end;
    if not exists(
      select 1 from public.expense_categories
      where id=v_category and owner_id=v_owner and active=true
    ) then
      raise exception 'La categoría reprocesada no pertenece al workspace.';
    end if;
  else
    v_category:=v_invoice.expense_category_id;
  end if;

  v_supplier_tax:=regexp_replace(upper(coalesce(p_payload->>'supplierTaxId','')),'[^A-Z0-9]','','g');
  if length(v_supplier_tax)>0 then
    select id into v_supplier
    from public.suppliers
    where owner_id=v_owner
      and active=true
      and regexp_replace(upper(coalesce(tax_id,'')),'[^A-Z0-9]','','g')=v_supplier_tax
    order by id
    limit 1;
  end if;

  update public.invoices
  set
    supplier_id=coalesce(v_supplier,v_invoice.supplier_id),
    invoice_number=coalesce(nullif(trim(p_payload->>'invoiceNumber'),''),v_invoice.invoice_number),
    issue_date=coalesce(v_issue_date,v_invoice.issue_date),
    expense_category_id=coalesce(v_category,v_invoice.expense_category_id),
    net_amount=coalesce((p_payload->>'subtotal')::numeric,v_invoice.net_amount),
    tax_amount=coalesce((p_payload->>'vat')::numeric,v_invoice.tax_amount),
    equivalence_surcharge_amount=coalesce((p_payload->>'equivalenceSurcharge')::numeric,v_invoice.equivalence_surcharge_amount),
    withholding_amount=coalesce((p_payload->>'withholding')::numeric,v_invoice.withholding_amount),
    total_amount=coalesce((p_payload->>'total')::numeric,v_invoice.total_amount),
    ocr_text=coalesce(p_payload->>'text',v_invoice.ocr_text),
    extraction=coalesce(v_invoice.extraction,'{}'::jsonb)
      || jsonb_build_object(
        'maintenanceReprocess',
        jsonb_build_object(
          'at',now(),
          'supplierName',p_payload->>'supplierName',
          'supplierTaxId',nullif(p_payload->>'supplierTaxId',''),
          'recipientTaxId',nullif(p_payload->>'recipientTaxId',''),
          'recipientName',nullif(p_payload->>'recipientName',''),
          'usedOcr',coalesce((p_payload->>'usedOcr')::boolean,false),
          'lineCount',coalesce(jsonb_array_length(coalesce(p_payload->'lines','[]'::jsonb)),0)
        )
      ),
    extraction_confidence=coalesce((p_payload->>'confidence')::numeric,v_invoice.extraction_confidence),
    updated_at=now()
  where id=p_invoice_id and owner_id=v_owner;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','reprocess','invoices',
    p_invoice_id::text,coalesce(p_payload->>'invoiceNumber',v_invoice.invoice_number),
    'Reprocesó una factura de gasto con el parser y política actuales',
    jsonb_build_object(
      'invoice_id',p_invoice_id,
      'supplier_relinked_by_exact_tax_id',v_supplier is not null,
      'lines_preserved',true,
      'historical_rows_deleted',0
    )
  );

  return jsonb_build_object(
    'ok',true,'invoiceId',p_invoice_id,
    'supplierRelinked',v_supplier is not null,
    'linesPreserved',true,'historicalRowsDeleted',0
  );
end;
$$;

create or replace function public.configuration_reset_app_settings(
  p_schema_version integer,
  p_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid := private.app_workspace_owner_id();
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_before jsonb := '{}'::jsonb;
  v_changed text[] := array[]::text[];
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede restaurar la configuración global.';
  end if;
  if jsonb_typeof(coalesce(p_config,'{}'::jsonb))<>'object' then
    raise exception 'Configuración predeterminada no válida.';
  end if;

  select coalesce(config,'{}'::jsonb) into v_before
  from public.app_settings
  where owner_id=v_owner;

  select coalesce(array_agg(key order by key),array[]::text[])
  into v_changed
  from (
    select key from jsonb_object_keys(coalesce(v_before,'{}'::jsonb)) key
    union
    select key from jsonb_object_keys(p_config) key
  ) keys
  where coalesce(v_before->key,'null'::jsonb) is distinct from coalesce(p_config->key,'null'::jsonb);

  insert into public.app_settings(owner_id,schema_version,config,updated_at)
  values(v_owner,p_schema_version,p_config,now())
  on conflict(owner_id) do update set
    schema_version=excluded.schema_version,
    config=excluded.config,
    updated_at=excluded.updated_at;

  select email into v_actor_email from public.app_users where user_id=v_actor limit 1;
  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_actor_email,'settings','reset','app_settings',
    v_owner::text,'Configuración global',
    'Restauró la configuración global a valores predeterminados',
    jsonb_build_object('changed_sections',to_jsonb(v_changed),'schema_version',p_schema_version)
  );

  return jsonb_build_object('ok',true,'changedSections',to_jsonb(v_changed));
end;
$$;

revoke all on function public.configuration_recalculate_product_costs(boolean) from public,anon;
revoke all on function public.configuration_rebuild_supplier_product_links(boolean) from public,anon;
revoke all on function public.configuration_rebuild_price_history_links(boolean) from public,anon;
revoke all on function public.configuration_apply_invoice_reprocess(uuid,jsonb) from public,anon;
revoke all on function public.configuration_reset_app_settings(integer,jsonb) from public,anon;

grant execute on function public.configuration_recalculate_product_costs(boolean) to authenticated;
grant execute on function public.configuration_rebuild_supplier_product_links(boolean) to authenticated;
grant execute on function public.configuration_rebuild_price_history_links(boolean) to authenticated;
grant execute on function public.configuration_apply_invoice_reprocess(uuid,jsonb) to authenticated;
grant execute on function public.configuration_reset_app_settings(integer,jsonb) to authenticated;

notify pgrst,'reload schema';
