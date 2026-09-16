-- PostgREST-callable service-only wrapper for the private atomic job claimer.
-- PUBLIC/anon/authenticated are explicitly denied; only service_role can execute it.
create or replace function public.amazon_claim_sync_jobs(limit_count integer default 3)
returns setof public.amazon_sync_jobs
language sql
security definer
set search_path = ''
as $$
  select * from private.amazon_claim_sync_jobs(limit_count);
$$;

revoke all on function public.amazon_claim_sync_jobs(integer) from public;
revoke all on function public.amazon_claim_sync_jobs(integer) from anon, authenticated;
grant execute on function public.amazon_claim_sync_jobs(integer) to service_role;
