import { supabase } from './supabase';

export async function reopenSalesInvoice(id: string) {
  const { data, error } = await supabase.rpc('reopen_sales_invoice', { p_invoice_id: id });
  if (error) throw error;
  return data;
}

export async function deleteReversibleSalesInvoice(id: string) {
  const { error } = await supabase.rpc('delete_reversible_sales_invoice', { p_invoice_id: id });
  if (error) throw error;
}
