create or replace function public.capture_confirmed_product_price()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_supplier_id uuid;
  v_issue_date date;
  v_currency text;
  v_base_unit text;
  v_latest_cost numeric;
  v_previous_cost numeric;
  v_latest_supplier_id uuid;
  v_latest_date date;
  v_latest_base_unit text;
begin
  if new.product_id is not null
     and new.price_update_status = 'confirmed'
     and new.normalized_unit_price is not null
     and (
       tg_op = 'INSERT'
       or old.price_update_status is distinct from 'confirmed'
       or old.normalized_unit_price is distinct from new.normalized_unit_price
     ) then

    select i.supplier_id, coalesce(i.issue_date, i.received_date), i.currency
      into v_supplier_id, v_issue_date, v_currency
    from public.invoices i
    where i.id = new.invoice_id;

    select p.base_unit into v_base_unit
    from public.products p
    where p.id = new.product_id;

    insert into public.product_price_history (
      owner_id, product_id, supplier_id, invoice_id, invoice_line_id,
      price_date, purchase_unit_price, normalized_unit_price, base_unit, currency
    ) values (
      new.owner_id, new.product_id, v_supplier_id, new.invoice_id, new.id,
      coalesce(v_issue_date, current_date), new.unit_price, new.normalized_unit_price,
      coalesce(v_base_unit, new.unit, 'ud'), coalesce(v_currency, 'EUR')
    )
    on conflict (invoice_line_id) do update set
      supplier_id = excluded.supplier_id,
      price_date = excluded.price_date,
      purchase_unit_price = excluded.purchase_unit_price,
      normalized_unit_price = excluded.normalized_unit_price,
      base_unit = excluded.base_unit,
      currency = excluded.currency;

    select h.normalized_unit_price, h.supplier_id, h.price_date, h.base_unit
      into v_latest_cost, v_latest_supplier_id, v_latest_date, v_latest_base_unit
    from public.product_price_history h
    where h.product_id = new.product_id
      and h.owner_id = new.owner_id
      and h.normalized_unit_price is not null
    order by h.price_date desc, h.created_at desc, h.id desc
    limit 1;

    v_previous_cost := null;
    select h.normalized_unit_price
      into v_previous_cost
    from public.product_price_history h
    where h.product_id = new.product_id
      and h.owner_id = new.owner_id
      and h.normalized_unit_price is not null
    order by h.price_date desc, h.created_at desc, h.id desc
    offset 1
    limit 1;

    update public.products p
       set previous_cost = v_previous_cost,
           last_cost = v_latest_cost,
           cost_unit = coalesce(v_latest_base_unit, v_base_unit, new.unit, 'ud'),
           last_supplier_id = v_latest_supplier_id,
           last_purchase_date = v_latest_date,
           updated_at = now()
     where p.id = new.product_id
       and p.owner_id = new.owner_id;
  end if;

  return new;
end;
$function$;

-- Repair snapshots that may have interpreted a technical correction as a new price change.
with ranked as (
  select
    h.owner_id,
    h.product_id,
    h.normalized_unit_price,
    h.supplier_id,
    h.price_date,
    h.base_unit,
    row_number() over (
      partition by h.owner_id, h.product_id
      order by h.price_date desc, h.created_at desc, h.id desc
    ) as rn
  from public.product_price_history h
  where h.normalized_unit_price is not null
), latest as (
  select * from ranked where rn = 1
), previous as (
  select * from ranked where rn = 2
)
update public.products p
   set last_cost = latest.normalized_unit_price,
       previous_cost = previous.normalized_unit_price,
       cost_unit = coalesce(latest.base_unit, p.cost_unit, p.base_unit, 'ud'),
       last_supplier_id = latest.supplier_id,
       last_purchase_date = latest.price_date,
       updated_at = now()
from latest
left join previous
  on previous.owner_id = latest.owner_id
 and previous.product_id = latest.product_id
where p.owner_id = latest.owner_id
  and p.id = latest.product_id
  and (
    p.last_cost is distinct from latest.normalized_unit_price
    or p.previous_cost is distinct from previous.normalized_unit_price
    or p.last_supplier_id is distinct from latest.supplier_id
    or p.last_purchase_date is distinct from latest.price_date
  );
