-- Harden the legacy Amazon detail RPC: authenticated users may call it,
-- but anonymous/public execution is never required.
revoke execute on function public.amazon_analytics_detail(date,date,text[]) from public, anon;
grant execute on function public.amazon_analytics_detail(date,date,text[]) to authenticated;
