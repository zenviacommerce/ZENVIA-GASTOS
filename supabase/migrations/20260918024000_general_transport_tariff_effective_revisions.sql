-- General effective-dated revisions inside one visible active transport tariff.
-- Any field can change from a chosen date without creating another tariff document.

drop function if exists public.transport_tariff_replace_fuel_periods(uuid,jsonb);
drop table if exists public.transport_tariff_fuel_periods cascade;

create table if not exists public.transport_tariff_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  document_id uuid not null,
  effective_from date not null,
  snapshot jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_tariff_revisions_document_fk foreign key (document_id,owner_id)
    references public.transport_tariff_documents(id,owner_id) on delete cascade,
  unique(owner_id,document_id,effective_from)
);

create index if not exists transport_tariff_revisions_lookup_idx
  on public.transport_tariff_revisions(owner_id,document_id,effective_from desc);

alter table public.transport_tariff_revisions enable row level security;

drop policy if exists transport_tariff_revisions_select on public.transport_tariff_revisions;
create policy transport_tariff_revisions_select on public.transport_tariff_revisions for select to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')));

grant select on public.transport_tariff_revisions to authenticated;

create or replace function private.transport_tariff_snapshot(p_owner uuid,p_document uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'carrierCode',d.carrier_code,
    'carrierName',d.carrier_name,
    'effectiveFrom',d.effective_from,
    'effectiveTo',d.effective_to,
    'currencyCode',d.currency_code,
    'pricesIncludeVat',d.prices_include_vat,
    'vatRatePct',coalesce(d.vat_rate_pct,21),
    'fuelSurchargePct',d.fuel_surcharge_pct,
    'fuelSurchargeIncluded',d.fuel_surcharge_included,
    'services',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'serviceName',s.service_name,
          'canonicalServiceKey',s.canonical_service_key,
          'externalProvider',s.external_provider,
          'externalServiceCode',s.external_service_code,
          'mappingStatus',s.mapping_status,
          'sortOrder',s.sort_order,
          'bands',coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'countryCode',b.country_code,
                'zoneCode',b.zone_code,
                'zoneName',b.zone_name,
                'minWeightKg',b.min_weight_kg,
                'maxWeightKg',b.max_weight_kg,
                'basePrice',b.base_price,
                'extraKgPrice',b.extra_kg_price,
                'notes',b.notes,
                'sortOrder',b.sort_order
              )
              order by b.sort_order,b.id
            )
            from public.transport_tariff_bands b
            where b.owner_id=s.owner_id and b.service_id=s.id
          ),'[]'::jsonb)
        )
        order by s.sort_order,s.id
      )
      from public.transport_tariff_services s
      where s.owner_id=d.owner_id and s.document_id=d.id
    ),'[]'::jsonb)
  )
  from public.transport_tariff_documents d
  where d.owner_id=p_owner and d.id=p_document;
$$;

create or replace function private.transport_tariff_config_for_date(p_owner uuid,p_document uuid,p_date date)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    (select r.snapshot from public.transport_tariff_revisions r
      where r.owner_id=p_owner and r.document_id=p_document and r.effective_from<=p_date
      order by r.effective_from desc,r.created_at desc limit 1),
    private.transport_tariff_snapshot(p_owner,p_document)
  );
$$;

create or replace function private.transport_tariff_estimate_for_date(
  p_owner uuid,p_document uuid,p_date date,p_country text,p_postal text,p_weight numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_config jsonb; v_band jsonb; v_base numeric; v_extra numeric; v_min numeric; v_max numeric;
  v_fuel numeric; v_vat numeric; v_net numeric; v_total numeric;
  v_include_vat boolean; v_fuel_included boolean;
begin
  if p_weight is null or p_weight<=0 then return null; end if;
  if upper(coalesce(p_country,'')) not in ('ES','PT') then return null; end if;
  if upper(coalesce(p_country,''))='ES' and regexp_replace(coalesce(p_postal,''),'\s+','','g') ~ '^07[0-9]{3}$' then return null; end if;
  v_config:=private.transport_tariff_config_for_date(p_owner,p_document,p_date);
  if v_config is null then return null; end if;

  select b.value into v_band
  from jsonb_array_elements(coalesce(v_config->'services','[]'::jsonb)) s(value)
  cross join lateral jsonb_array_elements(coalesce(s.value->'bands','[]'::jsonb)) b(value)
  where (s.value->>'canonicalServiceKey'='manana-19h' or coalesce(s.value->>'serviceName','') ~* '19[[:space:]]*h')
    and upper(coalesce(b.value->>'countryCode',''))=upper(p_country)
    and coalesce(b.value->>'zoneCode','')='peninsular'
    and p_weight>coalesce(nullif(b.value->>'minWeightKg','')::numeric,0)
    and (nullif(b.value->>'maxWeightKg','') is null or p_weight<=nullif(b.value->>'maxWeightKg','')::numeric)
  order by coalesce(nullif(b.value->>'minWeightKg','')::numeric,0) desc
  limit 1;

  if v_band is null then return null; end if;
  v_base:=nullif(v_band->>'basePrice','')::numeric;
  v_extra:=nullif(v_band->>'extraKgPrice','')::numeric;
  v_min:=coalesce(nullif(v_band->>'minWeightKg','')::numeric,0);
  v_max:=nullif(v_band->>'maxWeightKg','')::numeric;
  if v_base is null then return null; end if;
  if v_max is null and v_extra is not null and p_weight>v_min then v_base:=v_base+ceil(p_weight-v_min)*v_extra; end if;

  v_include_vat:=coalesce(nullif(v_config->>'pricesIncludeVat','')::boolean,false);
  v_fuel_included:=coalesce(nullif(v_config->>'fuelSurchargeIncluded','')::boolean,false);
  v_fuel:=case when v_fuel_included then 0 else coalesce(nullif(v_config->>'fuelSurchargePct','')::numeric,0) end;
  v_vat:=coalesce(nullif(v_config->>'vatRatePct','')::numeric,21);
  v_base:=v_base*(1+v_fuel/100);

  if v_include_vat then v_total:=v_base;v_net:=v_total/(1+v_vat/100);
  else v_net:=v_base;v_total:=v_net*(1+v_vat/100); end if;

  return jsonb_build_object('totalAmount',round(v_total,2),'netAmount',round(v_net,2),'taxAmount',round(v_total-v_net,2),'currency',coalesce(v_config->>'currencyCode','EUR'));
end;
$$;

create or replace function public.transport_tariff_save_active(document_id uuid,apply_from date,snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
  v_baseline date;
  v_effective_from date;
  v_effective_to date;
  v_service jsonb;
  v_band jsonb;
  v_service_id uuid;
  v_service_index integer:=0;
  v_band_index integer;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;
  if apply_from is null then raise exception 'Indica desde qué fecha se aplican los cambios'; end if;
  if snapshot is null or jsonb_typeof(snapshot)<>'object' then raise exception 'Configuración de tarifa no válida'; end if;

  select * into v_document
  from public.transport_tariff_documents d
  where d.id=document_id and d.owner_id=v_owner
  for update;

  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'active' then raise exception 'La tarifa no está activa'; end if;

  v_effective_from:=coalesce(nullif(snapshot->>'effectiveFrom','')::date,v_document.effective_from);
  v_effective_to:=case when snapshot ? 'effectiveTo' then nullif(snapshot->>'effectiveTo','')::date else v_document.effective_to end;

  if v_effective_from is not null and apply_from<v_effective_from then
    raise exception 'La fecha de aplicación no puede ser anterior al inicio de vigencia';
  end if;
  if v_effective_to is not null and apply_from>v_effective_to then
    raise exception 'La fecha de aplicación no puede ser posterior al fin de vigencia';
  end if;

  v_baseline:=coalesce(v_document.effective_from,apply_from);

  if not exists(
    select 1 from public.transport_tariff_revisions r
    where r.owner_id=v_owner and r.document_id=document_id and r.effective_from=v_baseline
  ) then
    insert into public.transport_tariff_revisions(owner_id,document_id,effective_from,snapshot,created_by)
    values(v_owner,document_id,v_baseline,private.transport_tariff_snapshot(v_owner,document_id),auth.uid());
  end if;

  insert into public.transport_tariff_revisions(owner_id,document_id,effective_from,snapshot,created_by,updated_at)
  values(v_owner,document_id,apply_from,snapshot,auth.uid(),now())
  on conflict(owner_id,document_id,effective_from) do update
  set snapshot=excluded.snapshot,updated_at=now();

  update public.transport_tariff_documents d
  set carrier_code=coalesce(nullif(snapshot->>'carrierCode',''),d.carrier_code),
      carrier_name=coalesce(nullif(snapshot->>'carrierName',''),d.carrier_name),
      effective_from=v_effective_from,
      effective_to=v_effective_to,
      currency_code=coalesce(nullif(snapshot->>'currencyCode',''),d.currency_code),
      prices_include_vat=coalesce(nullif(snapshot->>'pricesIncludeVat','')::boolean,d.prices_include_vat),
      vat_rate_pct=coalesce(nullif(snapshot->>'vatRatePct','')::numeric,d.vat_rate_pct),
      fuel_surcharge_pct=case when snapshot ? 'fuelSurchargePct' then nullif(snapshot->>'fuelSurchargePct','')::numeric else d.fuel_surcharge_pct end,
      fuel_surcharge_included=coalesce(nullif(snapshot->>'fuelSurchargeIncluded','')::boolean,d.fuel_surcharge_included),
      updated_at=now()
  where d.id=document_id and d.owner_id=v_owner;

  delete from public.transport_tariff_services s
  where s.owner_id=v_owner and s.document_id=document_id;

  for v_service in
    select value from jsonb_array_elements(coalesce(snapshot->'services','[]'::jsonb))
  loop
    insert into public.transport_tariff_services(
      owner_id,document_id,service_name,canonical_service_key,external_provider,
      external_service_code,mapping_status,sort_order
    )
    values(
      v_owner,document_id,
      coalesce(nullif(v_service->>'serviceName',''),'Servicio'),
      coalesce(nullif(v_service->>'canonicalServiceKey',''),'service-'||v_service_index),
      nullif(v_service->>'externalProvider',''),
      nullif(v_service->>'externalServiceCode',''),
      case when v_service->>'mappingStatus' in ('suggested','confirmed','unmapped') then v_service->>'mappingStatus' else 'confirmed' end,
      coalesce(nullif(v_service->>'sortOrder','')::integer,v_service_index)
    )
    returning id into v_service_id;

    if (v_service->>'mappingStatus')='confirmed'
       and nullif(v_service->>'externalProvider','') is not null
       and nullif(v_service->>'externalServiceCode','') is not null then
      insert into public.transport_service_mappings(
        owner_id,carrier_code,canonical_service_key,external_provider,external_service_code,
        confirmed_by,confirmed_at,updated_at
      )
      values(
        v_owner,
        coalesce(nullif(snapshot->>'carrierCode',''),v_document.carrier_code),
        coalesce(nullif(v_service->>'canonicalServiceKey',''),'service-'||v_service_index),
        v_service->>'externalProvider',v_service->>'externalServiceCode',
        auth.uid(),now(),now()
      )
      on conflict(owner_id,carrier_code,canonical_service_key) do update
      set external_provider=excluded.external_provider,
          external_service_code=excluded.external_service_code,
          confirmed_by=excluded.confirmed_by,
          confirmed_at=excluded.confirmed_at,
          updated_at=excluded.updated_at;
    end if;

    v_band_index:=0;
    for v_band in
      select value from jsonb_array_elements(coalesce(v_service->'bands','[]'::jsonb))
    loop
      insert into public.transport_tariff_bands(
        owner_id,service_id,country_code,zone_code,zone_name,min_weight_kg,max_weight_kg,
        base_price,extra_kg_price,notes,sort_order
      )
      values(
        v_owner,v_service_id,
        upper(coalesce(nullif(v_band->>'countryCode',''),'ES')),
        coalesce(nullif(v_band->>'zoneCode',''),'peninsular'),
        coalesce(nullif(v_band->>'zoneName',''),'Zona'),
        coalesce(nullif(v_band->>'minWeightKg','')::numeric,0),
        nullif(v_band->>'maxWeightKg','')::numeric,
        nullif(v_band->>'basePrice','')::numeric,
        nullif(v_band->>'extraKgPrice','')::numeric,
        nullif(v_band->>'notes',''),
        coalesce(nullif(v_band->>'sortOrder','')::integer,v_band_index)
      );
      v_band_index:=v_band_index+1;
    end loop;
    v_service_index:=v_service_index+1;
  end loop;

  return jsonb_build_object('ok',true,'effectiveFrom',apply_from);
end;
$$;

revoke all on function public.transport_tariff_save_active(uuid,date,jsonb) from public,anon;
grant execute on function public.transport_tariff_save_active(uuid,date,jsonb) to authenticated;

create or replace function public.transport_tariff_reprice_estimates(document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_owner uuid; v_document public.transport_tariff_documents%rowtype; v_count bigint;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;
  select * into v_document from public.transport_tariff_documents d where d.id=document_id and d.owner_id=v_owner;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.carrier_code<>'mrw' then return jsonb_build_object('ok',true,'updated',0); end if;

  with candidates as (
    select f.id,f.order_created_at,upper(coalesce(f.shipping_address->>'country_code','')) country_code,
      regexp_replace(coalesce(f.shipping_address->>'postal_code',''),'\s+','','g') postal_code,
      case
        when coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,value}','') !~ '^[0-9]+([.][0-9]+)?$' then null
        when lower(coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,unit}','kg'))='g' then (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric/1000
        when lower(coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,unit}','kg')) in ('lb','lbs') then (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric*0.45359237
        else (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric
      end weight_kg
    from public.fulfillment_orders f
    where f.owner_id=v_owner and f.shipping_cost_source='tariff_estimate' and f.order_created_at is not null
      and f.order_created_at::date between coalesce(v_document.effective_from,'1900-01-01'::date) and coalesce(v_document.effective_to,'9999-12-31'::date)
  ),
  priced as (
    select c.id,p.price from candidates c
    cross join lateral (select private.transport_tariff_estimate_for_date(v_owner,document_id,c.order_created_at::date,c.country_code,c.postal_code,c.weight_kg) price) p
    where p.price is not null
  ),
  updated as (
    update public.fulfillment_orders f
    set shipping_cost_amount=(p.price->>'totalAmount')::numeric,shipping_cost_net_amount=(p.price->>'netAmount')::numeric,
        shipping_cost_tax_amount=(p.price->>'taxAmount')::numeric,shipping_cost_currency=coalesce(p.price->>'currency','EUR'),
        shipping_cost_source='tariff_estimate',updated_at=now()
    from priced p where f.id=p.id and f.owner_id=v_owner returning f.id
  )
  select count(*) into v_count from updated;
  return jsonb_build_object('ok',true,'updated',v_count);
end;
$$;

revoke all on function public.transport_tariff_reprice_estimates(uuid) from public,anon;
grant execute on function public.transport_tariff_reprice_estimates(uuid) to authenticated;
