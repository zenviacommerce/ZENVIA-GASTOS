-- Keep the customer role minimal on support tickets.
-- Replies are inserted into support_messages; ticket lifecycle mutations are Platform-only.

revoke all privileges on table public.support_tickets from authenticated;
grant select,insert on table public.support_tickets to authenticated;

notify pgrst,'reload schema';
