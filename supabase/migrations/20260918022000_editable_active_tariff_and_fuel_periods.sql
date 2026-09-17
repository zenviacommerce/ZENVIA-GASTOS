-- Active transport tariffs can be corrected in place.
-- Fuel surcharge is periodized inside the same tariff so monthly changes do not require a new tariff version.

drop function if exists public.transport_tariff_clone_version(uuid,date);

create table if not exists public.transport_tariff_fuel_periods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  document_id uuid not null,
  effective_from date not null,
  effective_to date,
  fuel_surcharge_pct numeric(8,4) not null check (fuel_surcharge_pct >= 0 and fuel_surcharge_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_tariff_fuel_period_dates check (effective_to is null or effective_to >= effective_from),
  constraint transport_tariff_fuel_period_document_fk foreign key (document_id,owner_id)
    references public.transport_tariff_documents(id,owner_id) on delete cascade
);

create index if not exists transport_tariff_fuel_periods_lookup_idx
  on public.transport_tariff_fuel_periods(owner_id,document_id,effective_from desc,effective_to);

alter table public.transport_tariff_fuel_periods enable row level security;

drop policy if exists transport_tariff_fuel_periods_all on public.transport_tariff_fuel_periods;
create policy transport_tariff_fuel_periods_all on public.transport_tariff_fuel_periods for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')));

grant select,insert,update,delete on public.transport_tariff_fuel_periods to authenticated;

create or replace function public.transport_tariff_replace_fuel_periods(document_id uuid,periods jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_document public.transport_tariff_documents%rowtype;
  v_item jsonb; v_from date; v_to date; v_pct numeric;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;
  select * into v_document from public.transport_tariff_documents d
  where d.id=document_id and d.owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status not in ('draft','active') then raise exception 'Solo se pueden editar periodos de una tarifa en borrador o activa'; end if;
  if periods is null or jsonb_typeof(periods)<>'array' then raise exception 'Periodos de combustible no válidos'; end if;

  delete from public.transport_tariff_fuel_periods p where p.owner_id=v_owner and p.document_id=document_id;
  for v_item in select value from jsonb_array_elements(periods) loop
    v_from:=nullif(v_item->>'effectiveFrom','')::date;
    v_to:=nullif(v_item->>'effectiveTo','')::date;
    v_pct:=nullif(v_item->>'fuelSurchargePct','')::numeric;
    if v_from is null or v_pct is null then raise exception 'Cada periodo necesita fecha de inicio y porcentaje'; end if;
    if v_pct<0 or v_pct>100 then raise exception 'Porcentaje de combustible no válido'; end if;
    if v_to is not null and v_to<v_from then raise exception 'El fin del periodo no puede ser anterior al inicio'; end if;
    if v_document.effective_from is not null and v_from<v_document.effective_from then raise exception 'El periodo de combustible empieza antes que la tarifa'; end if;
    if v_document.effective_to is not null and coalesce(v_to,v_from)>v_document.effective_to then raise exception 'El periodo de combustible termina después de la tarifa'; end if;
    if exists(
      select 1 from public.transport_tariff_fuel_periods p
      where p.owner_id=v_owner and p.document_id=document_id
        and daterange(p.effective_from,coalesce(p.effective_to,'infinity'::date),'[]')
          && daterange(v_from,coalesce(v_to,'infinity'::date),'[]')
    ) then raise exception 'Los periodos de combustible no pueden solaparse'; end if;
    insert into public.transport_tariff_fuel_periods(owner_id,document_id,effective_from,effective_to,fuel_surcharge_pct)
    values(v_owner,document_id,v_from,v_to,v_pct);
  end loop;
  return jsonb_build_object('ok',true,'count',jsonb_array_length(periods));
end; $$;

revoke all on function public.transport_tariff_replace_fuel_periods(uuid,jsonb) from public,anon;
grant execute on function public.transport_tariff_replace_fuel_periods(uuid,jsonb) to authenticated;

create or replace function public.transport_tariff_reprice_estimates(document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid; v_document public.transport_tariff_documents%rowtype; v_count bigint;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;
  select * into v_document from public.transport_tariff_documents d
  where d.id=document_id and d.owner_id=v_owner;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.carrier_code<>'mrw' then return jsonb_build_object('ok',true,'updated',0); end if;

  with candidates as (
    select f.id,f.owner_id,f.order_created_at,
      upper(coalesce(f.shipping_address->>'country_code','')) country_code,
      regexp_replace(coalesce(f.shipping_address->>'postal_code',''),'\s+','','g') postal_code,
      case
        when coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,value}','') !~ '^[0-9]+([.][0-9]+)?$' then null
        when lower(coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,unit}','kg'))='g'
          then (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric/1000
        when lower(coalesce(f.raw_payload#>>'{shipping_details,measurement,weight,unit}','kg')) in ('lb','lbs')
          then (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric*0.45359237
        else (f.raw_payload#>>'{shipping_details,measurement,weight,value}')::numeric
      end weight_kg
    from public.fulfillment_orders f
    where f.owner_id=v_owner and f.shipping_cost_source='tariff_estimate' and f.order_created_at is not null
      and f.order_created_at::date between coalesce(v_document.effective_from,'1900-01-01'::date) and coalesce(v_document.effective_to,'9999-12-31'::date)
  ),
  priced as (
    select c.id,c.weight_kg,d.prices_include_vat,coalesce(d.vat_rate_pct,21) vat_rate,
      case when d.fuel_surcharge_included then 0 else coalesce(fp.fuel_surcharge_pct,d.fuel_surcharge_pct,0) end fuel_pct,
      b.min_weight_kg,b.max_weight_kg,b.base_price,b.extra_kg_price,
      case when b.max_weight_kg is null and b.extra_kg_price is not null and c.weight_kg>b.min_weight_kg
           then b.base_price+ceil(c.weight_kg-b.min_weight_kg)*b.extra_kg_price else b.base_price end base_amount
    from candidates c
    join public.transport_tariff_documents d on d.id=document_id and d.owner_id=c.owner_id
    join public.transport_tariff_services s on s.owner_id=d.owner_id and s.document_id=d.id
      and (s.canonical_service_key='manana-19h' or s.service_name ~* '19[[:space:]]*h')
    join public.transport_tariff_bands b on b.owner_id=d.owner_id and b.service_id=s.id
      and b.country_code=c.country_code and b.zone_code='peninsular'
      and c.weight_kg>b.min_weight_kg and (b.max_weight_kg is null or c.weight_kg<=b.max_weight_kg)
    left join lateral (
      select p.fuel_surcharge_pct from public.transport_tariff_fuel_periods p
      where p.owner_id=d.owner_id and p.document_id=d.id
        and c.order_created_at::date>=p.effective_from
        and (p.effective_to is null or c.order_created_at::date<=p.effective_to)
      order by p.effective_from desc limit 1
    ) fp on true
    where c.weight_kg>0 and c.country_code in ('ES','PT')
      and not(c.country_code='ES' and c.postal_code ~ '^07[0-9]{3}$')
  ),
  dedup as (
    select distinct on (id) * from priced order by id,min_weight_kg desc
  ),
  values_to_write as (
    select id,
      round(case when prices_include_vat then base_amount*(1+fuel_pct/100)
                 else base_amount*(1+fuel_pct/100)*(1+vat_rate/100) end,2) total_amount,
      round(case when prices_include_vat then base_amount*(1+fuel_pct/100)/(1+vat_rate/100)
                 else base_amount*(1+fuel_pct/100) end,2) net_amount
    from dedup
  ),
  updated as (
    update public.fulfillment_orders f
    set shipping_cost_amount=v.total_amount,shipping_cost_currency='EUR',shipping_cost_source='tariff_estimate',
        shipping_cost_net_amount=v.net_amount,shipping_cost_tax_amount=round(v.total_amount-v.net_amount,2),updated_at=now()
    from values_to_write v where f.id=v.id and f.owner_id=v_owner returning f.id
  )
  select count(*) into v_count from updated;
  return jsonb_build_object('ok',true,'updated',v_count);
end; $$;

revoke all on function public.transport_tariff_reprice_estimates(uuid) from public,anon;
grant execute on function public.transport_tariff_reprice_estimates(uuid) to authenticated;
