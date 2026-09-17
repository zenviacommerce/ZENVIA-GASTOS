# Amazon Analytics dashboard — design

Date: 2026-09-16

## Context

Phase B already connects ZENVIA COMMERCE SL to Amazon SP-API, discovers active EU marketplaces, synchronizes Orders, Finances and FBA Inventory, and runs backfill from 2026-01-01 plus recurring sync jobs.

The current Amazon page is still mainly a connection/status screen. This phase turns it into a business dashboard for sales, Amazon costs, product cost, profitability and inventory.

Production data establishes two constraints:

- Current Amazon seller SKUs do not automatically match internal `products.sku`, so explicit SKU mapping is required from day one.
- A Finance transaction total is not a single fee/refund value. A `Shipment` can contain nested Sales, Tax, Commission, FBA and other fee breakdowns while the transaction total is only the resulting settlement amount. Profitability must normalize the breakdown tree and must not add parent totals and their children together.

## Goals

1. Business dashboard with current month selected by default.
2. Profitability without VAT using the product cost valid on the sale date.
3. Orders as source of sales, units and state; Finances as source of fees, refunds and adjustments.
4. All active EU marketplaces, normalized to EUR.
5. Persistent Amazon SKU -> internal product mappings with a pack/bundle consumption factor.
6. Explicit incomplete-profit states when mapping, historical cost, VAT or FX is missing.
7. Preserve workspace isolation, `amazon` permission and the existing no-buyer-PII rule.

## Non-goals

- Amazon Ads API, ACOS and TACOS are deferred. `ProductAdsPayment` and equivalent Ads finance events are explicitly excluded from the pre-Ads profitability KPI instead of being silently treated as Amazon fees.
- No forecasting/replenishment recommendations.
- No fuzzy automatic SKU matching.
- No materialized aggregate facts initially; query-time SQL/RPC analytics are the starting point.

## Approved business rules

### Filters

Default period is **Current month**. Quick filters: Today, 7 days, 30 days, Current month, Previous month, Current quarter, Current year and Custom range. A global marketplace filter applies across tabs.

### Orders and sales

Cancelled orders do not count toward sales, orders or units. Handle both `Canceled` and `Cancelled` defensively.

Orders are dated by `purchase_date`. For eligible orders:

`net_sales = gross/order total - VAT`

Orders remain canonical for sales and units so Finance shipment totals cannot double count revenue. If required VAT is unavailable, the affected profitability is incomplete rather than estimated.

### Historical product cost

For each order item:

1. Resolve `seller_sku` to an internal product.
2. Find the latest `product_price_history.normalized_unit_price` where `price_date <= order.purchase_date`.
3. Calculate:

`product_cost = quantity_ordered * consumption_factor * historical_unit_cost`

`consumption_factor` defaults to 1 and must be > 0. A cost recorded after the sale is never back-used as an estimate. Missing mapping or historical cost makes the affected profitability incomplete.

Mappings are resolved at query time, so correcting a mapping/factor recalculates history automatically without rewriting source orders.

### SKU mapping

Automatic matching is allowed only when trimmed `seller_sku` equals exactly one trimmed internal `products.sku` value, preserving case. Ambiguous or non-matching SKUs remain unmapped; there is no fuzzy matching.

Unmapped SKUs are resolved in **Sin vincular** by selecting an internal product and consumption factor. Existing mappings can be corrected later.

### Finance normalization

`amazon_finance_transactions.amount_original` is a settlement-level transaction total and is not authoritative as a fee value. The existing coarse `category` remains diagnostic only.

Normalize selected business-level Finance breakdown components into a child table. The parser must understand nesting and never emit additive rows for both a parent aggregate and its additive children.

Representative shipment components include ProductCharges/Sales, Tax, Commission/referral-like fees, FBA fulfillment fees, Digital Services fees, Storage and other Amazon fees. Refunds include refunded product charges/tax and fee reversals.

When a fee exposes `Base` and `Tax`, profitability uses the Base amount; fee VAT remains available for audit but is not a business cost in the headline no-VAT KPI.

The normalized table preserves Amazon's signed amount. Normal fees normally reduce profit; fee reversals increase it. Refund product charges normally reduce profit.

Define signed analytical effects:

- `refund_sales_effect_eur`: signed refunded product-charge effect; normally negative.
- `amazon_fee_effect_eur`: signed Amazon fee effect excluding Ads; normal fee negative, reversal positive.

The headline calculation is therefore unambiguous:

`profit_before_ads = net_sales + refund_sales_effect_eur + amazon_fee_effect_eur - historical_product_cost`

`margin_pct = profit_before_ads / net_sales * 100`

For display, **Reembolsos** and **Tarifas Amazon** may show positive deduction magnitudes derived from those signed effects. The underlying calculation continues to use signed effects.

### Financial timing

Period summaries filter Orders by `purchase_date` and Finance events by `posted_date`. Thus a later refund reduces the period in which Amazon posts the refund. Where Amazon supplies order/SKU identifiers, the event remains linked for drill-down. Order detail may show all known linked events even when posted after the order date.

### FX

All headline money is EUR.

- EUR rate = 1.
- Non-EUR uses stored daily historical FX for the event/order date.
- Initial provider: ECB reference rates stored in the database; dashboard reads never make live FX calls.
- Weekend/holiday resolution uses the latest available rate on or before the date, with a maximum lookback of 7 calendar days.
- Missing acceptable FX makes the affected result incomplete; never substitute today's rate.

## Data model

### `amazon_product_mappings`

Workspace-scoped table:

- `id uuid primary key`
- `owner_id uuid not null`
- `amazon_account_id uuid not null`
- `seller_sku text not null`
- `product_id uuid not null`
- `consumption_factor numeric not null default 1 check (consumption_factor > 0)`
- `mapping_source text not null check in ('automatic','manual')`
- timestamps

Unique `(owner_id, amazon_account_id, seller_sku)`. Add foreign keys and covering indexes for account, SKU and product lookups.

### `amazon_finance_components`

Normalized child of `amazon_finance_transactions`:

- `id uuid primary key`
- workspace/account/finance transaction foreign keys
- marketplace/order/SKU/ASIN identifiers
- `posted_date`
- deterministic `component_key`
- `component_type`
- stable `component_category`
- signed `amount_original`, `currency_code`
- optional `tax_amount_original`
- converted `amount_eur`, optional `tax_amount_eur`, `fx_rate`
- timestamps

Unique `(owner_id, amazon_account_id, finance_transaction_id, component_key)`.

Stable categories include at least `refund_sales`, `commission_fee`, `fba_fee`, `digital_services_fee`, `storage_fee`, `other_amazon_fee`, `adjustment`, `ads_payment_excluded` plus audit-only revenue/tax categories where required.

### `amazon_fx_rates`

- `rate_date date`
- `currency_code text`
- `rate_to_eur numeric check > 0`
- `source text`
- timestamps

Primary/unique `(rate_date, currency_code)`.

## Finance ingestion

Keep the existing restartable/idempotent Finance sync. After upserting a transaction, normalize its sanitized breakdown tree into `amazon_finance_components`.

Requirements:

- deterministic component keys based on transaction + semantic breakdown path;
- repeat syncs upsert rather than duplicate;
- reprocessing updates/replaces normalized components consistently;
- historical Finance rows are backfilled from already-stored sanitized `metadata.breakdowns`;
- parser failures fail/retry the relevant job instead of silently persisting partial finance components;
- representative Shipment and Refund parser fixtures are tested.

## FX ingestion

Add a small backend ECB sync:

- required active-marketplace currencies plus EUR;
- daily upsert and manual/backfill capability;
- historical backfill from 2026-01-01 before PLN/SEK history is considered complete;
- no secret required when using the public ECB feed.

## SQL/RPC analytics layer

Calculations live in PostgreSQL, not React. Private helpers/views can centralize cost and FX resolution. Public RPCs expose stable typed shapes and validate workspace/permission server-side.

Suggested contract:

- `amazon_analytics_summary(from_date, to_date, marketplace_ids)`
- `amazon_analytics_series(from_date, to_date, marketplace_ids, grain)`
- `amazon_analytics_products(from_date, to_date, marketplace_ids, search, page, page_size)`
- `amazon_analytics_marketplaces(from_date, to_date, marketplace_ids)`
- `amazon_analytics_orders(from_date, to_date, marketplace_ids, search, page, page_size)`
- `amazon_analytics_inventory(marketplace_ids, search, page, page_size)`
- `amazon_analytics_unmapped_skus(search, page, page_size)`
- `amazon_set_product_mapping(seller_sku, product_id, consumption_factor)`
- `amazon_delete_product_mapping(seller_sku)`

Summary/grouped responses include completeness metadata: unmapped SKU/units, missing historical cost/units, missing FX events, missing VAT orders, current backfill state and `adsExcluded=true`.

`profitComplete=true` only when all required inputs for the selected scope are complete. A partial known-subset number may be returned for diagnostics, but UI must mark it incomplete and not present it as final.

## Dashboard UI

The current large connection card becomes a compact header status. Seller Central, Sellerboard and admin **Sincronizar ahora** remain.

Tabs:

**Resumen | Productos | Marketplaces | Pedidos | Inventario | Sin vincular**

### Resumen

Global filters first. KPI cards:

- Ventas sin IVA
- Pedidos
- Unidades vendidas
- Tarifas Amazon
- Reembolsos
- Coste producto
- Beneficio antes de Ads
- Margen %

Then:

1. Net sales + profit time series. Use daily grain for ranges <= 90 days, monthly above 90 days.
2. Cost breakdown: Amazon fees, product cost, refunds.
3. Products sorted by profit.
4. Products sorted by margin ascending for factual low-margin review.
5. Visible data-quality/backfill notice when required.

### Productos

Paginated/searchable seller SKU/ASIN rows with linked internal product, units, net sales, historical cost, fees, refunds, profit before Ads, margin and completeness. Mapping can be corrected here. Product detail may show trend and marketplace breakdown.

### Marketplaces

Same core metrics grouped by marketplace/country, EUR-normalized.

### Pedidos

No buyer PII. Show Amazon order ID, date, marketplace, status, units, net sales, known fees/refunds, historical cost and profit/completeness.

### Inventario

Current FBA fulfillable, reserved, inbound, unfulfillable, researching, total and last sync by SKU/ASIN/marketplace. Historical daily snapshots may power a stock trend. Days-of-cover is deferred.

### Sin vincular

Prominent workflow. For each unmapped SKU: SKU, ASIN, marketplaces seen, affected orders/units, recent sales context, internal product search/select, factor default 1 and Save. Saving refreshes analytics and historical profitability.

## Frontend architecture

Extend `src/services/amazon.ts` with typed analytics RPC calls; React does not query/aggregate raw Amazon tables directly.

Split the page into focused components as needed (`AmazonFilters`, `AmazonSummary`, `AmazonProducts`, `AmazonMarketplaces`, `AmazonOrders`, `AmazonInventory`, `AmazonUnmapped` plus shared KPI/table/completeness pieces).

Reuse existing Recharts. Add no second chart library. Desktop and mobile are first-class; filters/mapping actions must remain usable on mobile.

## Sync/backfill UX

Dashboard works while history is loading. Header shows connection, last successful sync and queue/backfill state compactly. Show **Sincronización histórica en curso** while needed. Analytics uses committed rows only.

## Security

New tables use RLS/workspace ownership consistent with the existing Amazon schema.

- Reads and mapping mutations require authenticated workspace access plus `amazon` permission.
- Backend ingestion uses server-secret/service context only.
- RPCs derive workspace ownership server-side and never trust caller-provided owner IDs.
- No buyer/recipient PII is requested, persisted or exposed.

## Performance

Start with query-time SQL plus indexes on order purchase date/marketplace, item SKU/order, finance component posted date/marketplace/order/SKU/category, mapping SKU/product, product history product/date, inventory marketplace/SKU and FX currency/date.

Products, Orders, Inventory and Unmapped RPCs are paginated. Summary/series aggregate in SQL. Introduce materialized daily facts only after production measurements justify them.

## Error/data-quality handling

Missing mapping, historical cost, VAT or FX is a data-quality state rather than a generic application failure. Invalid mapping/product/factor/cross-workspace references are rejected. Network/RPC failures use existing toast/error patterns. FX failures never fall back to current rates.

## Testing

### SQL/data

Cover exact/manual mapping, factor 1/>1, historical cost as-of date, no future-cost fallback, cancelled exclusion, net sales excluding VAT, missing VAT completeness, EUR=1, PLN/SEK date conversion, weekend/holiday <=7-day fallback, missing FX completeness, Shipment fee parsing without parent/child double count, Refund product-charge and fee-reversal effects, Ads exclusion, and workspace/RLS isolation.

### TypeScript

Test Finance breakdown parser and deterministic component keys using representative SP-API Shipment/Refund fixtures; test FX parsing/sync normalization.

### Frontend

Test current-month default, marketplace filters, incomplete-profit warning, mapping/factor workflow, empty/loading/error states, tabs and mobile-safe core actions.

Existing application tests, TypeScript and Vite build must remain green.

## Rollout

1. Analytics foundations: mappings, Finance component normalization, FX storage/sync, migrations/RLS/indexes, historical Finance/FX backfill.
2. Analytics RPCs: shared cost/FX helpers and summary/series/product/marketplace/order/inventory/unmapped endpoints.
3. Frontend dashboard: tabs, filters, KPIs, charts, tables, mapping workflow.
4. Production reconciliation against sample Amazon/Seller Central data, including no double counting and EUR/PLN/SEK.
5. Later Ads phase: Amazon Ads ingestion, post-ad profit, ACOS and TACOS.

## Acceptance criteria

Complete when:

- Amazon opens on a business dashboard, current month by default.
- Global date/marketplace filters work across relevant tabs.
- Cancelled orders are excluded.
- Sales/profit headline values are without VAT.
- Product cost uses historical as-of cost and mapping factor.
- Unmapped SKUs can be linked and history recalculates.
- Finance fees/refunds are normalized from breakdowns without parent/child double counting.
- EUR conversion is historical/reproducible and missing FX marks results incomplete.
- Profit is never presented as complete with missing mapping/cost/VAT/FX.
- Ads exclusion is explicit.
- No buyer PII is stored/displayed.
- RLS/permission tests, application tests, TypeScript and build pass.
