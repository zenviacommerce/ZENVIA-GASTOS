# Amazon Phase E — Dashboard, Automation and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete Amazon Analytics V1 UI, schedule the hourly/reconciliation pipeline, expose data-quality/sync state clearly, and release the module through the existing GitHub → Vercel flow only after live reconciliation passes.

**Architecture:** The browser consumes only server-side aggregate RPCs and status endpoints created in earlier phases. A focused Amazon filter model controls every dashboard block, while dynamic marketplace/product selectors reuse the application's shared `SearchableSelect` and period selection uses `SelectField`. Supabase Cron invokes the orchestrator hourly, the worker every five minutes, and a wider reconciliation daily; cron credentials stay in Vault and an internal cron secret is validated server-side.

**Tech Stack:** React 19, TypeScript, Vite, Recharts 2.15.4, Supabase Postgres/RPC/RLS, Supabase Edge Functions, Supabase Cron (`pg_cron`) + `pg_net`, existing shared forms/Pagination/StatCard, Node `node:test`, GitHub Actions, Vercel Git integration.

**Spec:** `docs/superpowers/specs/2026-09-16-amazon-analytics-design.md`

## Global Constraints

- Default Amazon dashboard period is the current calendar year; for 2026 this resolves to `2026-01-01` through `2026-12-31`.
- Filters are period + marketplace + product and must apply coherently to every KPI, chart, quality block and product table.
- `Europa consolidado` means all active/mapped European marketplaces in the current workspace, with amounts normalized to EUR by the server.
- The browser must not fetch raw annual Amazon order/finance/Ads tables and calculate business totals itself.
- Final KPI labels may say `Beneficio Amazon`, `Margen`, `ACOS`, `TACOS`, and `ROAS` only when the Phase D Ads-aware RPC is deployed; incomplete scopes must display their completeness state.
- Unallocated Ads spend is visible and included in consolidated profit but never distributed across product rows.
- Missing mapping, historical COGS, FX, Ads history, or source sync must remain visible as data-quality/incompleteness signals.
- Sync cadence: orchestrator once per hour, worker every 5 minutes, wider reconciliation once daily.
- Scheduled Edge Function calls must not put service-role/secret values in migrations or source code.
- Normal frontend releases deploy by merging GitHub `main`; Vercel's existing Git integration deploys automatically. Do not invoke a manual Vercel deployment for the normal release.
- Follow TDD: each pure/filter/presentation contract is red before implementation; full Node suite + production build + GitHub CI are required before merge.

---

### Task 1: Add Amazon filter model and focused regression tests

**Files:**
- Create: `src/services/amazonFilters.ts`
- Create: `scripts/amazon-dashboard-filters.test.mjs`

**Interfaces:**
- Produces:

```ts
export type AmazonPeriodPreset = 'today'|'current_month'|'current_quarter'|'current_year'|'custom';

export interface AmazonDashboardFilter {
  preset: AmazonPeriodPreset;
  from: string;
  to: string;
  marketplaceId: string;
  productId: string;
}

export function defaultAmazonFilter(now?:Date): AmazonDashboardFilter;
export function amazonFilterForPreset(preset:AmazonPeriodPreset,current:AmazonDashboardFilter,now?:Date):AmazonDashboardFilter;
export function amazonPeriodLabel(filter:AmazonDashboardFilter,now?:Date):string;
```

- Empty `marketplaceId` means Europe consolidated.
- Empty `productId` means all products.

- [ ] **Step 1: Write the failing pure test**

The test loads/transpiles `amazonFilters.ts` and verifies with `new Date(2026,8,16)`:

```js
assert.deepEqual(defaultAmazonFilter(now), {
  preset:'current_year',
  from:'2026-01-01',
  to:'2026-12-31',
  marketplaceId:'',
  productId:'',
});
```

Also assert current month resolves to `2026-09-01` → `2026-09-30`, current quarter to `2026-07-01` → `2026-09-30`, today to `2026-09-16`, custom keeps explicitly selected dates, and changing period preserves marketplace/product values.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-dashboard-filters.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the filter helpers**

Use local-date helpers consistent with existing `src/services/filters.ts`; do not use `toISOString().slice(0,10)` for local calendar boundaries because timezone shifts can change the day.

`amazonFilterForPreset('custom',...)` returns the current dates unchanged and only sets `preset:'custom'`.

- [ ] **Step 4: Run focused test and commit**

Run: `node --test scripts/amazon-dashboard-filters.test.mjs`

Expected: PASS.

Commit message: `feat: add amazon dashboard filters`

---

### Task 2: Complete aggregate RPC surface for charts and sync/data-quality status

**Files:**
- Create: `supabase/migrations/20260916174000_amazon_dashboard_rpc.sql`
- Create: `scripts/amazon-dashboard-rpc.test.mjs`
- Modify: `src/services/amazonAnalytics.ts`

**Interfaces:**
- Consumes Phase D `amazon_profit_summary`, `amazon_profit_by_marketplace`, `amazon_profit_by_product`, and quality logic.
- Produces RPCs:
  - `amazon_profit_time_series(p_from date,p_to date,p_marketplace_id text default null,p_product_id uuid default null)`
  - `amazon_sync_status()`
  - `amazon_filter_options()`
- Extends the typed frontend service with:

```ts
loadAmazonSummary(filter): Promise<AmazonProfitSummary>
loadAmazonTimeSeries(filter): Promise<AmazonTimePoint[]>
loadAmazonMarketplaceBreakdown(filter): Promise<AmazonMarketplaceProfit[]>
loadAmazonProductProfitability(filter,page,pageSize): Promise<{rows:AmazonProductProfit[];total:number}>
loadAmazonDataQuality(filter): Promise<AmazonDataQuality>
loadAmazonSyncStatus(): Promise<AmazonSyncStatus>
loadAmazonFilterOptions(): Promise<{marketplaces:AmazonMarketplaceOption[];products:AmazonProductOption[]}>
```

- [ ] **Step 1: Write failing SQL/service contract test**

Assert each RPC exists, contains workspace/`amazon` permission checks (or calls secured helpers), accepts date/marketplace/product filters where applicable, and the frontend service calls `supabase.rpc` rather than `.from('amazon_orders')`, `.from('amazon_finance_transactions')`, or `.from('amazon_ad_metrics_daily')` for dashboard totals.

- [ ] **Step 2: Implement daily time series RPC**

Return one row per date that has activity in the selected range, with at least:

```text
date
gross_sales
net_sales_ex_vat
amazon_profit
ad_spend
profit_complete
```

Use the same component definitions and Ads/COGS/FX completeness rules as the final summary RPC. Do not create a separate formula implementation with different fee/refund semantics; factor SQL CTEs/helpers if necessary so summary and series share definitions.

- [ ] **Step 3: Implement filter-options RPC**

Return active marketplaces belonging to the workspace and mapped Amazon product options derived from `amazon_product_mappings` + `products`. Include unresolved Amazon SKU count separately rather than creating fake product ids.

Expected response shape:

```json
{
  "marketplaces": [{"id":"...","name":"Amazon ES","countryCode":"ES"}],
  "products": [{"id":"uuid","name":"Film 45 cm","sku":"..."}],
  "unresolvedSkuCount": 0
}
```

- [ ] **Step 4: Implement sync-status RPC**

Return:

```text
account_status
initial_sync_from
last_successful_sync_at
running_jobs
queued_jobs
failed_jobs
latest_error
sources[] = {source,status,lastSuccessAt,queued,running,failed,requestedFrom,availableFrom}
```

Sanitize `latest_error` at write time and cap display text. Never expose job checkpoints that may contain provider request metadata not intended for the browser.

- [ ] **Step 5: Implement typed frontend mappings**

In `amazonAnalytics.ts`, centralize RPC error handling and numeric conversion. Keep metric values nullable when SQL returns incomplete/undefined ratios.

- [ ] **Step 6: Run focused test/build and commit**

Run:

`node --test scripts/amazon-dashboard-rpc.test.mjs`

`npm run build`

Commit message: `feat: expose amazon dashboard aggregates`

---

### Task 3: Build reusable Amazon filters and sync/data-quality components

**Files:**
- Create: `src/components/AmazonFilters.tsx`
- Create: `src/components/AmazonSyncStatus.tsx`
- Create: `src/components/AmazonDataQuality.tsx`
- Modify: `src/amazon.css`
- Create: `scripts/amazon-dashboard-components.test.mjs`

**Interfaces:**
- `AmazonFilters` props:

```ts
{
  filter: AmazonDashboardFilter;
  marketplaces: AmazonMarketplaceOption[];
  products: AmazonProductOption[];
  onChange:(next:AmazonDashboardFilter)=>void;
}
```

- `AmazonSyncStatus` props `{status:AmazonSyncStatus; isAdmin:boolean; onSync?:()=>Promise<void>}`.
- `AmazonDataQuality` props `{quality:AmazonDataQuality}`.

- [ ] **Step 1: Write failing component-source contract**

Assert period uses `SelectField`; marketplace and product use `SearchableSelect`; marketplace empty label is `Europa consolidado`; product empty label is `Todos los productos`; quick period buttons include `Hoy`, `Mes actual`, `Trimestre actual`, `Año actual`; custom date inputs set preset `custom`.

Assert sync component renders source names `Pedidos`, `Finanzas`, `Inventario`, `Ads`, `FX`, and only renders `Sincronizar ahora` when `isAdmin` and `onSync` are supplied.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-dashboard-components.test.mjs`

- [ ] **Step 3: Implement `AmazonFilters`**

Use `amazonFilterForPreset`. Marketplace options should include country code in `searchText`; product options include SKU in `searchText`. Do not populate a fixed list of European countries in the component—use the connected account options from the server.

- [ ] **Step 4: Implement `AmazonSyncStatus`**

Show a compact overall badge plus expandable/per-source details. Status semantics:

- `running`/queued work → `Sincronizando`.
- no failed required source and recent success → `Actualizado`.
- failed source → `Requiere atención`.
- initial backfill still incomplete → `Carga inicial en curso`.

Manual sync must disable while its request is being submitted, then refresh status; it does not wait synchronously for the whole sync to finish.

- [ ] **Step 5: Implement `AmazonDataQuality`**

Display explicit counts/amounts for:

- SKUs no vinculados.
- Unidades/ventas con COGS pendiente.
- Conversión FX pendiente.
- Gasto Ads no asignado a producto.
- Historial Ads no disponible desde 01/01/2026, when applicable.

A zero issue count renders a positive `Sin incidencias` state rather than hiding the quality section completely.

- [ ] **Step 6: Add responsive/dark-compatible Amazon CSS**

Use existing CSS variables/classes where possible. The Amazon filter panel must stack on mobile; actions remain reachable; no fixed-width chart/table should force the entire page wider than viewport. Product table may use its own horizontal overflow container.

- [ ] **Step 7: Run focused test/build and commit**

Commit message: `feat: add amazon filters and data status`

---

### Task 4: Build final KPI cards and completeness presentation

**Files:**
- Create: `src/components/AmazonKpis.tsx`
- Create: `src/services/amazonFormat.ts`
- Modify: `src/amazon.css`
- Modify: `scripts/amazon-dashboard-components.test.mjs`

**Interfaces:**
- `AmazonKpis` receives `AmazonProfitSummary` and period label.
- Formatting helpers:

```ts
formatAmazonMoney(value:number|null):string
formatAmazonPercent(value:number|null):string
formatAmazonRatio(value:number|null):string
```

- Ratios returned by SQL are decimal fractions (`0.125` => `12,50 %`) unless the Phase D RPC explicitly defines percentage-point values; keep one convention and assert it in tests.

- [ ] **Step 1: Extend failing tests for KPI labels**

Require the 15 approved labels:

`Ventas brutas`, `Ventas netas sin IVA`, `Pedidos`, `Unidades`, `Reembolsos y ajustes`, `Fees Amazon`, `Costes FBA`, `Gasto Ads`, `Ventas atribuidas Ads`, `ACOS`, `TACOS`, `ROAS`, `COGS`, `Beneficio Amazon`, `Margen`.

- [ ] **Step 2: Implement display formatting**

Use `Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'})`; NULL ratios render `—`, never `0 %`, `Infinity`, or `NaN`.

- [ ] **Step 3: Implement KPI layout using `StatCard`**

Reuse existing `StatCard` rather than creating a second card primitive. Group visually into sales/operations, Amazon costs, advertising, and profitability using section headings or CSS grouping.

- [ ] **Step 4: Surface completeness on affected cards**

If `profitComplete=false`, the Beneficio/Margen cards remain numerically visible only if the RPC provides a defensible partial value, but their `sub` text must say `Datos incompletos` and the quality/status section must explain the source. If the RPC returns null because the metric cannot be computed, show `—`.

Do not color a partial profit as success/failure based solely on sign.

- [ ] **Step 5: Run focused test/build and commit**

Commit message: `feat: show amazon profitability kpis`

---

### Task 5: Build sales/profit trend and marketplace comparison charts

**Files:**
- Create: `src/components/AmazonTrendChart.tsx`
- Create: `src/components/AmazonMarketplaceChart.tsx`
- Modify: `src/amazon.css`
- Modify: `scripts/amazon-dashboard-components.test.mjs`

**Interfaces:**
- Uses existing `recharts` dependency.
- Trend props `{points:AmazonTimePoint[]}`.
- Marketplace props `{rows:AmazonMarketplaceProfit[]}`.

- [ ] **Step 1: Extend source contract test**

Assert chart files import from `recharts`, trend renders both sales and profit series, and marketplace chart reads server-returned EUR fields rather than recalculating FX in React.

- [ ] **Step 2: Implement trend chart**

Use `ResponsiveContainer` + `LineChart` with date labels localized to Spanish. Plot `netSalesExVat` and `amazonProfit` as distinct series. Tooltip formats EUR and shows an `Datos incompletos` marker on points where `profitComplete=false`.

If no points exist, show a normal empty state rather than an empty Recharts frame.

- [ ] **Step 3: Implement marketplace comparison**

Use a horizontal `BarChart` when several marketplaces exist, with at least sales and profit available in tooltip. Keep `AmazonMarketplaceProfit` rows in the same ranking/order returned by server (or sort once by net sales in service) and do not infer missing marketplaces as zero.

- [ ] **Step 4: Make charts responsive**

Give charts a bounded minimum height and width via their card containers; use Recharts responsive wrapper rather than fixed pixel width. Verify labels remain readable on mobile; if necessary hide secondary axis labels but keep tooltip data.

- [ ] **Step 5: Run focused test/build and commit**

Commit message: `feat: chart amazon sales and profit`

---

### Task 6: Build paginated product profitability table

**Files:**
- Create: `src/components/AmazonProfitTable.tsx`
- Modify: `src/pages/Amazon.tsx`
- Modify: `src/amazon.css`
- Create: `scripts/amazon-profit-table.test.mjs`

**Interfaces:**
- Props:

```ts
{
  rows:AmazonProductProfit[];
  total:number;
  page:number;
  pageSize:number;
  loading:boolean;
  onPageChange:(page:number)=>void;
}
```

- Default `pageSize=20`.
- Data is already filtered/paginated by `amazon_profit_by_product`; component never slices a full annual dataset.

- [ ] **Step 1: Write failing table contract test**

Require visible columns for `Producto`, `ASIN`, `SKU`, `Marketplace`, `Unidades`, `Ventas netas`, `Fees`, `Ads`, `COGS`, `Beneficio`, `Margen`, and `ACOS/TACOS`. Assert it imports/reuses existing `Pagination` and does not call `.slice((page-1)` on all rows.

- [ ] **Step 2: Implement table**

Unlinked product renders `No vinculado` plus Amazon SKU/ASIN. Missing COGS renders `Pendiente`, not `0,00 €`. NULL ratios render `—`. Product-level profit uses only product-attributable Ads returned by the server.

- [ ] **Step 3: Explain unallocated Ads outside row totals**

Above/below table, if `quality.unallocatedAdSpend > 0`, show copy explaining that this spend is included in consolidated benefit but not arbitrarily assigned to products. Do not append a fake product row unless the server contract explicitly returns one for explanatory purposes.

- [ ] **Step 4: Reset pagination on filters**

In `AmazonPage`, whenever period/marketplace/product changes, set product table page to `1` before loading the new filtered page.

- [ ] **Step 5: Run test/build and commit**

Commit message: `feat: add amazon product profitability table`

---

### Task 7: Compose the final Amazon page and coherent loading/error flow

**Files:**
- Modify: `src/pages/Amazon.tsx`
- Modify: `src/App.tsx`
- Modify: `src/amazon.css`
- Create: `scripts/amazon-dashboard-page.test.mjs`

**Interfaces:**
- `AmazonPage` props become `{isAdmin:boolean}`.
- App renders `<AmazonPage isAdmin={access.role==='admin'}/>` behind `can('amazon')`.
- Page coordinates the services/components from Tasks 1–6.

- [ ] **Step 1: Write failing page contract test**

Assert `AmazonPage` imports `AmazonFilters`, `AmazonKpis`, trend, marketplace chart, profit table, sync status, data quality, and mapping component; the App route still checks `can('amazon')`; Seller Central/Sellerboard external links remain present and safe.

- [ ] **Step 2: Implement parallel dashboard loading**

On filter change, load summary, series, marketplace breakdown, quality, and the current product page with `Promise.allSettled` or isolated requests so one optional block failing can show its own error without blanking the entire page.

Filter options and sync status can have their own refresh lifecycle. Keep a request generation/token or cancellation flag so slow responses for an old filter do not overwrite a newer selection.

- [ ] **Step 3: Implement status-aware page states**

- No Amazon account: show configuration card + external links; admin gets connection action.
- Initial load/backfill: show available partial data plus `Carga inicial en curso`.
- Ads not authorized/approved: show SP-API data as partial and mark profit incomplete.
- Complete: show all dashboard blocks.
- Individual RPC error: show local error card and retry action for that block when practical.

- [ ] **Step 4: Preserve mapping administration**

Render `AmazonProductMappings` in a secondary section/tab/card. Any user with `amazon` can see mapping status; only admin sees mapping edit controls as established in Phase C.

- [ ] **Step 5: Add manual sync refresh loop**

Admin `Sincronizar ahora` calls the manual endpoint and immediately refreshes sync status. While status shows queued/running, poll status at a modest interval (e.g. 15 seconds) only while the Amazon page is open; stop polling on unmount or when no work remains.

This UI polling does not drive the backend synchronization and must not call Amazon APIs directly.

- [ ] **Step 6: Run focused tests/build and commit**

Run:

`node --test scripts/amazon-dashboard-*.test.mjs scripts/amazon-profit-table.test.mjs`

`npm run build`

Expected: PASS / exit 0.

Commit message: `feat: complete amazon analytics dashboard`

---

### Task 8: Secure scheduled orchestration and worker endpoints

**Files:**
- Create: `supabase/functions/_shared/amazon/cronAuth.ts`
- Modify: `supabase/functions/amazon-sync-orchestrator/index.ts`
- Modify: `supabase/functions/amazon-sync-worker/index.ts`
- Create: `scripts/amazon-cron-auth.test.mjs`

**Interfaces:**
- Scheduled functions require header `x-amazon-cron-secret` equal to server env `AMAZON_CRON_SECRET` using constant-time-ish byte comparison where feasible.
- User-triggered manual sync continues through the authenticated admin-only `amazon-sync-manual`, not through the cron secret route.

- [ ] **Step 1: Write failing auth contract test**

Assert orchestrator/worker import cron auth, reject absent/mismatched secret, and never echo expected/provided secret in error output. Assert `AMAZON_CRON_SECRET` does not occur under `src/`.

- [ ] **Step 2: Implement shared cron verification**

```ts
export function requireAmazonCron(req:Request){
  const expected=Deno.env.get('AMAZON_CRON_SECRET')||'';
  const provided=req.headers.get('x-amazon-cron-secret')||'';
  if(!expected||!safeEqual(expected,provided)) throw new Error('Unauthorized cron request');
}
```

Implement `safeEqual` by encoding both strings to bytes, iterating across a fixed/max length, and combining XOR differences; do not early-return on the first different byte.

- [ ] **Step 3: Separate cron action input from user input**

Scheduled orchestrator body accepts only internally defined actions `hourly` or `reconcile`. Worker does not accept arbitrary owner ids/job ids from cron body; it claims jobs through the queue RPC. Owner/job scope comes from database rows.

- [ ] **Step 4: Run test and commit**

Commit message: `feat: secure amazon scheduled sync endpoints`

---

### Task 9: Schedule hourly sync, worker and daily reconciliation with Supabase Cron

**Files:**
- Create: `supabase/migrations/20260916174100_amazon_cron.sql`
- Create: `scripts/amazon-cron-schedule.test.mjs`
- Update deployment runbook section in this plan during execution only if the target project uses different Vault secret names; do not change schedules without a reviewed reason.

**Interfaces:**
- Vault names expected before applying migration:
  - `amazon_project_url`
  - `amazon_publishable_key`
  - `amazon_cron_secret`
- Cron jobs:
  - `amazon-hourly-orchestrator`: minute 7 every hour (`7 * * * *`).
  - `amazon-sync-worker`: every 5 minutes (`*/5 * * * *`).
  - `amazon-daily-reconcile`: 03:20 UTC daily (`20 3 * * *`).

- [ ] **Step 1: Write failing schedule test**

Assert migration enables/requires `pg_cron` and `pg_net`, reads URL/key/cron secret from `vault.decrypted_secrets`, schedules the three exact job names/cadences, includes `x-amazon-cron-secret`, and contains no literal `sb_secret_`, service-role JWT, project URL, or production API key value.

- [ ] **Step 2: Run RED**

Run: `node --test scripts/amazon-cron-schedule.test.mjs`

- [ ] **Step 3: Implement idempotent cron setup**

Enable extensions if allowed by the managed project:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Before scheduling, unschedule an existing job with the same name when present, then call `cron.schedule`. Each job body uses `net.http_post` to:

```text
<amazon_project_url>/functions/v1/amazon-sync-orchestrator
<amazon_project_url>/functions/v1/amazon-sync-worker
```

Headers include `Content-Type: application/json`, the Vault publishable key in `apikey`, and Vault `amazon_cron_secret` in `x-amazon-cron-secret`.

Bodies:

```json
{"action":"hourly"}
```

```json
{"action":"work"}
```

```json
{"action":"reconcile"}
```

The `reconcile` action enqueues wider Finances/Ads windows; it does not synchronously fetch the year.

- [ ] **Step 4: Provision Vault + Edge secret before migration**

Generate a high-entropy random cron secret outside source control. Set the same value as Edge Function secret `AMAZON_CRON_SECRET` and Vault secret `amazon_cron_secret`. Store the project URL and current publishable key in the two other Vault entries.

No secret value should appear in the terminal transcript committed to Git, SQL migration, PR body, audit details, or test fixture.

- [ ] **Step 5: Apply migration in verification environment and inspect jobs**

Run SQL:

```sql
select jobname,schedule,active
from cron.job
where jobname in ('amazon-hourly-orchestrator','amazon-sync-worker','amazon-daily-reconcile')
order by jobname;
```

Expected: three active rows with exact schedules above.

- [ ] **Step 6: Observe actual cron executions**

Check `cron.job_run_details` and `amazon_sync_runs/jobs` for at least one worker execution and one manual invocation of each orchestrator action in verification. HTTP scheduling success alone is insufficient; confirm jobs are actually enqueued/claimed.

- [ ] **Step 7: Run focused test and commit**

Commit message: `feat: schedule hourly amazon synchronization`

---

### Task 10: Add final reconciliation/data-integrity regression checks

**Files:**
- Create: `scripts/amazon-final-regression.test.mjs`
- Create during execution only if useful: `docs/amazon-reconciliation-checklist.md`

**Interfaces:**
- Regression test is static/pure CI safety; live reconciliation checklist captures manual verification without secrets/PII.

- [ ] **Step 1: Create final source safety test**

The test recursively scans `src`, `supabase/functions`, migrations, and Amazon plan/fixture code and fails if it finds obvious secret assignments or forbidden buyer-PII field names in `amazon_*` schema/normalizers. Allow references to secret **environment variable names** in server functions, but reject secret names in `src/` and reject key-like literal values.

Also assert:

- App route contains `can('amazon')`.
- Dashboard service uses aggregate RPCs.
- `amazon_cron_secret` is read from Vault in schedule SQL.
- external links retain safe rel/target.
- Ads total/product grain rules remain present in profitability SQL.

- [ ] **Step 2: Run full automated verification**

Run:

```bash
node --test scripts/*.test.mjs
npm run build
```

Expected: zero Node failures and build exit 0.

- [ ] **Step 3: Reconcile all required live sources for a selected sample**

For at least one recent complete day and one marketplace, record non-sensitive comparison values from Amazon/Seller Central/Ads Console and ZENVIA:

```text
Orders / units
Gross sales
VAT / net sales ex VAT
Refunds
Referral + other non-FBA fees
FBA costs
Ad spend
Attributed ad sales
COGS for sampled SKUs
Amazon profit
Inventory for sampled SKUs
```

The purpose is explainability, not forced exactness when Amazon posts delayed finance/Ads events. Document timing/attribution differences and re-run reconciliation before accepting unexplained gaps.

- [ ] **Step 4: Verify consolidated Europe arithmetic**

Choose at least one non-EUR marketplace/date and confirm original amount, selected prior ECB rate, EUR amount, and consolidated total. Confirm product row totals may differ from consolidated profit by exactly explainable items such as `unallocated_ad_spend` and unresolved COGS—not by hidden distribution.

- [ ] **Step 5: Verify access controls with three personas**

- Admin: Amazon visible; mappings/config/manual sync editable.
- Non-admin with `amazon`: dashboard readable; no mapping/config/manual-sync mutation.
- Non-admin without `amazon`: Amazon absent; direct RLS queries/RPCs return no accessible Amazon business data.

- [ ] **Step 6: Verify no buyer PII**

Inspect Amazon tables/representative JSON metadata. There must be no buyer name, postal address, email, phone, or payment data. Do not rely only on TypeScript types—inspect persisted data keys.

- [ ] **Step 7: Commit any non-secret reconciliation documentation**

If a checklist file is added, ensure it contains only counts/amounts/request timestamps and no tokens, buyer data, or credential identifiers.

Commit message: `test: verify amazon analytics release readiness`

---

### Task 11: Controlled Supabase + GitHub/Vercel release

**Files:**
- No planned code changes; release task operates on the verified branch.

**Interfaces:**
- Production migration/function order is additive and backwards-compatible where possible.
- Frontend release occurs only after backend objects it depends on exist.

- [ ] **Step 1: Rebase/update implementation branch from current `main` before final PR**

Resolve conflicts by preserving all intervening application changes. Re-run Amazon and full tests after conflict resolution; never force-update `main`.

- [ ] **Step 2: Apply production database migrations in dependency order**

Order:

1. Phase A permission.
2. Phase B core schema + queue.
3. Phase C mapping/FX/COGS/profitability base.
4. Phase D Ads schema + final profitability.
5. Phase E dashboard RPC.
6. Phase E cron **only after Vault + Edge cron secret are provisioned**.

Stop if any migration fails; do not deploy a frontend that assumes missing RPCs/tables.

- [ ] **Step 3: Deploy production Edge Functions/secrets**

Deploy shared-dependent functions and set only server-side secrets. Verify status endpoints and a narrow manual sync before enabling/confirming cron.

The implementation execution must list exactly which functions were deployed and check their responses without logging secret values.

- [ ] **Step 4: Verify production cron + queue health**

Inspect the three `cron.job` rows and observe at least one worker execution. Confirm no uncontrolled retry storm and that queued/running counts decrease normally.

- [ ] **Step 5: Open PR to `main`**

PR body must summarize phases, migrations, Edge Functions, required secrets by **name only**, verification performed, and known Amazon eventual-consistency/Ads-history limitations. Do not include credential values.

- [ ] **Step 6: Require GitHub Actions green**

The repository CI already runs:

```text
node --test scripts/*.test.mjs
npm run build
```

Do not merge until the PR workflow completes successfully on the final head SHA.

- [ ] **Step 7: Merge through GitHub**

Use normal merge/squash policy chosen for the repo. After merge, verify `main` workflow on the merge commit succeeds.

- [ ] **Step 8: Verify Vercel Git deployment status**

Check the merge commit's Vercel status/context and production application. **Do not call a manual Vercel deploy** for the normal release; the connected GitHub integration is the deployment mechanism.

- [ ] **Step 9: Production smoke test**

With an authorized account, verify Amazon menu, current-year default filter, consolidated Europe view, one marketplace filter, one product filter, KPI completeness labels, charts, product pagination, quality block, Seller Central/Sellerboard links, and sync status. With an unauthorized test user, verify Amazon remains absent.

- [ ] **Step 10: Final completion evidence**

Before declaring V1 complete, capture fresh evidence of:

- production DB migrations present;
- Edge Functions responding;
- cron jobs active;
- a recent successful `amazon_sync_run`;
- all Node tests green;
- production build green;
- GitHub main CI green;
- Vercel deployment success for the merge commit;
- live sample reconciliation completed or any remaining discrepancy explicitly documented.
