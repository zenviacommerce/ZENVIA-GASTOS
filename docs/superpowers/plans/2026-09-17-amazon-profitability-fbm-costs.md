# Amazon Profitability + FBM Shipping Costs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Amazon profitability comparable to Sellerboard while preserving real VAT treatment and including FBM shipping costs, then add a versioned transport-tariff foundation for MRW.

**Architecture:** Keep Amazon financial calculations in PostgreSQL RPCs, using actual Amazon order VAT and finance-component tax fields. Persist shipping cost on each fulfillment order at label creation so later tariff changes never rewrite history. Store carrier tariff documents and normalized bands separately so MRW can later move from Sendcloud to its direct API without changing profitability logic.

**Tech Stack:** React + TypeScript, Supabase/PostgreSQL, Supabase Edge Functions, Sendcloud API.

**Spec:** Approved in chat on 2026-09-17.

## Global Constraints
- Never estimate VAT when `amazon_orders.vat_amount` is NULL.
- Explicit VAT 0 means net sales equal gross sales for that order.
- Amazon fees and refunds use net-of-recoverable-tax amounts: `amount_original - tax_amount_original`.
- Ads (`ads_payment_excluded`) are included in net profit.
- FBM shipping cost is stored historically per order/label.
- Sendcloud-priced services use the selected quote price; MRW tariffs are versioned/configurable and must not be hardcoded into analytics.

---

### Task 1: Amazon profitability KPIs

**Files:**
- Create: `scripts/amazon-profitability-kpis.test.mjs`
- Create: `supabase/migrations/20260917160000_amazon_profitability_kpis.sql`
- Modify: `src/services/amazon.ts`
- Modify: `src/components/amazon/AmazonSummary.tsx`

**Interfaces:**
- Produces summary fields: `grossSales`, `salesVat`, `netSales`, `amazonFees`, `amazonFeeVat`, `refunds`, `adsCost`, `productCost`, `fbmShippingCost`, `netProfit`, `marginPct`.

- [ ] Write failing regression tests for VAT-aware sales, net-of-tax fees/refunds, Ads in profit, and revised UI labels.
- [ ] Run CI and confirm RED.
- [ ] Add/replace summary + series RPCs with the approved formulas.
- [ ] Update TypeScript types and Summary UI.
- [ ] Run CI and confirm GREEN.

### Task 2: Persist FBM shipping cost from Sendcloud

**Files:**
- Create: `scripts/fbm-shipping-cost.test.mjs`
- Create: `supabase/migrations/20260917161000_fbm_shipping_cost.sql`
- Modify: `src/services/orders.ts`
- Modify: `supabase/functions/sendcloud-orders/index.ts`

**Interfaces:**
- Adds `shipping_cost_amount`, `shipping_cost_currency`, `shipping_cost_source`, `shipping_cost_net_amount`, `shipping_cost_tax_amount`, `shipping_cost_recorded_at` to `fulfillment_orders`.
- `createOrderLabel` sends selected quote price/currency to the Edge Function; the Edge Function persists it with the label.

- [ ] Write failing tests for quote persistence and historical shipping-cost fields.
- [ ] Run CI and confirm RED.
- [ ] Add schema and persist selected Sendcloud quote on label creation.
- [ ] Include Amazon FBM shipping cost in analytics by matching `amazon_order_id` to `fulfillment_orders.order_number/order_id`.
- [ ] Run CI and confirm GREEN.

### Task 3: Versioned MRW tariff foundation

**Files:**
- Create: `scripts/transport-tariffs.test.mjs`
- Create: `supabase/migrations/20260917162000_transport_tariffs.sql`
- Create: `src/services/transportTariffs.ts`
- Create: `src/components/TransportTariffsPanel.tsx`
- Modify: `src/pages/Orders.tsx` or existing settings surface after inspection.

**Interfaces:**
- Tables: `transport_tariff_documents`, `transport_tariff_services`, `transport_tariff_bands`.
- Status flow: `draft -> reviewed -> active`; upload/import never activates automatically.
- Stores effective dates, carrier, service name/code mapping, country/zone, weight bands, extra-kg rates, fuel surcharge and source document metadata.

- [ ] Write failing tests for versioned tariff schema and review-before-activate workflow.
- [ ] Run CI and confirm RED.
- [ ] Add schema/service/UI foundation for manual reviewed imports.
- [ ] Leave document-to-structured-data AI extraction behind one service boundary so the parser can be swapped without changing tariff storage.
- [ ] Run full CI/build and deploy only after all tests pass.
