# Amazon Analytics Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the secure, idempotent SP-API backend for Amazon accounts, marketplaces, orders, finances, inventory, synchronization jobs, and restartable history from 2026-01-01.

**Architecture:** Supabase Postgres owns the Amazon ledger and persistent job queue. Short-lived Supabase Edge Functions acquire jobs, call Amazon SP-API with LWA credentials held only in server-side secrets, and upsert non-PII data. The frontend only reads RLS-protected tables/status and can request a manual sync through an admin-only endpoint.

**Tech Stack:** PostgreSQL 17 / Supabase RLS + Edge Functions (Deno/TypeScript), Amazon SP-API Orders v2026-01-01, Finances v2024-06-19, FBA Inventory v1, React 19 frontend, Node 22 contract tests.

**Spec:** `docs/superpowers/specs/2026-09-16-amazon-analytics-phase-b-spec.md`

## Global Constraints

- Historical start is exactly `2026-01-01T00:00:00Z`.
- Europe endpoint is `https://sellingpartnerapi-eu.amazon.com`.
- Never store buyer name, address, email, phone, or buyer payment data.
- Never place Amazon credentials in `VITE_*`, frontend source, public tables, logs, or test fixtures.
- All public Amazon tables have RLS.
- Client users only SELECT rows for their active workspace and require `amazon` permission/admin.
- Ledger and sync writes are backend-only.
- Repeated sync windows must be idempotent.
- Backfill is chunked and restartable; no single long-running invocation.
- No Phase B DDL/functions are deployed to production until explicit integration approval.

---

### Task 1: Amazon schema, RLS, indexes, and atomic job acquisition

**Files:**
- Create: `supabase/migrations/20260916190000_amazon_analytics_phase_b.sql`
- Test: `scripts/amazon-phase-b-schema.test.mjs`

**Interfaces:**
- Produces tables `amazon_accounts`, `amazon_marketplaces`, `amazon_orders`, `amazon_order_items`, `amazon_finance_transactions`, `amazon_inventory_current`, `amazon_inventory_daily`, `amazon_sync_runs`, `amazon_sync_state`, `amazon_sync_jobs`.
- Produces `private.amazon_claim_sync_jobs(integer)` callable only by backend/service context.
- Produces RLS SELECT policies based on `private.app_workspace_owner_id()` and `private.app_has_permission('amazon')`.

- [ ] **Step 1: Write the failing schema contract test**

Assert the migration contains every required table, enables RLS, creates workspace+permission SELECT policies, revokes client writes, adds unique idempotency constraints, and implements `FOR UPDATE SKIP LOCKED` job claiming.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test scripts/amazon-phase-b-schema.test.mjs`
Expected: FAIL because the Phase B migration does not exist.

- [ ] **Step 3: Implement the migration**

Use UUID primary keys with `gen_random_uuid()`, `owner_id uuid not null`, timestamps, constrained source/status values, stable unique keys, useful date/marketplace/order indexes, RLS, explicit grants/revokes, and the atomic claim function in schema `private`.

- [ ] **Step 4: Validate SQL without production mutation**

Run the migration inside `BEGIN; ... ROLLBACK;` against the connected project with schema-only/no committed changes where tooling permits, then query catalog metadata in the transaction to confirm constraints/policies compile.

- [ ] **Step 5: Run test GREEN and commit**

Run: `node --test scripts/amazon-phase-b-schema.test.mjs`
Commit: `feat: add Amazon phase B schema`

### Task 2: Shared SP-API client and safe configuration

**Files:**
- Create: `supabase/functions/_shared/amazon/config.ts`
- Create: `supabase/functions/_shared/amazon/sp-api.ts`
- Create: `supabase/functions/_shared/amazon/http.ts`
- Create: `docs/amazon-sp-api-setup.md`
- Test: `scripts/amazon-sp-api-client.test.mjs`

**Interfaces:**
- `readAmazonSpApiCredentials()` -> `{clientId, clientSecret, refreshToken, sellerId}` from `AMAZON_SPAPI_CREDENTIALS`.
- `getLwaAccessToken()` -> cached access token until shortly before expiry.
- `spApiRequest(path, params?)` -> JSON response from the EU endpoint with `x-amz-access-token`, `x-amz-date`, `user-agent`, retry/backoff for 429/5xx, and sanitized errors.

- [ ] **Step 1: Write failing client contract tests**

Require the exact secret name, LWA token URL, EU endpoint, required headers, no `VITE_`, no AWS secret/signing credential fields, and bounded retry behavior.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/amazon-sp-api-client.test.mjs`
Expected: FAIL because shared Amazon client files do not exist.

- [ ] **Step 3: Implement credentials + LWA + request helper**

Parse one JSON secret, validate required fields, request LWA token with form-urlencoded body, cache token in-memory, encode query params, and retry only transient statuses with capped delays.

- [ ] **Step 4: Document private-app setup**

Document Amazon roles needed for Orders, Finance and Accounting, and FBA inventory, self-authorization flow, exact secret JSON shape, and a checklist that credentials must only be entered in Supabase Edge Function Secrets.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test scripts/amazon-sp-api-client.test.mjs`
Commit: `feat: add Amazon SP-API client`

### Task 3: Sync orchestration and worker queue

**Files:**
- Create: `supabase/functions/_shared/amazon/supabase.ts`
- Create: `supabase/functions/_shared/amazon/sync.ts`
- Create: `supabase/functions/amazon-sync-orchestrator/index.ts`
- Create: `supabase/functions/amazon-sync-worker/index.ts`
- Create: `supabase/functions/amazon-sync-manual/index.ts`
- Test: `scripts/amazon-sync-queue.test.mjs`

**Interfaces:**
- `enqueueInitialBackfill(ownerId, accountId, marketplaces)` creates bounded source/window jobs from 2026-01-01.
- `enqueueHourlySync(...)` uses high-water marks plus overlap.
- Worker claims a small batch atomically and dispatches by source.
- Manual endpoint authenticates a user and requires `role='admin'` before enqueueing `manual` jobs.

- [ ] **Step 1: Write failing queue tests**

Require initial/hourly/manual modes, chunking, attempts/backoff, sanitized errors, service-only worker/orchestrator behavior, and admin-only manual invocation.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/amazon-sync-queue.test.mjs`
Expected: FAIL because sync functions do not exist.

- [ ] **Step 3: Implement shared Supabase backend helper and queue state transitions**

Use `SUPABASE_SECRET_KEYS` with legacy fallback only server-side. Centralize run/job success/failure/checkpoint helpers.

- [ ] **Step 4: Implement orchestrator, worker, manual endpoint**

Workers process bounded batches and never keep a function alive for the whole backfill. Internal endpoints require service authentication; manual endpoint uses user JWT plus app user admin check.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test scripts/amazon-sync-queue.test.mjs`
Commit: `feat: add Amazon sync queue workers`

### Task 4: Orders v2026-01-01 sync

**Files:**
- Create: `supabase/functions/_shared/amazon/orders.ts`
- Create: `supabase/functions/amazon-sync-orders/index.ts`
- Test: `scripts/amazon-orders-sync.test.mjs`

**Interfaces:**
- `syncOrdersJob(job)` calls Orders v2026-01-01 for one marketplace/window, paginates using `paginationToken`, and upserts orders/items.
- Requested data must never include `BUYER` or `RECIPIENT`.

- [ ] **Step 1: Write failing Orders tests**

Require `/orders/2026-01-01/orders`, marketplace/window pagination, non-PII includedData, and stable upsert conflict keys.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/amazon-orders-sync.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement normalization and idempotent upserts**

Persist analytical order/item fields only. Normalize monetary/tax/proceeds fields that exist without assuming unavailable fields.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test scripts/amazon-orders-sync.test.mjs`
Commit: `feat: sync Amazon orders`

### Task 5: Finances v2024-06-19 sync

**Files:**
- Create: `supabase/functions/_shared/amazon/finances.ts`
- Create: `supabase/functions/amazon-sync-finances/index.ts`
- Test: `scripts/amazon-finances-sync.test.mjs`

**Interfaces:**
- `syncFinancesJob(job)` calls `/finances/2024-06-19/transactions`, paginates `nextToken`, classifies transaction category, and upserts a normalized ledger.

- [ ] **Step 1: Write failing Finances tests**

Require v2024-06-19 endpoint, nextToken pagination, marketplace/date filtering, stable transaction key derivation, normalized categories, and no buyer PII.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/amazon-finances-sync.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement transaction normalization/upsert**

Store original currency/amount and leave EUR/FX columns nullable for Phase C. Retain only sanitized non-sensitive raw metadata when needed for traceability.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test scripts/amazon-finances-sync.test.mjs`
Commit: `feat: sync Amazon finances`

### Task 6: FBA inventory sync and daily snapshots

**Files:**
- Create: `supabase/functions/_shared/amazon/inventory.ts`
- Create: `supabase/functions/amazon-sync-inventory/index.ts`
- Test: `scripts/amazon-inventory-sync.test.mjs`

**Interfaces:**
- `syncInventoryJob(job)` loads FBA inventory for a marketplace, upserts current values, and upserts one daily snapshot per owner/marketplace/SKU/date.

- [ ] **Step 1: Write failing inventory tests**

Require FBA Inventory v1, marketplace/SKU/ASIN quantities, current upsert, and daily unique snapshot semantics.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/amazon-inventory-sync.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement inventory normalization**

Persist fulfillable, inbound, reserved, unfulfillable, researching, total quantity, and sync timestamp without hourly snapshot duplication.

- [ ] **Step 4: Run GREEN and commit**

Run: `node --test scripts/amazon-inventory-sync.test.mjs`
Commit: `feat: sync Amazon FBA inventory`

### Task 7: Connection/status API and Amazon shell integration

**Files:**
- Create: `supabase/functions/amazon-status/index.ts`
- Create: `src/services/amazon.ts`
- Modify: `src/pages/Amazon.tsx`
- Test: `scripts/amazon-status-ui.test.mjs`

**Interfaces:**
- Status endpoint returns configured flag, account/marketplace summary, last successful sync, active run, latest sanitized error; never returns credentials/tokens.
- Frontend page displays real connection/sync state while preserving Seller Central/Sellerboard links and `amazon` permission routing.

- [ ] **Step 1: Write failing status/UI tests**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Implement secure status endpoint and frontend service**
- [ ] **Step 4: Replace placeholder connection copy with live state**
- [ ] **Step 5: Run GREEN and commit**

Run: `node --test scripts/amazon-status-ui.test.mjs`
Commit: `feat: connect Amazon shell to sync status`

### Task 8: Scheduler migration, full verification, and review gate

**Files:**
- Create: `supabase/migrations/20260916193000_amazon_sync_scheduler.sql`
- Test: `scripts/amazon-sync-scheduler.test.mjs`

**Interfaces:**
- Hourly orchestrator schedule.
- Short worker schedule.
- Scheduler calls are authenticated server-to-server.

- [ ] **Step 1: Write failing scheduler contract test**
- [ ] **Step 2: Verify RED**
- [ ] **Step 3: Add idempotent Cron/pg_net setup using Vault/secret-key pattern compatible with current Supabase docs**
- [ ] **Step 4: Run the complete suite**

Run: `node --test scripts/*.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Build frontend**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Review branch diff for secrets/PII**

Search for `refresh_token`, `client_secret`, `Atzr|`, `Atza|`, buyer/address/email/phone fields in Amazon code and verify only variable names/schema exclusions/documentation examples exist, never real values or persistence of PII.

- [ ] **Step 7: Open draft PR and stop before production**

Production migration/function deployment happens only after explicit user approval to integrate Phase B.
