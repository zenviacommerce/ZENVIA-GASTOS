create or replace function public.reopen_gmail_import_after_invoice_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.invoice_id is not null
     and new.invoice_id is null
     and new.status = 'imported' then
    new.status := 'found';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'reopenReason', 'invoice_deleted',
      'reopenedAt', now()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists gmail_import_reopen_after_invoice_delete on public.gmail_imports;

create trigger gmail_import_reopen_after_invoice_delete
before update of invoice_id on public.gmail_imports
for each row
execute function public.reopen_gmail_import_after_invoice_delete();

update public.gmail_imports
set status = 'found',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'reopenReason', 'invoice_deleted',
      'reopenedAt', now()
    )
where status = 'imported'
  and invoice_id is null;
