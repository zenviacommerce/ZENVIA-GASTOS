# Amazon Phase B — SP-API Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the secure, resumable Amazon SP-API backend that discovers EU marketplaces and synchronizes orders, finance transactions, and FBA inventory from 01/01/2026 without buyer PII.

**Architecture:** Amazon credentials live only in Supabase server-side secrets. Edge Functions call the EU SP-API endpoint with short-lived LWA access tokens and write normalized rows with service-role access. A Postgres job queue (`amazon_sync_jobs`) provides atomic claiming, retries, checkpoints, and backfill resumability; the frontend never calls Amazon directly.

**Tech Stack:** Supabase Postgres/RLS, Supabase Edge Functions (Deno + `@supabase/supabase-js`), Amazon SP-API EU endpoint, React/Vite only for connection-status display, Node `node:test` source/logic tests.

**Spec:** `docs/superpowers/specs/2026-09-16-amazon-analytics-design.md`

## Global Constraints

- Initial historical boundary is exactly `2026-01-01T00:00:00Z`.
- Region is EU and endpoint is `https://sellingpartnerapi-eu.amazon.com`.
- Use non-restricted SP-API operations only; do not request buyer name, address, email, phone, or payment PII.
- SP-API authentication uses LWA credentials/refresh token server-side; never put Amazon secrets in `VITE_*`, source code, response payloads, or public tables.
- All normalized rows carry `owner_id`; all authenticated reads require `private.app_has_permission('amazon')`.
- Ledger/sync writes are service-role only; browser users receive SELECT only where required.
- All sync operations are idempotent and safe to replay with overlap.
- Jobs are claimed atomically; checkpoint/high-water marks advance only after successful source work.
- One source failing must not mark unrelated source jobs as failed.
- Backfill is chunked and reanudable; no single Edge Function processes the whole year.

---

### Task 1: Add the Amazon core schema and RLS

**Files:**
- Create: `supabase/migrations/20260916171000_amazon_core_schema.sql`
- Create: `scripts/amazon-core-schema.test.mjs`

**Interfaces:**
- Produces tables: `amazon_accounts`, `amazon_marketplaces`, `amazon_orders`, `amazon_order_items`, `amazon_finance_transactions`, `amazon_inventory_current`, `amazon_inventory_daily`, `amazon_sync_runs`, `amazon_sync_state`, `amazon_sync_jobs`.
- Produces read policies for `amazon` permission; no authenticated client INSERT/UPDATE/DELETE on ledger/sync tables.

- [ ] **Step 1: Write the failing schema-contract test**

The Node test reads the migration and asserts all required tables exist, every business/sync table includes `owner_id`, RLS is enabled, and `private.app_has_permission('amazon')` appears in SELECT policies. It must also assert no field names matching `buyer_name|buyer_email|buyer_phone|shipping_address|billing_address|customer_name|customer_email|customer_phone` are introduced in Amazon tables.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test scripts/amazon-core-schema.test.mjs`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement account and marketplace tables**

Create:

```sql
create table public.amazon_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  seller_id text not null,
  display_name text not null default 'Amazon',
  region text not null default 'EU' check (region='EU'),
  status text not null default 'pending' check (status in ('pending','connected','error','disabled')),
  initial_sync_from timestamptz not null default '2026-01-01T00:00:00Z',
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,seller_id)
);

create table public.amazon_marketplaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default private.app_workspace_owner_id(),
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  marketplace_id text not null,
  country_code text not null,
  name text not null,
  currency_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,amazon_account_id,marketplace_id)
);
```

Add indexes on owner/account/marketplace and `set_updated_at` triggers where appropriate.

- [ ] **Step 4: Implement order tables**

`amazon_orders` unique key: `(owner_id, marketplace_id, amazon_order_id)`.

Minimum normalized columns: purchase/update timestamps, order status, fulfillment channel, currency, `order_total`, `order_tax`, `promotion_discount`, `last_synced_at`.

`amazon_order_items` unique key: `(owner_id, marketplace_id, amazon_order_id, order_item_id)` and includes `asin`, `seller_sku`, quantities, item/ship price/tax/discount numeric columns, currency, nullable `product_id`, `last_synced_at`.

Do not add buyer/shipping fields.

- [ ] **Step 5: Implement finance ledger**

Create `amazon_finance_transactions` with:

```sql
transaction_key text not null,
marketplace_id text not null,
amazon_order_id text,
seller_sku text,
asin text,
posted_date timestamptz not null,
transaction_status text,
transaction_type text not null,
category text not null,
amount_original numeric(16,4) not null,
currency_code text not null,
amount_eur numeric(16,4),
fx_rate numeric(18,8),
metadata jsonb not null default '{}'::jsonb,
last_synced_at timestamptz not null default now(),
unique(owner_id,transaction_key)
```

Restrict `category` to the normalized vocabulary used by later profitability work: `sale`, `refund`, `referral_fee`, `fba_fee`, `storage_fee`, `other_fee`, `tax`, `adjustment`, `other`.

- [ ] **Step 6: Implement inventory tables**

`amazon_inventory_current` unique key: `(owner_id,marketplace_id,seller_sku)` with `asin`, `fulfillable`, `inbound`, `reserved`, `unfulfillable`, `researching`, `synced_at`.

`amazon_inventory_daily` unique key: `(owner_id,marketplace_id,seller_sku,snapshot_date)` with the same quantities and ASIN.

- [ ] **Step 7: Implement sync tables**

`amazon_sync_runs` stores source/mode/status/window/rows/error metadata.

`amazon_sync_state` unique key: `(owner_id,source,scope_key)` where `scope_key` is marketplace id, profile id, or `global`; store `high_water_mark`, `checkpoint jsonb`, `last_success_at`, `updated_at`.

`amazon_sync_jobs` stores `source`, `scope_key`, optional marketplace/profile ids, windows, status, attempts, `max_attempts default 5`, `available_at`, `locked_at`, `locked_by`, `last_error`, timestamps, and a deterministic `dedupe_key` unique per owner.

- [ ] **Step 8: Add RLS/grants**

Enable RLS on every Amazon table. For analytical tables, grant SELECT to authenticated and create policy:

```sql
using (
  owner_id=(select private.app_workspace_owner_id())
  and (select private.app_has_permission('amazon'))
)
```

Revoke authenticated writes to all Amazon ledger/sync tables. Mapping/config mutation is added in later phases through admin-only Edge/RPC paths, not generic table writes.

- [ ] **Step 9: Run focused test**

Run: `node --test scripts/amazon-core-schema.test.mjs`

Expected: PASS.

- [ ] **Step 10: Commit**

Commit message: `feat: add amazon core data schema`

---

### Task 2: Add atomic queue primitives

**Files:**
- Create: `supabase/migrations/20260916171100_amazon_sync_queue.sql`
- Create: `scripts/amazon-sync-queue.test.mjs`

**Interfaces:**
- Produces SQL RPC `public.claim_amazon_sync_jobs(p_worker_id text, p_limit integer)` callable only by service role.
- Produces SQL RPC `public.finish_amazon_sync_job(p_job_id uuid, p_status text, p_rows integer, p_error text, p_checkpoint jsonb)` callable only by service role.
- Produces helper uniqueness via `dedupe_key`.

- [ ] **Step 1: Write failing queue test**

Assert the migration contains `for update skip locked`, increments `attempts`, sets `locked_at/locked_by`, excludes jobs whose `available_at > now()`, and prevents authenticated/anon execution.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-sync-queue.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement atomic claiming**

Use one SQL function transaction with a CTE:

```sql
with picked as (
  select id
  from public.amazon_sync_jobs
  where status='queued'
    and available_at<=now()
    and attempts<max_attempts
  order by available_at,created_at
  for update skip locked
  limit greatest(1,least(p_limit,20))
)
update public.amazon_sync_jobs j
set status='running', attempts=j.attempts+1, locked_at=now(), locked_by=p_worker_id, updated_at=now()
from picked
where j.id=picked.id
returning j.*;
```

The RPC must be SECURITY DEFINER with fixed `search_path=''`, revoked from public/anon/authenticated, granted to `service_role` only.

- [ ] **Step 4: Implement finishing/retry semantics**

`finish_amazon_sync_job` must set `success` on success. On transient failure and attempts remaining, reset to `queued`, clear lock, and set `available_at` using bounded exponential minutes `least(60, power(2, attempts)::int)`; on terminal failure set `failed`. Store only sanitized `last_error` limited to 1000 characters.

- [ ] **Step 5: Run focused test and commit**

Run: `node --test scripts/amazon-sync-queue.test.mjs`

Expected: PASS.

Commit message: `feat: add resumable amazon sync queue`

---

### Task 3: Build shared Amazon server utilities and LWA/SP-API client

**Files:**
- Create: `supabase/functions/_shared/amazon/env.ts`
- Create: `supabase/functions/_shared/amazon/http.ts`
- Create: `supabase/functions/_shared/amazon/spApi.ts`
- Create: `supabase/functions/_shared/amazon/auth.ts`
- Create: `scripts/amazon-edge-contract.test.mjs`

**Interfaces:**
- `getServiceClient(): SupabaseClient`
- `getLwaAccessToken(): Promise<string>` with in-process cache until 5 minutes before expiry.
- `spApiJson<T>(path:string, options?:{method?:string;query?:URLSearchParams;body?:unknown}):Promise<T>`
- `authenticateAmazonViewer(req, admin, requiredAdmin?:boolean)` returning `{userId,dataOwnerId,role}`.

- [ ] **Step 1: Write the failing contract test**

Assert the shared client reads only server env names:

`AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_SPAPI_REFRESH_TOKEN`, `SUPABASE_URL`, and service-role secret fallback already used by current Edge Functions.

Assert no file under `src/` contains `AMAZON_LWA_CLIENT_SECRET` or `AMAZON_SPAPI_REFRESH_TOKEN`.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-edge-contract.test.mjs`

- [ ] **Step 3: Implement LWA token exchange**

POST `application/x-www-form-urlencoded` to `https://api.amazon.com/auth/o2/token` with `grant_type=refresh_token`, refresh token, client id, and client secret. Cache access token in module memory using returned `expires_in` minus 300 seconds.

Error messages returned to callers must not include response bodies that may echo secrets. Keep status and Amazon request id where safe.

- [ ] **Step 4: Implement SP-API request helper**

Use base URL `https://sellingpartnerapi-eu.amazon.com`. Add headers:

```ts
'x-amz-access-token': accessToken,
'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g,'').slice(0,15)+'Z',
'user-agent': 'ZENVIA-Gestion/1.0 (Language=TypeScript)',
'accept': 'application/json'
```

Follow current Amazon SP-API connection documentation: do not introduce legacy AWS IAM/SigV4 credentials unless the API documentation actually requires them during implementation verification.

On `429` or `5xx`, throw a typed/transient error carrying retry information; on `401/403`, throw a non-secret authentication/authorization error.

- [ ] **Step 5: Implement caller authentication helper**

Mirror the secure pattern in existing `sendcloud-orders`: validate bearer session with service client, read `app_users`, require active user and either admin or `permissions.includes('amazon')`; when `requiredAdmin` is true require role `admin`.

- [ ] **Step 6: Run focused test and commit**

Run: `node --test scripts/amazon-edge-contract.test.mjs`

Expected: PASS.

Commit message: `feat: add secure amazon sp-api client`

---

### Task 4: Discover account marketplaces and initialize backfill

**Files:**
- Create: `supabase/functions/amazon-sync-orchestrator/index.ts`
- Create: `supabase/functions/_shared/amazon/jobs.ts`
- Create: `scripts/amazon-orchestrator.test.mjs`

**Interfaces:**
- `enqueueJob(admin,{ownerId,source,scopeKey,marketplaceId?,windowFrom?,windowTo?,mode}):Promise<void>` creates an idempotent job using deterministic `dedupe_key`.
- Orchestrator action `bootstrap` discovers marketplaces and enqueues initial source windows.
- Orchestrator action `hourly` enqueues incremental windows from sync state.

- [ ] **Step 1: Write failing orchestrator test**

Assert bootstrap boundary literal `2026-01-01T00:00:00Z`, EU marketplace discovery, deterministic dedupe keys, and source isolation (`orders`, `finances`, `inventory`).

- [ ] **Step 2: Implement account bootstrap**

Use Sellers API marketplace-participation operation to retrieve the authorized seller's marketplaces. Upsert only marketplaces in the Europe endpoint response, preserving Amazon `marketplace_id`, country code, display name, and default currency mapping returned/derived from authoritative marketplace metadata.

Set `amazon_accounts.status='connected'` only after a successful authenticated marketplace call.

- [ ] **Step 3: Enqueue backfill windows**

Use day/week-sized windows small enough to retry independently:

- Orders: 7-day windows from 2026-01-01 to now per marketplace.
- Finances: 7-day windows from 2026-01-01 to now per marketplace.
- Inventory: one current job per marketplace.

Create `amazon_sync_runs` parent records and include `run_id` in job metadata/checkpoint.

- [ ] **Step 4: Implement hourly enqueue**

For orders/finances, use last successful high-water mark with an overlap of 6 hours, capped at current time. Inventory receives a single current refresh per marketplace. Do not backfill if the same `dedupe_key` already exists as queued/running/success for the exact window.

- [ ] **Step 5: Run test and commit**

Run: `node --test scripts/amazon-orchestrator.test.mjs`

Expected: PASS.

Commit message: `feat: orchestrate amazon backfill jobs`

---

### Task 5: Implement orders synchronization without PII

**Files:**
- Create: `supabase/functions/_shared/amazon/orders.ts`
- Create: `supabase/functions/amazon-sync-orders/index.ts`
- Create: `scripts/amazon-orders-sync.test.mjs`

**Interfaces:**
- `normalizeAmazonOrder(raw, marketplaceId)` returns only non-PII order fields.
- `normalizeAmazonOrderItem(raw, context)` returns SKU/ASIN/quantity/money fields.
- Function input: `{jobId:string}` or internal job payload from worker; output `{rows:number, highWaterMark:string|null}`.

- [ ] **Step 1: Write real normalization tests**

Create fixtures inline containing forbidden buyer/shipping properties plus valid order fields. Assert normalized result does not expose any forbidden property and correctly maps IDs, timestamps, status, fulfillment channel, totals/taxes/discounts.

If direct importing TS from Node is needed, add a small test helper `scripts/import-ts-module.mjs` using installed `typescript.transpileModule` for import-free pure modules; keep normalization module free of runtime imports so the same code can be tested and used by Deno.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-orders-sync.test.mjs`

- [ ] **Step 3: Implement paginated Orders API fetch**

Use the current Orders API version from the approved spec (`v2026-01-01`). Request only fields available without restricted data. Page using Amazon next-token semantics until exhausted. Respect job window and marketplace.

- [ ] **Step 4: Upsert orders and items idempotently**

Upsert on the unique keys defined in Task 1. Set `last_synced_at=now()`. Do not delete historical lines simply because a partial page omitted them.

- [ ] **Step 5: Return high-water mark**

Compute max `last_update_date` successfully persisted. Do not modify `amazon_sync_state` inside the source function; the worker advances state only after the function returns success.

- [ ] **Step 6: Run focused test and commit**

Commit message: `feat: sync amazon orders without buyer pii`

---

### Task 6: Implement finance-ledger synchronization

**Files:**
- Create: `supabase/functions/_shared/amazon/finance.ts`
- Create: `supabase/functions/amazon-sync-finances/index.ts`
- Create: `scripts/amazon-finance-sync.test.mjs`

**Interfaces:**
- `normalizeFinanceTransaction(raw, context): NormalizedFinanceTransaction[]`
- Stable `transaction_key` must be deterministic for the same Amazon event/component.
- Categories use the exact vocabulary from Task 1.

- [ ] **Step 1: Write failing normalization tests**

Cover sale principal/tax, refund principal/tax, referral fee, FBA fee, storage/other fee, adjustment, and unknown fallback. Reprocessing the same fixture must produce identical transaction keys.

- [ ] **Step 2: Implement Finances API page retrieval**

Use Finances API `v2024-06-19`, job date window, and marketplace filters where supported. Page until next token is empty.

- [ ] **Step 3: Normalize components as ledger rows**

Do not collapse different fee/tax components into one opaque amount. Preserve raw event identifiers and a small sanitized metadata object sufficient to audit category/source, but never whole payloads containing unnecessary data.

- [ ] **Step 4: Upsert and return high-water mark**

Upsert by `(owner_id,transaction_key)`. On a repeated late event, update amount/status/posted date rather than creating a duplicate.

- [ ] **Step 5: Run tests and commit**

Run: `node --test scripts/amazon-finance-sync.test.mjs`

Commit message: `feat: sync amazon finance ledger`

---

### Task 7: Implement FBA inventory synchronization

**Files:**
- Create: `supabase/functions/_shared/amazon/inventory.ts`
- Create: `supabase/functions/amazon-sync-inventory/index.ts`
- Create: `scripts/amazon-inventory-sync.test.mjs`

**Interfaces:**
- `normalizeInventorySummary(raw, marketplaceId)` returns SKU/ASIN and five inventory buckets.
- Each run updates `amazon_inventory_current`; at most one row/day/SKU is upserted into `amazon_inventory_daily`.

- [ ] **Step 1: Write failing inventory normalization test**

Assert missing Amazon quantity components normalize to zero and all quantities are finite non-negative integers.

- [ ] **Step 2: Implement FBA Inventory API pagination**

Use FBA Inventory API v1 summary operation scoped by marketplace. Page through all summaries.

- [ ] **Step 3: Persist current and daily snapshot**

Use upsert for current. Use `snapshot_date=(now() at time zone 'UTC')::date` semantics and upsert, not insert-only, for daily snapshot so hourly refreshes update the day's one row.

- [ ] **Step 4: Run focused test and commit**

Commit message: `feat: sync amazon fba inventory`

---

### Task 8: Build worker execution and state advancement

**Files:**
- Create: `supabase/functions/amazon-sync-worker/index.ts`
- Modify: `supabase/functions/_shared/amazon/jobs.ts`
- Create: `scripts/amazon-worker.test.mjs`

**Interfaces:**
- Worker claims at most 5 jobs per invocation.
- Dispatch map: `orders`, `finances`, `inventory`; later phases add `fx` and `ads` without changing queue semantics.
- On successful source completion, worker updates `amazon_sync_state` and finishes the job.

- [ ] **Step 1: Write failing worker contract**

Assert atomic claim RPC is used, dispatch is source-specific, no state advancement occurs in a catch/failure branch, and one job error does not abort the remaining claimed jobs.

- [ ] **Step 2: Implement worker identity and claim**

Generate `workerId='amazon-worker:'+crypto.randomUUID()`, call `claim_amazon_sync_jobs(workerId,5)`, then process jobs sequentially to avoid accidental rate-limit bursts in V1.

- [ ] **Step 3: Dispatch source implementation**

Prefer shared callable functions rather than HTTP chaining Edge Functions. Each source module should expose a `run...Job(admin, job)` function; the standalone source Edge Function wrappers exist for focused/manual diagnostics but worker imports the shared logic directly.

- [ ] **Step 4: Advance state only after success**

Upsert `amazon_sync_state` with returned high-water mark/checkpoint, then call `finish_amazon_sync_job(...,'success',rows,null,checkpoint)`.

On transient error, pass sanitized message to finish RPC for retry; on permanent auth/schema error mark terminal failure according to RPC input.

- [ ] **Step 5: Update parent run status**

After each batch, recompute the relevant `amazon_sync_runs` parent: success when all child jobs succeeded; partial when some succeeded and some remain/failed; failed when all terminal jobs failed. Update `amazon_accounts.last_successful_sync_at` only when the scheduled/hourly run has no failed required SP-API sources.

- [ ] **Step 6: Run test and commit**

Commit message: `feat: process amazon sync jobs safely`

---

### Task 9: Add admin connection/status and manual bootstrap endpoint

**Files:**
- Create: `supabase/functions/amazon-sync-manual/index.ts`
- Create: `src/services/amazon.ts`
- Modify: `src/pages/Amazon.tsx`
- Modify: `scripts/amazon-shell.test.mjs`

**Interfaces:**
- `getAmazonConnectionStatus(): Promise<AmazonConnectionStatus>` reads public tables/RLS, not secrets.
- `requestAmazonSync(mode:'bootstrap'|'manual'): Promise<{ok:true;runId:string}>` invokes admin-only Edge Function.

- [ ] **Step 1: Extend test for no-secret status path**

Assert `src/services/amazon.ts` contains no Amazon credential environment names and invokes `amazon-sync-manual` only for manual/bootstrap operations.

- [ ] **Step 2: Implement admin-only function**

Authenticate caller with `requiredAdmin=true`. `status` may return booleans such as `spApiConfigured`, account status, marketplace count, queued/running/failed job counts, and last success/error; never return any credential value.

`bootstrap` creates/updates the owner account, discovers marketplaces through orchestrator shared logic, and enqueues 2026 backfill.

`manual` enqueues an incremental run using the same overlap/high-water logic as hourly.

- [ ] **Step 3: Update Amazon shell**

Replace static placeholder with connection summary. Admin gets `Conectar / iniciar carga` or `Sincronizar ahora` action depending on account state. Non-admin sees read-only status.

- [ ] **Step 4: Run tests/build and commit**

Run:

`node --test scripts/amazon-*.test.mjs`

`npm run build`

Commit message: `feat: expose amazon connection status and manual sync`

---

### Task 10: Phase B verification gate

**Files:**
- No planned production changes.

**Interfaces:**
- Phase C may assume order, finance, inventory, queue, account, marketplace, and sync-state data are available.

- [ ] **Step 1: Configure server secrets in the target Supabase project**

Set exact secret names to the values issued by the private Amazon application:

- `AMAZON_LWA_CLIENT_ID`
- `AMAZON_LWA_CLIENT_SECRET`
- `AMAZON_SPAPI_REFRESH_TOKEN`

Do not add them to `.env.production`, `.env.example` with real values, Vercel browser env, or GitHub files.

- [ ] **Step 2: Apply Phase A/B migrations in staging/verification first**

Verify RLS with an authorized non-admin and an unauthorized non-admin. Unauthorized SELECT from every `amazon_*` analytical table must return no rows / permission-filtered result; direct writes from authenticated client must fail.

- [ ] **Step 3: Deploy Amazon Edge Functions to verification project**

Deploy orchestrator, worker, orders, finances, inventory, and manual function.

- [ ] **Step 4: Run a narrow live smoke window before full backfill**

Use one marketplace and a recent 24-hour window. Compare sample order ids/counts, finance events, and inventory SKUs against Seller Central. Confirm no buyer PII columns/data exist.

- [ ] **Step 5: Start full backfill from 01/01/2026**

Verify jobs are chunked, can be retried, and duplicate windows do not duplicate rows. Interrupt a worker intentionally in verification, run another worker, and confirm `FOR UPDATE SKIP LOCKED`/locks prevent simultaneous processing of the same job.

- [ ] **Step 6: Run full regression suite**

Run:

`node --test scripts/*.test.mjs`

`npm run build`

Expected: 0 failures and build exit 0.

- [ ] **Step 7: Do not merge Phase B until a sample reconciliation is explainable**

For at least one marketplace/date window, document order count, finance ledger total, and inventory sample with Amazon request ids/timestamps. Differences caused by eventual consistency must be identified rather than hidden.
