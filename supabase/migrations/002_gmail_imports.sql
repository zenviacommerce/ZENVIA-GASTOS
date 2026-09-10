alter table public.gmail_imports
  add column if not exists attachment_id text,
  add column if not exists attachment_mime_type text,
  add column if not exists attachment_size integer;

create unique index if not exists gmail_imports_owner_message_attachment_uidx
  on public.gmail_imports (owner_id, gmail_message_id, attachment_id)
  where attachment_id is not null;

create index if not exists gmail_imports_owner_received_idx
  on public.gmail_imports (owner_id, received_at desc);
