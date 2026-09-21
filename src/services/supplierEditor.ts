import { supabase } from './supabase';

export type SupplierType = 'unclassified' | 'goods' | 'service' | 'both';

export type SupplierInput = {
  name: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  supplierType: SupplierType;
  defaultCategoryId?: string|null;
};

function supplierRow(input: SupplierInput) {
  return {
    name: input.name.trim(),
    tax_id: input.taxId?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    website: input.website?.trim() || null,
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


export type SupplierOption={id:string;name:string;taxId:string|null};

export async function loadSupplierOptions():Promise<SupplierOption[]>{
  const {data,error}=await supabase.from('suppliers').select('id,name,tax_id').order('name');
  if(error)throw error;
  return (data??[]).map((row:any)=>({id:row.id,name:row.name,taxId:row.tax_id||null}));
}
