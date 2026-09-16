# Amazon Analytics V1 — Mandatory Self-Review Amendments

These amendments were found during the final cross-plan review. They are mandatory implementation details and supplement the phase plans without changing the approved user-facing scope.

**Read with:**

- `docs/superpowers/specs/2026-09-16-amazon-analytics-design.md`
- `docs/superpowers/plans/2026-09-16-amazon-analytics-v1-execution-index.md`

## Amendment 1 — Recover stale `running` sync jobs

### Why

An Edge Function can terminate after atomically claiming a job and before it calls the finish RPC. Without a lease-expiry path, that row can remain `running` forever and the backfill/hourly pipeline silently stalls.

### Required implementation

During Phase B Task 2/8, add:

**Files:**
- Create: `supabase/migrations/20260916171150_amazon_sync_queue_recovery.sql`
- Modify: `scripts/amazon-sync-queue.test.mjs`
- Modify: `supabase/functions/amazon-sync-worker/index.ts`

Create a service-role-only RPC:

```sql
create or replace function public.requeue_stale_amazon_sync_jobs(
  p_stale_after interval default interval '15 minutes'
)
returns table(requeued integer, failed integer)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_requeued integer := 0;
  v_failed integer := 0;
begin
  with moved as (
    update public.amazon_sync_jobs
       set status='queued',
           available_at=now(),
           locked_at=null,
           locked_by=null,
           last_error='Worker lease expired; requeued automatically',
           updated_at=now()
     where status='running'
       and locked_at < now()-p_stale_after
       and attempts < max_attempts
     returning 1
  ) select count(*) into v_requeued from moved;

  with exhausted as (
    update public.amazon_sync_jobs
       set status='failed',
           locked_at=null,
           locked_by=null,
           last_error='Worker lease expired after maximum attempts',
           updated_at=now()
     where status='running'
       and locked_at < now()-p_stale_after
       and attempts >= max_attempts
     returning 1
  ) select count(*) into v_failed from exhausted;

  return query select v_requeued,v_failed;
end;
$$;
```

Revoke from `public`, `anon`, and `authenticated`; grant only to `service_role`.

Before claiming a new batch, `amazon-sync-worker` calls this RPC once. Do not requeue a fresh `running` job merely because another worker is active.

### Required test

`amazon-sync-queue.test.mjs` must assert:

- stale threshold exists;
- fresh running jobs are untouched;
- stale jobs under max attempts become queued and locks clear;
- stale exhausted jobs become failed;
- RPC is service-role only;
- worker calls recovery before claim.

## Amendment 2 — Use marketplace business dates consistently

### Why

Orders/finance timestamps are timestamps, while Amazon Ads reports are day-grained in an advertising profile's marketplace context. Using UTC `::date` blindly can move late-night orders into a different calendar day from Ads and produce hard-to-explain daily/period totals, especially across UK/CET/EET marketplaces.

### Required implementation

During Phase B core schema/discovery, add the following normalized fields:

```text
amazon_marketplaces.timezone_name text not null
amazon_orders.purchase_business_date date not null
amazon_orders.update_business_date date
amazon_finance_transactions.posted_business_date date not null
```

Keep original UTC timestamps too. `amazon_order_items` derives business date by joining its order; do not duplicate it unless a measured query-performance need appears.

Create server utility:

**File:** `supabase/functions/_shared/amazon/marketplaces.ts`

```ts
export type AmazonMarketplaceMeta={
  marketplaceId:string;
  countryCode:string;
  currencyCode:string;
  timeZone:string;
};

export function businessDate(instant:string,timeZone:string):string;
```

The marketplace metadata map must be keyed by Amazon `marketplace_id`, not merely by browser locale. Cover every marketplace actually returned by Sellers API. Known/allowed metadata is committed as non-secret code and tests; an unknown marketplace must be surfaced as unsupported/unmapped rather than silently assigned another country's timezone.

`businessDate` should use an IANA timezone and produce `YYYY-MM-DD` without depending on the Edge Function machine timezone.

### Required tests

Create `scripts/amazon-marketplace-dates.test.mjs` with cases around UTC midnight, for example:

```text
2026-09-16T22:30:00Z -> 2026-09-17 in Europe/Madrid
2026-09-16T22:30:00Z -> 2026-09-16 in Europe/London (when DST offset keeps it before midnight)
```

Use dates/offsets that are valid for the tested DST period and derive the expected value with `Intl.DateTimeFormat` in the test rather than hard-coding an incorrect seasonal offset.

Orders/finance normalizers persist the corresponding business date. Dashboard period/date filters and daily time-series RPCs use business dates, not UTC casts.

### Ads alignment

`amazon_ad_metrics_daily.date` is the source report date for its mapped profile/marketplace and is treated as that marketplace's business date. Do not convert an Ads report date through UTC.

When an Ads profile is `unmapped`, its rows must not be silently included in a marketplace/day comparison.

## Amendment 3 — Product filter must search ZENVIA name/SKU and Amazon SKU/ASIN

### Why

The approved dashboard filter is searchable by product name, SKU or ASIN. A mapped product can have one ZENVIA SKU and multiple marketplace-specific Amazon seller SKUs/ASINs.

### Required implementation

In Phase E `amazon_filter_options()` return mapped product options with search metadata:

```json
{
  "id":"<zenvia-product-uuid>",
  "name":"Film 45 cm",
  "sku":"ZENVIA-SKU",
  "sellerSkus":["AMZ-SKU-ES","AMZ-SKU-DE"],
  "asins":["B0...","B0..." ]
}
```

Deduplicate the arrays. `AmazonFilters` builds `SearchableSelect.searchText` from:

```ts
[option.sku,...option.sellerSkus,...option.asins].filter(Boolean).join(' ')
```

The selected value remains the ZENVIA `product_id`, so existing aggregate RPC signatures do not need an overloaded string id.

Unmapped Amazon SKUs/ASINs remain visible in the data-quality/mapping section; they cannot truthfully select a ZENVIA product filter until mapped.

## Amendment 4 — COGS currency is part of completeness

Phase C has been updated inline to make this explicit. During implementation verify the final code still satisfies:

```text
1. choose historical source cost with price_date <= sale/reference date;
2. if source currency is EUR, unit_cost_eur = source cost;
3. otherwise choose ECB rate on-or-before the historical price_date;
4. unit_cost_eur = source cost * eur_rate;
5. missing source cost OR missing purchase-date FX => COGS incomplete.
```

Never convert a historical supplier USD/GBP/etc cost with the later Amazon sale-date FX rate and never treat the raw non-EUR number as EUR.

## Amendment 5 — Final release must test scheduler authentication end-to-end

The Phase E plan uses a publishable key for the Supabase function gateway plus a separate high-entropy `x-amazon-cron-secret`. During verification, test both paths against the deployed worker/orchestrator:

```text
valid apikey + valid cron secret     -> accepted
valid apikey + missing cron secret   -> rejected
valid apikey + wrong cron secret     -> rejected
```

Do not weaken the Edge Function to make Cron work. If the project's current Edge gateway configuration requires an explicit function auth setting, configure it so the publishable key can reach the function while the custom cron secret remains the actual authorization check for these internal scheduled actions.

The cron secret itself exists only in Supabase Edge secrets + Vault and never in Git/Vercel/browser configuration.

## Self-review acceptance

These amendments are satisfied only when their tests are included in the normal repository command:

```bash
node --test scripts/*.test.mjs
```

and the final production reconciliation uses marketplace business dates and currency-aware COGS when explaining sampled profitability.
