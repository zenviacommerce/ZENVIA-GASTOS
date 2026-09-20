create table if not exists public.app_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  schema_version integer not null default 1 check (schema_version >= 1),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  schema_version integer not null default 1 check (schema_version >= 1),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,owner_id)
);

create table if not exists public.entity_alias_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  entity_type text not null check (entity_type in ('supplier','client')),
  alias text not null,
  normalized_alias text not null,
  target_entity_id uuid not null,
  priority integer not null default 100 check (priority between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,entity_type,normalized_alias)
);

create table if not exists public.shipping_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  name text not null,
  priority integer not null default 100 check (priority between 0 and 10000),
  active boolean not null default true,
  conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions)='object'),
  action jsonb not null default '{}'::jsonb check (jsonb_typeof(action)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade default private.app_workspace_owner_id(),
  rule_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,rule_key)
);

create index if not exists entity_alias_rules_lookup_idx
  on public.entity_alias_rules(owner_id,entity_type,normalized_alias) where active;
create index if not exists entity_alias_rules_priority_idx
  on public.entity_alias_rules(owner_id,entity_type,priority,id) where active;
create index if not exists shipping_rules_priority_idx
  on public.shipping_rules(owner_id,priority,id) where active;
create index if not exists automation_rules_key_idx
  on public.automation_rules(owner_id,rule_key);

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();

drop trigger if exists user_preferences_updated_at on public.user_preferences;
create trigger user_preferences_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();

drop trigger if exists entity_alias_rules_updated_at on public.entity_alias_rules;
create trigger entity_alias_rules_updated_at before update on public.entity_alias_rules
for each row execute function public.set_updated_at();

drop trigger if exists shipping_rules_updated_at on public.shipping_rules;
create trigger shipping_rules_updated_at before update on public.shipping_rules
for each row execute function public.set_updated_at();

drop trigger if exists automation_rules_updated_at on public.automation_rules;
create trigger automation_rules_updated_at before update on public.automation_rules
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.user_preferences enable row level security;
alter table public.entity_alias_rules enable row level security;
alter table public.shipping_rules enable row level security;
alter table public.automation_rules enable row level security;

revoke all on public.app_settings,public.user_preferences,public.entity_alias_rules,public.shipping_rules,public.automation_rules from anon;
revoke all on public.app_settings,public.user_preferences,public.entity_alias_rules,public.shipping_rules,public.automation_rules from authenticated;

grant select,insert,update,delete on public.app_settings to authenticated;
grant select,insert,update,delete on public.user_preferences to authenticated;
grant select,insert,update,delete on public.entity_alias_rules to authenticated;
grant select,insert,update,delete on public.shipping_rules to authenticated;
grant select,insert,update,delete on public.automation_rules to authenticated;

drop policy if exists app_settings_workspace_select on public.app_settings;
create policy app_settings_workspace_select on public.app_settings
for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_active())
);

drop policy if exists app_settings_admin_insert on public.app_settings;
create policy app_settings_admin_insert on public.app_settings
for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

drop policy if exists app_settings_admin_update on public.app_settings;
create policy app_settings_admin_update on public.app_settings
for update to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
)
with check (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

drop policy if exists app_settings_admin_delete on public.app_settings;
create policy app_settings_admin_delete on public.app_settings
for delete to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_admin())
);

drop policy if exists user_preferences_own_select on public.user_preferences;
create policy user_preferences_own_select on public.user_preferences
for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and user_id=(select auth.uid())
  and (select private.app_is_active())
);

drop policy if exists user_preferences_own_insert on public.user_preferences;
create policy user_preferences_own_insert on public.user_preferences
for insert to authenticated
with check (
  owner_id=(select private.app_workspace_owner_id())
  and user_id=(select auth.uid())
  and (select private.app_is_active())
);

drop policy if exists user_preferences_own_update on public.user_preferences;
create policy user_preferences_own_update on public.user_preferences
for update to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and user_id=(select auth.uid())
  and (select private.app_is_active())
)
with check (
  owner_id=(select private.app_workspace_owner_id())
  and user_id=(select auth.uid())
  and (select private.app_is_active())
);

drop policy if exists user_preferences_own_delete on public.user_preferences;
create policy user_preferences_own_delete on public.user_preferences
for delete to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and user_id=(select auth.uid())
  and (select private.app_is_active())
);

drop policy if exists entity_alias_rules_workspace_select on public.entity_alias_rules;
create policy entity_alias_rules_workspace_select on public.entity_alias_rules
for select to authenticated
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_is_active())
);
drop policy if exists entity_alias_rules_admin_insert on public.entity_alias_rules;
create policy entity_alias_rules_admin_insert on public.entity_alias_rules
for insert to authenticated
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists entity_alias_rules_admin_update on public.entity_alias_rules;
create policy entity_alias_rules_admin_update on public.entity_alias_rules
for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists entity_alias_rules_admin_delete on public.entity_alias_rules;
create policy entity_alias_rules_admin_delete on public.entity_alias_rules
for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));

drop policy if exists shipping_rules_workspace_select on public.shipping_rules;
create policy shipping_rules_workspace_select on public.shipping_rules
for select to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_active()));
drop policy if exists shipping_rules_admin_insert on public.shipping_rules;
create policy shipping_rules_admin_insert on public.shipping_rules
for insert to authenticated
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists shipping_rules_admin_update on public.shipping_rules;
create policy shipping_rules_admin_update on public.shipping_rules
for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists shipping_rules_admin_delete on public.shipping_rules;
create policy shipping_rules_admin_delete on public.shipping_rules
for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));

drop policy if exists automation_rules_workspace_select on public.automation_rules;
create policy automation_rules_workspace_select on public.automation_rules
for select to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_active()));
drop policy if exists automation_rules_admin_insert on public.automation_rules;
create policy automation_rules_admin_insert on public.automation_rules
for insert to authenticated
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists automation_rules_admin_update on public.automation_rules;
create policy automation_rules_admin_update on public.automation_rules
for update to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()))
with check (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));
drop policy if exists automation_rules_admin_delete on public.automation_rules;
create policy automation_rules_admin_delete on public.automation_rules
for delete to authenticated
using (owner_id=(select private.app_workspace_owner_id()) and (select private.app_is_admin()));

create or replace function private.audit_configuration_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else '{}'::jsonb end;
  v_after jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  v_row jsonb := case when tg_op='DELETE' then v_before else v_after end;
  v_owner uuid := nullif(v_row->>'owner_id','')::uuid;
  v_actor uuid := auth.uid();
  v_mail text;
  v_action text := lower(tg_op);
  v_entity_id text := coalesce(v_row->>'id',v_row->>'owner_id');
  v_label text;
  v_summary text;
  v_details jsonb := '{}'::jsonb;
  v_changed_sections jsonb := '[]'::jsonb;
begin
  if v_owner is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  if v_actor is not null then
    select email into v_mail from public.app_users where user_id=v_actor limit 1;
  end if;

  if tg_table_name='app_settings' then
    v_label := 'Configuración global';
    if tg_op='UPDATE' then
      select coalesce(jsonb_agg(key order by key),'[]'::jsonb)
        into v_changed_sections
      from (
        select key from (
          select jsonb_object_keys(coalesce(v_before->'config','{}'::jsonb)) as key
          union
          select jsonb_object_keys(coalesce(v_after->'config','{}'::jsonb)) as key
        ) keys
        where (v_before->'config'->key) is distinct from (v_after->'config'->key)
      ) changed;
    elsif tg_op='INSERT' then
      select coalesce(jsonb_agg(key order by key),'[]'::jsonb)
        into v_changed_sections
      from jsonb_object_keys(coalesce(v_after->'config','{}'::jsonb)) as key;
    end if;
    v_details := jsonb_build_object('changed_sections',v_changed_sections,'schema_version',v_row->>'schema_version');
  elsif tg_table_name='entity_alias_rules' then
    v_label := coalesce(v_row->>'alias','Alias');
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'entity_type',v_row->>'entity_type','alias',v_row->>'alias',
      'target_entity_id',v_row->>'target_entity_id','priority',v_row->>'priority','active',v_row->>'active'
    ));
  elsif tg_table_name='shipping_rules' then
    v_label := coalesce(v_row->>'name','Regla de envío');
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'name',v_row->>'name','priority',v_row->>'priority','active',v_row->>'active'
    ));
  elsif tg_table_name='automation_rules' then
    v_label := coalesce(v_row->>'rule_key','Automatización');
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'rule_key',v_row->>'rule_key','enabled',v_row->>'enabled'
    ));
  else
    if tg_op='DELETE' then return old; else return new; end if;
  end if;

  v_summary := case tg_op
    when 'INSERT' then 'Creó '
    when 'UPDATE' then 'Modificó '
    else 'Eliminó '
  end || lower(v_label);

  insert into public.audit_logs(
    workspace_owner_id,actor_user_id,actor_email,module,action,
    entity_type,entity_id,entity_label,summary,details
  ) values (
    v_owner,v_actor,v_mail,'settings',v_action,tg_table_name,
    v_entity_id,v_label,v_summary,v_details
  );

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function private.audit_configuration_change() from public,anon,authenticated;

drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings after insert or update or delete on public.app_settings
for each row execute function private.audit_configuration_change();

drop trigger if exists audit_entity_alias_rules on public.entity_alias_rules;
create trigger audit_entity_alias_rules after insert or update or delete on public.entity_alias_rules
for each row execute function private.audit_configuration_change();

drop trigger if exists audit_shipping_rules on public.shipping_rules;
create trigger audit_shipping_rules after insert or update or delete on public.shipping_rules
for each row execute function private.audit_configuration_change();

drop trigger if exists audit_automation_rules on public.automation_rules;
create trigger audit_automation_rules after insert or update or delete on public.automation_rules
for each row execute function private.audit_configuration_change();

notify pgrst,'reload schema';
