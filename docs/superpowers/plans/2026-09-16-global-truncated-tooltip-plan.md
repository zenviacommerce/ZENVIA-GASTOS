# Global Truncated Text Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace native browser/Windows title tooltips for truncated list/table text with one elegant ZENVIA tooltip that only appears when content is actually clipped.

**Architecture:** Extend the existing `UnifiedListExperience` DOM enhancement layer with a single floating tooltip element and delegated hover/focus handling. Detect real overflow at interaction time, derive full text from the target, position the tooltip inside the viewport, and style it with dedicated CSS for light/dark themes. Keep action-button `title` attributes intact; remove native `title` only where it is being used to expose truncated data text.

**Tech Stack:** React 19, TypeScript DOM APIs, existing MutationObserver-based UnifiedListExperience, CSS, Node source-contract tests.

**Spec:** `docs/superpowers/specs/2026-09-16-invoice-import-bulk-tooltips-products-design.md`

## Global Constraints

- Tooltip appears only for actually clipped textual content.
- Hover and keyboard focus are supported.
- Tooltip hides on pointer leave, blur, scroll, list mutation and resize.
- Tooltip never leaves the viewport.
- Light and dark themes are supported.
- Native `title` on action buttons remains available for accessibility/usability.
- Native `title` used only for truncated row text is removed.
- Coverage is global for list/table content handled by `UnifiedListExperience`.

---

### Task 1: Add pure overflow/target helpers

**Files:**
- Create: `src/services/truncatedTextTooltip.ts`
- Create: `scripts/truncated-tooltip.test.mjs`

**Interfaces:**
- `isTextOverflowing(element:HTMLElement):boolean`
- `tooltipTextFor(element:HTMLElement):string`
- `isTooltipEligible(element:HTMLElement):boolean`

- [ ] **Step 1: Write failing helper/source-contract tests**

Because Node does not provide layout metrics, test the source contract plus pure text cleanup:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('overflow helper checks width and height clipping',async()=>{
  const source=await readFile(new URL('../src/services/truncatedTextTooltip.ts',import.meta.url),'utf8');
  assert.match(source,/scrollWidth\s*>\s*clientWidth/);
  assert.match(source,/scrollHeight\s*>\s*clientHeight/);
});

test('tooltip eligibility excludes buttons and action controls',async()=>{
  const source=await readFile(new URL('../src/services/truncatedTextTooltip.ts',import.meta.url),'utf8');
  assert.match(source,/button|input|select|textarea/i);
  assert.match(source,/zenviaRowAction|iconBtn|statusBtn/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/truncated-tooltip.test.mjs`
Expected: FAIL because helper file does not exist.

- [ ] **Step 3: Implement helpers**

Implement clipping as `element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1`; return compacted `textContent`; reject interactive controls, empty text, hidden elements and action containers.

- [ ] **Step 4: Run and verify GREEN**

Run: `node --test scripts/truncated-tooltip.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/truncatedTextTooltip.ts scripts/truncated-tooltip.test.mjs
git commit -m "feat: add truncated text tooltip helpers"
```

### Task 2: Add delegated tooltip manager to UnifiedListExperience

**Files:**
- Modify: `src/components/UnifiedListExperience.tsx`
- Modify: `scripts/truncated-tooltip.test.mjs`

**Interfaces:**
- One tooltip node with class `zenviaTruncatedTooltip` is appended to `document.body` while the experience is mounted.
- Eligible targets receive no permanent per-row listeners; use delegated pointer/focus listeners on `document`.

- [ ] **Step 1: Add failing integration source assertions**

Assert UnifiedListExperience imports `isTextOverflowing`, creates `zenviaTruncatedTooltip`, listens for `pointerover`, `pointerout`, `focusin`, `focusout`, `scroll`, and removes listeners on cleanup.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/truncated-tooltip.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement one floating tooltip**

On interaction, walk from `event.target` to the nearest eligible textual element inside `.page .tableCard`, `.masterMobileList`, `.zenviaUnifiedMobileList`, `.gmail*` list rows, or order/list containers already enhanced by UnifiedListExperience. Check overflow before scheduling display.

Use a short delay around 180ms for pointer hover, immediate display for keyboard focus. Set tooltip text with `textContent`, never `innerHTML`.

- [ ] **Step 4: Implement viewport positioning**

Use `getBoundingClientRect()` for target and tooltip. Prefer above with 8px gap; if insufficient top space, place below. Clamp horizontal `left` to 8px and `window.innerWidth - tooltipWidth - 8`.

- [ ] **Step 5: Hide on lifecycle events**

Cancel timer and hide on pointerout from current target, focusout, capture-phase scroll, resize, MutationObserver sync, and unmount.

- [ ] **Step 6: Run focused test/build**

Run: `node --test scripts/truncated-tooltip.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/UnifiedListExperience.tsx scripts/truncated-tooltip.test.mjs
git commit -m "feat: show elegant tooltip for clipped list text"
```

### Task 3: Add ZENVIA tooltip styling

**Files:**
- Create: `src/truncated-tooltip.css`
- Modify: `src/main.tsx`
- Modify: `scripts/truncated-tooltip.test.mjs`

**Interfaces:**
- `.zenviaTruncatedTooltip`
- `.zenviaTruncatedTooltip.visible`
- `.zenviaTruncatedTooltip[data-placement="top"]::after` and bottom equivalent.

- [ ] **Step 1: Add failing CSS/import assertions**

Assert CSS contains border radius, max-width, box-shadow, transition, pointer-events none, z-index, arrow pseudo-element, and dark-theme selector; assert main imports the stylesheet.

- [ ] **Step 2: Run and verify RED**

Run: `node --test scripts/truncated-tooltip.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement styles**

Use theme variables where available. Keep tooltip compact with approximately `max-width:min(360px,calc(100vw - 24px))`, `white-space:normal`, `word-break:break-word`, 8-10px radius, soft shadow and ~120ms opacity/transform animation.

- [ ] **Step 4: Import stylesheet from main.tsx**

Place import near existing global CSS imports so it loads once.

- [ ] **Step 5: Run test/build**

Run: `node --test scripts/truncated-tooltip.test.mjs && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/truncated-tooltip.css src/main.tsx scripts/truncated-tooltip.test.mjs
git commit -m "style: add ZENVIA truncated text tooltip"
```

### Task 4: Remove native data-text titles and ensure broad coverage

**Files:**
- Modify: `src/pages/Products.tsx`
- Inspect/modify only where needed: `src/pages/Suppliers.tsx`, `src/pages/Clients.tsx`, `src/pages/Invoices.tsx`, `src/pages/SalesInvoices.tsx`, `src/pages/Orders.tsx`, `src/pages/Gmail.tsx`
- Modify: `scripts/truncated-tooltip.test.mjs`

**Interfaces:**
- Product names must no longer use `title={p.name}`.
- Action/control titles such as `title="Editar"`, `title="Abrir factura"`, status buttons, theme/logout controls remain unchanged.

- [ ] **Step 1: Add failing assertion that product-name title is removed**

```js
assert.doesNotMatch(productsSource,/title=\{p\.name\}/);
```

- [ ] **Step 2: Audit data-text titles across list pages**

For each page, remove `title` only where the value is dynamic row/cell text intended to reveal truncation. Do not remove action-control titles.

- [ ] **Step 3: Ensure eligible text receives CSS clipping where necessary**

If a table cell currently truncates via a nested `strong`, `span`, or `.masterEntityCell`, make sure the actual clipped element has measurable `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` and a constrained width/max-width inherited from the existing table layout.

- [ ] **Step 4: Run full suite/build**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages src/components/UnifiedListExperience.tsx src/truncated-tooltip.css scripts/truncated-tooltip.test.mjs
git commit -m "fix: replace native row text titles with global tooltip"
```

### Task 5: Browser verification

**Files:**
- No production files unless verification exposes a defect.

- [ ] **Step 1: Verify desktop Product list**

Open Products at a desktop viewport. Confirm a long product name is visually clipped, hovering shows the full name in the ZENVIA tooltip, and short text shows no tooltip.

- [ ] **Step 2: Verify at least four other list types**

Check Suppliers, Invoices, Orders and one of Clients/Gmail/Sales. Confirm tooltip positioning and no overlap/out-of-viewport behavior.

- [ ] **Step 3: Verify dark mode**

Toggle dark mode and confirm contrast, arrow, shadow and text readability.

- [ ] **Step 4: Verify keyboard focus where focusable clipped text exists**

Tab through list/card content and confirm the tooltip displays for an eligible focused clipped element and hides on blur.

- [ ] **Step 5: Run final suite/build**

Run: `npm test && npm run build`
Expected: PASS.
