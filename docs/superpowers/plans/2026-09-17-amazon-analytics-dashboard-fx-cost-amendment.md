# Amazon Analytics Dashboard Plan Amendment — Historical Cost FX

This amendment is part of `docs/superpowers/plans/2026-09-17-amazon-analytics-dashboard.md` and must be read with it during execution.

Production verification on 2026-09-17 shows the current `product_price_history` rows are all EUR, so this refinement does not change current results. It closes the future non-EUR cost case while preserving the approved rule that every dashboard monetary value is reported in EUR and missing FX makes profitability incomplete.

## Task 4 correction

Replace the planned helper:

`private.amazon_historical_unit_cost(owner uuid, product uuid, event_date date) returns numeric`

with:

`private.amazon_historical_unit_cost_eur(owner uuid, product uuid, event_date date) returns numeric`

The helper must first select the latest historical price row with `price_date <= event_date`, then convert that row using the FX rate valid on the **historical purchase price date**, not the Amazon sale date.

Required SQL shape:

```sql
create or replace function private.amazon_historical_unit_cost_eur(
  p_owner uuid,
  p_product uuid,
  p_event_date date
)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  with historical as (
    select h.normalized_unit_price,
           upper(coalesce(h.currency,'EUR')) as currency_code,
           h.price_date
    from public.product_price_history h
    where h.owner_id=p_owner
      and h.product_id=p_product
      and h.normalized_unit_price is not null
      and h.price_date <= p_event_date
    order by h.price_date desc, h.created_at desc, h.id desc
    limit 1
  )
  select historical.normalized_unit_price
         * private.amazon_rate_to_eur(historical.currency_code,historical.price_date)
  from historical;
$$;
```

For EUR, `private.amazon_rate_to_eur` deterministically returns `1`. If the selected historical cost is non-EUR and no acceptable rate exists within the approved seven-day lookback, the helper returns null and profitability is incomplete.

## Completeness correction

`missingFxEventCount` must include both:

1. order/Finance monetary events whose currency cannot be converted to EUR; and
2. mapped product-cost rows whose selected `product_price_history.currency` cannot be converted using `price_date`.

Do not classify a missing product-cost FX rate as `missingHistoricalCost`; the historical cost exists, but its EUR conversion is incomplete.

## Tests

The Task 4 regression test must additionally assert that the RPC migration references `product_price_history.currency`, uses `price_date` for historical-cost FX, and contains `amazon_historical_unit_cost_eur`.

Add a data-level case during production smoke testing where a temporary non-EUR historical cost fixture resolves with the FX rate from its purchase-price date; remove the fixture after verification. Do not alter real production purchase history for this test.