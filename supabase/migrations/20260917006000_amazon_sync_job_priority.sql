-- Keep current Amazon data fresh while the historical backfill is still running.
-- Hourly/manual jobs must not wait behind hundreds of older initial backfill jobs.

create or replace function private.amazon_claim_sync_jobs(limit_count integer default 3)
returns setof public.amazon_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if limit_count < 1 or limit_count > 20 then
    raise exception 'Invalid job claim size';
  end if;

  return query
  with candidates as (
    select j.id
    from public.amazon_sync_jobs j
    where j.status = 'queued'
      and j.available_at <= now()
      and j.attempts < j.max_attempts
    order by
      case
        when coalesce(j.payload->>'mode','') in ('hourly','manual') then 0
        else 1
      end,
      j.available_at,
      j.created_at
    for update skip locked
    limit limit_count
  )
  update public.amazon_sync_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      locked_at = now(),
      updated_at = now()
  from candidates c
  where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function private.amazon_claim_sync_jobs(integer) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.amazon_claim_sync_jobs(integer) to service_role;
