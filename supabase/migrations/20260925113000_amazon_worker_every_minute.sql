-- Drain Amazon sync work every minute instead of every five minutes.
-- A full hourly batch currently creates up to 27 marketplace/source jobs; with a
-- 3-job worker and a five-minute cadence the last inventory jobs could wait
-- ~40-45 minutes even when every API call succeeded.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname='amazon-sync-worker'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'amazon-sync-worker',
  '* * * * *',
  $cron$select private.amazon_invoke_internal_function('amazon-sync-worker','{}'::jsonb);$cron$
);
