-- Coalesce stale Amazon incremental jobs so the dashboard stays current during backfill.
-- Superseded jobs are bookkeeping-only completions: they must never advance source checkpoints.

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

  update public.amazon_sync_jobs stale
  set status = 'success',
      rows_processed = 0,
      finished_at = now(),
      updated_at = now(),
      payload = coalesce(stale.payload,'{}'::jsonb)
                || jsonb_build_object('superseded',true,'superseded_at',now())
  where stale.status = 'queued'
    and coalesce(stale.payload->>'mode','') in ('hourly','manual')
    and exists (
      select 1
      from public.amazon_sync_jobs newer
      where newer.owner_id = stale.owner_id
        and newer.amazon_account_id = stale.amazon_account_id
        and newer.source = stale.source
        and coalesce(newer.scope_key,newer.marketplace_id,'global')
            = coalesce(stale.scope_key,stale.marketplace_id,'global')
        and coalesce(newer.payload->>'mode','') in ('hourly','manual')
        and newer.created_at > stale.created_at
        and newer.status in ('queued','running','success')
    );

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
      case
        when coalesce(j.payload->>'mode','') in ('hourly','manual') then j.created_at
      end desc nulls last,
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
