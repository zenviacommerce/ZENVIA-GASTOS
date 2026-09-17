-- Keep the public RPC argument name `document_id` while using positional parameter
-- references internally so it can never collide with table column names.

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

  select * into v_document from public.transport_tariff_documents d
  where d.id=$1 and d.owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'draft' then raise exception 'Solo una tarifa en borrador puede marcarse como revisada'; end if;
  if v_document.effective_from is null then raise exception 'Indica la fecha de inicio de vigencia'; end if;

  select count(*) into v_unconfirmed from public.transport_tariff_services s
  where s.owner_id=v_owner and s.document_id=$1 and s.mapping_status<>'confirmed';
  if v_unconfirmed>0 then raise exception 'Confirma la asociación de todos los servicios antes de revisar'; end if;

  select count(*) into v_band_count
  from public.transport_tariff_bands b
  join public.transport_tariff_services s on s.id=b.service_id and s.owner_id=b.owner_id
  where s.owner_id=v_owner and s.document_id=$1;
  if v_band_count=0 then raise exception 'La tarifa no contiene tramos'; end if;

  update public.transport_tariff_documents d
  set status='reviewed',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where d.id=$1 and d.owner_id=v_owner;

  insert into public.transport_service_mappings(owner_id,carrier_code,canonical_service_key,external_provider,external_service_code,confirmed_by,confirmed_at,updated_at)
  select v_owner,v_document.carrier_code,s.canonical_service_key,s.external_provider,s.external_service_code,auth.uid(),now(),now()
  from public.transport_tariff_services s
  where s.owner_id=v_owner and s.document_id=$1 and s.mapping_status='confirmed'
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

  select * into v_document from public.transport_tariff_documents d
  where d.id=$1 and d.owner_id=v_owner for update;
  if not found then raise exception 'Tarifa no encontrada'; end if;
  if v_document.status<>'reviewed' then raise exception 'La tarifa debe estar revisada antes de activarla'; end if;
  if v_document.effective_from is null then raise exception 'La tarifa no tiene fecha de inicio'; end if;

  update public.transport_tariff_documents d
  set effective_to=v_document.effective_from-1,status='superseded',updated_at=now()
  where d.owner_id=v_owner and d.carrier_code=v_document.carrier_code and d.status='active'
    and d.id<>$1 and d.effective_from<v_document.effective_from
    and (d.effective_to is null or d.effective_to>=v_document.effective_from);

  if exists(
    select 1 from public.transport_tariff_documents d
    where d.owner_id=v_owner and d.carrier_code=v_document.carrier_code and d.status='active' and d.id<>$1
      and daterange(d.effective_from,coalesce(d.effective_to,'infinity'::date),'[]') &&
          daterange(v_document.effective_from,coalesce(v_document.effective_to,'infinity'::date),'[]')
  ) then
    raise exception 'Existe otra tarifa activa del transportista que solapa este periodo';
  end if;

  update public.transport_tariff_documents d
  set status='active',activated_by=auth.uid(),activated_at=now(),updated_at=now()
  where d.id=$1 and d.owner_id=v_owner;
  return jsonb_build_object('ok',true,'status','active');
end;
$$;
