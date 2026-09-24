-- Avoid duplicate audit entries when resetting global settings.
-- The app_settings audit trigger already records the configuration update.

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
  v_changed text[] := array[]::text[];
  v_before jsonb := '{}'::jsonb;
begin
  if not coalesce(private.app_is_admin(),false) then
    raise exception 'Solo un administrador puede restaurar la configuración global.';
  end if;
  if jsonb_typeof(coalesce(p_config,'{}'::jsonb))<>'object' then
    raise exception 'Configuración predeterminada no válida.';
  end if;

  select coalesce(config,'{}'::jsonb)
    into v_before
  from public.app_settings
  where owner_id=v_owner;

  select coalesce(array_agg(key order by key),array[]::text[])
    into v_changed
  from (
    select key from jsonb_object_keys(coalesce(v_before,'{}'::jsonb)) key
    union
    select key from jsonb_object_keys(p_config) key
  ) keys
  where coalesce(v_before->key,'null'::jsonb)
        is distinct from coalesce(p_config->key,'null'::jsonb);

  insert into public.app_settings(owner_id,schema_version,config,updated_at)
  values(v_owner,p_schema_version,p_config,now())
  on conflict(owner_id) do update set
    schema_version=excluded.schema_version,
    config=excluded.config,
    updated_at=excluded.updated_at;

  return jsonb_build_object('ok',true,'changedSections',to_jsonb(v_changed));
end;
$$;

revoke all on function public.configuration_reset_app_settings(integer,jsonb) from public,anon;
grant execute on function public.configuration_reset_app_settings(integer,jsonb) to authenticated;

notify pgrst,'reload schema';
