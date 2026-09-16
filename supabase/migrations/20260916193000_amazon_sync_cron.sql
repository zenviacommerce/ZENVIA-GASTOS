-- Schedule Amazon Analytics Phase B without embedding credentials in SQL.
-- The project URL and the internal project secret key are read from Supabase Vault.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.amazon_invoke_internal_function(
  function_name text,
  request_body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  project_url text;
  cron_secret text;
  request_id bigint;
begin
  select decrypted_secret
    into project_url
    from vault.decrypted_secrets
   where name = 'project_url'
   limit 1;

  select decrypted_secret
    into cron_secret
    from vault.decrypted_secrets
   where name = 'amazon_cron_secret_key'
   limit 1;

  if coalesce(trim(project_url),'') = '' then
    raise exception 'Vault secret project_url is not configured.';
  end if;
  if coalesce(trim(cron_secret),'') = '' then
    raise exception 'Vault secret amazon_cron_secret_key is not configured.';
  end if;

  select net.http_post(
    url := rtrim(project_url,'/') || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',cron_secret
    ),
    body := coalesce(request_body,'{}'::jsonb),
    timeout_milliseconds := 10000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.amazon_invoke_internal_function(text,jsonb) from public;
revoke all on function private.amazon_invoke_internal_function(text,jsonb) from anon;
revoke all on function private.amazon_invoke_internal_function(text,jsonb) from authenticated;

-- Keep the migration idempotent when it is replayed in a branch or restored project.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname in ('amazon-sync-hourly','amazon-sync-worker')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'amazon-sync-hourly',
  '7 * * * *',
  $cron$select private.amazon_invoke_internal_function('amazon-sync-orchestrator','{"mode":"hourly"}'::jsonb);$cron$
);

select cron.schedule(
  'amazon-sync-worker',
  '*/5 * * * *',
  $cron$select private.amazon_invoke_internal_function('amazon-sync-worker','{}'::jsonb);$cron$
);
