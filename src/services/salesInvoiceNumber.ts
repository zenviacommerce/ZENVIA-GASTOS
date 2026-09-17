import { supabase } from './supabase';

export async function updateSalesInvoiceNumber(invoiceId:string,invoiceNumber:string){
  const clean=invoiceNumber.trim();
  if(!invoiceId)throw new Error('Factura no válida.');
  if(!clean)throw new Error('Indica un número de factura.');
  const {data,error}=await supabase.rpc('update_sales_invoice_number',{p_invoice_id:invoiceId,p_invoice_number:clean});
  if(error)throw error;
  return data;
}
