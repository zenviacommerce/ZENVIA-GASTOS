import { supabase } from './supabase';

export type SupplierInput = {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  supplierType: 'goods' | 'service' | 'both';
  defaultCategoryId?: string;
};

function supplierRow(input: SupplierInput) {
  return {
    name: input.name.trim(),
    tax_id: input.taxId?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    supplier_type: input.supplierType,
    default_category_id: input.defaultCategoryId || null,
  };
}

export async function addSupplier(input: SupplierInput) {
  const { error } = await supabase.from('suppliers').insert(supplierRow(input));
  if (error) throw error;
}

export async function updateSupplier(supplierId: string, input: SupplierInput) {
  const { error } = await supabase.from('suppliers').update(supplierRow(input)).eq('id', supplierId);
  if (error) throw error;
}
