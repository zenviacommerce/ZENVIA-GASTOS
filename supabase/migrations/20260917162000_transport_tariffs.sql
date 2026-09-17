-- Versioned carrier tariffs. Imports always start as drafts and require an explicit
-- review step before they can be activated.

create table if not exists public.transport_tariff_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  carrier_code text not null,
  carrier_name text not null,
  status text not null default 'draft' check (status in ('draft','reviewed','active','superseded')),
  effective_from date,
  effective_to date,
  currency_code text not null default 'EUR',
  prices_include_vat boolean not null default false,
  fuel_surcharge_pct numeric(8,4),
  fuel_surcharge_included boolean not null default false,
  source_file_name text,
  source_file_path text,
  source_mime_type text,
  source_sha256 text,
  parser_provider text,
  parser_model text,
  parser_confidence numeric(5,4),
  parser_notes jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  activated_by uuid,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_tariff_document_dates check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint transport_tariff_documents_owner_pair unique (id,owner_id)
);

create table if not exists public.transport_tariff_services (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  document_id uuid not null,
  service_name text not null,
  canonical_service_key text not null,
  external_provider text,
  external_service_code text,
  mapping_status text not null default 'suggested' check (mapping_status in ('suggested','confirmed','unmapped')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_tariff_services_document_fk foreign key (document_id,owner_id)
    references public.transport_tariff_documents(id,owner_id) on delete cascade,
  constraint transport_tariff_services_owner_pair unique (id,owner_id)
);

create table if not exists public.transport_tariff_bands (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  service_id uuid not null,
  country_code text not null check (char_length(country_code)=2),
  zone_code text not null,
  zone_name text not null,
  min_weight_kg numeric(12,3) not null default 0 check (min_weight_kg >= 0),
  max_weight_kg numeric(12,3),
  base_price numeric(12,4),
  extra_kg_price numeric(12,4),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_tariff_band_weights check (max_weight_kg is null or max_weight_kg > min_weight_kg),
  constraint transport_tariff_band_price check (base_price is not null or extra_kg_price is not null),
  constraint transport_tariff_bands_service_fk foreign key (service_id,owner_id)
    references public.transport_tariff_services(id,owner_id) on delete cascade
);

-- Confirmed service mappings are independent from a tariff version so a mapping
-- approved once can be proposed automatically on the next carrier document.
create table if not exists public.transport_service_mappings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  carrier_code text not null,
  canonical_service_key text not null,
  external_provider text not null,
  external_service_code text not null,
  confirmed_by uuid default auth.uid(),
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,carrier_code,canonical_service_key)
);

create index if not exists transport_tariff_documents_owner_carrier_dates_idx
  on public.transport_tariff_documents(owner_id,carrier_code,effective_from desc,effective_to);
create index if not exists transport_tariff_services_document_idx
  on public.transport_tariff_services(owner_id,document_id,sort_order);
create index if not exists transport_tariff_bands_service_idx
  on public.transport_tariff_bands(owner_id,service_id,country_code,zone_code,min_weight_kg,max_weight_kg);
create index if not exists transport_service_mappings_lookup_idx
  on public.transport_service_mappings(owner_id,carrier_code,canonical_service_key);

alter table public.transport_tariff_documents enable row level security;
alter table public.transport_tariff_services enable row level security;
alter table public.transport_tariff_bands enable row level security;
alter table public.transport_service_mappings enable row level security;

create policy transport_tariff_documents_select on public.transport_tariff_documents for select to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')));
create policy transport_tariff_documents_insert on public.transport_tariff_documents for insert to authenticated
with check (owner_id=(select private.app_workspace_owner_id()) and status='draft' and (select private.app_has_permission('orders')));
create policy transport_tariff_documents_update on public.transport_tariff_documents for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')));
create policy transport_tariff_documents_delete on public.transport_tariff_documents for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and status in ('draft','reviewed') and (select private.app_has_permission('orders')));

create policy transport_tariff_services_all on public.transport_tariff_services for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')));
create policy transport_tariff_bands_all on public.transport_tariff_bands for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')));
create policy transport_service_mappings_all on public.transport_service_mappings for all to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_has_permission('orders')));

grant select,insert,update,delete on public.transport_tariff_documents to authenticated;
grant select,insert,update,delete on public.transport_tariff_services to authenticated;
grant select,insert,update,delete on public.transport_tariff_bands to authenticated;
grant select,insert,update,delete on public.transport_service_mappings to authenticated;

create or replace function public.transport_tariff_mark_reviewed(document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
  v_unconfirmed bigint;
  v_band_count bigint;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;

  select * into v_document from public.transport_tariff_documents
  where id=document_id and owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'draft' then raise exception 'Solo una tarifa en borrador puede marcarse como revisada'; end if;
  if v_document.effective_from is null then raise exception 'Indica la fecha de inicio de vigencia'; end if;

  select count(*) into v_unconfirmed from public.transport_tariff_services
  where owner_id=v_owner and document_id=document_id and mapping_status<>'confirmed';
  if v_unconfirmed>0 then raise exception 'Confirma la asociación de todos los servicios antes de revisar'; end if;

  select count(*) into v_band_count
  from public.transport_tariff_bands b
  join public.transport_tariff_services s on s.id=b.service_id and s.owner_id=b.owner_id
  where s.owner_id=v_owner and s.document_id=document_id;
  if v_band_count=0 then raise exception 'La tarifa no contiene tramos'; end if;

  update public.transport_tariff_documents
  set status='reviewed',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where id=document_id and owner_id=v_owner;

  insert into public.transport_service_mappings(owner_id,carrier_code,canonical_service_key,external_provider,external_service_code,confirmed_by,confirmed_at,updated_at)
  select v_owner,v_document.carrier_code,s.canonical_service_key,s.external_provider,s.external_service_code,auth.uid(),now(),now()
  from public.transport_tariff_services s
  where s.owner_id=v_owner and s.document_id=document_id and s.mapping_status='confirmed'
    and nullif(s.external_provider,'') is not null and nullif(s.external_service_code,'') is not null
  on conflict(owner_id,carrier_code,canonical_service_key) do update
  set external_provider=excluded.external_provider,external_service_code=excluded.external_service_code,
      confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'status','reviewed');
end;
$$;

create or replace function public.transport_tariff_activate(document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_owner uuid;
  v_document public.transport_tariff_documents%rowtype;
begin
  v_owner:=private.app_workspace_owner_id();
  if v_owner is null or not private.app_has_permission('orders') then raise exception 'Forbidden'; end if;

  select * into v_document from public.transport_tariff_documents
  where id=document_id and owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'reviewed' then raise exception 'La tarifa debe estar revisada antes de activarla'; end if;
  if v_document.effective_from is null then raise exception 'La tarifa no tiene fecha de inicio'; end if;

  -- Close a previous open-ended version of the same carrier the day before the
  -- new version starts. Nothing historical is deleted.
  update public.transport_tariff_documents
  set effective_to=v_document.effective_from-1,status='superseded',updated_at=now()
  where owner_id=v_owner and carrier_code=v_document.carrier_code and status='active'
    and id<>document_id and effective_from<v_document.effective_from
    and (effective_to is null or effective_to>=v_document.effective_from);

  if exists(
    select 1 from public.transport_tariff_documents d
    where d.owner_id=v_owner and d.carrier_code=v_document.carrier_code and d.status='active' and d.id<>document_id
      and daterange(d.effective_from,coalesce(d.effective_to,'infinity'::date),'[]') &&
          daterange(v_document.effective_from,coalesce(v_document.effective_to,'infinity'::date),'[]')
  ) then
    raise exception 'Existe otra tarifa activa del transportista que solapa este periodo';
  end if;

  update public.transport_tariff_documents
  set status='active',activated_by=auth.uid(),activated_at=now(),updated_at=now()
  where id=document_id and owner_id=v_owner;
  return jsonb_build_object('ok',true,'status','active');
end;
$$;

revoke all on function public.transport_tariff_mark_reviewed(uuid) from public,anon;
revoke all on function public.transport_tariff_activate(uuid) from public,anon;
grant execute on function public.transport_tariff_mark_reviewed(uuid) to authenticated;
grant execute on function public.transport_tariff_activate(uuid) to authenticated;

-- Private source documents. The first folder is always the uploading user; the
-- workspace helper lets authorised colleagues read documents from the same workspace.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('transport-tariffs','transport-tariffs',false,15728640,array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy transport_tariffs_storage_select on storage.objects for select to authenticated
using (bucket_id='transport-tariffs' and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1])) and (select private.app_has_permission('orders')));
create policy transport_tariffs_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='transport-tariffs' and (storage.foldername(name))[1]=(select auth.uid())::text and (select private.app_has_permission('orders')));
create policy transport_tariffs_storage_update on storage.objects for update to authenticated
using (bucket_id='transport-tariffs' and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1])) and (select private.app_has_permission('orders')))
with check (bucket_id='transport-tariffs' and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1])) and (select private.app_has_permission('orders')));
create policy transport_tariffs_storage_delete on storage.objects for delete to authenticated
using (bucket_id='transport-tariffs' and (select private.app_storage_folder_in_workspace((storage.foldername(name))[1])) and (select private.app_has_permission('orders')));
