# Configuration Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ZENVIA Gestión into a centrally configurable system while preserving current production behavior by default and keeping all work isolated from `main`.

**Architecture:** The work is split into five independently reviewable phases that share a typed settings core. Global configuration lives in workspace-owned Supabase tables with admin-only writes; personal preferences live per user. Existing structured tables such as `business_settings` and `company_branding` remain canonical for company identity while new modular settings drive behavior through a single service/provider.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Supabase/PostgreSQL/RLS, Supabase Edge Functions, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-configuration-center-design.md`

## Global Constraints

- All development stays on `feature/configuration-center`; do not merge to `main` without explicit user approval.
- Do not apply Configuration Center migrations to the production Supabase project during development.
- Before creating a Supabase development branch, retrieve its actual cost and obtain explicit user confirmation.
- Global settings are writable only by workspace admins; normal users may edit only their own personal preferences.
- Every visible setting must have a real effect before the feature is considered complete.
- Existing production behavior is the initial default.
- Existing `business_settings`, `company_branding`, tax registrations, invoice series, and integration secret storage remain canonical where they already model the domain.
- Secrets never enter `app_settings` and are never returned in full to the browser.
- Configuration changes are non-retroactive unless the user explicitly launches a maintenance action.
- Invalid or missing settings must degrade to typed defaults instead of preventing the app from rendering.
- iPad/Safari compatibility target remains `es2018` / `safari13`.

## Review Focus

- A malformed JSON setting or unknown enum must fall back only for that property and keep the rest of the app usable; Phase 1 pins this in parser tests.
- A normal authenticated user must be unable to mutate global settings through the Data API even if they bypass the UI; Phase 1 pins this with RLS verification queries.
- Changing a default must affect new records but never silently rewrite issued invoices or historical costs; Phases 2 and 3 pin this with regression tests.
- A shipping rule with no match or an unavailable Sendcloud service must fail safely and allow manual selection; Phase 4 pins this in rule-engine and order-flow tests.
- Disabled integrations or sync settings must not accidentally disable manual access to already-synced data; Phase 5 pins this in integration and Amazon tests.

---

## Execution order

The implementation is deliberately decomposed because the approved specification spans multiple independent subsystems. Execute the phase plans in this order:

1. `docs/superpowers/plans/2026-09-21-configuration-center-phase-1-foundation.md`
2. `docs/superpowers/plans/2026-09-21-configuration-center-phase-2-general-sales-clients.md`
3. `docs/superpowers/plans/2026-09-21-configuration-center-phase-3-expenses-suppliers-products.md`
4. `docs/superpowers/plans/2026-09-21-configuration-center-phase-4-orders-shipping.md`
5. `docs/superpowers/plans/2026-09-21-configuration-center-phase-5-amazon-integrations-alerts-maintenance.md`

Each phase must end in a working, testable branch state. Do not start a later phase with failing tests introduced by the previous phase.

## Final branch contract

After Phase 5:

- [ ] Run all Configuration Center tests explicitly with `node --test`.
- [ ] Run the full existing test suite and classify any failures against the pre-feature baseline.
- [ ] Run `npm run build` and inspect the output.
- [ ] Run Supabase security and performance advisors against the development branch.
- [ ] Verify admin and normal-user RLS behavior.
- [ ] Verify desktop, iPad/Safari, and mobile layouts in light and dark mode.
- [ ] Verify General, Facturación, Gastos, Pedidos, Envíos, Amazon, Productos, Clientes, Proveedores, Integraciones, Alertas, Mis preferencias, and Mantenimiento.
- [ ] Export the effective configuration and confirm that secrets are absent.
- [ ] Confirm `main` still points to the pre-feature production lineage.
- [ ] Present the complete preview to the user for manual validation.
- [ ] Do not merge or migrate production until the user explicitly approves both actions.
