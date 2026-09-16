# Invoice product and supplier cleanup

## Scope
- Reject fiscal/payment summary rows as invoice product lines.
- Remove stray currency symbols from imported product descriptions.
- Keep valid product descriptions intact, including dimensions such as 45x0,83 kgs.
- Show the full product name on hover when the Products table truncates it.
- Recognize dotted Spanish tax labels such as `C.I.F.` and save the supplier CIF.
- Extract and persist supplier address and website when they are present in the invoice.
- Do not overwrite existing supplier contact/profile fields with empty extracted values.
- When an invoice belongs to Mercancía, newly created suppliers should be typed as goods; an existing service supplier receiving goods should become both rather than losing its existing classification.
- Repair the already imported VIGATRO invoice/products/supplier after the code and schema changes are verified.

## Verification
- Regression tests must fail before implementation and pass after it.
- Production build must pass.
- Database migration must be verified against the live project.
- Current VIGATRO data must be queried after repair to confirm the five bad product rows are corrected/removed and the supplier profile contains the extracted details.
- Merge only after CI passes, then verify the main deployment status in Vercel.
