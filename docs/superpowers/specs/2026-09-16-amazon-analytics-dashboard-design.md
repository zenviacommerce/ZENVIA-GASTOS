# Amazon Analytics dashboard — design

Date: 2026-09-16

## Context

Phase B already connects ZENVIA COMMERCE SL to Amazon SP-API, discovers the active EU marketplaces, synchronizes Orders, Finances and FBA Inventory, and runs an initial backfill from 2026-01-01 plus recurring sync jobs.

The current Amazon page is still primarily a connection/status screen. The next phase turns it into a business dashboard for sales, Amazon costs, product cost, profitability and inventory while keeping the existing SP-API sync architecture.

Production data exposed two important implementation facts:

- Amazon seller SKUs do not currently match internal `products.sku` values automatically, so explicit SKU mapping is required from day one.
- A Finance transaction total cannot be treated as a single fee/refund category. For example, a `Shipment` transaction contains nested `Sales`, tax and multiple Amazon fee breakdowns while its transaction total is only the net settlement effect. Analytics must therefore normalize the Finance breakdown tree and must not sum parent and child nodes together.

## Goals

1. Provide a useful Amazon business dashboard with a default period of the current month.
2. Calculate profitability without VAT using historical product cost valid on the order date.
3. Keep Orders as the source of sales, units and order state, and Finances as the source of Amazon fees, refunds and financial adjustments.
4. Support all active EU marketplaces and normalize non-EUR currencies to EUR.
5. Support explicit Amazon SKU -> internal product mappings, including packs/bundles through a consumption factor.
6. Make incomplete profitability visible instead of silently estimating missing cost, VAT or FX.
7. Preserve workspace isolation, the existing `amazon` permission model and the no-buyer-PII constraint.

## Non-goals

- Amazon Ads API integration, ACOS and TACOS are not part of this phase. Existing finance events such as `ProductAdsPayment` must not be silently folded into the pre-Ads profitability KPI. The UI will label profit as excluding Ads until the Ads phase is implemented.
- No forecasting or replenishment recommendations in this phase.
- No fuzzy automatic SKU matching.
- No materialized aggregate tables initially. Parameterized SQL/RPC analytics are sufficient for the current data volume; pre-aggregation can be introduced later if measurements justify it.

## Approved business rules

### Period and filters

- Default period: current month.
- Quick filters: Today, 7 days, 30 days, Current month, Previous month, Current quarter, Current year, Custom range.
- Global marketplace filter supports all marketplaces or one/more selected marketplaces.

### Eligible orders

- Cancelled orders do not count toward sales, order count or units. Both `Canceled` and `Cancelled` spellings are treated as cancelled defensively.
- Orders are dated by `purchase_date`.

### Sales without VAT

For eligible orders:

`net_sales = gross/order total - VAT`

The Orders feed remains the canonical source for sales and units so Finance shipment totals cannot double count revenue.

If VAT required for a row is missing, that portion of profitability is marked incomplete rather than inferred silently.

### Historical product cost

For each Amazon order item:

1. Resolve its `seller_sku` to an internal `product_id`.
2. Read the latest `product_price_history.normalized_unit_price` whose `price_date <= order.purchase_date`.
3. Calculate:

`product_cost = quantity_ordered * consumption_factor * historical_unit_cost`

Rules:

- `consumption_factor` defaults to `1` and must be greater than zero.
- A changed mapping or factor recalculates historical analytics automatically because analytics resolves from source tables at query time.
- A cost recorded after the sale is not used retroactively as an estimate for that sale.
- If no valid mapping or historical cost exists, the affected amount is incomplete.

### Amazon SKU mapping

Automatic matching is only allowed for exact seller SKU matches to internal product SKU. There is no fuzzy auto-linking.

Unmatched SKUs are surfaced in the `Sin vincular` tab. The user selects an internal product and a consumption factor once; the mapping persists and is reusable across historical and future calculations.

Existing mappings can be corrected from the Products experience.

### Finance normalization and fees

`amazon_finance_transactions.amount_original` is the transaction total, not a fee amount. The existing coarse `category` remains useful for diagnostics but is not authoritative for profitability.

The implementation will normalize meaningful Finance breakdown components into a dedicated relational table. The parser must understand nested breakdowns without double counting parent totals and their children.

For finalized shipment-style transactions, examples include:

- Product charges / sales components.
- Tax components.
- Commission / referral-like fees.
- FBA per-unit fulfillment fees.
- Digital services fees.
- Storage and other Amazon fees when present.

For refund transactions, examples include:

- Refunded product charges.
- Refunded tax.
- Reversed/refunded Amazon fees.

Profitability uses fee amounts without their VAT component when Amazon exposes a distinct `Base` and `Tax` breakdown, because the headline KPI is defined without VAT. Fee taxes remain available for audit/detail but are not treated as business cost in that KPI.

The normalizer will preserve the signed source amount. Analytical categories describe meaning; they must not assume that every cost arrives with one particular sign.

### Refunds and financial timing

Refunds are sourced from Finance and reduce profitability when their Finance event is posted. Financial events are filtered by `posted_date` in period summaries. Where Amazon supplies an order ID/SKU, the event remains linked to that order/product for drill-down.

Order detail may show all known linked financial events for the selected order even when those events were posted after the original purchase date.

### Profitability formula

The primary KPI is profitability without VAT and before Amazon Ads:

`profit_before_ads = net_sales - refunds_net - amazon_fees_net - historical_product_cost`

`margin_pct = profit_before_ads / net_sales * 100`

The UI must make the Ads exclusion explicit until the Ads integration is complete.

### FX

All dashboard money is reported in EUR.

- EUR uses rate `1`.
- Non-EUR amounts use a daily stored FX rate valid for the transaction/order date.
- The initial FX provider is ECB reference data, stored in the database so analytics is reproducible and does not perform external calls during dashboard reads.
- For weekends/holidays, use the most recent available rate on or before the event date within a bounded lookback window.
- If no acceptable FX rate exists, the affected profitability is incomplete. Do not use an arbitrary current rate.

## Data model

### `amazon_product_mappings`

New workspace-scoped table:

- `id uuid primary key`
- `owner_id uuid not null`
- `amazon_account_id uuid not null`
- `seller_sku text not null`
- `product_id uuid not null`
- `consumption_factor numeric not null default 1 check (consumption_factor > 0)`
- `mapping_source text not null check in ('automatic','manual')`
- `created_at timestamptz`
- `updated_at timestamptz`

Unique key: `(owner_id, amazon_account_id, seller_sku)`.

Foreign keys reference Amazon account and internal product. Add covering indexes for foreign keys and SKU/product lookup paths.

### `amazon_finance_components`

New normalized child table of `amazon_finance_transactions`:

- `id uuid primary key`
- `owner_id uuid not null`
- `amazon_account_id uuid not null`
- `finance_transaction_id uuid not null`
- `marketplace_id text`
- `amazon_order_id text`
- `seller_sku text`
- `asin text`
- `posted_date timestamptz`
- `component_key text not null`
- `component_type text not null`
- `component_category text not null`
- `amount_original numeric not null`
- `currency_code text not null`
- `tax_amount_original numeric`
- `amount_eur numeric`
- `tax_amount_eur numeric`
- `fx_rate numeric`
- `created_at timestamptz`
- `updated_at timestamptz`

Unique key: `(owner_id, amazon_account_id, finance_transaction_id, component_key)`.

`component_category` is a stable internal analytical vocabulary such as `refund`, `commission_fee`, `fba_fee`, `digital_services_fee`, `storage_fee`, `other_amazon_fee`, `adjustment`, `ads_payment_excluded`, and audit-only tax/revenue categories where needed.

The normalizer stores only business-level components selected by parser rules. It must not create additive rows for both a parent aggregate and all of its additive children.

### `amazon_fx_rates`

New table with reproducible daily rates:

- `rate_date date not null`
- `currency_code text not null`
- `rate_to_eur numeric not null check (rate_to_eur > 0)`
- `source text not null`
- `created_at timestamptz`
- `updated_at timestamptz`

Primary/unique key: `(rate_date, currency_code)`.

Store EUR explicitly as 1 or handle it as a deterministic special case in SQL. Other currencies are populated from ECB data.

## Finance ingestion changes

The existing Finance sync remains restartable and idempotent. After upserting each `amazon_finance_transactions` row, the same sync flow normalizes that transaction's sanitized breakdown tree into `amazon_finance_components`.

Requirements:

- Deterministic `component_key` based on transaction plus semantic breakdown path so repeated syncs upsert, not duplicate.
- Reprocessing a Finance transaction replaces/updates its normalized components consistently.
- Existing historical Finance rows are backfilled into the component table from the already-persisted sanitized `metadata.breakdowns`; no buyer data is needed.
- Add parser tests using representative Shipment and Refund breakdown structures.

The existing coarse transaction `category` may be improved for diagnostics, but dashboard profitability must use normalized components rather than that field.

## FX ingestion

Add a small backend sync for ECB daily reference rates.

- Fetch only required currencies for active Amazon marketplaces plus EUR.
- Upsert by date/currency.
- Run daily and allow manual/backfill execution.
- Backfill from 2026-01-01 before profitability is considered complete for historical PLN/SEK activity.
- Analytics resolves the latest valid rate on or before each monetary event date.

No FX secret is required if the chosen ECB endpoint is public.

## Analytical SQL/RPC layer

Profitability calculations live in PostgreSQL, not React.

Create focused RPCs with workspace/permission checks and parameters for date range and marketplace list. Suggested public contract:

- `amazon_analytics_summary(from_date, to_date, marketplace_ids)`
- `amazon_analytics_series(from_date, to_date, marketplace_ids, grain)`
- `amazon_analytics_products(from_date, to_date, marketplace_ids, search, page, page_size)`
- `amazon_analytics_marketplaces(from_date, to_date, marketplace_ids)`
- `amazon_analytics_orders(from_date, to_date, marketplace_ids, search, page, page_size)`
- `amazon_analytics_inventory(marketplace_ids, search, page, page_size)`
- `amazon_analytics_unmapped_skus(search, page, page_size)`
- `amazon_set_product_mapping(seller_sku, product_id, consumption_factor)`
- `amazon_delete_product_mapping(seller_sku)` if an incorrect mapping must be removed.

The exact SQL may use private helper functions/views to avoid repeating cost/FX logic. Public RPCs expose stable result shapes only.

### Completeness metadata

Summary and grouped RPCs return explicit quality metadata alongside values, including at least:

- unmapped SKU count / affected units.
- missing historical cost count / affected units.
- missing FX event count.
- missing VAT order count.
- historical backfill/sync state.
- whether Ads are excluded.

`profitComplete` is true only when all inputs required for the selected period/filter are complete.

A partial numeric profit may be returned for the known subset for diagnostic value, but the UI must label it incomplete and must not present it as final.

## Dashboard UI

The current large connection-status experience becomes a compact status area in the Amazon header. Seller Central, Sellerboard and admin `Sincronizar ahora` remain available.

Internal tabs:

`Resumen | Productos | Marketplaces | Pedidos | Inventario | Sin vincular`

### Resumen

Global filters at the top, defaulting to current month.

Primary KPI cards:

- Ventas sin IVA
- Pedidos
- Unidades vendidas
- Tarifas Amazon
- Reembolsos
- Coste producto
- Beneficio antes de Ads
- Margen %

Below the KPIs:

1. Time series combining net sales and profit before Ads. Grain is selected automatically (daily for short ranges, monthly for long ranges) while allowing a stable API contract.
2. Cost breakdown: Amazon fees, product cost and refunds.
3. Top products by profit.
4. Products with the weakest margin, shown as a factual sort rather than a hidden scoring system.
5. A visible data-quality notice when profit is incomplete or historical sync is still running.

### Productos

Paginated/searchable table grouped by seller SKU / ASIN with:

- linked internal product.
- units.
- net sales.
- historical product cost.
- Amazon fees.
- refunds.
- profit before Ads.
- margin %.
- mapping/completeness state.

A product row can open/detail its trend and marketplace breakdown. Existing mappings can be corrected here.

### Marketplaces

Grouped performance by marketplace/country with the same core financial metrics and units/orders. All values are EUR-normalized.

### Pedidos

Paginated/searchable order list containing no buyer PII:

- Amazon order ID.
- date.
- marketplace.
- status.
- units.
- net sales.
- known Amazon costs/refunds.
- historical product cost.
- profit/completeness state.

### Inventario

Current FBA stock grouped by SKU/ASIN and marketplace:

- fulfillable.
- reserved.
- inbound.
- unfulfillable.
- researching.
- total.
- last sync.

Historical daily inventory can be used for a stock trend when enough snapshots exist. Days-of-cover/replenishment forecasting is deferred.

### Sin vincular

Prominent workflow because current production data has unmatched Amazon SKUs.

For every unmatched seller SKU:

- SKU and ASIN.
- marketplaces where seen.
- affected order/unit counts.
- recent sales context.
- internal product search/select.
- consumption factor, default 1.
- Save mapping action.

After saving, analytics refresh and historical profitability becomes calculable without rewriting source rows.

## Frontend service architecture

Extend `src/services/amazon.ts` with typed analytics calls rather than querying multiple raw tables from React.

Split the large Amazon page into focused components if necessary, for example:

- `AmazonFilters`
- `AmazonSummary`
- `AmazonProducts`
- `AmazonMarketplaces`
- `AmazonOrders`
- `AmazonInventory`
- `AmazonUnmapped`
- shared KPI/table/completeness components

Reuse the project's existing Recharts dependency. Do not add another chart library.

Desktop and mobile layouts must both be first-class. Tables may switch to compact cards or horizontal-scroll patterns already used by the application; filters and mapping actions must remain usable on mobile.

## Sync/backfill UX

The dashboard remains usable while historical jobs are running.

- Header shows connection state, last successful sync and queue/backfill status compactly.
- If backfill is incomplete, show `Sincronización histórica en curso` with queue/failure context.
- An admin can request sync from the existing button.
- Analytics reads only committed source rows; no optimistic fabricated values.

## Security

All new tables use RLS and workspace ownership consistent with the existing Amazon schema.

- Reads require authenticated workspace ownership/membership and `amazon` permission.
- Mapping mutations require the same `amazon` permission and are workspace constrained.
- Backend ingestion writes use the server secret/service context only.
- No buyer/recipient PII is requested, stored or exposed.
- RPCs derive/validate workspace ownership server-side and do not trust caller-supplied owner IDs.

## Performance

Initial strategy is query-time analytics with supporting indexes.

Required indexes include common paths for:

- order purchase date + marketplace/account.
- order items seller SKU/order.
- Finance component posted date + marketplace/order/SKU/category.
- mapping account + seller SKU/product.
- product price history product + price date.
- inventory marketplace + SKU.
- FX currency + rate date.

RPCs are paginated for Products, Orders, Inventory and Unmapped views. Summary/series queries aggregate in SQL.

Only introduce materialized daily facts after measuring production query latency and data growth.

## Error handling

- Missing mapping, cost, VAT or FX is a data-quality condition, not a generic application error.
- RPC/database/network failures show the existing toast/error patterns and keep the last successfully rendered state when practical.
- Mapping validation rejects an invalid product, non-positive factor or cross-workspace reference.
- Finance parser failures fail/retry the relevant sync job rather than silently writing incomplete normalized components.
- FX sync failures do not substitute current FX rates for historical transactions.

## Testing

### SQL/data tests

Cover at least:

- exact SKU mapping and manual mapping.
- factor 1 and factor > 1.
- historical cost chooses latest cost on/before sale date.
- later product cost is not used for an earlier sale.
- cancelled order exclusion.
- net sale = gross - VAT.
- missing VAT marks completeness false.
- EUR conversion at 1.
- PLN/SEK conversion by event date.
- weekend/holiday prior-rate resolution within allowed lookback.
- missing FX marks completeness false.
- Finance Shipment breakdown extracts fee bases without double counting parent aggregates.
- Finance Refund breakdown reduces net result correctly and handles fee reversals.
- Ads payment is excluded from the pre-Ads profit KPI and surfaced as excluded scope.
- workspace/RLS separation.

### TypeScript tests

Cover Finance breakdown parser normalization and deterministic component keys with representative SP-API fixtures.

### Frontend tests

Cover:

- current-month default filter.
- marketplace filtering.
- incomplete-profit warning.
- unmapped mapping workflow and factor.
- empty/loading/error states.
- tab navigation.
- mobile-safe rendering of core actions.

Existing application tests, TypeScript build and Vite build must stay green.

## Rollout sequence

1. **Analytics foundations**: mappings, Finance component normalization, FX storage/sync, migrations/RLS/indexes and historical Finance/FX backfill.
2. **Analytics RPCs**: shared cost/FX helpers, summary/series/product/marketplace/order/inventory/unmapped endpoints and completeness metadata.
3. **Frontend dashboard**: tabs, filters, KPIs, charts, tables and mapping workflow.
4. **Production validation**: reconcile sample orders against Amazon/Seller Central, verify no double counting, test historical cost, EUR/PLN/SEK and incomplete states.
5. **Ads phase later**: add Amazon Ads ingestion and extend the profit formula to full post-ad profitability plus ACOS/TACOS.

## Acceptance criteria

The phase is complete when:

- Amazon opens on a business dashboard rather than a setup-centric screen.
- Current month is selected by default and filters work across tabs.
- Cancelled orders are excluded.
- Sales and profit are displayed without VAT.
- Product cost uses the historically valid cost and mapping factor.
- Unmapped SKUs can be linked and the historical result updates automatically.
- Finance fee/refund components are normalized from breakdowns without parent/child double counting.
- All displayed monetary KPIs are normalized to EUR or clearly marked incomplete when FX is missing.
- Profit is never presented as complete when mapping, cost, VAT or FX inputs are missing.
- Ads exclusion is explicit until Ads integration is implemented.
- No buyer PII is stored or displayed.
- RLS/permission tests, application tests, TypeScript and build pass.
