# Amazon Analytics V1 — Execution Index

This document is the ordered execution map for the approved Amazon Analytics design. It does not replace the detailed phase plans; executors must read the design plus the current phase plan before touching code.

**Design:** `docs/superpowers/specs/2026-09-16-amazon-analytics-design.md`

## Execution order

1. **Phase A — Shell and Permissions**  
   `docs/superpowers/plans/2026-09-16-amazon-phase-a-shell-permissions-plan.md`

2. **Phase B — SP-API Core**  
   `docs/superpowers/plans/2026-09-16-amazon-phase-b-spapi-core-plan.md`

3. **Phase C — Product Mapping, FX, COGS and Profitability**  
   `docs/superpowers/plans/2026-09-16-amazon-phase-c-profitability-fx-cogs-plan.md`

4. **Phase D — Amazon Ads**  
   `docs/superpowers/plans/2026-09-16-amazon-phase-d-ads-plan.md`

5. **Phase E — Dashboard, Automation and Release**  
   `docs/superpowers/plans/2026-09-16-amazon-phase-e-dashboard-automation-release-plan.md`

## Dependency gates

- Phase B starts only after `amazon` is a valid persisted permission and the shell route is guarded by `can('amazon')`.
- Phase C starts only after SP-API orders/finance/inventory and resumable sync state are verified on a narrow live window.
- Phase D may be developed before Amazon grants Ads production access, but V1 cannot be declared complete until Ads is authorized, synchronized, and reconciled or the user explicitly changes the approved V1 scope.
- Phase E dashboard composition starts only after the aggregate contracts from C/D are stable. Cron/release work can be prepared earlier but must not be enabled against incomplete backend functions.
- Production frontend must never precede production database/RPC/function dependencies it calls.

## Cross-phase invariants

- Historical boundary requested: `2026-01-01T00:00:00Z`.
- Europe is consolidated from active connected marketplaces; every source row remains marketplace-qualified.
- Buyer PII is outside scope and must not be persisted in Amazon Analytics tables.
- Browser never receives Amazon secrets/tokens.
- Automatic product mapping is exact unique SKU only; no fuzzy mapping.
- Missing COGS/FX/Ads attribution is visible and is never replaced by invented values.
- Purchase costs must be expressed in EUR before they enter consolidated COGS. If `product_price_history.currency <> 'EUR'`, use the historical FX rate on the purchase-cost date; a missing rate leaves that cost unresolved rather than treating the numeric amount as EUR.
- Campaign-grain Ads is the source of total spend; product-grain Ads is the only source of product-attributable spend. Residual is `unallocated_ad_spend`.
- Source jobs are idempotent/replayable; checkpoint only advances after success.
- Normal release is GitHub `main` → Vercel Git integration; no manual Vercel deployment.

## Review checkpoints

After every phase:

```bash
node --test scripts/*.test.mjs
npm run build
```

In addition, perform the phase-specific live verification before continuing. A green build alone is not evidence that Amazon data is correct.

Before the final merge, require all of the following:

- migrations applied in dependency order;
- Edge Functions deployed and responding;
- SP-API reconciliation sample explained;
- Ads reconciliation sample explained;
- COGS sample checked against historical purchases;
- non-EUR sample checked against ECB FX;
- RLS verified with admin / authorized user / unauthorized user;
- no buyer PII persisted;
- cron jobs active and worker consuming normally;
- full Node suite green;
- production build green;
- final PR CI green;
- post-merge `main` CI green;
- Vercel status success on the merge commit.

## Implementation branch strategy

At execution time, create an isolated implementation branch/worktree from the latest `main`, then carry the approved design/plans into that branch (or branch from this documentation branch after first reconciling it with the latest `main`). Do not build on the abandoned `fix/bulk-import-reveal-all` branch/PR #45.

Use frequent phase/task commits exactly as the detailed plans specify. Do not merge intermediate code merely because a task compiles; merge/release only at an explicit reviewed checkpoint.
