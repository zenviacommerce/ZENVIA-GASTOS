-- Invoke the Amazon worker directly from pg_net.
-- The previous cron referenced private.amazon_invoke_internal_function(), which
-- is no longer present in production, so every minute the cron failed and the
-- queue kept growing.

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname in ('amazon-sync-worker','amazon-worker-minute')
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'amazon-sync-worker',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/amazon-sync-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='amazon_cron_secret_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
