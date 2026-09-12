create or replace function public.sync_product_supplier_from_invoice_line()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_supplier_id uuid;
  v_issue_date date;
begin
  if new.product_id is null then
    return new;
  end if;

  select i.supplier_id, coalesce(i.issue_date, i.received_date, current_date)
    into v_supplier_id, v_issue_date
  from public.invoices i
  where i.id = new.invoice_id;

  if v_supplier_id is null then
    return new;
  end if;

  update public.products p
     set last_supplier_id = v_supplier_id,
         last_purchase_date = case
           when p.last_purchase_date is null or v_issue_date >= p.last_purchase_date then v_issue_date
           else p.last_purchase_date
         end,
         updated_at = now()
   where p.id = new.product_id
     and p.owner_id = new.owner_id
     and (p.last_purchase_date is null or v_issue_date >= p.last_purchase_date);

  update public.product_price_history h
     set supplier_id = v_supplier_id
   where h.invoice_line_id = new.id
     and h.supplier_id is distinct from v_supplier_id;

  return new;
end;
$function$;

drop trigger if exists invoice_lines_sync_product_supplier on public.invoice_lines;
create trigger invoice_lines_sync_product_supplier
after insert or update of product_id, invoice_id on public.invoice_lines
for each row execute function public.sync_product_supplier_from_invoice_line();

create or replace function public.sync_invoice_supplier_to_products()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_issue_date date;
begin
  if new.supplier_id is null or new.supplier_id is not distinct from old.supplier_id then
    return new;
  end if;

  v_issue_date := coalesce(new.issue_date, new.received_date, current_date);

  update public.product_price_history h
     set supplier_id = new.supplier_id
   where h.invoice_id = new.id
     and h.supplier_id is distinct from new.supplier_id;

  update public.products p
     set last_supplier_id = new.supplier_id,
         last_purchase_date = case
           when p.last_purchase_date is null or v_issue_date >= p.last_purchase_date then v_issue_date
           else p.last_purchase_date
         end,
         updated_at = now()
   where exists (
     select 1
     from public.invoice_lines il
     where il.invoice_id = new.id
       and il.product_id = p.id
       and il.owner_id = p.owner_id
   )
     and (p.last_purchase_date is null or v_issue_date >= p.last_purchase_date);

  return new;
end;
$function$;

drop trigger if exists invoices_sync_product_supplier on public.invoices;
create trigger invoices_sync_product_supplier
after update of supplier_id on public.invoices
for each row execute function public.sync_invoice_supplier_to_products();
