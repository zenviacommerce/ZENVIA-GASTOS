# Amazon Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Amazon connection/status page into a production Amazon business dashboard with VAT-exclusive profitability, historical product cost, SKU mapping, Finance component normalization, EUR FX normalization, inventory and drill-down views.

**Architecture:** Keep the existing SP-API ingestion tables as source-of-truth. Add normalized Finance components, persistent SKU mappings and daily FX rates; calculate analytics in PostgreSQL RPCs with explicit completeness metadata; keep React responsible only for filters, presentation and mapping actions. Reuse the existing `amazon` permission, RLS model and Recharts dependency.

**Tech Stack:** PostgreSQL 17 / Supabase migrations and RPCs, Supabase Edge Functions on Deno/TypeScript, React 19.2.1, TypeScript 5.8.2, Recharts 2.15.4, lucide-react 0.468.0, Node 22 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-16-amazon-analytics-dashboard-design.md`

## Global Constraints

- Default analytics period is current month.
- Headline profitability is without VAT and before Amazon Ads.
- Cancelled/Canceled orders are excluded from sales, order count and units.
- Orders are the source of sales, units and order status; Finances is the source of fees, refunds and financial adjustments.
- Historical cost uses the latest `product_price_history.normalized_unit_price` with `price_date <= purchase_date`; never substitute a later cost.
- `consumption_factor` defaults to `1` and must be greater than zero.
- Exact SKU matching only; no fuzzy automatic SKU matching.
- All dashboard money is reported in EUR; missing FX makes profitability incomplete.
- Missing mapping, historical cost, VAT or FX must be surfaced as incomplete, never silently estimated.
- `ProductAdsPayment` and equivalent Ads costs are excluded from pre-Ads profitability until the Ads phase.
- No buyer/recipient PII may be requested, stored or rendered.
- All new workspace data must use existing workspace ownership and `private.app_has_permission('amazon')` checks.
- Do not add a second chart library.

---

## File Map

### Database
- Create `supabase/migrations/20260917001000_amazon_analytics_dashboard_schema.sql`: mappings, Finance components, FX tables, RLS, grants and indexes.
- Create `supabase/migrations/20260917002000_amazon_analytics_dashboard_rpcs.sql`: private analytical helpers plus public summary/detail/mapping RPCs.
- Create `supabase/migrations/20260917003000_amazon_fx_scheduler.sql`: daily FX cron using existing Vault `project_url` and `amazon_cron_secret_key`.

### Edge Functions
- Modify `supabase/functions/_shared/amazon/finances.ts`: normalize Finance breakdown components after transaction upsert.
- Create `supabase/functions/_shared/amazon/finance-components.ts`: pure breakdown walker/classifier producing non-overlapping components.
- Create `supabase/functions/_shared/amazon/fx.ts`: ECB parser and upsert logic.
- Create `supabase/functions/amazon-sync-fx/index.ts`: internal-only FX backfill/daily endpoint.

### Frontend
- Modify `src/services/amazon.ts`: typed analytics/mapping RPC clients.
- Create `src/components/amazon/AmazonFilters.tsx`.
- Create `src/components/amazon/AmazonCompleteness.tsx`.
- Create `src/components/amazon/AmazonSummary.tsx`.
- Create `src/components/amazon/AmazonProducts.tsx`.
- Create `src/components/amazon/AmazonMarketplaces.tsx`.
- Create `src/components/amazon/AmazonOrders.tsx`.
- Create `src/components/amazon/AmazonInventory.tsx`.
- Create `src/components/amazon/AmazonUnmapped.tsx`.
- Modify `src/pages/Amazon.tsx`: compact connection/status header and tab orchestration.
- Modify `src/amazon.css`: responsive dashboard/tabs/tables/cards/dark mode.

### Tests
- Create `scripts/amazon-analytics-schema.test.mjs`.
- Create `scripts/amazon-finance-components.test.mjs`.
- Create `scripts/amazon-fx-sync.test.mjs`.
- Create `scripts/amazon-analytics-rpcs.test.mjs`.
- Create `scripts/amazon-dashboard-ui.test.mjs`.

---

### Task 1: Add analytics storage schema, RLS and indexes

**Files:**
- Create: `supabase/migrations/20260917001000_amazon_analytics_dashboard_schema.sql`
- Create: `scripts/amazon-analytics-schema.test.mjs`

**Interfaces:**
- Produces table `public.amazon_product_mappings(owner_id, amazon_account_id, seller_sku, product_id, consumption_factor, mapping_source, created_at, updated_at)`.
- Produces table `public.amazon_finance_components(owner_id, amazon_account_id, finance_transaction_id, marketplace_id, amazon_order_id, seller_sku, asin, posted_date, component_key, component_type, component_category, amount_original, currency_code, tax_amount_original, amount_eur, tax_amount_eur, fx_rate, created_at, updated_at)`.
- Produces table `public.amazon_fx_rates(rate_date, currency_code, rate_to_eur, source, created_at, updated_at)`.

- [ ] **Step 1: Write the failing schema regression test**

Create `scripts/amazon-analytics-schema.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../supabase/migrations/20260917001000_amazon_analytics_dashboard_schema.sql', import.meta.url);
async function migration(){return readFile(migrationUrl,'utf8');}

test('Amazon analytics schema creates mappings, finance components and FX rates', async()=>{
  const sql = await migration();
  for (const table of ['amazon_product_mappings','amazon_finance_components','amazon_fx_rates']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(sql,/consumption_factor numeric[^\n]+check \(consumption_factor > 0\)/i);
  assert.match(sql,/unique \(owner_id, amazon_account_id, seller_sku\)/i);
  assert.match(sql,/unique \(owner_id, amazon_account_id, finance_transaction_id, component_key\)/i);
  assert.match(sql,/primary key \(rate_date, currency_code\)/i);
});

test('Amazon analytics tables are workspace scoped and permission protected', async()=>{
  const sql = await migration();
  for (const table of ['amazon_product_mappings','amazon_finance_components']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`create policy ${table}_select[\\s\\S]+private\\.app_workspace_owner_id\\(\\)[\\s\\S]+private\\.app_has_permission\\('amazon'\\)`));
  }
  assert.match(sql,/revoke insert, update, delete[\s\S]+amazon_finance_components[\s\S]+from anon, authenticated/i);
});

test('Amazon analytics schema adds lookup indexes used by RPCs', async()=>{
  const sql = await migration();
  for (const index of [
    'amazon_product_mappings_sku_idx',
    'amazon_product_mappings_product_idx',
    'amazon_finance_components_period_idx',
    'amazon_finance_components_order_idx',
    'amazon_finance_components_sku_idx',
    'amazon_fx_rates_lookup_idx',
    'amazon_price_history_analytics_idx'
  ]) assert.match(sql,new RegExp(index));
});
```

- [ ] **Step 2: Run the test and verify it fails because the migration is missing**

Run:

```bash
node --test scripts/amazon-analytics-schema.test.mjs
```

Expected: FAIL with `ENOENT` for `20260917001000_amazon_analytics_dashboard_schema.sql`.

- [ ] **Step 3: Create the schema migration**

Create `supabase/migrations/20260917001000_amazon_analytics_dashboard_schema.sql` with these exact core definitions and the same Amazon RLS pattern used by Phase B:

```sql
create table if not exists public.amazon_product_mappings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  seller_sku text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  consumption_factor numeric(18,6) not null default 1 check (consumption_factor > 0),
  mapping_source text not null default 'manual' check (mapping_source in ('automatic','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, seller_sku)
);

create table if not exists public.amazon_finance_components (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  amazon_account_id uuid not null references public.amazon_accounts(id) on delete cascade,
  finance_transaction_id uuid not null references public.amazon_finance_transactions(id) on delete cascade,
  marketplace_id text,
  amazon_order_id text,
  seller_sku text,
  asin text,
  posted_date timestamptz,
  component_key text not null,
  component_type text not null,
  component_category text not null check (component_category in (
    'refund','commission_fee','fba_fee','digital_services_fee','storage_fee',
    'other_amazon_fee','adjustment','ads_payment_excluded','sale_audit','tax_audit'
  )),
  amount_original numeric(18,6) not null,
  currency_code text not null,
  tax_amount_original numeric(18,6),
  amount_eur numeric(18,6),
  tax_amount_eur numeric(18,6),
  fx_rate numeric(20,10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, amazon_account_id, finance_transaction_id, component_key)
);

create table if not exists public.amazon_fx_rates (
  rate_date date not null,
  currency_code text not null,
  rate_to_eur numeric(20,10) not null check (rate_to_eur > 0),
  source text not null default 'ECB',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rate_date, currency_code)
);

create index if not exists amazon_product_mappings_sku_idx
  on public.amazon_product_mappings(owner_id, amazon_account_id, seller_sku);
create index if not exists amazon_product_mappings_product_idx
  on public.amazon_product_mappings(owner_id, product_id);
create index if not exists amazon_finance_components_period_idx
  on public.amazon_finance_components(owner_id, marketplace_id, posted_date desc, component_category);
create index if not exists amazon_finance_components_order_idx
  on public.amazon_finance_components(owner_id, amazon_order_id);
create index if not exists amazon_finance_components_sku_idx
  on public.amazon_finance_components(owner_id, seller_sku, posted_date desc);
create index if not exists amazon_fx_rates_lookup_idx
  on public.amazon_fx_rates(currency_code, rate_date desc);
create index if not exists amazon_price_history_analytics_idx
  on public.product_price_history(owner_id, product_id, price_date desc, created_at desc);

alter table public.amazon_product_mappings enable row level security;
alter table public.amazon_finance_components enable row level security;
alter table public.amazon_fx_rates enable row level security;

create policy amazon_product_mappings_select on public.amazon_product_mappings for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));
create policy amazon_finance_components_select on public.amazon_finance_components for select to authenticated
  using (owner_id = private.app_workspace_owner_id() and private.app_has_permission('amazon'));

-- FX contains no workspace/private information; authenticated Amazon users read it only through analytics RPCs.
revoke all on table public.amazon_fx_rates from anon, authenticated;

revoke all on table public.amazon_product_mappings, public.amazon_finance_components from anon;
revoke insert, update, delete on table public.amazon_product_mappings, public.amazon_finance_components from anon, authenticated;
grant select on table public.amazon_product_mappings, public.amazon_finance_components to authenticated;
```

Do not add direct authenticated mutation grants for mappings; mapping writes will go through validated RPCs in Task 5.

- [ ] **Step 4: Run the schema regression test**

Run:

```bash
node --test scripts/amazon-analytics-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run the full application test suite and build**

Run:

```bash
node --test scripts/*.test.mjs
npm run build
```

Expected: all tests PASS; TypeScript/Vite build succeeds.

- [ ] **Step 6: Commit Task 1**

```bash
git add supabase/migrations/20260917001000_amazon_analytics_dashboard_schema.sql scripts/amazon-analytics-schema.test.mjs
git commit -m "feat: add Amazon analytics storage schema"
```

---

### Task 2: Normalize Finance breakdowns into non-overlapping analytical components

**Files:**
- Create: `supabase/functions/_shared/amazon/finance-components.ts`
- Modify: `supabase/functions/_shared/amazon/finances.ts`
- Create: `scripts/amazon-finance-components.test.mjs`

**Interfaces:**
- Produces `normalizeFinanceComponents(transaction, persistedTransaction, job): FinanceComponentInput[]`.
- `FinanceComponentInput` contains `component_key`, `component_type`, `component_category`, `amount_original`, `currency_code`, `tax_amount_original` plus source linkage fields.
- Finance sync upserts transaction first, obtains its persisted UUID, then replaces/upserts deterministic components for that transaction.

- [ ] **Step 1: Write the failing parser/ingestion regression test**

Create `scripts/amazon-finance-components.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Finance component normalizer classifies fee/refund leaves without additive parent duplication', async()=>{
  const parser = await source('supabase/functions/_shared/amazon/finance-components.ts');
  for (const token of ['Commission','FBAPerUnitFulfillmentFee','DigitalServicesFee','Storage','Refunded Sales','ProductAdsPayment']) {
    assert.match(parser,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  }
  for (const category of ['commission_fee','fba_fee','digital_services_fee','storage_fee','refund','ads_payment_excluded']) {
    assert.match(parser,new RegExp(`['"]${category}['"]`));
  }
  assert.match(parser,/Base/);
  assert.match(parser,/Tax/);
  assert.match(parser,/component_key/);
});

test('Finances sync persists normalized components after transaction upsert', async()=>{
  const finances = await source('supabase/functions/_shared/amazon/finances.ts');
  assert.match(finances,/normalizeFinanceComponents/);
  assert.match(finances,/amazon_finance_components/);
  assert.match(finances,/finance_transaction_id/);
  assert.match(finances,/owner_id,amazon_account_id,finance_transaction_id,component_key/);
});
```

- [ ] **Step 2: Run the test and verify it fails because the parser module is missing**

```bash
node --test scripts/amazon-finance-components.test.mjs
```

Expected: FAIL with `ENOENT` for `finance-components.ts`.

- [ ] **Step 3: Implement the breakdown walker/classifier**

Create `supabase/functions/_shared/amazon/finance-components.ts` around these exact rules:

```ts
export type FinanceComponentCategory =
  | 'refund' | 'commission_fee' | 'fba_fee' | 'digital_services_fee'
  | 'storage_fee' | 'other_amazon_fee' | 'adjustment'
  | 'ads_payment_excluded' | 'sale_audit' | 'tax_audit';

type Breakdown={
  breakdownType?:string;
  breakdownAmount?:{currencyAmount?:number|string;currencyCode?:string};
  breakdowns?:Breakdown[];
};

function number(value:unknown){const n=Number(value);return Number.isFinite(n)?n:0;}
function amount(node:Breakdown){return number(node.breakdownAmount?.currencyAmount);}
function currency(node:Breakdown){return String(node.breakdownAmount?.currencyCode||'EUR');}
function children(node:Breakdown){return Array.isArray(node.breakdowns)?node.breakdowns:[];}
function type(node:Breakdown){return String(node.breakdownType||'').trim();}

function classify(name:string, transactionType:string):FinanceComponentCategory|null {
  const text=`${transactionType} ${name}`.toLowerCase();
  if(/productadspayment|advertis|sponsored/.test(text))return 'ads_payment_excluded';
  if(/refunded sales|refund|chargeback|return/.test(text))return 'refund';
  if(/commission|referral/.test(text))return 'commission_fee';
  if(/fbaperunitfulfillmentfee|fulfil+l?ment.*fee|fba.*fee/.test(text))return 'fba_fee';
  if(/digitalservicesfee/.test(text))return 'digital_services_fee';
  if(/storage/.test(text))return 'storage_fee';
  if(/adjust|reimburse|correction/.test(text))return 'adjustment';
  if(/^sales$|productcharges/.test(name.toLowerCase()))return 'sale_audit';
  if(/^tax$/.test(name.toLowerCase()))return 'tax_audit';
  if(/fee|expense|charge/.test(text))return 'other_amazon_fee';
  return null;
}

function economicNodes(nodes:Breakdown[], transactionType:string, path:string[]=[]):Array<{node:Breakdown;path:string[];category:FinanceComponentCategory;tax:number|null}> {
  const out:Array<{node:Breakdown;path:string[];category:FinanceComponentCategory;tax:number|null}>=[];
  for(let index=0;index<nodes.length;index+=1){
    const node=nodes[index];
    const nodeType=type(node);
    const nodePath=[...path,`${index}:${nodeType}`];
    const nested=children(node);
    const base=nested.find(child=>type(child).toLowerCase()==='base');
    const tax=nested.find(child=>type(child).toLowerCase()==='tax');
    const category=classify(nodeType,transactionType);
    if(category && (base || nested.length===0)){
      const source=base||node;
      out.push({node:source,path:nodePath,category,tax:tax?amount(tax):null});
      continue;
    }
    out.push(...economicNodes(nested,transactionType,nodePath));
  }
  return out;
}
```

`normalizeFinanceComponents` must hash the semantic path with SHA-256 to create a deterministic `component_key`; copy owner/account/marketplace/order/SKU/ASIN/date from the persisted Finance row; preserve signed amounts; and set `amount_eur`, `tax_amount_eur`, `fx_rate` to null for Task 3 to resolve.

- [ ] **Step 4: Change Finance persistence to upsert transaction rows and then component rows idempotently**

Replace the bulk-only transaction helper with a helper that returns persisted rows. The critical write contract is:

```ts
const {data:persisted,error}=await admin
  .from('amazon_finance_transactions')
  .upsert(rows,{onConflict:'owner_id,amazon_account_id,transaction_key'})
  .select('id,owner_id,amazon_account_id,marketplace_id,amazon_order_id,seller_sku,asin,posted_date,transaction_key,transaction_type');
if(error)throw error;

for(const row of persisted||[]){
  const original=transactionsByKey.get(row.transaction_key);
  const components=await normalizeFinanceComponents(original,row,job);
  await admin.from('amazon_finance_components').delete().eq('finance_transaction_id',row.id);
  if(components.length){
    const {error:componentError}=await admin.from('amazon_finance_components').upsert(components,{onConflict:'owner_id,amazon_account_id,finance_transaction_id,component_key'});
    if(componentError)throw componentError;
  }
}
```

Deleting only the selected transaction UUID before deterministic reinsert guarantees stale components disappear if Amazon changes a transaction breakdown.

- [ ] **Step 5: Run parser tests, full tests and build**

```bash
node --test scripts/amazon-finance-components.test.mjs scripts/amazon-finances-sync.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add supabase/functions/_shared/amazon/finance-components.ts supabase/functions/_shared/amazon/finances.ts scripts/amazon-finance-components.test.mjs
git commit -m "feat: normalize Amazon finance components"
```

---

### Task 3: Add ECB FX backfill/daily synchronization

**Files:**
- Create: `supabase/functions/_shared/amazon/fx.ts`
- Create: `supabase/functions/amazon-sync-fx/index.ts`
- Create: `supabase/migrations/20260917003000_amazon_fx_scheduler.sql`
- Create: `scripts/amazon-fx-sync.test.mjs`

**Interfaces:**
- Produces internal Edge Function `amazon-sync-fx` accepting `{from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD'}`.
- Upserts `amazon_fx_rates(rate_date,currency_code,rate_to_eur,source)`.
- Scheduler invokes it once daily through `apikey` loaded from Vault.

- [ ] **Step 1: Write the failing FX regression test**

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('FX sync uses ECB data, writes EUR-normalized daily rates and is internal only', async()=>{
  const fx=await source('supabase/functions/_shared/amazon/fx.ts');
  const edge=await source('supabase/functions/amazon-sync-fx/index.ts');
  assert.match(fx,/ecb\.europa\.eu|data-api\.ecb\.europa\.eu/i);
  assert.match(fx,/amazon_fx_rates/);
  assert.match(fx,/rate_to_eur/);
  assert.match(fx,/EUR/);
  assert.match(edge,/requireInternalSecret/);
});

test('FX scheduler invokes amazon-sync-fx with Vault apikey', async()=>{
  const sql=await source('supabase/migrations/20260917003000_amazon_fx_scheduler.sql');
  assert.match(sql,/amazon-sync-fx/);
  assert.match(sql,/amazon_cron_secret_key/);
  assert.match(sql,/project_url/);
  assert.match(sql,/'apikey'/);
});
```

- [ ] **Step 2: Run the test and verify missing files fail**

```bash
node --test scripts/amazon-fx-sync.test.mjs
```

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Implement ECB parsing and rate conversion**

Use ECB reference rates expressed as units of foreign currency per EUR. Store `rate_to_eur = 1 / ecb_rate` so `amount_eur = amount_original * rate_to_eur`.

The shared module must always include EUR explicitly:

```ts
export function toRateRows(observations:Array<{date:string;currency:string;rate:number}>){
  const rows=observations
    .filter(row=>row.currency&&row.date&&Number.isFinite(row.rate)&&row.rate>0)
    .map(row=>({rate_date:row.date,currency_code:row.currency.toUpperCase(),rate_to_eur:1/row.rate,source:'ECB',updated_at:new Date().toISOString()}));
  const dates=[...new Set(rows.map(row=>row.rate_date))];
  for(const date of dates)rows.push({rate_date:date,currency_code:'EUR',rate_to_eur:1,source:'ECB',updated_at:new Date().toISOString()});
  return rows;
}
```

Fetch only `PLN` and `SEK` initially because those are the active non-EUR Amazon marketplace currencies; keep the list derived from active marketplace rows in the Edge Function so future currencies are picked up without source edits.

- [ ] **Step 4: Implement the internal Edge Function and daily cron**

`amazon-sync-fx/index.ts` must call `requireInternalSecret(req)`, load active marketplace currency codes through the admin client, default `from` to 7 days ago and `to` to today for normal daily runs, accept explicit backfill dates, fetch ECB observations, and upsert on `rate_date,currency_code`.

Create scheduler SQL that unschedules an existing `amazon-fx-daily` job if present and schedules daily at `04:17` UTC:

```sql
select cron.schedule(
  'amazon-fx-daily',
  '17 4 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='project_url') || '/functions/v1/amazon-sync-fx',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='amazon_cron_secret_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

- [ ] **Step 5: Run tests and build**

```bash
node --test scripts/amazon-fx-sync.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add supabase/functions/_shared/amazon/fx.ts supabase/functions/amazon-sync-fx/index.ts supabase/migrations/20260917003000_amazon_fx_scheduler.sql scripts/amazon-fx-sync.test.mjs
git commit -m "feat: sync Amazon analytics FX rates"
```

---

### Task 4: Add SQL helpers plus Summary and Series analytics RPCs

**Files:**
- Create: `supabase/migrations/20260917002000_amazon_analytics_dashboard_rpcs.sql`
- Create: `scripts/amazon-analytics-rpcs.test.mjs`

**Interfaces:**
- Produces private `private.amazon_rate_to_eur(currency text, event_date date) returns numeric` with a 7-day historical lookback.
- Produces private `private.amazon_historical_unit_cost(owner uuid, product uuid, event_date date) returns numeric`.
- Produces public `amazon_analytics_summary(from_date date, to_date date, marketplace_ids text[] default null) returns jsonb`.
- Produces public `amazon_analytics_series(from_date date, to_date date, marketplace_ids text[] default null, grain text default 'day') returns jsonb`.

- [ ] **Step 1: Write failing RPC contract tests**

Create `scripts/amazon-analytics-rpcs.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const file=new URL('../supabase/migrations/20260917002000_amazon_analytics_dashboard_rpcs.sql',import.meta.url);
async function sql(){return readFile(file,'utf8');}

test('Analytics RPC migration defines historical cost and bounded FX helpers',async()=>{
  const text=await sql();
  assert.match(text,/private\.amazon_rate_to_eur/);
  assert.match(text,/interval '7 days'/i);
  assert.match(text,/private\.amazon_historical_unit_cost/);
  assert.match(text,/price_date <=/i);
  assert.match(text,/order by[^;]+price_date desc/is);
});

test('Summary and series RPCs expose approved KPIs and completeness',async()=>{
  const text=await sql();
  for(const fn of ['amazon_analytics_summary','amazon_analytics_series'])assert.match(text,new RegExp(`function public\\.${fn}`));
  for(const key of ['netSales','orders','units','amazonFees','refunds','productCost','profitBeforeAds','marginPct','profitComplete'])assert.match(text,new RegExp(key));
  assert.match(text,/adsExcluded/);
  assert.match(text,/unmappedSkuCount/);
  assert.match(text,/missingHistoricalCostCount/);
  assert.match(text,/missingFxEventCount/);
  assert.match(text,/missingVatOrderCount/);
});
```

- [ ] **Step 2: Run the RPC test and verify it fails**

```bash
node --test scripts/amazon-analytics-rpcs.test.mjs
```

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Implement private EUR and historical-cost helpers**

Add these helpers to the migration:

```sql
create or replace function private.amazon_rate_to_eur(p_currency text, p_event_date date)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select case
    when upper(coalesce(p_currency,'EUR'))='EUR' then 1::numeric
    else (
      select r.rate_to_eur
      from public.amazon_fx_rates r
      where r.currency_code=upper(p_currency)
        and r.rate_date between p_event_date - interval '7 days' and p_event_date
      order by r.rate_date desc
      limit 1
    )
  end;
$$;

create or replace function private.amazon_historical_unit_cost(p_owner uuid, p_product uuid, p_event_date date)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select h.normalized_unit_price
  from public.product_price_history h
  where h.owner_id=p_owner
    and h.product_id=p_product
    and h.normalized_unit_price is not null
    and h.price_date <= p_event_date
  order by h.price_date desc, h.created_at desc, h.id desc
  limit 1;
$$;
```

Revoke public/anon/authenticated execution on private helpers; analytics RPCs call them under their own security-definer context.

- [ ] **Step 4: Implement `amazon_analytics_summary` with separate order-date and finance-posted-date CTEs**

Use `private.app_workspace_owner_id()` as the only owner source and raise if `private.app_has_permission('amazon')` is false. Validate `to_date >= from_date`.

The query must compute:

```sql
-- Orders side, event date = purchase_date::date
net_sales_eur = (order_total - vat_amount) * order_fx
orders = count(distinct amazon_order_id)
units = sum(quantity_ordered)
product_cost_eur = sum(quantity_ordered * consumption_factor * historical_unit_cost)

-- Finance side, event date = posted_date::date
-- Exclude sale_audit, tax_audit and ads_payment_excluded from headline cost.
finance_effect_eur = amount_original * finance_fx
amazon_fee_effect_eur = sum(finance_effect_eur) for fee categories
refund_effect_eur = sum(finance_effect_eur) for refund

-- Display positive deductions, while formula preserves signed source effect.
amazonFees = -amazon_fee_effect_eur
refunds = -refund_effect_eur
profitBeforeAds = net_sales_eur + amazon_fee_effect_eur + refund_effect_eur - product_cost_eur
marginPct = case when net_sales_eur<>0 then profitBeforeAds/net_sales_eur*100 end
```

Completeness counters must be calculated from affected source rows, not from UI assumptions:

```sql
unmappedSkuCount
unmappedUnits
missingHistoricalCostCount
missingHistoricalCostUnits
missingFxEventCount
missingVatOrderCount
syncQueued
syncRunning
syncFailed
adsExcluded = true
profitComplete = all four missing-input counters are zero and syncFailed=0
```

Return a JSON object with exactly these camelCase keys so the frontend contract is stable.

- [ ] **Step 5: Implement `amazon_analytics_series` using the same formulas grouped by day/month**

Validate `grain in ('day','month')`. Return JSON array rows with:

```json
{"period":"2026-09-01","netSales":123.45,"profitBeforeAds":45.67,"orders":8,"units":12,"profitComplete":true}
```

The series must reuse the same private SQL views/CTEs or helper functions as summary so formulas cannot drift.

- [ ] **Step 6: Lock down RPC privileges**

For each public analytics function:

```sql
revoke all on function public.amazon_analytics_summary(date,date,text[]) from public, anon;
grant execute on function public.amazon_analytics_summary(date,date,text[]) to authenticated;
```

Apply equivalent grants to `amazon_analytics_series`.

- [ ] **Step 7: Run tests and build**

```bash
node --test scripts/amazon-analytics-rpcs.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add supabase/migrations/20260917002000_amazon_analytics_dashboard_rpcs.sql scripts/amazon-analytics-rpcs.test.mjs
git commit -m "feat: add Amazon summary analytics RPCs"
```

---

### Task 5: Add product, marketplace, order, inventory, unmapped and mapping RPCs

**Files:**
- Modify: `supabase/migrations/20260917002000_amazon_analytics_dashboard_rpcs.sql`
- Modify: `scripts/amazon-analytics-rpcs.test.mjs`

**Interfaces:**
- Produces `amazon_analytics_products(from_date date,to_date date,marketplace_ids text[] default null,search text default null,page integer default 1,page_size integer default 25) returns jsonb`.
- Produces `amazon_analytics_marketplaces(from_date date,to_date date,marketplace_ids text[] default null) returns jsonb`.
- Produces `amazon_analytics_orders(from_date date,to_date date,marketplace_ids text[] default null,search text default null,page integer default 1,page_size integer default 25) returns jsonb`.
- Produces `amazon_analytics_inventory(marketplace_ids text[] default null,search text default null,page integer default 1,page_size integer default 25) returns jsonb`.
- Produces `amazon_analytics_unmapped_skus(search text default null,page integer default 1,page_size integer default 25) returns jsonb`.
- Produces `amazon_set_product_mapping(seller_sku text,product_id uuid,consumption_factor numeric default 1) returns jsonb`.
- Produces `amazon_delete_product_mapping(seller_sku text) returns jsonb`.

- [ ] **Step 1: Extend the contract tests before implementation**

Append to `scripts/amazon-analytics-rpcs.test.mjs`:

```js
test('Detail and mapping RPCs are present and paginated',async()=>{
  const text=await sql();
  for(const fn of [
    'amazon_analytics_products','amazon_analytics_marketplaces','amazon_analytics_orders',
    'amazon_analytics_inventory','amazon_analytics_unmapped_skus',
    'amazon_set_product_mapping','amazon_delete_product_mapping'
  ]) assert.match(text,new RegExp(`function public\\.${fn}`));
  assert.match(text,/page_size/);
  assert.match(text,/consumption_factor > 0|consumption factor/i);
  assert.match(text,/private\.app_workspace_owner_id\(\)/);
  assert.match(text,/private\.app_has_permission\('amazon'\)/);
});
```

- [ ] **Step 2: Run test and verify the new assertions fail**

```bash
node --test scripts/amazon-analytics-rpcs.test.mjs
```

Expected: FAIL because detail/mapping RPC names are absent.

- [ ] **Step 3: Implement detail read RPCs using the same analytical base**

Return shapes:

```ts
// Products
{items:[{sellerSku,asin,productId,productName,units,netSales,amazonFees,refunds,productCost,profitBeforeAds,marginPct,profitComplete}],page,pageSize,total}
// Marketplaces
{items:[{marketplaceId,countryCode,name,orders,units,netSales,amazonFees,refunds,productCost,profitBeforeAds,marginPct,profitComplete}]}
// Orders
{items:[{amazonOrderId,purchaseDate,marketplaceId,status,units,netSales,amazonFees,refunds,productCost,profitBeforeAds,profitComplete}],page,pageSize,total}
// Inventory
{items:[{sellerSku,asin,marketplaceId,fulfillable,reserved,inbound,unfulfillable,researching,total,lastSync}],page,pageSize,total}
// Unmapped
{items:[{sellerSku,asin,marketplaceIds,orders,units,recentNetSales}],page,pageSize,total}
```

Search must be parameterized with `ilike '%' || coalesce(search,'') || '%'` against SKU/ASIN/product name/order ID as appropriate; never concatenate raw SQL.

- [ ] **Step 4: Implement mapping mutations with cross-workspace validation**

The setter must:

```sql
v_owner := private.app_workspace_owner_id();
if not private.app_has_permission('amazon') then raise exception 'Forbidden'; end if;
if coalesce(trim(seller_sku),'')='' then raise exception 'seller_sku is required'; end if;
if consumption_factor is null or consumption_factor <= 0 then raise exception 'consumption_factor must be greater than zero'; end if;
select id into v_product from public.products where id=product_id and owner_id=v_owner;
if v_product is null then raise exception 'Product not found in workspace'; end if;
select id into v_account from public.amazon_accounts where owner_id=v_owner and status='connected' order by created_at limit 1;
if v_account is null then raise exception 'Amazon account not connected'; end if;
insert into public.amazon_product_mappings(...)
values(v_owner,v_account,trim(seller_sku),v_product,consumption_factor,'manual',now(),now())
on conflict(owner_id,amazon_account_id,seller_sku) do update
set product_id=excluded.product_id, consumption_factor=excluded.consumption_factor, mapping_source='manual', updated_at=now();
```

The delete RPC removes only `owner_id=v_owner` + connected account + exact seller SKU.

- [ ] **Step 5: Grant authenticated execute only**

Revoke `public`/`anon`, grant `authenticated` on every new public RPC signature.

- [ ] **Step 6: Run tests and build**

```bash
node --test scripts/amazon-analytics-rpcs.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
git add supabase/migrations/20260917002000_amazon_analytics_dashboard_rpcs.sql scripts/amazon-analytics-rpcs.test.mjs
git commit -m "feat: add Amazon analytics detail RPCs"
```

---

### Task 6: Add typed frontend analytics service and period helpers

**Files:**
- Modify: `src/services/amazon.ts`
- Create: `scripts/amazon-dashboard-ui.test.mjs`

**Interfaces:**
- Produces `AmazonAnalyticsFilters`, `AmazonSummary`, `AmazonSeriesPoint`, paginated detail types.
- Produces `loadAmazonSummary`, `loadAmazonSeries`, `loadAmazonProducts`, `loadAmazonMarketplaces`, `loadAmazonOrders`, `loadAmazonInventory`, `loadAmazonUnmapped`, `setAmazonProductMapping`, `deleteAmazonProductMapping`.
- Produces `amazonQuickRange(key, now)` helper for deterministic preset dates.

- [ ] **Step 1: Write failing service/UI contract test**

Create `scripts/amazon-dashboard-ui.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8');}

test('Amazon service exposes typed analytics and mapping calls',async()=>{
  const service=await source('src/services/amazon.ts');
  for(const name of [
    'AmazonAnalyticsFilters','AmazonSummary','AmazonSeriesPoint','loadAmazonSummary','loadAmazonSeries',
    'loadAmazonProducts','loadAmazonMarketplaces','loadAmazonOrders','loadAmazonInventory','loadAmazonUnmapped',
    'setAmazonProductMapping','deleteAmazonProductMapping','amazonQuickRange'
  ]) assert.match(service,new RegExp(name));
  for(const rpc of [
    'amazon_analytics_summary','amazon_analytics_series','amazon_analytics_products','amazon_analytics_marketplaces',
    'amazon_analytics_orders','amazon_analytics_inventory','amazon_analytics_unmapped_skus','amazon_set_product_mapping'
  ]) assert.match(service,new RegExp(rpc));
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
```

Expected: FAIL on missing analytics names.

- [ ] **Step 3: Add stable TypeScript contracts**

Add these core types to `src/services/amazon.ts`:

```ts
export type AmazonRangeKey='today'|'7d'|'30d'|'current_month'|'previous_month'|'current_quarter'|'current_year'|'custom';
export type AmazonAnalyticsFilters={from:string;to:string;marketplaceIds:string[]};
export type AmazonCompleteness={
  profitComplete:boolean;unmappedSkuCount:number;unmappedUnits:number;
  missingHistoricalCostCount:number;missingHistoricalCostUnits:number;
  missingFxEventCount:number;missingVatOrderCount:number;
  syncQueued:number;syncRunning:number;syncFailed:number;adsExcluded:true;
};
export type AmazonSummary=AmazonCompleteness&{
  netSales:number;orders:number;units:number;amazonFees:number;refunds:number;
  productCost:number;profitBeforeAds:number|null;marginPct:number|null;
};
export type AmazonSeriesPoint={period:string;netSales:number;profitBeforeAds:number|null;orders:number;units:number;profitComplete:boolean};
```

Each RPC wrapper must call `supabase.rpc`, throw `new Error(message(...))` on error, and pass snake_case parameter names matching SQL.

- [ ] **Step 4: Implement deterministic quick-range calculation**

`amazonQuickRange('current_month', now)` must return local-calendar YYYY-MM-DD boundaries from day 1 to `now`; `previous_month` returns the full prior month; quarter starts at month `Math.floor(month/3)*3`; rolling 7d/30d are inclusive ending today.

- [ ] **Step 5: Run service test, full tests and build**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/services/amazon.ts scripts/amazon-dashboard-ui.test.mjs
git commit -m "feat: add Amazon analytics frontend service"
```

---

### Task 7: Build compact Amazon shell, filters, completeness banner and Summary dashboard

**Files:**
- Create: `src/components/amazon/AmazonFilters.tsx`
- Create: `src/components/amazon/AmazonCompleteness.tsx`
- Create: `src/components/amazon/AmazonSummary.tsx`
- Modify: `src/pages/Amazon.tsx`
- Modify: `src/amazon.css`
- Modify: `scripts/amazon-dashboard-ui.test.mjs`

**Interfaces:**
- `AmazonFilters` emits a complete `AmazonAnalyticsFilters` object.
- `AmazonCompleteness` renders incomplete/backfill/Ads-excluded state without hiding known values.
- `AmazonSummary` loads/render KPIs and series for supplied filters.

- [ ] **Step 1: Extend the UI regression test before adding components**

Append:

```js
test('Amazon page is a tabbed analytics dashboard with approved Summary KPIs',async()=>{
  const page=await source('src/pages/Amazon.tsx');
  const summary=await source('src/components/amazon/AmazonSummary.tsx');
  for(const tab of ['Resumen','Productos','Marketplaces','Pedidos','Inventario','Sin vincular'])assert.match(page,new RegExp(tab));
  for(const label of ['Ventas sin IVA','Pedidos','Unidades vendidas','Tarifas Amazon','Reembolsos','Coste producto','Beneficio antes de Ads','Margen'])assert.match(summary,new RegExp(label));
  assert.match(summary,/LineChart|AreaChart/);
  assert.match(summary,/Recharts|recharts/);
});
```

- [ ] **Step 2: Run and verify missing component failure**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
```

Expected: FAIL with `ENOENT` for `AmazonSummary.tsx`.

- [ ] **Step 3: Replace the large connection card with a compact header/status strip and tab state**

`src/pages/Amazon.tsx` must keep Seller Central, Sellerboard and admin sync button, then render:

```tsx
const tabs=['summary','products','marketplaces','orders','inventory','unmapped'] as const;
const [activeTab,setActiveTab]=useState<(typeof tabs)[number]>('summary');
const [filters,setFilters]=useState<AmazonAnalyticsFilters>(()=>({
  ...amazonQuickRange('current_month',new Date()),
  marketplaceIds:[],
}));
```

Show `Conectado`, last successful sync, and queue counts in one compact strip rather than the old full-width technical connection card.

- [ ] **Step 4: Implement `AmazonFilters`**

Render quick buttons for all approved presets, two date inputs when Custom is selected, and marketplace chips/select based on active marketplaces from `AmazonStatus`. Applying a preset immediately calls `onChange` with new dates while preserving marketplace selection.

- [ ] **Step 5: Implement `AmazonCompleteness`**

If `profitComplete` is false, show a warning containing concrete counts for unmapped SKU, missing cost, missing FX, missing VAT and failed jobs. If sync queue/running > 0 show `Sincronización histórica en curso`. Always show `Beneficio antes de Ads` / `Ads no incluido` while `adsExcluded` is true.

- [ ] **Step 6: Implement Summary KPIs and chart**

`AmazonSummary` must call `loadAmazonSummary(filters)` and `loadAmazonSeries(filters, grain)` together with `Promise.all`, where grain is `month` only when the date span exceeds 93 days; otherwise `day`.

Use Recharts `ResponsiveContainer`, `LineChart`, two `Line`s for `netSales` and `profitBeforeAds`, CartesianGrid, XAxis, YAxis and Tooltip. No new dependency.

- [ ] **Step 7: Add responsive/dark CSS**

Add classes for `.amazonTabs`, `.amazonFilters`, `.amazonKpiGrid`, `.amazonKpiCard`, `.amazonQualityBanner`, `.amazonChartCard`, `.amazonCompactStatus`; use existing CSS variables/colors where available. At `max-width:900px` make KPI grid two columns; at `max-width:520px` one column and horizontally scroll tab buttons.

- [ ] **Step 8: Run tests and build**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add src/pages/Amazon.tsx src/amazon.css src/components/amazon/AmazonFilters.tsx src/components/amazon/AmazonCompleteness.tsx src/components/amazon/AmazonSummary.tsx scripts/amazon-dashboard-ui.test.mjs
git commit -m "feat: build Amazon analytics summary dashboard"
```

---

### Task 8: Build Products, Marketplaces, Orders and Inventory tabs

**Files:**
- Create: `src/components/amazon/AmazonProducts.tsx`
- Create: `src/components/amazon/AmazonMarketplaces.tsx`
- Create: `src/components/amazon/AmazonOrders.tsx`
- Create: `src/components/amazon/AmazonInventory.tsx`
- Modify: `src/pages/Amazon.tsx`
- Modify: `src/amazon.css`
- Modify: `scripts/amazon-dashboard-ui.test.mjs`

**Interfaces:**
- Each tab consumes `filters: AmazonAnalyticsFilters`.
- Products/Orders/Inventory own `search`, `page`, `pageSize`; Marketplaces is grouped and unpaginated.
- Products provides mapping correction entry point, implemented by shared mapping workflow from Task 9.

- [ ] **Step 1: Extend UI regression tests**

Append assertions that each component imports its corresponding loader and contains required visible columns/labels:

```js
test('Amazon detail tabs use typed loaders and expose approved business fields',async()=>{
  const cases=[
    ['src/components/amazon/AmazonProducts.tsx','loadAmazonProducts',['SKU','Unidades','Ventas','Coste','Tarifas','Beneficio','Margen']],
    ['src/components/amazon/AmazonMarketplaces.tsx','loadAmazonMarketplaces',['Marketplace','Pedidos','Unidades','Ventas','Beneficio']],
    ['src/components/amazon/AmazonOrders.tsx','loadAmazonOrders',['Pedido','Fecha','Marketplace','Estado','Ventas','Beneficio']],
    ['src/components/amazon/AmazonInventory.tsx','loadAmazonInventory',['SKU','Disponible','Reservado','Entrante','No disponible','Total']],
  ];
  for(const [path,loader,labels] of cases){
    const text=await source(path);
    assert.match(text,new RegExp(loader));
    for(const label of labels)assert.match(text,new RegExp(label));
  }
});
```

- [ ] **Step 2: Run and verify missing files fail**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
```

Expected: FAIL with missing component files.

- [ ] **Step 3: Implement each data table with shared interaction conventions**

Use semantic `<table>` on desktop and CSS overflow container on mobile rather than duplicating a second data model. Money uses `Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'})`; percentages use one decimal. `profitComplete=false` renders `Incompleto` badge next to profit instead of suppressing the numeric known-subset value.

- [ ] **Step 4: Wire tabs in `Amazon.tsx`**

Render only the active tab component so deep views do not issue background RPCs unnecessarily:

```tsx
{activeTab==='products'&&<AmazonProducts filters={filters}/>} 
{activeTab==='marketplaces'&&<AmazonMarketplaces filters={filters}/>} 
{activeTab==='orders'&&<AmazonOrders filters={filters}/>} 
{activeTab==='inventory'&&<AmazonInventory filters={filters}/>} 
```

- [ ] **Step 5: Add responsive table/search/pagination CSS**

All tab toolbars wrap at 900px; search becomes full width under 520px; pagination controls remain tap-friendly; tables use `min-width` plus horizontal scrolling rather than clipping actions.

- [ ] **Step 6: Run tests and build**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/components/amazon/AmazonProducts.tsx src/components/amazon/AmazonMarketplaces.tsx src/components/amazon/AmazonOrders.tsx src/components/amazon/AmazonInventory.tsx src/pages/Amazon.tsx src/amazon.css scripts/amazon-dashboard-ui.test.mjs
git commit -m "feat: add Amazon analytics detail tabs"
```

---

### Task 9: Build the Sin vincular workflow and mapping correction

**Files:**
- Create: `src/components/amazon/AmazonUnmapped.tsx`
- Modify: `src/components/amazon/AmazonProducts.tsx`
- Modify: `src/pages/Amazon.tsx`
- Modify: `src/amazon.css`
- Modify: `scripts/amazon-dashboard-ui.test.mjs`

**Interfaces:**
- `AmazonUnmapped` loads unmatched SKUs and internal products, validates factor > 0, calls `setAmazonProductMapping` and reloads its list after success.
- Product rows with existing mappings can invoke the same product/factor editor and can remove a bad mapping through `deleteAmazonProductMapping`.

- [ ] **Step 1: Extend mapping UI regression tests**

```js
test('Sin vincular supports internal product selection and consumption factor',async()=>{
  const text=await source('src/components/amazon/AmazonUnmapped.tsx');
  assert.match(text,/loadAmazonUnmapped/);
  assert.match(text,/setAmazonProductMapping/);
  assert.match(text,/Factor|factor/);
  assert.match(text,/Producto interno|producto interno/);
  assert.match(text,/sellerSku/);
});
```

- [ ] **Step 2: Run and verify missing file failure**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
```

Expected: FAIL with missing `AmazonUnmapped.tsx`.

- [ ] **Step 3: Implement the unmatched SKU list and product selector**

Load internal products through the existing products service already used by the Products module; do not add a direct unrestricted products table query if an existing workspace-scoped loader is available. For each unmatched SKU show SKU, ASIN, marketplaces, affected orders/units, recent net sales, searchable internal-product select and factor input defaulting to `1`.

Before save:

```ts
const factor=Number(consumptionFactor);
if(!productId){showError('Selecciona un producto interno.');return;}
if(!Number.isFinite(factor)||factor<=0){showError('El factor debe ser mayor que 0.');return;}
await setAmazonProductMapping({sellerSku:item.sellerSku,productId,consumptionFactor:factor});
showSuccess('Producto de Amazon vinculado.');
await refresh();
```

- [ ] **Step 4: Add mapping correction in Products**

For a mapped product row render `Cambiar vínculo`; open the same editor values with current `productId`/factor. Render `Eliminar vínculo` only inside that explicit edit state and confirm before calling `deleteAmazonProductMapping`.

- [ ] **Step 5: Wire `Sin vincular` tab and badge count**

`Amazon.tsx` renders `<AmazonUnmapped/>` for the tab. The Summary completeness/unmapped count should be used as a badge when available; do not issue a duplicate RPC solely for the badge.

- [ ] **Step 6: Run tests and build**

```bash
node --test scripts/amazon-dashboard-ui.test.mjs
node --test scripts/*.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9**

```bash
git add src/components/amazon/AmazonUnmapped.tsx src/components/amazon/AmazonProducts.tsx src/pages/Amazon.tsx src/amazon.css scripts/amazon-dashboard-ui.test.mjs
git commit -m "feat: add Amazon SKU mapping workflow"
```

---

### Task 10: Production migration, historical backfills and end-to-end verification

**Files:**
- No new source files expected; deploy artifacts created by Tasks 1-9.

**Interfaces:**
- Production Supabase project: `sjkxxbedkkmgmqnvaqjh`.
- Existing Amazon Edge Functions continue to use the current server secret model.
- New `amazon-sync-fx` is deployed `verify_jwt=false` and authenticates with `requireInternalSecret`.

- [ ] **Step 1: Run local verification before any production mutation**

```bash
node --test scripts/*.test.mjs
npm run build
```

Expected: all tests PASS; build succeeds.

- [ ] **Step 2: Apply database migrations in order**

Apply:

```text
20260917001000_amazon_analytics_dashboard_schema.sql
20260917002000_amazon_analytics_dashboard_rpcs.sql
20260917003000_amazon_fx_scheduler.sql
```

After each migration, query `pg_tables`, `pg_proc` and `pg_policies` to verify objects/policies exist before continuing.

- [ ] **Step 3: Deploy changed/new Edge Functions**

Deploy:

```text
amazon-sync-finances   (changed shared Finance component logic)
amazon-sync-worker     (redeploy because it imports changed shared Finance code)
amazon-sync-fx         (new, verify_jwt=false)
```

Also redeploy any existing function bundle required by the project deployment mechanism when shared imports are embedded at deploy time.

- [ ] **Step 4: Backfill Finance components from persisted sanitized metadata**

Use a one-time SQL/Edge-safe reprocessing path, not direct client-side JSON parsing. For every existing `amazon_finance_transactions` row, feed its stored sanitized `metadata.breakdowns` through the same normalizer used by live ingestion and upsert `amazon_finance_components`. Verify:

```sql
select count(*) as transactions from public.amazon_finance_transactions;
select count(*) as components from public.amazon_finance_components;
select component_category,count(*) from public.amazon_finance_components group by 1 order by 1;
```

Expected: components > 0 and representative categories include `commission_fee`/`fba_fee` and `refund` where source data contains them.

- [ ] **Step 5: Backfill ECB rates from 2026-01-01 through today**

Invoke `amazon-sync-fx` internally with:

```json
{"from":"2026-01-01","to":"2026-09-17"}
```

Verify:

```sql
select currency_code,min(rate_date),max(rate_date),count(*)
from public.amazon_fx_rates
where currency_code in ('EUR','PLN','SEK')
group by currency_code
order by currency_code;
```

Expected: EUR/PLN/SEK present with historical dates covering the backfill window subject to ECB business-day publication.

- [ ] **Step 6: Smoke-test analytics RPCs using the authenticated app**

Verify current month and a January historical range. Confirm:

```text
- Cancelled orders do not contribute.
- Summary, series and detail totals reconcile within rounding.
- Profit is marked incomplete while the 20 currently-unmatched SKUs remain unmapped.
- Saving one mapping removes that SKU from Sin vincular and reduces the unmapped completeness count.
- A factor > 1 changes historical product cost without rewriting order rows.
- EUR data does not require an FX table hit; PLN/SEK do.
- Ads finance events do not enter the pre-Ads fee KPI.
```

- [ ] **Step 7: Check sync/backfill health after deployment**

Query Amazon job counts and latest failures. There must be no new permanent failure caused by Finance component normalization or FX deployment. Existing historical queue may continue processing normally.

- [ ] **Step 8: Run Supabase security/performance advisors**

Confirm no new exposed tables/functions and no new unindexed foreign keys from the analytics tables. Existing unrelated warnings must be recorded separately rather than claimed fixed.

- [ ] **Step 9: Final repository/CI verification**

Push the implementation branch, open a PR, wait for GitHub Actions `node --test scripts/*.test.mjs`, `npm run build`, and artifact upload to pass. Review the diff for secrets/PII before merge.

- [ ] **Step 10: Commit any deployment-only documentation adjustment if required**

If deployment revealed a necessary documented setup change, commit only that concrete change; otherwise do not create a no-op documentation commit.
