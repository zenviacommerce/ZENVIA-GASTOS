# Amazon Phase C — Product Mapping, FX, COGS and Profitability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link Amazon SKUs/ASINs to ZENVIA products, convert non-EUR amounts consistently, apply historical purchase cost by sale date, and expose auditable profitability aggregates before Ads is added.

**Architecture:** Mapping is explicit and marketplace-qualified. Automatic mapping is allowed only for an exact, unique SKU match; ambiguous/unmatched products remain unresolved. FX and COGS are resolved server-side in Postgres/Edge synchronization, and aggregate RPCs return already-filtered metrics so the browser never downloads the raw year to calculate profitability.

**Tech Stack:** Supabase Postgres/RLS/RPC, Supabase Edge Functions, ECB reference FX rates, existing `products` and `product_price_history`, React/TypeScript admin mapping UI, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-16-amazon-analytics-design.md`

## Global Constraints

- Amazon SKU uniqueness is scoped by marketplace; never assume global uniqueness.
- Resolution order is manual mapping, then exact unique ZENVIA SKU, otherwise unresolved.
- No fuzzy matching.
- Historical COGS uses the most recent confirmed `product_price_history.normalized_unit_price` with `price_date <= sale reference date`.
- A later purchase cost must never be back-applied to an earlier sale.
- Missing historical cost remains NULL / `COGS pendiente`; do not substitute current `products.last_cost`.
- Respect `product_price_history.currency`. A non-EUR historical cost must be converted to EUR with the FX rate applicable on the **purchase-cost date (`price_date`)** before it enters consolidated COGS. Never treat a USD/GBP/etc numeric cost as if it were EUR.
- If the historical cost exists but the required FX rate is missing, that COGS remains unresolved and contributes to data-quality warnings until FX reconciliation succeeds.
- Original currency and amount remain stored; EUR conversion is auditable by date/rate.
- Define `fx_rates_daily.eur_rate` as **EUR per 1 unit of source currency**. Therefore `amount_eur = amount_original * eur_rate` and EUR has rate `1`.
- ECB source data commonly expresses foreign currency per EUR; invert that published rate before persisting `eur_rate`.
- Weekend/holiday conversion uses the latest prior available ECB date.
- Profitability before Ads is explicitly partial and must not be presented as final channel profit until Phase D is complete.

---

### Task 1: Add product mappings and FX schema

**Files:**
- Create: `supabase/migrations/20260916172000_amazon_mapping_fx.sql`
- Create: `scripts/amazon-mapping-fx-schema.test.mjs`

**Interfaces:**
- Produces `amazon_product_mappings`.
- Produces `fx_rates_daily`.
- Mapping SELECT requires `amazon`; direct authenticated writes are revoked.
- FX SELECT may be granted to authenticated Amazon users; writes remain service role only.

- [ ] **Step 1: Write failing schema test**

Assert migration creates both tables, mapping key is marketplace-qualified, `product_id` references `products(id)`, and `eur_rate` is positive. Assert direct authenticated mapping mutation is not granted.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-mapping-fx-schema.test.mjs`

- [ ] **Step 3: Create mapping table**

Use:

```sql
create table public.amazon_product_mappings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  marketplace_id text not null,
  seller_sku text not null,
  asin text,
  product_id uuid references public.products(id) on delete set null,
  mapping_source text not null default 'manual' check (mapping_source in ('manual','sku_exact','asin_manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,marketplace_id,seller_sku)
);
```

Add index `(owner_id,product_id)` and `set_updated_at` trigger.

- [ ] **Step 4: Create FX table**

Use:

```sql
create table public.fx_rates_daily (
  date date not null,
  currency_code text not null,
  eur_rate numeric(20,10) not null check (eur_rate>0),
  source text not null default 'ECB' check (source='ECB'),
  created_at timestamptz not null default now(),
  primary key(date,currency_code)
);
```

Insert/upsert EUR rate 1 for the historical range as dates are requested rather than pre-generating all days.

- [ ] **Step 5: Add RLS/grants**

Mapping rows: SELECT only when owner workspace + `amazon`; authenticated INSERT/UPDATE/DELETE revoked. `fx_rates_daily` contains no tenant data, but expose it only through aggregate functions or grant SELECT as needed; service role owns writes.

- [ ] **Step 6: Run test and commit**

Run: `node --test scripts/amazon-mapping-fx-schema.test.mjs`

Commit message: `feat: add amazon product mapping and fx schema`

---

### Task 2: Implement ECB FX synchronization and deterministic conversion

**Files:**
- Create: `supabase/functions/_shared/amazon/fx.ts`
- Create: `supabase/functions/amazon-sync-fx/index.ts`
- Modify: `supabase/functions/amazon-sync-worker/index.ts`
- Modify: `supabase/functions/amazon-sync-orchestrator/index.ts`
- Create: `scripts/amazon-fx.test.mjs`

**Interfaces:**
- `parseEcbHistoricalCsv(csv:string): Array<{date:string;currencyCode:string;eurRate:number}>`
- `findRateOnOrBefore(rates,date,currency): number|null`
- `runFxJob(admin,job): Promise<{rows:number;highWaterMark:string|null}>`

- [ ] **Step 1: Write real pure-function tests**

Use an inline ECB-style CSV fixture such as:

```text
Date,USD,GBP,PLN,SEK
2026-01-05,1.2000,0.8000,4.0000,10.0000
2026-01-02,1.2500,0.833333,4.166667,10.416667
```

Assert persisted EUR-per-unit values are inverted: USD `0.833333...` for 1.20 USD/EUR; GBP `1.25` for 0.8 GBP/EUR. Assert EUR is exactly 1. Assert a weekend date resolves to the last prior row.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-fx.test.mjs`

- [ ] **Step 3: Implement pure parser**

Use the ECB historical CSV endpoint `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.csv`. Parse only currencies needed by active Amazon marketplaces plus any currency present in finance/order rows and historical `product_price_history` used by mapped products. Reject non-finite or non-positive rates.

- [ ] **Step 4: Implement FX job**

Fetch the ECB dataset server-side, keep rows from `2026-01-01`, convert published foreign-currency-per-EUR rates to `eur_rate=1/published_rate`, and upsert. Add EUR=1 for each requested conversion date or handle EUR as a hard-coded 1 in conversion SQL.

- [ ] **Step 5: Add FX jobs to worker/orchestrator**

Bootstrap enqueues one `fx/global` job before profitability reconciliation. Hourly runs enqueue FX only when a required currency/date is missing; do not refetch the full file on every dashboard view.

- [ ] **Step 6: Run test and commit**

Commit message: `feat: sync amazon fx rates from ecb`

---

### Task 3: Auto-resolve exact SKU mappings and admin manual mappings

**Files:**
- Create: `supabase/functions/amazon-product-mappings/index.ts`
- Create: `src/services/amazonMappings.ts`
- Create: `src/components/AmazonProductMappings.tsx`
- Modify: `src/pages/Amazon.tsx`
- Create: `scripts/amazon-product-mapping.test.mjs`

**Interfaces:**
- Admin Edge actions: `list`, `auto_resolve`, `set`, `clear`.
- `set` input: `{marketplaceId:string,sellerSku:string,asin?:string|null,productId:string}`.
- Non-admin users can view mapping status through RLS/aggregate service but cannot call mutations.

- [ ] **Step 1: Write failing source/logic tests**

Assert automatic resolver uses exact normalized SKU equality only and refuses ambiguity. Include fixture logic where two products share the same normalized SKU and ensure result is unresolved.

Normalization for matching is limited to `trim().toLowerCase()`; do not strip punctuation or perform fuzzy similarity.

- [ ] **Step 2: Implement server auto-resolve**

Collect distinct `(marketplace_id,seller_sku,asin)` from order items. Query `products(id,sku)` for owner. Build map from normalized SKU to product ids. Auto-upsert only when exactly one product id exists and no manual mapping row already owns that marketplace/SKU.

Manual mappings always win: never overwrite `mapping_source in ('manual','asin_manual')` during auto-resolve.

- [ ] **Step 3: Implement admin set/clear**

Authenticate admin. Ensure selected product belongs to caller workspace. Upsert `mapping_source='manual'`; `clear` deletes the mapping row and sets matching order-item `product_id` values to null, allowing a future exact resolver to act again. If an explicit long-term suppression behavior is later required, design a distinct `ignored` state rather than overloading a null manual mapping.

- [ ] **Step 4: Backfill `amazon_order_items.product_id`**

After mapping change, update all matching order items for owner + marketplace + seller SKU. Clearing sets those item `product_id` values to null.

- [ ] **Step 5: Build mapping UI**

`AmazonProductMappings` displays marketplace, SKU, ASIN, current ZENVIA product, source, and unresolved status. Use existing `SearchableSelect` for product selection. Show mutation controls only to admin; pass `isAdmin` from `App.tsx` to `AmazonPage`.

- [ ] **Step 6: Run tests/build and commit**

Run:

`node --test scripts/amazon-product-mapping.test.mjs`

`npm run build`

Commit message: `feat: link amazon skus to zenvia products`

---

### Task 4: Resolve the historical source cost

**Files:**
- Create: `supabase/migrations/20260916172100_amazon_cogs_helpers.sql`
- Create: `scripts/amazon-cogs.test.mjs`

**Interfaces:**
- Produces private SQL function `private.amazon_product_cost_at(p_owner_id uuid,p_product_id uuid,p_date date)` returning one row with `{source_unit_cost, source_currency, source_price_date}` or no row when no prior historical cost exists.
- Function is used only by later server-side profitability helpers; it is not exposed directly to anon/authenticated.

- [ ] **Step 1: Write failing SQL contract test**

Assert helper queries `product_price_history`, filters `price_date <= p_date`, orders `price_date desc, created_at desc`, `limit 1`, returns the stored `currency`, and does not reference `products.last_cost` as fallback.

- [ ] **Step 2: Implement source-cost helper**

Use a SQL STABLE function with explicit owner check:

```sql
create or replace function private.amazon_product_cost_at(
  p_owner_id uuid,
  p_product_id uuid,
  p_date date
)
returns table(source_unit_cost numeric, source_currency text, source_price_date date)
language sql
stable
security definer
set search_path=''
as $$
  select
    pph.normalized_unit_price,
    upper(pph.currency),
    pph.price_date
  from public.product_price_history pph
  where pph.owner_id=p_owner_id
    and pph.product_id=p_product_id
    and pph.price_date<=p_date
  order by pph.price_date desc, pph.created_at desc
  limit 1
$$;
```

Revoke execution from public/anon/authenticated; only internal/server-side functions need it.

- [ ] **Step 3: Verify against known product history**

After applying in verification environment, select one product with at least two historical costs and test dates before first cost, between costs, and after latest. Expected: no row, first historical cost, latest applicable cost respectively. Confirm returned currency/date match the actual price-history row.

- [ ] **Step 4: Run test and commit**

Run: `node --test scripts/amazon-cogs.test.mjs`

Commit message: `feat: resolve amazon historical source cost`

---

### Task 5: Normalize finance and historical product costs to EUR

**Files:**
- Create: `supabase/migrations/20260916172200_amazon_fx_resolution.sql`
- Modify: `supabase/functions/_shared/amazon/finance.ts`
- Create: `scripts/amazon-fx-resolution.test.mjs`

**Interfaces:**
- Produces private function `private.amazon_fx_rate_on_or_before(p_currency text,p_date date)`.
- Produces private function `private.amazon_product_cost_eur_at(p_owner_id uuid,p_product_id uuid,p_date date)` returning `{unit_cost_eur, source_unit_cost, source_currency, source_price_date, fx_rate}` or no row when source cost/FX is unresolved.
- Finance sync writes `amount_eur` and `fx_rate` when rate exists.
- Reconciliation RPC can backfill previously-null finance EUR values after FX arrives.

- [ ] **Step 1: Write failing contract tests**

Assert FX lookup selects latest FX date `<= p_date`; EUR returns 1; multiplication direction is `amount_original * eur_rate`.

Assert the product-cost EUR helper first chooses historical cost by **sale/reference date**, then converts the selected source cost using FX on the selected `source_price_date`:

```text
unit_cost_eur = source_unit_cost * fx_rate(source_currency, source_price_date)
```

It must not use the sale date as the FX date for a historical purchase cost.

- [ ] **Step 2: Implement FX lookup/reconciliation**

Create `private.amazon_fx_rate_on_or_before`. Create service-role-only RPC `public.reconcile_amazon_finance_fx(p_owner_id uuid,p_from date,p_to date)` that updates rows with missing/stale FX from that helper.

- [ ] **Step 3: Implement currency-aware historical COGS helper**

Use `private.amazon_product_cost_at(...)` as the source selector, then:

- source currency `EUR` → `fx_rate=1`;
- otherwise call `private.amazon_fx_rate_on_or_before(source_currency, source_price_date)`;
- no FX row → return no resolved EUR cost and let data-quality logic count it.

Return both the EUR result and source audit fields so a reconciliation query can explain exactly which purchase cost/rate was used.

- [ ] **Step 4: Update finance synchronization**

When normalized finance event is received, resolve FX after ensuring relevant FX job has run; if rate is missing, persist original data with null EUR and let reconciliation fill it. Missing FX must not fail the entire finance job.

- [ ] **Step 5: Test signs and purchase-cost currencies**

Verify finance signs are preserved: `-10 GBP * 1.25 = -12.50 EUR`.

Verify historical COGS example: a `10.00 USD` source cost dated on a day whose stored `eur_rate` is `0.80` resolves to `8.00 EUR/unit`, regardless of the later Amazon sale-date FX rate.

- [ ] **Step 6: Commit**

Run: `node --test scripts/amazon-fx-resolution.test.mjs scripts/amazon-cogs.test.mjs`

Commit message: `feat: resolve amazon finance and cogs to eur`

---

### Task 6: Build server-side profitability base aggregates without Ads

**Files:**
- Create: `supabase/migrations/20260916172300_amazon_profitability_rpc.sql`
- Create: `scripts/amazon-profitability-sql.test.mjs`
- Create: `src/services/amazonAnalytics.ts`

**Interfaces:**
- Produces RPCs:
  - `amazon_profit_summary(p_from date,p_to date,p_marketplace_id text default null,p_product_id uuid default null)`
  - `amazon_profit_by_marketplace(...)`
  - `amazon_profit_by_product(...,p_limit integer,p_offset integer)`
  - `amazon_profit_data_quality(...)`
- Phase C responses include `ads_complete=false` / `profit_complete=false` semantics so UI cannot call partial contribution profit final.

- [ ] **Step 1: Write failing SQL contract test**

Assert the RPC SQL:

- derives sales from order-item monetary components, not by adding finance `sale` rows on top;
- derives refunds/fees from finance ledger;
- separates `fba_fee` from non-FBA fees;
- calls `private.amazon_product_cost_eur_at` with order sale/reference date rather than using raw `normalized_unit_price` as EUR;
- leaves COGS incomplete when a mapped item lacks a prior cost **or required purchase-cost FX**;
- has `security invoker` or explicit workspace/permission guard;
- accepts from/to and marketplace/product filters.

- [ ] **Step 2: Define order-item sales CTE**

For each order item compute in original currency:

```text
gross_sales = item_price + shipping_price - promotion_discount
vat_amount = item_tax + shipping_tax
net_sales_ex_vat = gross_sales - vat_amount
```

Convert components to EUR using rate on order purchase date. Exclude cancelled orders from realized sales unless Amazon's financial ledger indicates otherwise; document any status exception discovered during live reconciliation.

- [ ] **Step 3: Define fee/refund CTEs**

From `amazon_finance_transactions`, aggregate negative/positive signs consistently into positive **cost magnitudes** returned by the RPC:

- `refunds_ex_vat`
- `non_fba_amazon_fees`
- `fba_costs`

Do not include finance `sale` amount in gross sales again.

- [ ] **Step 4: Define currency-aware COGS CTE**

For each mapped order item call `private.amazon_product_cost_eur_at(owner_id, product_id, sale_reference_date)` and multiply `unit_cost_eur` by quantity. Track separately:

- `cogs_missing_units`: no prior historical cost;
- `cogs_fx_missing_units`: historical non-EUR cost exists but required purchase-date FX is missing.

`cogs` may sum only resolved EUR costs. Response includes `cogs_complete = (cogs_missing_units=0 and cogs_fx_missing_units=0)`.

- [ ] **Step 5: Define Phase C partial profit**

Return:

```text
profit_before_ads = net_sales_ex_vat
                  - refunds_ex_vat
                  - non_fba_amazon_fees
                  - fba_costs
                  - cogs
```

Do **not** name it `amazon_profit` yet. Return `ads_complete=false` and `profit_complete=false` until Phase D adds Ads.

- [ ] **Step 6: Add product pagination and quality counts**

Product rows include mapping, ASIN, SKU, marketplace, units, sales, fees, COGS, missing COGS units, missing purchase-cost FX units, and `profit_before_ads`. Quality RPC reports unmapped SKU count/revenue, missing-COGS units/revenue, missing purchase-cost FX, and missing Amazon transaction/order FX.

- [ ] **Step 7: Implement typed frontend service**

`src/services/amazonAnalytics.ts` wraps `supabase.rpc(...)` and maps snake_case to typed camelCase structures. The service performs no business arithmetic beyond display-safe formatting.

- [ ] **Step 8: Run test/build and commit**

Run:

`node --test scripts/amazon-profitability-sql.test.mjs`

`npm run build`

Commit message: `feat: aggregate amazon profitability before ads`

---

### Task 7: Phase C verification gate

**Files:**
- No planned production changes.

**Interfaces:**
- Phase D may assume mappings, historical COGS, FX, and server-side non-Ads profitability are working.

- [ ] **Step 1: Run complete automated suite**

Run:

`node --test scripts/*.test.mjs`

`npm run build`

- [ ] **Step 2: Verify exact mapping behavior with production-like catalog sample**

Choose at least one unique exact SKU, one Amazon SKU absent in products, and one intentionally ambiguous duplicate SKU fixture. Verify only the unique exact SKU auto-maps.

- [ ] **Step 3: Verify historical COGS against invoices**

Choose at least three sales dates around known `product_price_history` changes. Manually compare the chosen source cost to the latest confirmed purchase cost on/before each sale date. Include at least one non-EUR historical price if such a mapped product exists; verify its COGS uses FX on `price_date`, not the Amazon sale date. If all real mapped purchase history is EUR, use a verification fixture for this currency branch.

- [ ] **Step 4: Verify FX math**

Pick a GBP or PLN Amazon transaction date and compare persisted `eur_rate` with the corresponding ECB publication inverted to EUR-per-currency. Also verify one non-EUR purchase-cost conversion when available.

- [ ] **Step 5: Reconcile a marketplace/day without Ads**

For one marketplace/day, explain gross sales, VAT, refunds, referral/non-FBA fees, FBA costs, EUR-normalized COGS, and `profit_before_ads`. Confirm finance `sale` events are not double-counted with order sales.

- [ ] **Step 6: Confirm partial-profit labelling**

Until Phase D is deployed, no UI text may present `profit_before_ads` as final `Beneficio Amazon`.
