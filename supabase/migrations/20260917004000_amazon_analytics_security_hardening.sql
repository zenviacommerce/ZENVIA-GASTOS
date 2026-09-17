-- Harden direct privileges for Amazon Analytics tables.
-- RLS protects SELECT, but TRUNCATE/REFERENCES/TRIGGER are table privileges and must not remain on app roles.

revoke all on table
  public.amazon_product_mappings,
  public.amazon_finance_components,
  public.amazon_fx_rates
from anon, authenticated;

grant select on table
  public.amazon_product_mappings,
  public.amazon_finance_components
to authenticated;
