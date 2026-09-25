-- Consolidate legacy Amazon worker cron names into one minute-level worker.
-- Some environments still have the older amazon-worker-minute job active.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in ('amazon-sync-worker','amazon-worker-minute')
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
