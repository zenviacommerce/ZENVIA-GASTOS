# Amazon Phase A — Shell and Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Amazon as a first-class, permission-controlled module with a native page shell and safe external links to Seller Central and Sellerboard.

**Architecture:** Extend the existing `MenuPermission`/`Page` model instead of creating a parallel permission path. Keep Amazon data disconnected in this phase: the page only exposes the module shell, connection-state placeholder, and external shortcuts, while database permissions and admin-user validation already understand `amazon`.

**Tech Stack:** React 19, TypeScript, Vite, lucide-react, Supabase Postgres, Supabase Edge Functions, Node `node:test` source-contract tests.

**Spec:** `docs/superpowers/specs/2026-09-16-amazon-analytics-design.md`

## Global Constraints

- `amazon` is configurable per non-admin user and automatically available to admins.
- Users without `amazon` must not be able to navigate to the page.
- Existing permissions remain valid: `dashboard`, `sales`, `orders`, `invoices`, `clients`, `products`, `suppliers`.
- Seller Central and Sellerboard open in a new tab with `noopener noreferrer`.
- No Amazon credentials or tokens are introduced in the browser in this phase.
- The mobile sidebar remains horizontally scrollable; adding Amazon must not reintroduce a fixed five-item assumption.
- Follow TDD: write a failing regression/contract before implementation.

---

### Task 1: Lock the permission and navigation contract

**Files:**
- Create: `scripts/amazon-shell.test.mjs`
- Inspect: `src/services/access.ts`
- Inspect: `src/components/Sidebar.tsx`
- Inspect: `src/App.tsx`
- Inspect: `supabase/functions/admin-users/index.ts`

**Interfaces:**
- Produces: a regression test requiring the exact permission id `amazon`, the Amazon page, the sidebar item, App routing, and safe external links.

- [ ] **Step 1: Write the failing test**

Create `scripts/amazon-shell.test.mjs` using `node:test`, `node:assert/strict`, and `readFile`. The test must assert:

```js
assert.match(accessSource, /export type MenuPermission[^;]*'amazon'/s);
assert.match(accessSource, /id:\s*['"]amazon['"],\s*label:\s*['"]Amazon['"]/);
assert.match(adminUsersSource, /allowedPermissions\s*=\s*\[[^\]]*['"]amazon['"]/s);
assert.match(sidebarSource, /export type Page[^;]*'amazon'/s);
assert.match(sidebarSource, /\['amazon','Amazon','Amazon'/);
assert.match(appSource, /regularPages[^;]*'amazon'/s);
assert.match(appSource, /page===['"]amazon['"]&&can\(['"]amazon['"]\)/);
assert.match(amazonPageSource, /Seller Central/);
assert.match(amazonPageSource, /Sellerboard/);
assert.match(amazonPageSource, /target=["']_blank["']/);
assert.match(amazonPageSource, /rel=["']noopener noreferrer["']/);
```

Also read the new migration path `supabase/migrations/20260916170000_add_amazon_permission.sql` and assert it preserves the seven current permission ids plus `amazon` in `app_users_permissions_check`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/amazon-shell.test.mjs`

Expected: FAIL because `amazon` and the page/migration do not exist.

- [ ] **Step 3: Commit the red test**

Commit message: `test: define amazon module shell contract`

---

### Task 2: Extend permission persistence and admin validation

**Files:**
- Create: `supabase/migrations/20260916170000_add_amazon_permission.sql`
- Modify: `src/services/access.ts`
- Modify: `supabase/functions/admin-users/index.ts`
- Modify: `src/pages/Admin.tsx`

**Interfaces:**
- Produces: `MenuPermission` containing `'amazon'` and `permissionOptions` containing `{ id:'amazon', label:'Amazon', ... }`.
- Produces: database check constraint accepting exactly the existing seven permission ids plus `amazon`.
- `admin-users` must sanitize and return `amazon` in the same way as every other module.

- [ ] **Step 1: Add the migration**

The migration must be additive and explicit:

```sql
alter table public.app_users drop constraint if exists app_users_permissions_check;
alter table public.app_users add constraint app_users_permissions_check
  check (permissions <@ array[
    'dashboard','sales','orders','invoices','clients','products','suppliers','amazon'
  ]::text[]);
```

Do not rewrite existing user permission arrays. Admin behavior already derives all permissions dynamically from the application/server allow-list.

- [ ] **Step 2: Extend frontend permission metadata**

In `src/services/access.ts`, change:

```ts
export type MenuPermission =
  | 'dashboard' | 'sales' | 'orders' | 'invoices'
  | 'clients' | 'products' | 'suppliers' | 'amazon';
```

Add this option to `permissionOptions`:

```ts
{
  id: 'amazon',
  label: 'Amazon',
  description: 'Consultar analítica Amazon, rentabilidad, publicidad, inventario y sincronización.'
}
```

- [ ] **Step 3: Extend the admin Edge Function allow-list**

In `supabase/functions/admin-users/index.ts`, append `'amazon'` to `allowedPermissions`. Do not create a separate special case: `sanitizePermissions`, admin list/create/update behavior, and audit details should keep using that shared array.

- [ ] **Step 4: Add Amazon to audit-module labels**

In `src/pages/Admin.tsx`, extend `moduleLabels` with `amazon:'Amazon'` so future Amazon audit events render with a friendly module name.

- [ ] **Step 5: Run the focused test**

Run: `node --test scripts/amazon-shell.test.mjs`

Expected: permission assertions PASS; navigation/page assertions remain RED.

- [ ] **Step 6: Commit**

Commit message: `feat: add configurable amazon permission`

---

### Task 3: Add Amazon to the sidebar and App router

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Create: `src/pages/Amazon.tsx`
- Create: `src/amazon.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: `Page` union member `'amazon'`.
- Produces: `AmazonPage` component with no required props in Phase A.
- App guard is `page==='amazon' && can('amazon')`.

- [ ] **Step 1: Add the sidebar item**

Import a Lucide icon suited to Amazon analytics, e.g. `Store`, and extend `Page` and `items`:

```ts
export type Page = 'dashboard' | 'sales' | 'orders' | 'invoices' | 'clients' | 'products' | 'suppliers' | 'amazon' | 'admin';

['amazon','Amazon','Amazon',Store],
```

Place Amazon before Administration so admin remains the final internal item.

- [ ] **Step 2: Make Amazon a regular permission-controlled page**

In `src/App.tsx`, import `AmazonPage`, append `'amazon'` to `regularPages`, and render:

```tsx
{page==='amazon'&&can('amazon')&&<AmazonPage/>}
```

Do not add any bypass around `allowedPages` or `can()`.

- [ ] **Step 3: Create the Phase A page shell**

Create `src/pages/Amazon.tsx` with:

```tsx
import { ExternalLink, Store, BarChart3 } from 'lucide-react';
import '../amazon.css';

const SELLER_CENTRAL_URL='https://sellercentral.amazon.es/';
const SELLERBOARD_URL='https://app.sellerboard.com/';

export function AmazonPage(){
  return <div className="page amazonPage">
    <div className="pageHead amazonPageHead">
      <div>
        <div className="eyebrow">AMAZON</div>
        <h1>Amazon Analytics</h1>
        <p>Rentabilidad, publicidad, inventario y rendimiento por marketplace.</p>
      </div>
      <div className="actions amazonExternalLinks">
        <a className="secondary" href={SELLER_CENTRAL_URL} target="_blank" rel="noopener noreferrer"><Store size={16}/> Seller Central <ExternalLink size={14}/></a>
        <a className="secondary" href={SELLERBOARD_URL} target="_blank" rel="noopener noreferrer"><BarChart3 size={16}/> Sellerboard <ExternalLink size={14}/></a>
      </div>
    </div>
    <section className="card amazonConnectionPlaceholder">
      <div className="amazonConnectionIcon"><Store/></div>
      <div><h3>Conexión Amazon pendiente</h3><p>La siguiente fase conectará SP-API y preparará la sincronización desde el 01/01/2026.</p></div>
    </section>
  </div>;
}
```

- [ ] **Step 4: Add focused styling**

In `src/amazon.css`, style only Amazon-specific layout classes. Reuse global `.page`, `.pageHead`, `.card`, `.secondary`, and `.actions`. Include a mobile rule stacking `.amazonPageHead` and `.amazonExternalLinks` without changing global sidebar behavior.

- [ ] **Step 5: Import the stylesheet**

Add `import './amazon.css';` to `src/main.tsx` near other feature stylesheets.

- [ ] **Step 6: Run focused test**

Run: `node --test scripts/amazon-shell.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add amazon module shell`

---

### Task 4: Verify database and UI behavior before moving to Phase B

**Files:**
- No new production files unless verification finds a regression.

**Interfaces:**
- Phase B may assume `amazon` is a valid app permission and `AmazonPage` is routable.

- [ ] **Step 1: Run the full Node suite**

Run: `node --test scripts/*.test.mjs`

Expected: 0 failures.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 3: Apply the migration in a non-production verification environment first**

After applying the migration, verify with:

```sql
select pg_get_constraintdef(oid)
from pg_constraint
where conrelid='public.app_users'::regclass
  and conname='app_users_permissions_check';
```

Expected definition contains exactly the current seven permissions plus `amazon`.

- [ ] **Step 4: Permission smoke test**

Use one non-admin test user without `amazon` and one with it. Verify the first does not see Amazon in navigation and cannot retain `page='amazon'`; verify the second sees and opens the shell. Verify admins see Amazon automatically.

- [ ] **Step 5: External-link smoke test**

From desktop and mobile, click Seller Central and Sellerboard. Confirm each opens a separate tab/window and the ZENVIA app remains open.

- [ ] **Step 6: Commit any verification-only correction**

If no correction is needed, do not create an empty commit. Phase A is complete when focused tests, full tests, build, and permission smoke checks pass.
