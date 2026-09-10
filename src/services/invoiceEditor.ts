import { supabase } from './supabase';

export async function updateInvoiceSupplier(invoiceId:string,supplierId:string) {
  if(!invoiceId) throw new Error('Factura no válida.');
  if(!supplierId) throw new Error('Selecciona un proveedor.');

  const { data, error } = await supabase
    .from('invoices')
    .update({ supplier_id: supplierId })
    .eq('id', invoiceId)
    .select('id')
    .single();

  if(error) throw error;
  if(!data?.id) throw new Error('No se pudo actualizar el proveedor de la factura.');
}
