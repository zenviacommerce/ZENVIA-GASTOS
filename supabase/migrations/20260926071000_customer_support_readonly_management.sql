-- Customer-side support is conversational only.
-- Ticket management (edit/status/priority/delete) is reserved for the independent ZENVIA Platform bridge.

drop policy if exists support_tickets_admin_update on public.support_tickets;
drop policy if exists support_tickets_admin_delete on public.support_tickets;

revoke update,delete on public.support_tickets from authenticated;

-- Keep customer capabilities explicit: authenticated users can read/create tickets
-- according to RLS and add replies/attachments. Platform uses service-role through
-- the authenticated server-to-server bridge and is unaffected by these grants.
grant select,insert on public.support_tickets to authenticated;

notify pgrst,'reload schema';
