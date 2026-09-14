import { supabase } from './supabase';

export type BillableProduct = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  salePrice: number | null;
  taxRate: number;
  description: string;
};

export async function loadBillableProducts(): Promise<BillableProduct[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,sku,base_unit,sale_price,sales_tax_rate,invoice_description')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    sku: row.sku,
    unit: row.base_unit || 'ud',
    salePrice: row.sale_price == null ? null : Number(row.sale_price),
    taxRate: row.sales_tax_rate == null ? 21 : Number(row.sales_tax_rate),
    description: row.invoice_description || row.name,
  }));
}
