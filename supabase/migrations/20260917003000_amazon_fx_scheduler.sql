-- Daily ECB FX refresh for Amazon Analytics.
-- Uses the existing Vault URL/key pair and the internal apikey contract.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname='amazon-fx-daily' loop
    perform cron.unschedule(v_jobid);
  end loop;
end;
$$;

select cron.schedule(
  'amazon-fx-daily',
  '17 4 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/amazon-sync-fx',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='amazon_cron_secret_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
