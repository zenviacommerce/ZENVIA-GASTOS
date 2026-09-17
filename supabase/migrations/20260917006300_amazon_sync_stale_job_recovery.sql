-- Recover Amazon sync jobs whose worker was terminated before it could clear the lock.
-- A 15-minute stale threshold is safely above Supabase hosted Edge Function wall-clock limits.

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
  set status = 'failed',
      locked_at = null,
      finished_at = now(),
      updated_at = now(),
      last_error = coalesce(stale.last_error,'') || case when coalesce(stale.last_error,'')='' then '' else ' · ' end || 'Recovered stale worker lock after retry exhaustion'
  where stale.status = 'running'
    and stale.locked_at < now() - interval '15 minutes'
    and stale.attempts >= stale.max_attempts;

  update public.amazon_sync_jobs stale
  set status = 'queued',
      locked_at = null,
      available_at = now(),
      finished_at = null,
      updated_at = now(),
      last_error = coalesce(stale.last_error,'') || case when coalesce(stale.last_error,'')='' then '' else ' · ' end || 'Recovered stale worker lock'
  where stale.status = 'running'
    and stale.locked_at < now() - interval '15 minutes'
    and stale.attempts < stale.max_attempts;

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
      case j.source
        when 'orders' then 0
        when 'finances' then 1
        when 'inventory' then 2
        else 9
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
