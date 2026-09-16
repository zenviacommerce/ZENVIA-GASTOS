# Select system normalization design

## Goal

Normalize every visible dropdown in ZENVIA Gastos so the application uses one coherent visual system while preserving two interaction modes: a simple selector for short, fixed lists and a searchable selector for growing catalogs. Also remove duplicate browser/native tooltips where the global truncated-text tooltip already applies.

## Architecture

Use two sibling form controls:

- `SelectField` for short, fixed lists such as tax rate, status, series, period, tracking status, fixed categories and similar enums.
- `SearchableSelect` for lists that can grow, such as suppliers, clients, products, countries and other dynamic catalogs.

Both controls share the same visual contract: trigger height, border, radius, typography, chevron, hover, focus, disabled/error states, menu surface, active option treatment, portal positioning, light/dark mode and responsive behavior. Search is the only intentional behavioral difference.

Native `<select>` elements must not remain visible in application forms or filters after migration, unless a documented technical exception is necessary.

## Selection rules

Use `SearchableSelect` when the list is dynamic or can grow materially with user data. Search text may include secondary identifiers such as CIF/NIF, email, phone, SKU or address when useful.

Use `SelectField` when the option set is small, bounded and fixed. Examples include VAT rate, invoice status, invoice series, tracking state, payment/status enums and small configuration choices.

## Floating menu behavior

Both controls use a body portal so menus cannot be clipped by modal or scrolling containers. The menu is fixed-positioned from the trigger bounding rectangle, recalculates on scroll and resize, and flips above or below according to viewport space. Mobile layouts keep the menu within the available viewport width.

## Accessibility

Both variants support keyboard use, focus visibility, Escape to close, ArrowUp/ArrowDown navigation, Enter selection, click/touch outside to close, and meaningful ARIA labeling. Removing native `title` attributes must not remove accessible names; use `aria-label` or existing visible text where required.

## Tooltip regression

The global truncated-text tooltip is the single tooltip system for overflowing text. Native `title` attributes that duplicate it must be removed from text cells, beginning with Orders product and tracking cells and covering equivalent duplicate cases elsewhere. The Orders regression shown by the user is caused by `title={productsText(order)}` coexisting with the global tooltip.

## Migration scope

Inventory and migrate visible native selects across `src/components` and `src/pages`, including Orders, sales invoices/configuration, expense filters, modals, Admin/Gmail/configuration areas and any other current UI location. Existing values, IDs, callbacks, persistence, filtering and business logic must remain unchanged.

## Verification

Add contract/regression tests that require:

- `SelectField` exists and shares the common visual/menu primitives with `SearchableSelect`.
- both selectors use portal/fixed floating menus and keyboard navigation.
- visible native `<select>` elements are no longer present in `src/pages` and `src/components` unless explicitly allow-listed.
- Orders does not attach duplicate native `title` tooltips to product/tracking text covered by the global tooltip.
- full existing test suite and production build pass.
